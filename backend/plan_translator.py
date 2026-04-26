"""Translate `plan_gen` JSON output into the frontend `ExperimentPlan` shape.

The SSE `/plan` endpoint emits a rich plan produced by `plan_gen.generate_plan`
(protocol/materials/budget/timeline/validation). The browser UI, however,
consumes the richer `ExperimentPlan` contract defined in `src/lib/labApi.ts`
(id/project/hypothesis/plainEnglish/metrics/novelty/materials/steps/timeline/
budget/benchmark/validation/reviewAdaptations/sources).

`build_frontend_experiment` stitches these two shapes together, pulling novelty
metadata from `check_literature` and supplementary source citations from the
OpenAlex/S2 paper corpus fetched earlier in the pipeline. When fields are
missing (for example if the LLM truncates a section), we fall back to the same
domain heuristics used by `labmate.api_logic.build_experiment_plan` so that the
frontend never sees an unpopulated section.
"""
from __future__ import annotations

import re
import uuid
from typing import Any, Dict, List, Optional

from .input_parser import ParsedHypothesis
from .labmate.literature_schemas import LiteratureQCResult


_SIGNAL_MAP = {
    "not_found": "not found",
    "similar_work_exists": "similar work exists",
    "exact_match_found": "exact match found",
}

_DOMAIN_PROFILES: Dict[str, Dict[str, Any]] = {
    "cell biology": {"base_days": 10, "owner_exec": "Lab Scientist", "sustainability_bias": 66},
    "pharmacology": {"base_days": 14, "owner_exec": "Preclinical Scientist", "sustainability_bias": 60},
    "chemistry": {"base_days": 9, "owner_exec": "Chemist", "sustainability_bias": 58},
    "diagnostics": {"base_days": 12, "owner_exec": "Assay Scientist", "sustainability_bias": 64},
    "general science": {"base_days": 11, "owner_exec": "Scientist", "sustainability_bias": 62},
}


def _domain_profile(domain: str) -> Dict[str, Any]:
    d = (domain or "").strip().lower()
    for key, profile in _DOMAIN_PROFILES.items():
        if key in d:
            return profile
    return _DOMAIN_PROFILES["general science"]


def _as_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _as_int(value: Any, default: int = 0) -> int:
    try:
        if value is None:
            return default
        if isinstance(value, bool):
            return int(value)
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _parse_duration_to_days(text: Any) -> int:
    """Best-effort: extract a day count from a duration string like '3 days', '2 weeks'."""
    if isinstance(text, (int, float)):
        return max(1, int(text))
    if not isinstance(text, str) or not text.strip():
        return 1
    s = text.lower()
    m = re.search(r"(\d+(?:\.\d+)?)\s*(day|week|hour|hr|min)", s)
    if not m:
        return 1
    amount = float(m.group(1))
    unit = m.group(2)
    if unit == "week":
        return max(1, int(round(amount * 7)))
    if unit in {"hour", "hr"}:
        return max(1, int(round(amount / 24)) or 1)
    if unit == "min":
        return 1
    return max(1, int(round(amount)))


def _novelty_signal(qc: Optional[LiteratureQCResult]) -> str:
    if qc is None:
        return "similar work exists"
    return _SIGNAL_MAP.get(qc.novelty_signal, "similar work exists")


def _qc_references(qc: Optional[LiteratureQCResult]) -> List[Dict[str, Any]]:
    if qc is None or not qc.references:
        return []
    return [
        {
            "title": r.title,
            "uri": r.url,
            "source": f"{r.authors} ({r.year})" if r.year else r.authors,
        }
        for r in qc.references
    ]


def _paper_sources(papers: List[Dict[str, Any]], limit: int = 8) -> List[Dict[str, Any]]:
    sources: List[Dict[str, Any]] = []
    for p in papers[:limit]:
        title = (p.get("title") or "").strip()
        if not title:
            continue
        doi = p.get("doi")
        uri = f"https://doi.org/{doi}" if doi else ""
        year = p.get("year") or ""
        sources.append({
            "title": title,
            "uri": uri,
            "source": f"Semantic Scholar ({year})" if year else "Semantic Scholar",
        })
    return sources


def _extract_uri(text: str) -> str:
    if not text:
        return ""
    m = re.search(r"https?://[^\s)]+", text)
    return m.group(0) if m else ""


def _extract_catalog(text: str) -> str:
    if not text:
        return ""
    # Common catalog patterns: CAT12345, ab1234, sc-12345, etc.
    m = re.search(r"\b([A-Za-z]{1,4}[-_]?\d{3,8})\b", text)
    return m.group(1) if m else ""


