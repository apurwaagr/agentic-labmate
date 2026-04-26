from __future__ import annotations

import json
import uuid
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Tuple
from urllib.parse import parse_qs, urlparse

from backend.literature_qc import check_literature
from backend.parser import parse_user_input
from backend.schemas import ParsedHypothesis

HOST = "127.0.0.1"
PORT = 8787

REVIEWS: List[Dict[str, Any]] = []

DOMAIN_PROFILES: Dict[str, Dict[str, Any]] = {
    "cell biology": {
        "base_reagents": 420,
        "base_equipment": 180,
        "base_days": 10,
        "owner_exec": "Lab Scientist",
        "sustainability_bias": 66,
    },
    "pharmacology": {
        "base_reagents": 520,
        "base_equipment": 240,
        "base_days": 14,
        "owner_exec": "Preclinical Scientist",
        "sustainability_bias": 60,
    },
    "chemistry": {
        "base_reagents": 360,
        "base_equipment": 220,
        "base_days": 9,
        "owner_exec": "Chemist",
        "sustainability_bias": 58,
    },
    "diagnostics": {
        "base_reagents": 490,
        "base_equipment": 260,
        "base_days": 12,
        "owner_exec": "Assay Scientist",
        "sustainability_bias": 64,
    },
    "general science": {
        "base_reagents": 400,
        "base_equipment": 200,
        "base_days": 11,
        "owner_exec": "Scientist",
        "sustainability_bias": 62,
    },
}


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
    adjusted = base - int(complexity * 8)
    return max(45, min(adjusted, 85))


def _build_materials(parsed: ParsedHypothesis, profile: Dict[str, Any], complexity: float) -> List[Dict[str, Any]]:
    intervention_cost = max(80, int(profile["base_reagents"] * (0.45 + complexity * 0.5)))
    subject_cost = max(40, int(profile["base_reagents"] * (0.25 + complexity * 0.35)))
    consumables_cost = max(35, int(profile["base_reagents"] * (0.2 + complexity * 0.25)))
    return [
        {
            "name": parsed.intervention,
            "catalogNumber": "TBD",
            "supplier": "Select validated supplier",
            "quantity": parsed.target_quantity or "Protocol-defined",
            "unitCostUsd": intervention_cost,
            "leadTime": "4-10 days",
            "status": "order",
            "notes": "Confirm grade/purity and storage constraints before ordering.",
            "sourceConfidence": 0.42,
            "sourceEvidence": "Heuristic from parsed intervention; no supplier catalog retrieval yet.",
        },
        {
            "name": parsed.subject,
            "catalogNumber": "N/A",
            "supplier": "In-house / reference supplier",
            "quantity": "Per protocol",
            "unitCostUsd": subject_cost,
            "leadTime": "2-7 days",
            "status": "in-stock",
            "notes": "Validate model/system specification against protocol assumptions.",
            "sourceConfidence": 0.55,
            "sourceEvidence": "Derived from parsed subject and standard lab assumptions.",
        },
        {
            "name": "Assay and controls consumables",
            "catalogNumber": "TBD",
            "supplier": "Preferred lab vendor",
            "quantity": "Per run",
            "unitCostUsd": consumables_cost,
            "leadTime": "2-5 days",
            "status": "order",
            "notes": "Include replicates and QA/QC controls.",
            "sourceConfidence": 0.48,
            "sourceEvidence": "Template consumables based on run structure; exact kit not retrieved.",
        },
    ]


def _build_timeline(profile: Dict[str, Any], complexity: float, citation_confidence: float) -> Tuple[List[Dict[str, Any]], int]:
    base_days = int(profile["base_days"])
    evidence_adjust = max(-1.5, min(1.5, (0.55 - citation_confidence) * 3))
    setup = max(2, int(round(base_days * 0.25 + complexity * 2 + evidence_adjust)))
    execution = max(3, int(round(base_days * 0.45 + complexity * 3 + evidence_adjust)))
    analysis = max(2, int(round(base_days * 0.30 + complexity * 2 + evidence_adjust * 0.7)))
    phases = [
        {
            "phase": "Setup and procurement",
            "durationDays": setup,
            "dependsOn": [],
            "owner": "Project Scientist",
            "deliverable": "Validated setup and materials readiness",
        },
        {
            "phase": "Experimental execution",
            "durationDays": execution,
            "dependsOn": ["Setup and procurement"],
            "owner": profile["owner_exec"],
            "deliverable": "Completed intervention + raw measurements",
        },
        {
            "phase": "Analysis and go/no-go review",
            "durationDays": analysis,
            "dependsOn": ["Experimental execution"],
            "owner": "Analyst",
            "deliverable": "Decision-ready report and next-step recommendation",
        },
    ]
    return phases, setup + execution + analysis


