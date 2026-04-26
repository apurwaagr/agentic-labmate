"""Experiment plan builder — sync, used via run_in_executor from FastAPI routes."""
from __future__ import annotations

import uuid
import json
import logging
import time
from pathlib import Path
from typing import Any, Dict, List, Tuple

from .literature_qc import check_literature
from .parser import parse_user_input
from .schemas import ParsedHypothesis

logger = logging.getLogger(__name__)

DOMAIN_PROFILES: Dict[str, Dict[str, Any]] = {
    "cell biology": {"base_reagents": 420, "base_equipment": 180, "base_days": 10, "owner_exec": "Lab Scientist", "sustainability_bias": 66},
    "pharmacology": {"base_reagents": 520, "base_equipment": 240, "base_days": 14, "owner_exec": "Preclinical Scientist", "sustainability_bias": 60},
    "chemistry": {"base_reagents": 360, "base_equipment": 220, "base_days": 9, "owner_exec": "Chemist", "sustainability_bias": 58},
    "diagnostics": {"base_reagents": 490, "base_equipment": 260, "base_days": 12, "owner_exec": "Assay Scientist", "sustainability_bias": 64},
    "general science": {"base_reagents": 400, "base_equipment": 200, "base_days": 11, "owner_exec": "Scientist", "sustainability_bias": 62},
}

def _emit_timing(message: str) -> None:
    """Send timing diagnostics to both logger and stdout."""
    logger.info(message)
    print(message)


def _load_knowledge_base() -> Dict[str, Any]:
    """Load common reagents and protocols from knowledge base."""
    kb_path = Path(__file__).parent.parent / "data" / "common_reagents.json"
    if kb_path.exists():
        with open(kb_path) as f:
            return json.load(f)
    return {"reagents": [], "protocols": []}


_KNOWLEDGE_BASE = _load_knowledge_base()


def _domain_profile(domain: str) -> Dict[str, Any]:
    d = (domain or "").strip().lower()
    for key, profile in DOMAIN_PROFILES.items():
        if key in d:
            return profile
    return DOMAIN_PROFILES["general science"]


def _citation_confidence(literature: Any) -> float:
    refs = list(getattr(literature, "references", []) or [])
    total_results = max(0, int(getattr(literature, "total_results", 0) or 0))
    if total_results <= 0 and not refs:
        return 0.1
    now_year = 2026
    recency_scores: List[float] = []
    for ref in refs[:3]:
        y = getattr(ref, "year", None)
        if isinstance(y, int):
            age = max(0, now_year - y)
            recency_scores.append(max(0.0, 1.0 - age / 20))
        else:
            recency_scores.append(0.4)
    ref_strength = min(len(refs), 3) / 3
    recency = sum(recency_scores) / len(recency_scores) if recency_scores else 0.35
    retrieval = min(1.0, total_results / 500.0)
    return max(0.05, min(0.95, 0.45 * ref_strength + 0.35 * recency + 0.20 * retrieval))


def _estimate_complexity(parsed: ParsedHypothesis, total_results: int, citation_confidence: float) -> float:
    score = 0.45
    score += min(len(parsed.environmental_constraints), 4) * 0.08
    score += 0.08 if parsed.target_quantity else 0.0
    score += min(len(parsed.clarifying_questions), 4) * 0.09
    score += 0.06 if total_results == 0 else 0.0
    score += 0.04 if total_results > 500 else 0.0
    score -= citation_confidence * 0.16
    return max(0.15, min(score, 0.95))


def _confidence_from_state(parsed: ParsedHypothesis, total_results: int, citation_confidence: float) -> str:
    if parsed.clarifying_questions:
        return "Low"
    if citation_confidence >= 0.7 and total_results > 0:
        return "High"
    if citation_confidence >= 0.4 and total_results > 0:
        return "Medium"
    return "Low"