def _extract_vendor(text: str) -> str:
    if not text:
        return ""
    known = [
        "Sigma-Aldrich",
        "Thermo Fisher",
        "Invitrogen",
        "Promega",
        "Qiagen",
        "Abcam",
        "Bio-Rad",
        "ATCC",
        "CST",
        "Cell Signaling",
    ]
    lowered = text.lower()
    for vendor in known:
        if vendor.lower() in lowered:
            return vendor
    return ""


def _citation_confidence(qc: Optional[LiteratureQCResult]) -> float:
    if qc is None:
        return 0.2
    refs = qc.references or []
    total = max(0, qc.total_results)
    if not refs and total <= 0:
        return 0.1
    now_year = 2026
    recency: List[float] = []
    for r in refs[:3]:
        if isinstance(r.year, int):
            age = max(0, now_year - r.year)
            recency.append(max(0.0, 1.0 - age / 20))
        else:
            recency.append(0.4)
    ref_strength = min(len(refs), 3) / 3
    recency_score = sum(recency) / len(recency) if recency else 0.35
    retrieval = min(1.0, total / 500.0)
    return max(0.05, min(0.95, 0.45 * ref_strength + 0.35 * recency_score + 0.20 * retrieval))


def _confidence_label(parsed: ParsedHypothesis, qc: Optional[LiteratureQCResult], citation_conf: float) -> str:
    if parsed.clarifying_questions:
        return "Low"
    total = qc.total_results if qc is not None else 0
    if citation_conf >= 0.7 and total > 0:
        return "High"
    if citation_conf >= 0.4 and total > 0:
        return "Medium"
    return "Low"


def _materials_from_plan(plan_materials: Any) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    raw = (plan_materials or {}).get("items") if isinstance(plan_materials, dict) else None
    if not isinstance(raw, list):
        return items
    for idx, item in enumerate(raw):
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or f"Material {idx + 1}")
        notes = str(item.get("notes") or "")
        source_uri = str(item.get("source_uri") or item.get("sourceUri") or "") or _extract_uri(notes)
        parsed_catalog = _extract_catalog(notes)
        parsed_vendor = _extract_vendor(notes)
        catalog = str(item.get("catalog") or item.get("catalog_number") or parsed_catalog or "TBD")
        vendor = str(item.get("vendor") or item.get("supplier") or parsed_vendor or "Select validated supplier")
        quantity = str(item.get("quantity") or "Protocol-defined")
        unit_price = _as_float(item.get("unit_price_usd") or item.get("unitCostUsd"), 0.0)
        is_placeholder = catalog.upper() in {"TBD", "N/A", ""} or "verify with supplier" in notes.lower()
        items.append({
            "name": name,
            "catalogNumber": catalog,
            "supplier": vendor,
            "quantity": quantity,
            "unitCostUsd": round(unit_price, 2),
            "leadTime": str(item.get("lead_time") or "2-7 days"),
            "status": "order" if is_placeholder else "in-stock",
            "notes": notes,
            "sourceUri": source_uri,
        })
    return items


def _fallback_materials(parsed: ParsedHypothesis) -> List[Dict[str, Any]]:
    return [
        {
            "name": parsed.intervention or "Intervention reagent",
            "catalogNumber": "TBD",
            "supplier": "Select validated supplier",
            "quantity": parsed.target_quantity or "Protocol-defined",
            "unitCostUsd": 250.0,
            "leadTime": "4-10 days",
            "status": "order",
            "notes": "Confirm grade/purity and storage constraints before ordering.",
        },
        {
            "name": parsed.subject or "Subject system",
            "catalogNumber": "N/A",
            "supplier": "In-house / reference supplier",
            "quantity": "Per protocol",
            "unitCostUsd": 120.0,
            "leadTime": "2-7 days",
            "status": "in-stock",
            "notes": "Validate model/system specification against protocol assumptions.",
        },
        {
            "name": "Assay and controls consumables",
            "catalogNumber": "TBD",
            "supplier": "Preferred lab vendor",
            "quantity": "Per run",
            "unitCostUsd": 95.0,
            "leadTime": "2-5 days",
            "status": "order",
            "notes": "Include replicates and QA/QC controls.",
        },
    ]