def _build_budget(
    materials: List[Dict[str, Any]],
    profile: Dict[str, Any],
    complexity: float,
    total_days: int,
    citation_confidence: float,
) -> Dict[str, Any]:
    reagents = int(sum(m["unitCostUsd"] for m in materials))
    equipment = int(profile["base_equipment"] * (0.8 + complexity * 0.5))
    shipping = int(max(45, reagents * (0.08 + complexity * 0.06)))
    labor = int(max(150, total_days * (35 + complexity * 20)))
    contingency_rate = max(0.04, 0.06 + complexity * 0.08 + (0.55 - citation_confidence) * 0.06)
    contingency = int((reagents + equipment + shipping + labor) * contingency_rate)
    total = reagents + equipment + shipping + labor + contingency
    cap = int(total * (1.18 + complexity * 0.2))
    saved = max(cap - total, 0)
    return {
        "reagentsUsd": reagents,
        "equipmentUsd": equipment,
        "shippingUsd": shipping,
        "laborUsd": labor,
        "contingencyUsd": contingency,
        "totalUsd": total,
        "budgetCapUsd": cap,
        "savedUsd": saved,
        "reliability": (
            f"Derived estimate from parsed complexity and citation confidence "
            f"({int(round(citation_confidence * 100))}/100). Validate with vendor quotes."
        ),
        "assumptions": [
            "Single-site execution with standard lab staffing.",
            "One primary run with replicates and basic QA/QC controls.",
            "No major capital equipment purchase included.",
        ],
        "lineItems": [
            {"label": "Primary reagents and assay kits", "amountUsd": reagents, "category": "reagents", "note": "Intervention + subject + consumables"},
            {"label": "Instrument and setup overhead", "amountUsd": equipment, "category": "equipment", "note": "Calibration and shared equipment access"},
            {"label": "Procurement and shipping", "amountUsd": shipping, "category": "shipping", "note": "Includes cold-chain assumptions if needed"},
            {"label": "Scientist labor", "amountUsd": labor, "category": "labor", "note": f"Estimated over ~{total_days} execution days"},
            {"label": "Contingency buffer", "amountUsd": contingency, "category": "contingency", "note": "Handles reruns and variance"},
        ],
    }


def _build_benchmark(total_cost: int, total_days: int, sustainability: int) -> List[Dict[str, Any]]:
    baseline_cost = int(total_cost * 1.22)
    baseline_days = int(max(total_days + 2, total_days * 1.25))
    baseline_sustainability = max(sustainability - 10, 40)
    return [
        {
            "label": "This plan",
            "time": f"{total_days} days",
            "cost": total_cost,
            "sustainability": sustainability,
            "ours": True,
        },
        {
            "label": "Typical baseline",
            "time": f"{baseline_days} days",
            "cost": baseline_cost,
            "sustainability": baseline_sustainability,
            "ours": False,
        },
    ]


def _confidence_explanation(
    parsed: ParsedHypothesis,
    total_results: int,
    citation_confidence: float,
) -> str:
    parts = [
        f"Literature retrieval returned {total_results} results.",
        f"Citation confidence is {int(round(citation_confidence * 100))}/100 based on top references and recency.",
    ]
    if parsed.clarifying_questions:
        parts.append("Confidence is reduced because clarifying questions are still open.")
    else:
        parts.append("No mandatory clarifying questions are pending.")
    return " ".join(parts)


def _safe_parse_hypothesis(hypothesis_text: str) -> ParsedHypothesis:
    try:
        return parse_user_input(hypothesis_text)
    except Exception as exc:
        err_msg = str(exc).strip() or "Unknown parser error."
        # Fallback so UI remains usable even when LLM/network is down.
        return ParsedHypothesis(
            original_input=hypothesis_text,
            domain="General Science",
            subject="unspecified subject",
            intervention="unspecified intervention",
            outcome_metric="quantitative change > 0%",
            is_novelty_search=False,
            control_condition="baseline/control group",
            clarifying_questions=[
                f"Parser fallback was used because parsing failed: {err_msg}",
                "Please confirm subject, intervention, and exact metric.",
            ],
        )