def _sustainability_score(parsed: ParsedHypothesis, profile: Dict[str, Any], complexity: float) -> int:
    base = int(profile["sustainability_bias"])
    if any("ice" in c.lower() for c in parsed.environmental_constraints):
        base -= 3
    if any("light exclusion" in c.lower() for c in parsed.environmental_constraints):
        base -= 2
    return max(45, min(base - int(complexity * 8), 85))


def _find_reagent_in_kb(search_term: str) -> Dict[str, Any] | None:
    """Search knowledge base for a reagent by name."""
    search_lower = search_term.lower()
    for reagent in _KNOWLEDGE_BASE.get("reagents", []):
        if reagent["name"].lower() in search_lower or search_lower in reagent["name"].lower():
            return reagent
    return None


def _find_protocol_in_kb(search_terms: List[str], hypothesis: str) -> Dict[str, Any] | None:
    """Search knowledge base for a protocol by keywords."""
    search_lower = " ".join(search_terms).lower()
    hypothesis_lower = hypothesis.lower()
    
    for protocol in _KNOWLEDGE_BASE.get("protocols", []):
        protocol_name = protocol["name"].lower()
        # Check if any search term matches protocol name
        if any(term.lower() in protocol_name for term in search_terms):
            return protocol
        # Check if hypothesis contains protocol keywords
        if protocol_name in hypothesis_lower:
            return protocol
        # Special case matching for common assay types
        if "cryoprotectant" in hypothesis_lower and "cryopreservation" in protocol_name:
            return protocol
        if "cryopreservation" in hypothesis_lower and "cryopreservation" in protocol_name:
            return protocol
        if "permeability" in hypothesis_lower and "permeability" in protocol_name:
            return protocol
        if "fitc-dextran" in hypothesis_lower and "permeability" in protocol_name:
            return protocol
        if "elisa" in hypothesis_lower and "elisa" in protocol_name:
            return protocol
        if "biosensor" in hypothesis_lower and "elisa" in protocol_name:
            return protocol
        if "electrochemical" in hypothesis_lower and "electrochemical" in protocol_name:
            return protocol
    return None


def _build_materials(parsed: ParsedHypothesis, profile: Dict[str, Any], complexity: float) -> List[Dict[str, Any]]:
    materials = []
    
    # Try to find intervention in knowledge base
    intervention_kb = _find_reagent_in_kb(parsed.intervention)
    if intervention_kb:
        materials.append({
            "name": intervention_kb["name"],
            "catalogNumber": intervention_kb["catalogNumber"],
            "supplier": intervention_kb["supplier"],
            "quantity": parsed.target_quantity or "Protocol-defined",
            "unitCostUsd": intervention_kb["unitCostUsd"],
            "leadTime": "4-10 days",
            "status": "order",
            "notes": intervention_kb["notes"],
            "sourceConfidence": 0.95,
            "sourceEvidence": f"Catalog match from {intervention_kb['supplier']}"
        })
    else:
        intervention_cost = max(80, int(profile["base_reagents"] * (0.45 + complexity * 0.5)))
        materials.append({
            "name": parsed.intervention,
            "catalogNumber": "TBD",
            "supplier": "Select validated supplier",
            "quantity": parsed.target_quantity or "Protocol-defined",
            "unitCostUsd": intervention_cost,
            "leadTime": "4-10 days",
            "status": "order",
            "notes": "Confirm grade/purity and storage constraints before ordering.",
            "sourceConfidence": 0.42,
            "sourceEvidence": "Heuristic from parsed intervention."
        })
    
    # Try to find subject in knowledge base
    subject_kb = _find_reagent_in_kb(parsed.subject)
    if subject_kb:
        materials.append({
            "name": subject_kb["name"],
            "catalogNumber": subject_kb["catalogNumber"],
            "supplier": subject_kb["supplier"],
            "quantity": "Per protocol",
            "unitCostUsd": subject_kb["unitCostUsd"],
            "leadTime": "2-7 days",
            "status": "in-stock",
            "notes": subject_kb["notes"],
            "sourceConfidence": 0.95,
            "sourceEvidence": f"Catalog match from {subject_kb['supplier']}"
        })
    else:
        subject_cost = max(40, int(profile["base_reagents"] * (0.25 + complexity * 0.35)))
        materials.append({
            "name": parsed.subject,
            "catalogNumber": "N/A",
            "supplier": "In-house / reference supplier",
            "quantity": "Per protocol",
            "unitCostUsd": subject_cost,
            "leadTime": "2-7 days",
            "status": "in-stock",
            "notes": "Validate model/system specification against protocol assumptions.",
            "sourceConfidence": 0.55,
            "sourceEvidence": "Derived from parsed subject."
        })
    
    # Consumables
    consumables_cost = max(35, int(profile["base_reagents"] * (0.2 + complexity * 0.25)))
    materials.append({
        "name": "Assay and controls consumables",
        "catalogNumber": "TBD",
        "supplier": "Preferred lab vendor",
        "quantity": "Per run",
        "unitCostUsd": consumables_cost,
        "leadTime": "2-5 days",
        "status": "order",
        "notes": "Include replicates and QA/QC controls.",
        "sourceConfidence": 0.48,
        "sourceEvidence": "Template consumables based on run structure."
    })
    
    return materials