def _steps_from_plan(
    plan_protocol: Any,
    parsed: ParsedHypothesis,
    total_days: int,
) -> List[Dict[str, Any]]:
    steps: List[Dict[str, Any]] = []
    raw = (plan_protocol or {}).get("steps") if isinstance(plan_protocol, dict) else None
    if not isinstance(raw, list) or not raw:
        return _fallback_steps(parsed, total_days)
    for idx, entry in enumerate(raw):
        if not isinstance(entry, dict):
            continue
        step_num = _as_int(entry.get("step"), idx + 1)
        action = str(entry.get("action") or f"Step {step_num}")
        detail = str(entry.get("notes") or entry.get("detail") or action)
        duration = str(entry.get("duration") or "Protocol-defined")
        risk = entry.get("risk_level") or entry.get("riskLevel")
        risk_level = risk if risk in {"low", "med", "high"} else "med"
        source_hint = _extract_uri(detail)
        steps.append({
            "id": f"s{step_num}",
            "title": action[:120],
            "detail": detail,
            "quantity": str(entry.get("quantity") or parsed.target_quantity or "Protocol-defined"),
            "duration": duration,
            "source": source_hint or "Knowledge graph context",
            "riskLevel": risk_level,
            "riskNote": str(entry.get("risk_note") or entry.get("riskNote") or "") or None,
            "validationChecks": list(entry.get("validation_checks") or entry.get("validationChecks") or []),
            "decisionGate": str(entry.get("decision_gate") or entry.get("decisionGate") or "") or None,
        })
    return steps or _fallback_steps(parsed, total_days)


def _fallback_steps(parsed: ParsedHypothesis, total_days: int) -> List[Dict[str, Any]]:
    constraints = ", ".join(parsed.environmental_constraints) if parsed.environmental_constraints else "standard conditions"
    return [
        {
            "id": "s1",
            "title": "Prepare control and treatment groups",
            "detail": f"Set up baseline control ({parsed.control_condition or 'standard condition'}) and treatment with {parsed.intervention}.",
            "quantity": parsed.target_quantity or "Protocol-defined",
            "duration": f"Day 1-{max(2, int(total_days * 0.3))}",
            "source": "Protocol heuristic",
            "riskLevel": "med",
            "riskNote": "Unclear dosing or setup can bias downstream outcomes.",
            "validationChecks": ["Randomization documented", "Control condition matches baseline claim"],
            "decisionGate": "Proceed only if baseline variance is acceptable.",
        },
        {
            "id": "s2",
            "title": "Apply intervention and monitor",
            "detail": f"Apply {parsed.intervention} under declared constraints: {constraints}.",
            "quantity": parsed.target_quantity or "Protocol-defined",
            "duration": f"Day {max(2, int(total_days * 0.3))}-{max(4, int(total_days * 0.75))}",
            "source": "Parsed hypothesis",
            "riskLevel": "med",
            "riskNote": "Environmental drift may reduce reproducibility.",
            "validationChecks": ["Temperature/log checks", "Intervention timing recorded"],
            "decisionGate": "Repeat run if intervention deviations exceed threshold.",
        },
        {
            "id": "s3",
            "title": "Measure primary outcome",
            "detail": f"Quantify outcome metric: {parsed.outcome_metric}.",
            "quantity": "n>=4 replicates",
            "duration": f"Day {max(4, int(total_days * 0.75))}-{total_days}",
            "source": "Hypothesis metric",
            "riskLevel": "low",
            "validationChecks": ["Predefine statistical test", "Include confidence intervals"],
            "decisionGate": "Go only if effect size and uncertainty meet criteria.",
        },
    ]