def _novelty_to_frontend(novelty_signal: str) -> str:
    mapping = {
        "not_found": "not found",
        "similar_work_exists": "similar work exists",
        "exact_match_found": "exact match found",
        "unavailable": "search unavailable",
    }
    return mapping.get(novelty_signal, "similar work exists")


def _build_experiment_plan(hypothesis_text: str) -> Dict[str, Any]:
    parsed = _safe_parse_hypothesis(hypothesis_text)
    try:
        literature = check_literature(parsed)
    except Exception as exc:
        literature = type("LitFallback", (), {
            "novelty_signal": "unavailable",
            "references": [],
            "search_query_used": f"{parsed.domain} {parsed.subject} {parsed.intervention} {parsed.outcome_metric}",
            "total_results": -1,
            "error_msg": str(exc),
        })()

    refs = [
        {
            "title": r.title,
            "uri": r.url,
            "source": f"{r.authors} ({r.year})" if r.year else r.authors,
        }
        for r in literature.references
    ]
    if not refs:
        refs = [
            {
                "title": "No directly matching references found",
                "uri": "",
                "source": "OpenAlex search",
            }
        ]

    novelty_label = _novelty_to_frontend(getattr(literature, "novelty_signal", "similar_work_exists"))
    
    if getattr(literature, "novelty_signal", "") == "unavailable":
        novelty_summary = f"OpenAlex literature search is currently unavailable. (Error: {getattr(literature, 'error_msg', 'Network error')})"
    else:
        novelty_summary = (
            f"Retrieval: OpenAlex returned {literature.total_results} results for "
            f"query '{literature.search_query_used}'. "
            "Novelty signal is based on title/abstract relevance scoring over top hits."
        )

    review_adaptations = [
        {
            "section": r["section"],
            "change": r["correction"],
            "impact": "Integrated into next regeneration request.",
        }
        for r in REVIEWS[-3:]
    ]

    profile = _domain_profile(parsed.domain)
    citation_confidence = _citation_confidence(literature)
    total_results = max(0, getattr(literature, "total_results", 0))
    complexity = _estimate_complexity(parsed, total_results, citation_confidence)
    materials = _build_materials(parsed, profile, complexity)
    timeline, total_days = _build_timeline(profile, complexity, citation_confidence)
    budget = _build_budget(materials, profile, complexity, total_days, citation_confidence)
    sustainability_value = _sustainability_score(parsed, profile, complexity)
    confidence_label = _confidence_from_state(parsed, total_results, citation_confidence)
    confidence_explanation = _confidence_explanation(parsed, total_results, citation_confidence)
    benchmark = _build_benchmark(budget["totalUsd"], total_days, sustainability_value)
    has_real_refs = bool(getattr(literature, "references", []) and getattr(literature, "total_results", 0) > 0)
    placeholder_materials = sum(
        1
        for m in materials
        if str(m.get("catalogNumber", "")).upper() in {"TBD", "N/A"} or "validated supplier" in str(m.get("supplier", "")).lower()
    )
    material_conf = max(0.2, min(0.95, citation_confidence - 0.12 * (placeholder_materials / max(len(materials), 1))))
    protocol_conf = max(0.2, min(0.95, citation_confidence - (0.1 if parsed.clarifying_questions else 0.0)))
    timeline_conf = max(0.25, min(0.95, 0.55 + (0.4 - complexity * 0.25)))
    validation_conf = max(0.25, min(0.95, 0.5 + (0.35 if not parsed.clarifying_questions else -0.15)))

    plan_id = f"exp-{uuid.uuid4().hex[:8]}"
    return {
        "experiment": {
            "id": plan_id,
            "project": "Agentic Labmate",
            "hypothesis": hypothesis_text,
            "originalInput": getattr(parsed, "original_input", hypothesis_text),
            "clarifyingQuestions": getattr(parsed, "clarifying_questions", []),
            "plainEnglish": (
                f"Test whether {parsed.intervention} changes {parsed.outcome_metric} "
                f"for {parsed.subject} compared to {parsed.control_condition or 'control'}."
            ),
            "domain": parsed.domain,
            "metrics": {
                "confidence": confidence_label,
                "novelty": novelty_label.title(),
                "sustainability": f"{sustainability_value}/100",
            },
            "confidenceExplanation": confidence_explanation,
            "citationConfidence": round(citation_confidence, 3),
            "novelty": {
                "signal": novelty_label,
                "summary": novelty_summary,
                "references": refs,
            },
            "sectionConfidence": {
                "novelty": round(citation_confidence if has_real_refs else 0.25, 3),
                "protocol": round(protocol_conf, 3),
                "materials": round(material_conf, 3),
                "timeline": round(timeline_conf, 3),
                "validation": round(validation_conf, 3),
            },
            "materials": materials,
            "steps": [
                {
                    "id": "s1",
                    "title": "Prepare control and treatment groups",
                    "detail": (
                        f"Set up baseline control ({parsed.control_condition or 'standard condition'}) "
                        f"and treatment with {parsed.intervention}."
                    ),
                    "quantity": parsed.target_quantity or "Protocol-defined",
                    "duration": f"Day 1-{max(2, int(total_days * 0.3))}",
                    "source": "Protocol heuristic",
                    "sourceConfidence": round(protocol_conf - 0.08, 3),
                    "sourceEvidence": "No protocol repository mapping found for exact setup/control pair.",
                    "riskLevel": "med",
                    "riskNote": "Unclear dosing or setup can bias downstream outcomes.",
                    "validationChecks": [
                        "Randomization documented",
                        "Control condition matches baseline claim",
                    ],
                    "decisionGate": "Proceed only if baseline variance is acceptable.",
                },
                {
                    "id": "s2",
                    "title": "Apply intervention and monitor",
                    "detail": (
                        f"Apply {parsed.intervention} under declared constraints: "
                        f"{', '.join(parsed.environmental_constraints) if parsed.environmental_constraints else 'standard conditions'}."
                    ),
                    "quantity": parsed.target_quantity or "Protocol-defined",
                    "duration": f"Day {max(2, int(total_days * 0.3))}-{max(4, int(total_days * 0.75))}",
                    "source": "Parsed hypothesis",
                    "sourceConfidence": round(protocol_conf, 3),
                    "sourceEvidence": "Anchored to parsed intervention and constraints; needs protocol citation enrichment.",
                    "riskLevel": "med",
                    "riskNote": "Environmental drift may reduce reproducibility.",
                    "validationChecks": ["Temperature/log checks", "Intervention timing recorded"],
                    "decisionGate": "Repeat run if intervention deviations exceed threshold.",
                },
                {
                    "id": "s3",
                    "title": "Measure primary outcome",
                    "detail": f"Quantify outcome metric: {parsed.outcome_metric}.",
                    "quantity": f"n>={3 + int(round(complexity * 2))} replicates",
                    "duration": f"Day {max(4, int(total_days * 0.75))}-{total_days}",
                    "source": "Hypothesis metric",
                    "sourceConfidence": round(protocol_conf + 0.05, 3),
                    "sourceEvidence": "Outcome metric sourced from parsed hypothesis statement.",
                    "riskLevel": "low",
                    "validationChecks": [
                        "Predefine statistical test",
                        "Include confidence intervals",
                    ],
                    "decisionGate": "Go only if effect size and uncertainty meet criteria.",
                },
            ],
            "timeline": timeline,
            "budget": budget,
            "benchmark": benchmark,
            "validation": {
                "primaryMetric": parsed.outcome_metric,
                "successCriteria": "Observed improvement against control with statistical significance.",
                "failureCriteria": [
                    "No measurable delta against control",
                    "High variance across replicates",
                    "Protocol deviations invalidate comparison",
                ],
                "decisionGates": [
                    "Control quality pass",
                    "Intervention consistency pass",
                    "Outcome confidence pass",
                ],
            },
            "reviewAdaptations": review_adaptations,
            "sources": refs,
        }
    }