def _build_timeline(profile: Dict[str, Any], complexity: float, citation_confidence: float) -> Tuple[List[Dict[str, Any]], int]:
    base_days = int(profile["base_days"])
    evidence_adjust = max(-1.5, min(1.5, (0.55 - citation_confidence) * 3))
    setup = max(2, int(round(base_days * 0.25 + complexity * 2 + evidence_adjust)))
    execution = max(3, int(round(base_days * 0.45 + complexity * 3 + evidence_adjust)))
    analysis = max(2, int(round(base_days * 0.30 + complexity * 2 + evidence_adjust * 0.7)))
    phases = [
        {"phase": "Setup and procurement", "durationDays": setup, "dependsOn": [], "owner": "Project Scientist", "deliverable": "Validated setup and materials readiness"},
        {"phase": "Experimental execution", "durationDays": execution, "dependsOn": ["Setup and procurement"], "owner": profile["owner_exec"], "deliverable": "Completed intervention + raw measurements"},
        {"phase": "Analysis and go/no-go review", "durationDays": analysis, "dependsOn": ["Experimental execution"], "owner": "Analyst", "deliverable": "Decision-ready report and next-step recommendation"},
    ]
    return phases, setup + execution + analysis


def _build_budget(materials: List[Dict[str, Any]], profile: Dict[str, Any], complexity: float, total_days: int, citation_confidence: float) -> Dict[str, Any]:
    reagents = int(sum(m["unitCostUsd"] for m in materials))
    equipment = int(profile["base_equipment"] * (0.8 + complexity * 0.5))
    shipping = int(max(45, reagents * (0.08 + complexity * 0.06)))
    labor = int(max(150, total_days * (35 + complexity * 20)))
    contingency_rate = max(0.04, 0.06 + complexity * 0.08 + (0.55 - citation_confidence) * 0.06)
    contingency = int((reagents + equipment + shipping + labor) * contingency_rate)
    total = reagents + equipment + shipping + labor + contingency
    cap = int(total * (1.18 + complexity * 0.2))
    return {
        "reagentsUsd": reagents, "equipmentUsd": equipment, "shippingUsd": shipping,
        "laborUsd": labor, "contingencyUsd": contingency, "totalUsd": total,
        "budgetCapUsd": cap, "savedUsd": max(cap - total, 0),
        "reliability": f"Derived estimate ({int(round(citation_confidence * 100))}/100 citation confidence). Validate with vendor quotes.",
        "assumptions": ["Single-site execution.", "One primary run with replicates.", "No major capital equipment purchase."],
        "lineItems": [
            {"label": "Primary reagents and assay kits", "amountUsd": reagents, "category": "reagents", "note": "Intervention + subject + consumables"},
            {"label": "Instrument and setup overhead", "amountUsd": equipment, "category": "equipment", "note": "Calibration and shared equipment access"},
            {"label": "Procurement and shipping", "amountUsd": shipping, "category": "shipping", "note": "Includes cold-chain if needed"},
            {"label": "Scientist labor", "amountUsd": labor, "category": "labor", "note": f"Estimated over ~{total_days} execution days"},
            {"label": "Contingency buffer", "amountUsd": contingency, "category": "contingency", "note": "Handles reruns and variance"},
        ],
    }