def _timeline_from_plan(
    plan_timeline: Any,
    profile: Dict[str, Any],
) -> tuple[List[Dict[str, Any]], int]:
    phases: List[Dict[str, Any]] = []
    total_days = 0
    raw = (plan_timeline or {}).get("phases") if isinstance(plan_timeline, dict) else None
    total_weeks = (plan_timeline or {}).get("total_weeks") if isinstance(plan_timeline, dict) else None

    if isinstance(raw, list) and raw:
        for entry in raw:
            if not isinstance(entry, dict):
                continue
            name = str(entry.get("name") or entry.get("phase") or "Phase")
            weeks = entry.get("weeks")
            days = entry.get("durationDays")
            if isinstance(days, (int, float)):
                duration_days = max(1, int(days))
            else:
                duration_days = _parse_duration_to_days(weeks) if weeks is not None else max(3, profile["base_days"] // max(len(raw), 1))
            depends = entry.get("depends_on") or entry.get("dependsOn") or []
            if not isinstance(depends, list):
                depends = [str(depends)] if depends else []
            owner = str(entry.get("owner") or profile["owner_exec"])
            deliverable = str(entry.get("deliverable") or f"Completion of {name}")
            phases.append({
                "phase": name,
                "durationDays": duration_days,
                "dependsOn": [str(d) for d in depends],
                "owner": owner,
                "deliverable": deliverable,
            })
            total_days += duration_days

    if not phases:
        base = int(profile["base_days"])
        phases = [
            {"phase": "Setup and procurement", "durationDays": max(2, int(base * 0.25)), "dependsOn": [], "owner": "Project Scientist", "deliverable": "Validated setup and materials readiness"},
            {"phase": "Experimental execution", "durationDays": max(3, int(base * 0.45)), "dependsOn": ["Setup and procurement"], "owner": profile["owner_exec"], "deliverable": "Completed intervention + raw measurements"},
            {"phase": "Analysis and go/no-go review", "durationDays": max(2, int(base * 0.30)), "dependsOn": ["Experimental execution"], "owner": "Analyst", "deliverable": "Decision-ready report and next-step recommendation"},
        ]
        total_days = sum(p["durationDays"] for p in phases)
    elif total_days <= 0 and isinstance(total_weeks, (int, float)):
        total_days = max(1, int(round(total_weeks * 7)))
    return phases, total_days


def _budget_from_plan(
    plan_budget: Any,
    materials: List[Dict[str, Any]],
    total_days: int,
) -> Dict[str, Any]:
    reagents_cost = int(sum(_as_float(m.get("unitCostUsd")) for m in materials))
    labor_cost = max(150, total_days * 45)
    equipment_cost = 180
    shipping_cost = max(45, int(reagents_cost * 0.1))

    plan_total = _as_float((plan_budget or {}).get("total_usd"))
    breakdown_raw = (plan_budget or {}).get("breakdown") if isinstance(plan_budget, dict) else []
    breakdown: List[Dict[str, Any]] = []
    category_totals: Dict[str, int] = {}
    if isinstance(breakdown_raw, list):
        for entry in breakdown_raw:
            if not isinstance(entry, dict):
                continue
            label = str(entry.get("category") or entry.get("label") or "Line item")
            amount = int(_as_float(entry.get("amount_usd") or entry.get("amount") or entry.get("amountUsd")))
            category_key = label.lower()
            if "reagent" in category_key or "material" in category_key or "kit" in category_key:
                cat = "reagents"
            elif "equip" in category_key or "instrument" in category_key:
                cat = "equipment"
            elif "ship" in category_key or "proc" in category_key:
                cat = "shipping"
            elif "labor" in category_key or "personnel" in category_key or "staff" in category_key:
                cat = "labor"
            else:
                cat = "contingency"
            breakdown.append({
                "label": label,
                "amountUsd": amount,
                "category": cat,
                "note": str(entry.get("note") or ""),
            })
            category_totals[cat] = category_totals.get(cat, 0) + amount

    reagents = category_totals.get("reagents", reagents_cost)
    equipment = category_totals.get("equipment", equipment_cost)
    shipping = category_totals.get("shipping", shipping_cost)
    labor = category_totals.get("labor", labor_cost)
    contingency = category_totals.get("contingency", int((reagents + equipment + shipping + labor) * 0.1))
    total_usd = int(plan_total) if plan_total > 0 else (reagents + equipment + shipping + labor + contingency)
    cap = int(total_usd * 1.2)

    if not breakdown:
        breakdown = [
            {"label": "Primary reagents and assay kits", "amountUsd": reagents, "category": "reagents", "note": "Intervention + subject + consumables"},
            {"label": "Instrument and setup overhead", "amountUsd": equipment, "category": "equipment", "note": "Calibration and shared equipment access"},
            {"label": "Procurement and shipping", "amountUsd": shipping, "category": "shipping", "note": "Includes cold-chain if needed"},
            {"label": "Scientist labor", "amountUsd": labor, "category": "labor", "note": f"Estimated over ~{total_days} execution days"},
            {"label": "Contingency buffer", "amountUsd": contingency, "category": "contingency", "note": "Handles reruns and variance"},
        ]

    return {
        "reagentsUsd": reagents,
        "equipmentUsd": equipment,
        "shippingUsd": shipping,
        "laborUsd": labor,
        "contingencyUsd": contingency,
        "totalUsd": total_usd,
        "budgetCapUsd": cap,
        "savedUsd": max(cap - total_usd, 0),
        "reliability": "Derived from plan_gen output + domain heuristics.",
        "assumptions": ["Single-site execution.", "One primary run with replicates.", "No major capital equipment purchase."],
        "lineItems": breakdown,
    }


def _validation_from_plan(plan_validation: Any, parsed: ParsedHypothesis) -> Dict[str, Any]:
    pv = plan_validation if isinstance(plan_validation, dict) else {}
    primary_metric = str(pv.get("primary_metric") or pv.get("primaryMetric") or parsed.outcome_metric or "Primary outcome metric")
    success = str(pv.get("success_criteria") or pv.get("successCriteria") or "Observed improvement against control with statistical significance.")
    approach = str(pv.get("approach") or "")
    failure = pv.get("failure_criteria") or pv.get("failureCriteria") or [
        "No measurable delta against control",
        "High variance across replicates",
        "Protocol deviations invalidate comparison",
    ]
    if not isinstance(failure, list):
        failure = [str(failure)]
    gates = pv.get("decision_gates") or pv.get("decisionGates") or []
    if not isinstance(gates, list):
        gates = [str(gates)] if gates else []
    if not gates:
        gates = ["Control quality pass", "Intervention consistency pass", "Outcome confidence pass"]
    if approach and approach not in gates:
        gates = [approach, *gates]
    return {
        "primaryMetric": primary_metric,
        "successCriteria": success,
        "failureCriteria": [str(x) for x in failure],
        "decisionGates": [str(x) for x in gates],
    }


def _benchmark(total_cost: int, total_days: int, sustainability: int) -> List[Dict[str, Any]]:
    return [
        {"label": "This plan", "time": f"{total_days} days", "cost": total_cost, "sustainability": sustainability, "ours": True},
        {"label": "Typical baseline", "time": f"{int(max(total_days + 2, total_days * 1.25))} days", "cost": int(total_cost * 1.22), "sustainability": max(sustainability - 10, 40), "ours": False},
    ]


def build_frontend_experiment(
    *,
    hypothesis: str,
    parsed: ParsedHypothesis,
    plan_json: Dict[str, Any],
    qc_result: Optional[LiteratureQCResult],
    papers: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Stitch plan_gen JSON + parsed hypothesis + QC result + papers into an ExperimentPlan."""
    profile = _domain_profile(parsed.domain)
    novelty_label = _novelty_signal(qc_result)
    qc_refs = _qc_references(qc_result)
    paper_sources = _paper_sources(papers)
    # Prefer actionable sources (has URI) and de-duplicate by title.
    seen_titles = {r["title"] for r in qc_refs}
    ranked_papers = sorted(
        paper_sources,
        key=lambda s: (bool(s.get("uri")), "doi.org" in (s.get("uri") or "")),
        reverse=True,
    )
    combined_sources = list(qc_refs)
    for src in ranked_papers:
        if src["title"] in seen_titles:
            continue
        combined_sources.append(src)
        seen_titles.add(src["title"])

    citation_conf = _citation_confidence(qc_result)
    confidence_label = _confidence_label(parsed, qc_result, citation_conf)

    materials = _materials_from_plan(plan_json.get("materials")) or _fallback_materials(parsed)
    timeline, total_days = _timeline_from_plan(plan_json.get("timeline"), profile)
    if total_days <= 0:
        total_days = profile["base_days"]
    steps = _steps_from_plan(plan_json.get("protocol"), parsed, total_days)
    budget = _budget_from_plan(plan_json.get("budget"), materials, total_days)
    validation = _validation_from_plan(plan_json.get("validation"), parsed)

    sustainability = max(45, min(profile["sustainability_bias"] + (5 if citation_conf > 0.6 else 0), 85))
    benchmark = _benchmark(budget["totalUsd"], total_days, sustainability)

    novelty_summary = (
        f"OpenAlex returned {qc_result.total_results} results for '{qc_result.search_query_used}'."
        if qc_result is not None
        else "Literature QC unavailable."
    )
    if not qc_refs and qc_result is not None:
        qc_refs = [{"title": "No directly matching references found", "uri": "", "source": "OpenAlex search"}]

    plan_id = f"exp-{uuid.uuid4().hex[:8]}"
    return {
        "id": plan_id,
        "project": "Agentic Labmate",
        "hypothesis": hypothesis,
        "plainEnglish": f"Test whether {parsed.intervention} changes {parsed.outcome_metric} for {parsed.subject} compared to {parsed.control_condition or 'control'}.",
        "domain": parsed.domain,
        "metrics": {
            "confidence": confidence_label,
            "novelty": novelty_label.title(),
            "sustainability": f"{sustainability}/100",
        },
        "novelty": {
            "signal": novelty_label,
            "summary": novelty_summary,
            "references": qc_refs,
        },
        "materials": materials,
        "steps": steps,
        "timeline": timeline,
        "budget": budget,
        "benchmark": benchmark,
        "validation": validation,
        "reviewAdaptations": [],
        "sources": combined_sources,
    }