def _json_response(handler: BaseHTTPRequestHandler, code: int, payload: Any) -> None:
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(code)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
    handler.end_headers()
    handler.wfile.write(body)


class ApiHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.end_headers()

    def _read_json(self) -> Dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length > 0 else b"{}"
        return json.loads(raw.decode("utf-8"))

    def do_GET(self) -> None:  # noqa: N802
        parsed_url = urlparse(self.path)
        path = parsed_url.path
        query = parse_qs(parsed_url.query)

        if path == "/api/contracts":
            return _json_response(
                self,
                200,
                [
                    {"name": "Plan Generation", "method": "POST", "path": "/api/experiments/plan", "purpose": "Parse hypothesis and generate protocol plan."},
                    {"name": "Chat", "method": "POST", "path": "/api/chat", "purpose": "Answer grounded questions over active experiment context."},
                    {"name": "List Reviews", "method": "GET", "path": "/api/reviews", "purpose": "Fetch stored scientist review notes."},
                    {"name": "Create Review", "method": "POST", "path": "/api/reviews", "purpose": "Store a review note used for regeneration."},
                    {"name": "Knowledge Graph", "method": "GET", "path": "/api/knowledge-graph/context", "purpose": "Expose lightweight KG nodes/edges/tags."},
                ],
            )

        if path == "/api/reviews":
            experiment_id = query.get("experimentId", [""])[0]
            if experiment_id:
                data = [r for r in REVIEWS if r.get("experimentId") == experiment_id]
            else:
                data = REVIEWS
            return _json_response(self, 200, data)

        if path == "/api/knowledge-graph/context":
            hypothesis = query.get("hypothesis", [""])[0]
            parsed = _safe_parse_hypothesis(hypothesis) if hypothesis else None
            context = {
                "experimentId": f"ctx-{uuid.uuid4().hex[:8]}",
                "nodes": [
                    {"id": "domain", "type": "domain", "label": parsed.domain if parsed else "General Science"},
                    {"id": "subject", "type": "subject", "label": parsed.subject if parsed else "Subject"},
                    {"id": "intervention", "type": "intervention", "label": parsed.intervention if parsed else "Intervention"},
                    {"id": "outcome", "type": "metric", "label": parsed.outcome_metric if parsed else "Outcome metric"},
                ],
                "edges": [
                    {"source": "intervention", "target": "subject", "relation": "applied_to"},
                    {"source": "subject", "target": "outcome", "relation": "measured_by"},
                ],
                "tags": [parsed.domain, "literature-qc", "agentic-plan"] if parsed else ["general", "literature-qc"],
                "materials": [],
                "protocolSteps": [],
                "reviews": REVIEWS[-5:],
            }
            return _json_response(self, 200, context)

        return _json_response(self, 404, {"error": "Not found"})

    def do_POST(self) -> None:  # noqa: N802
        parsed_url = urlparse(self.path)
        path = parsed_url.path

        if path == "/api/experiments/plan":
            payload = self._read_json()
            hypothesis = str(payload.get("hypothesis", "")).strip()
            if not hypothesis:
                return _json_response(self, 400, {"error": "hypothesis is required"})
            try:
                plan = _build_experiment_plan(hypothesis)
                return _json_response(self, 200, plan)
            except Exception as exc:
                return _json_response(self, 500, {"error": f"Plan generation failed: {exc}"})

        if path == "/api/chat":
            payload = self._read_json()
            question = str(payload.get("question", "")).strip()
            hypothesis = str(payload.get("hypothesis", "")).strip()
            if not question:
                return _json_response(self, 400, {"error": "question is required"})
            answer = (
                f"For hypothesis '{hypothesis[:120]}', the key next check is: {question}. "
                "Review novelty references, validate control integrity, then confirm the primary metric thresholds."
            )
            return _json_response(
                self,
                200,
                {
                    "answer": answer,
                    "citations": [{"title": "OpenAlex literature QC", "source": "Generated from current plan context"}],
                    "followUps": [
                        "Should we tighten the success criteria?",
                        "Which step has highest execution risk?",
                    ],
                },
            )

        if path == "/api/reviews":
            payload = self._read_json()
            required = ["experimentId", "section", "reviewer", "correction", "severity"]
            missing = [k for k in required if not payload.get(k)]
            if missing:
                return _json_response(self, 400, {"error": f"Missing fields: {', '.join(missing)}"})
            record = {
                "experimentId": str(payload["experimentId"]),
                "section": str(payload["section"]),
                "reviewer": str(payload["reviewer"]),
                "correction": str(payload["correction"]),
                "severity": str(payload["severity"]).lower(),
            }
            REVIEWS.append(record)
            return _json_response(self, 200, record)

        return _json_response(self, 404, {"error": "Not found"})

    def log_message(self, fmt: str, *args: Any) -> None:
        # Keep console quiet while frontend polls.
        return


def run() -> None:
    server = ThreadingHTTPServer((HOST, PORT), ApiHandler)
    print(f"Python API server running on http://{HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    run()