def _build_benchmark(total_cost: int, total_days: int, sustainability: int) -> List[Dict[str, Any]]:
    return [
        {"label": "This plan", "time": f"{total_days} days", "cost": total_cost, "sustainability": sustainability, "ours": True},
        {"label": "Typical baseline", "time": f"{int(max(total_days + 2, total_days * 1.25))} days", "cost": int(total_cost * 1.22), "sustainability": max(sustainability - 10, 40), "ours": False},
    ]


def _novelty_to_frontend(novelty_signal: str) -> str:
    return {"not_found": "not found", "similar_work_exists": "similar work exists", "exact_match_found": "exact match found", "unavailable": "search unavailable"}.get(novelty_signal, "similar work exists")


def _safe_parse(hypothesis_text: str) -> ParsedHypothesis:
    try:
        return parse_user_input(hypothesis_text)
    except Exception as exc:
        err_msg = str(exc).strip() or "Unknown parser error."
        return ParsedHypothesis(
            original_input=hypothesis_text, domain="General Science",
            subject="unspecified subject", intervention="unspecified intervention",
            outcome_metric="quantitative change > 0%", is_novelty_search=False,
            control_condition="baseline/control group",
            clarifying_questions=[f"Parser fallback: {err_msg}", "Please confirm subject, intervention, and metric."],
        )


def build_experiment_plan(hypothesis_text: str, reviews: List[Dict[str, Any]]) -> Dict[str, Any]:
    request_id = uuid.uuid4().hex[:8]
    t0 = time.perf_counter()
    _emit_timing(f"[plan:{request_id}] Starting plan generation")

    t_parse_start = time.perf_counter()
    parsed = _safe_parse(hypothesis_text)
    t_parse_ms = (time.perf_counter() - t_parse_start) * 1000
    _emit_timing(
        f"[plan:{request_id}] Parse complete in {t_parse_ms:.1f}ms "
        f"(domain={getattr(parsed, 'domain', 'unknown')}, subject={getattr(parsed, 'subject', 'unknown')})"
    )

    t_lit_start = time.perf_counter()
    try:
        literature = check_literature(parsed)
        lit_error = None
    except Exception as exc:
        lit_error = str(exc)
        literature = type("LitFallback", (), {
            "novelty_signal": "unavailable", "references": [],
            "search_query_used": f"{parsed.domain} {parsed.subject} {parsed.intervention}",
            "total_results": -1, "error_msg": str(exc),
        })()
    t_lit_ms = (time.perf_counter() - t_lit_start) * 1000
    _emit_timing(
        f"[plan:{request_id}] Literature QC complete in {t_lit_ms:.1f}ms "
        f"(signal={getattr(literature, 'novelty_signal', 'unknown')}, "
        f"total_results={getattr(literature, 'total_results', 'unknown')}, "
        f"error={lit_error or 'none'})"
    )

    t_assemble_start = time.perf_counter()
    refs = [{"title": r.title, "uri": r.url, "source": f"{r.authors} ({r.year})" if r.year else r.authors} for r in literature.references]
    if not refs:
        refs = [{"title": "No directly matching references found", "uri": "", "source": "OpenAlex search"}]

    novelty_label = _novelty_to_frontend(getattr(literature, "novelty_signal", "similar_work_exists"))
    novelty_summary = (
        f"OpenAlex literature search unavailable. (Error: {getattr(literature, 'error_msg', 'Network error')})"
        if getattr(literature, "novelty_signal", "") == "unavailable"
        else f"OpenAlex returned {literature.total_results} results for '{literature.search_query_used}'."
    )

    review_adaptations = [{"section": r["section"], "change": r["correction"], "impact": "Integrated into next regeneration."} for r in reviews[-3:]]

    profile = _domain_profile(parsed.domain)
    citation_confidence = _citation_confidence(literature)
    total_results = max(0, getattr(literature, "total_results", 0))
    complexity = _estimate_complexity(parsed, total_results, citation_confidence)
    materials = _build_materials(parsed, profile, complexity)
    timeline, total_days = _build_timeline(profile, complexity, citation_confidence)
    budget = _build_budget(materials, profile, complexity, total_days, citation_confidence)
    sustainability_value = _sustainability_score(parsed, profile, complexity)
    confidence_label = _confidence_from_state(parsed, total_results, citation_confidence)
    benchmark = _build_benchmark(budget["totalUsd"], total_days, sustainability_value)

    has_real_refs = bool(getattr(literature, "references", []) and getattr(literature, "total_results", 0) > 0)
    placeholder_materials = sum(1 for m in materials if str(m.get("catalogNumber", "")).upper() in {"TBD", "N/A"})
    material_conf = max(0.2, min(0.95, citation_confidence - 0.12 * (placeholder_materials / max(len(materials), 1))))
    
    # Try to find matching protocol in knowledge base
    protocol_kb = _find_protocol_in_kb([parsed.intervention, parsed.subject, parsed.outcome_metric], hypothesis_text)
    if protocol_kb:
        protocol_conf = 0.95
        protocol_source = protocol_kb["source"]
        protocol_uri = protocol_kb["uri"]
        protocol_steps = protocol_kb["steps"]
    else:
        protocol_conf = max(0.2, min(0.95, citation_confidence - (0.1 if parsed.clarifying_questions else 0.0)))
        protocol_source = "Protocol heuristic"
        protocol_uri = ""
        protocol_steps = []
    
    timeline_conf = max(0.25, min(0.95, 0.55 + (0.4 - complexity * 0.25)))
    validation_conf = max(0.25, min(0.95, 0.5 + (0.35 if not parsed.clarifying_questions else -0.15)))

    plan_id = f"exp-{uuid.uuid4().hex[:8]}"
    
    # Build steps from protocol if available, otherwise use heuristic
    if protocol_steps:
        steps = []
        for i, step_text in enumerate(protocol_steps, 1):
            steps.append({
                "id": f"s{i}",
                "title": f"Protocol step {i}",
                "detail": step_text,
                "quantity": "Protocol-defined",
                "duration": f"Day {i}-{i+1}",
                "source": protocol_source,
                "sourceConfidence": 0.95,
                "sourceEvidence": f"Protocol from {protocol_source}: {protocol_uri}",
                "riskLevel": "low",
                "riskNote": "Validated protocol from peer-reviewed source.",
                "validationChecks": ["Follow protocol exactly", "Document any deviations"],
                "decisionGate": "Proceed if step completed successfully.",
            })
    else:
        steps = [
            {
                "id": "s1", "title": "Prepare control and treatment groups",
                "detail": f"Set up baseline control ({parsed.control_condition or 'standard condition'}) and treatment with {parsed.intervention}.",
                "quantity": parsed.target_quantity or "Protocol-defined",
                "duration": f"Day 1-{max(2, int(total_days * 0.3))}",
                "source": "Protocol heuristic", "sourceConfidence": round(protocol_conf - 0.08, 3),
                "sourceEvidence": "No protocol repository mapping found for exact setup/control pair.",
                "riskLevel": "med", "riskNote": "Unclear dosing or setup can bias downstream outcomes.",
                "validationChecks": ["Randomization documented", "Control condition matches baseline claim"],
                "decisionGate": "Proceed only if baseline variance is acceptable.",
            },
            {
                "id": "s2", "title": "Apply intervention and monitor",
                "detail": f"Apply {parsed.intervention} under declared constraints: {', '.join(parsed.environmental_constraints) if parsed.environmental_constraints else 'standard conditions'}.",
                "quantity": parsed.target_quantity or "Protocol-defined",
                "duration": f"Day {max(2, int(total_days * 0.3))}-{max(4, int(total_days * 0.75))}",
                "source": "Parsed hypothesis", "sourceConfidence": round(protocol_conf, 3),
                "sourceEvidence": "Anchored to parsed intervention and constraints.",
                "riskLevel": "med", "riskNote": "Environmental drift may reduce reproducibility.",
                "validationChecks": ["Temperature/log checks", "Intervention timing recorded"],
                "decisionGate": "Repeat run if intervention deviations exceed threshold.",
            },
            {
                "id": "s3", "title": "Measure primary outcome",
                "detail": f"Quantify outcome metric: {parsed.outcome_metric}.",
                "quantity": "n>=4 replicates",
                "duration": f"Day {max(4, int(total_days * 0.75))}-{total_days}",
                "source": "Hypothesis metric", "sourceConfidence": round(protocol_conf + 0.05, 3),
                "sourceEvidence": "Outcome metric sourced from parsed hypothesis statement.",
                "riskLevel": "low",
                "validationChecks": ["Predefine statistical test", "Include confidence intervals"],
                "decisionGate": "Go only if effect size and uncertainty meet criteria.",
            },
        ]
    
    evidence_sources = list(refs)
    if protocol_uri:
        evidence_sources.append({
            "title": "Matched protocol template",
            "uri": protocol_uri,
            "source": protocol_source,
        })
    elif protocol_source:
        evidence_sources.append({
            "title": "Protocol generation fallback",
            "uri": "",
            "source": "Protocol heuristic (no exact repository match)",
        })
    evidence_sources.append({
        "title": "Hypothesis parse extraction",
        "uri": "",
        "source": "Vertex/Groq parser from user input",
    })

    response = {
        "experiment": {
            "id": plan_id, "project": "Agentic Labmate", "hypothesis": hypothesis_text,
            "originalInput": getattr(parsed, "original_input", hypothesis_text),
            "clarifyingQuestions": getattr(parsed, "clarifying_questions", []),
            "plainEnglish": f"Test whether {parsed.intervention} changes {parsed.outcome_metric} for {parsed.subject} compared to {parsed.control_condition or 'control'}.",
            "domain": parsed.domain,
            "metrics": {"confidence": confidence_label, "novelty": novelty_label.title(), "sustainability": f"{sustainability_value}/100"},
            "confidenceExplanation": f"Literature retrieval returned {total_results} results. Citation confidence is {int(round(citation_confidence * 100))}/100.",
            "citationConfidence": round(citation_confidence, 3),
            "novelty": {"signal": novelty_label, "summary": novelty_summary, "references": refs},
            "sectionConfidence": {
                "novelty": round(citation_confidence if has_real_refs else 0.25, 3),
                "protocol": round(protocol_conf, 3), "materials": round(material_conf, 3),
                "timeline": round(timeline_conf, 3), "validation": round(validation_conf, 3),
            },
            "materials": materials,
            "steps": steps,
            "timeline": timeline, "budget": budget, "benchmark": benchmark,
            "validation": {
                "primaryMetric": parsed.outcome_metric,
                "successCriteria": "Observed improvement against control with statistical significance.",
                "failureCriteria": ["No measurable delta against control", "High variance across replicates", "Protocol deviations invalidate comparison"],
                "decisionGates": ["Control quality pass", "Intervention consistency pass", "Outcome confidence pass"],
            },
            "reviewAdaptations": review_adaptations,
            "sources": evidence_sources,
        }
    }
    t_assemble_ms = (time.perf_counter() - t_assemble_start) * 1000
    t_total_ms = (time.perf_counter() - t0) * 1000
    _emit_timing(f"[plan:{request_id}] Plan assembled in {t_assemble_ms:.1f}ms; total={t_total_ms:.1f}ms")
    return response
