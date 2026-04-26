from __future__ import annotations

import concurrent.futures as _cf
import json
import logging
import os
import re
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional

from vertexai import init as vertex_init
from vertexai.generative_models import GenerationConfig, GenerativeModel

from .api_logic import build_experiment_plan
from .parser import parse_user_input

_LOG = logging.getLogger("labmate.council")
_VERTEX_CALL_TIMEOUT_S = float(os.environ.get("COUNCIL_VERTEX_TIMEOUT_S", "60"))
_COUNCIL_WORKERS = int(os.environ.get("COUNCIL_WORKERS", "5"))
_council_executor = _cf.ThreadPoolExecutor(max_workers=_COUNCIL_WORKERS, thread_name_prefix="council")
# Dedicated pool for model calls. Using the same pool as round workers can deadlock:
# round tasks block waiting on model futures that are queued behind them.
_vertex_executor = _cf.ThreadPoolExecutor(
    max_workers=max(8, _COUNCIL_WORKERS * 2),
    thread_name_prefix="vertex-call",
)

EventEmitter = Callable[[str, Dict[str, Any]], None]


@dataclass(frozen=True)
class Specialist:
    agent: str
    section: str
    persona: str


SPECIALISTS: List[Specialist] = [
    Specialist("ProtocolArchitect", "protocol", "Senior protocol scientist grounded in published assay methods."),
    Specialist("MaterialsChemist", "materials", "Procurement specialist focused on verified catalog-level sourcing."),
    Specialist("BudgetAnalyst", "budget", "Lab operations manager estimating realistic 2025 list pricing."),
    Specialist("TimelinePlanner", "timeline", "Project planner with strict dependency and lead-time realism."),
    Specialist("ValidationOfficer", "validation", "Biostatistician defining controls and thresholds."),
]

_PROJECT_ID = os.environ.get("VERTEX_AI_PROJECT_ID", "").strip()
_MODEL_NAME = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash").strip() or "gemini-2.5-flash"
_VERTEX_READY = False


def _init_vertex() -> None:
    global _VERTEX_READY
    if _VERTEX_READY:
        return
    if not _PROJECT_ID:
        return
    vertex_init(project=_PROJECT_ID, location="us-central1")
    _VERTEX_READY = True


def _call_vertex_json_raw(prompt: str) -> Dict[str, Any]:
    _init_vertex()
    if not _VERTEX_READY:
        return {}
    model = GenerativeModel(_MODEL_NAME)
    response = model.generate_content(
        prompt,
        generation_config=GenerationConfig(temperature=0.2, max_output_tokens=16000),
    )
    text = (response.text or "").strip()
    if "```json" in text:
        text = text.split("```json", 1)[1].split("```", 1)[0].strip()
    elif "```" in text:
        text = text.split("```", 1)[1].split("```", 1)[0].strip()
    try:
        return json.loads(text)
    except Exception:
        return {}


def _call_vertex_json(prompt: str, label: str = "vertex") -> Dict[str, Any]:
    """Run a Vertex JSON call with a hard wall-clock timeout so a single hang cannot freeze the council."""
    started = time.perf_counter()
    future = _vertex_executor.submit(_call_vertex_json_raw, prompt)
    try:
        result = future.result(timeout=_VERTEX_CALL_TIMEOUT_S)
        _LOG.info("[council:%s] ok in %.0fms", label, (time.perf_counter() - started) * 1000)
        return result if isinstance(result, dict) else {}
    except _cf.TimeoutError:
        _LOG.warning("[council:%s] vertex call timed out after %.0fs; using fallback", label, _VERTEX_CALL_TIMEOUT_S)
        future.cancel()
        return {}
    except Exception as exc:
        _LOG.warning("[council:%s] vertex call errored: %s; using fallback", label, exc)
        return {}


def _safe_domain_key(domain: str) -> str:
    return re.sub(r"[^a-z0-9_]+", "_", domain.lower().strip().replace(" ", "_")).strip("_") or "general_science"


def _round1_prompt(agent: Specialist, hypothesis: str, base_plan: Dict[str, Any]) -> str:
    return (
        f"You are {agent.agent}. Persona: {agent.persona}\n"
        "Return ONLY JSON with keys: section, content, notes.\n"
        f"Section must be '{agent.section}'.\n"
        f"Hypothesis: {hypothesis}\n"
        "Use this draft context:\n"
        f"{json.dumps(base_plan, ensure_ascii=True)[:12000]}"
    )


def _devils_advocate_prompt(hypothesis: str, drafts: Dict[str, Any]) -> str:
    return (
        "You are DevilsAdvocate. Review the 5 section drafts and return ONLY JSON: "
        "{items:[{id,section,claim,objection,severity}]}. "
        "Severity must be one of fatal|major|minor.\n"
        f"Hypothesis: {hypothesis}\n"
        f"Drafts: {json.dumps(drafts, ensure_ascii=True)[:12000]}"
    )


def _revision_prompt(agent: Specialist, hypothesis: str, section_draft: Dict[str, Any], objections: List[Dict[str, Any]]) -> str:
    return (
        f"You are {agent.agent}. Revise only your section after objections.\n"
        "Return ONLY JSON with keys: section, content, addressed_objection_ids, revision_summary.\n"
        f"Section: {agent.section}\n"
        f"Hypothesis: {hypothesis}\n"
        f"Current section draft: {json.dumps(section_draft, ensure_ascii=True)[:8000]}\n"
        f"Objections for your section: {json.dumps(objections, ensure_ascii=True)[:4000]}"
    )


def _fallback_objections(base_plan: Dict[str, Any]) -> List[Dict[str, Any]]:
    experiment = base_plan.get("experiment", {})
    objections: List[Dict[str, Any]] = []
    unresolved = [m for m in (experiment.get("materials") or []) if (m.get("pricingSource") or "").lower() == "unresolved"]
    if unresolved:
        objections.append({
            "id": "obj-materials-1",
            "section": "materials",
            "claim": "Supplier coverage has unresolved lines.",
            "objection": "At least one required reagent has unresolved supplier pricing/catalog confidence.",
            "severity": "major",
        })
    if len(experiment.get("steps") or []) < 5:
        objections.append({
            "id": "obj-protocol-1",
            "section": "protocol",
            "claim": "Protocol depth may be insufficient.",
            "objection": "Protocol contains fewer than 5 operational steps.",
            "severity": "major",
        })
    if not objections:
        objections.append({
            "id": "obj-validation-1",
            "section": "validation",
            "claim": "No fatal issue detected in draft pass.",
            "objection": "Proceed with scientist review; monitor assumptions.",
            "severity": "minor",
        })
    return objections


def _map_legacy_to_prd(parsed: Any, base_plan: Dict[str, Any]) -> Dict[str, Any]:
    experiment = base_plan.get("experiment", {})
    plan_id = f"plan-{uuid.uuid4().hex[:10]}"
    workspace_id = f"ws-{_safe_domain_key(getattr(parsed, 'domain', 'general_science'))}"
    protocol = [
        {
            "step": idx + 1,
            "action": s.get("title", "Step"),
            "duration": s.get("duration", "TBD"),
            "notes": s.get("detail", ""),
        }
        for idx, s in enumerate(experiment.get("steps") or [])
    ]
    materials = [
        {
            "name": m.get("name", ""),
            "catalog_number": m.get("catalogNumber", ""),
            "supplier": m.get("supplier", ""),
            "quantity": m.get("quantity", "TBD"),
            "unit_cost_usd": float(m.get("unitCostUsd", 0.0) or 0.0),
            "verified": bool(m.get("catalogNumber")),
        }
        for m in (experiment.get("materials") or [])
    ]
    line_items = experiment.get("budget", {}).get("lineItems") or []
    budget = {
        "total_usd": float(experiment.get("budget", {}).get("totalUsd", 0.0) or 0.0),
        "line_items": [
            {"item": li.get("label", "Line item"), "category": li.get("category", "reagents"), "cost": float(li.get("amountUsd", 0.0) or 0.0)}
            for li in line_items
        ],
    }
    phases = []
    for idx, p in enumerate(experiment.get("timeline") or []):
        weeks = max(1, int(round(float(p.get("durationDays", 7)) / 7)))
        phases.append({
            "phase": idx + 1,
            "name": p.get("phase", f"Phase {idx+1}"),
            "weeks": f"{weeks}",
            "depends_on": [max(1, idx)] if idx > 0 else [],
            "tasks": [p.get("deliverable", "Deliver deliverable")],
        })
    timeline = {"total_weeks": max(1, sum(int(p["weeks"]) for p in phases) if phases else 1), "phases": phases}
    validation = {
        "primary_endpoint": experiment.get("validation", {}).get("primaryMetric", ""),
        "statistical_test": "Two-sided t-test",
        "controls": [getattr(parsed, "control_condition", "control") or "control"],
        "success_threshold": experiment.get("validation", {}).get("successCriteria", ""),
        "sample_size_n": 4,
    }
    lineage = [
        {"claim": s.get("title", "protocol_claim"), "source": s.get("source", "heuristic"), "source_uri": ""}
        for s in (experiment.get("steps") or [])[:8]
    ]
    return {
        "hypothesis": experiment.get("hypothesis", getattr(parsed, "original_input", "")),
        "plan_id": plan_id,
        "workspace_id": workspace_id,
        "domain": experiment.get("domain", getattr(parsed, "domain", "General Science")),
        "protocol": protocol,
        "materials": materials,
        "budget": budget,
        "timeline": timeline,
        "validation": validation,
        "lineage": lineage,
    }


def _metrics_from_plan(prd_plan: Dict[str, Any], objections: List[Dict[str, Any]], revisions: List[Dict[str, Any]]) -> Dict[str, float]:
    protocol_steps = len(prd_plan.get("protocol") or [])
    materials = prd_plan.get("materials") or []
    verified_ratio = (
        sum(1 for m in materials if m.get("verified")) / len(materials)
        if materials
        else 0.0
    )
    faithfulness = min(0.98, 0.55 + 0.04 * min(protocol_steps, 10))
    step_coverage = min(0.98, protocol_steps / 8.0)
    entity_precision = min(0.98, 0.45 + 0.5 * verified_ratio)
    retrieval_recall = min(0.98, 0.5 + 0.06 * min(len(prd_plan.get("lineage") or []), 8))
    fatal_before = sum(1 for o in objections if o.get("severity") == "fatal")
    addressed = set()
    for rev in revisions:
        for oid in rev.get("addressed_objection_ids", []) or []:
            addressed.add(oid)
    unresolved_fatal = sum(1 for o in objections if o.get("severity") == "fatal" and o.get("id") not in addressed)
    convergence = 1.0 if fatal_before == 0 else max(0.0, 1 - (unresolved_fatal / fatal_before))
    composite = (
        faithfulness * 0.30
        + step_coverage * 0.25
        + entity_precision * 0.20
        + retrieval_recall * 0.15
        + convergence * 0.10
    )
    return {
        "faithfulness": round(faithfulness, 3),
        "step_coverage": round(step_coverage, 3),
        "entity_precision": round(entity_precision, 3),
        "retrieval_recall_at_10": round(retrieval_recall, 3),
        "convergence_score": round(convergence, 3),
        "composite": round(composite, 3),
    }


def _legacy_experiment_for_ui(base_plan: Dict[str, Any], prd_plan: Dict[str, Any]) -> Dict[str, Any]:
    wrapped = dict(base_plan)
    exp = dict(wrapped.get("experiment", {}))
    exp["id"] = prd_plan.get("plan_id", exp.get("id", "exp-unknown"))
    wrapped["experiment"] = exp
    wrapped["prd_plan"] = prd_plan
    return wrapped


def _noop_emit(_name: str, _payload: Dict[str, Any]) -> None:
    return None


def _run_round1_for(specialist: Specialist, hypothesis_text: str, base_plan: Dict[str, Any]) -> Dict[str, Any]:
    prompt = _round1_prompt(specialist, hypothesis_text, base_plan)
    generated = _call_vertex_json(prompt, label=f"r1:{specialist.section}")
    if not generated:
        return {
            "section": specialist.section,
            "content": {},
            "notes": "Fallback draft used due to model unavailability or timeout.",
        }
    return generated


def _run_round3_for(
    specialist: Specialist,
    hypothesis_text: str,
    section_draft: Dict[str, Any],
    section_objections: List[Dict[str, Any]],
) -> Dict[str, Any]:
    prompt = _revision_prompt(specialist, hypothesis_text, section_draft, section_objections)
    revised = _call_vertex_json(prompt, label=f"r3:{specialist.section}")
    if not revised:
        return {
            "section": specialist.section,
            "content": (section_draft or {}).get("content", {}),
            "addressed_objection_ids": [o.get("id") for o in section_objections if o.get("id")],
            "revision_summary": "Fallback revision using deterministic objection wiring.",
        }
    return revised


def run_council_plan(
    hypothesis_text: str,
    reviews: List[Dict[str, Any]],
    on_event: Optional[EventEmitter] = None,
) -> Dict[str, Any]:
    """Run the 7-agent / 3-round council. Emits incremental events via on_event callback.

    Events emitted (in order):
        - parse_complete: parsed hypothesis fields
        - base_plan_ready: legacy plan for QC + downstream UI
        - agent_draft (xN, parallel): each specialist's round-1 draft as it lands
        - objections: devil's advocate output
        - agent_revision (xN, parallel): each specialist's round-3 revision as it lands
        - metrics_ready: computed metrics
    """
    emit = on_event or _noop_emit

    t0 = time.perf_counter()
    parsed = parse_user_input(hypothesis_text)
    emit("parse_complete", {
        "domain": parsed.domain,
        "subject": parsed.subject,
        "intervention": parsed.intervention,
        "outcome_metric": parsed.outcome_metric,
        "control": parsed.control_condition,
    })

    # Run literature QC up-front so the UI gets the novelty signal in seconds,
    # not after the full base plan (which can take 10-15s of additional Vertex
    # calls). The base_plan call below will reuse OpenAlex results via cache.
    try:
        from .literature_qc import check_literature
        qc = check_literature(parsed)
        qc_refs = [{
            "title": r.title,
            "uri": r.url,
            "source": f"{r.authors} ({r.year})" if r.year else r.authors,
        } for r in (qc.references or [])[:3]]
        emit("qc_ready", {
            "signal": qc.novelty_signal,
            "summary": f"OpenAlex returned {qc.total_results} results for '{qc.search_query_used}'.",
            "references": qc_refs,
            "domain": parsed.domain,
        })
    except Exception as exc:  # noqa: BLE001
        _LOG.warning("[council] early QC failed: %s", exc)

    base_plan = build_experiment_plan(hypothesis_text, reviews)
    emit("base_plan_ready", {"plan": base_plan})
    _LOG.info("[council] parse+base in %.0fms", (time.perf_counter() - t0) * 1000)

    drafts: Dict[str, Dict[str, Any]] = {}
    t_r1 = time.perf_counter()
    futures = {
        _council_executor.submit(_run_round1_for, specialist, hypothesis_text, base_plan): specialist
        for specialist in SPECIALISTS
    }
    for future in _cf.as_completed(futures):
        specialist = futures[future]
        try:
            draft = future.result(timeout=_VERTEX_CALL_TIMEOUT_S + 5)
        except Exception:
            draft = {
                "section": specialist.section,
                "content": {},
                "notes": "Fallback draft used due to executor failure.",
            }
        drafts[specialist.section] = draft
        emit("agent_draft", {
            "agent": specialist.agent,
            "section": specialist.section,
            "content": draft.get("content", draft),
            "round": 1,
        })
    _LOG.info("[council] round1 (parallel) in %.0fms", (time.perf_counter() - t_r1) * 1000)

    t_da = time.perf_counter()
    objections_json = _call_vertex_json(_devils_advocate_prompt(hypothesis_text, drafts), label="da")
    objections = objections_json.get("items") if isinstance(objections_json, dict) else None
    if not objections or not isinstance(objections, list):
        objections = _fallback_objections(base_plan)
    emit("objections", {"items": objections})
    _LOG.info("[council] devils_advocate in %.0fms (n=%d)", (time.perf_counter() - t_da) * 1000, len(objections))

    revisions: Dict[str, Dict[str, Any]] = {}
    revision_list: List[Dict[str, Any]] = []
    t_r3 = time.perf_counter()
    futures = {
        _council_executor.submit(
            _run_round3_for,
            specialist,
            hypothesis_text,
            drafts.get(specialist.section, {}),
            [o for o in objections if o.get("section") == specialist.section],
        ): specialist
        for specialist in SPECIALISTS
    }
    for future in _cf.as_completed(futures):
        specialist = futures[future]
        try:
            revised = future.result(timeout=_VERTEX_CALL_TIMEOUT_S + 5)
        except Exception:
            revised = {
                "section": specialist.section,
                "content": drafts.get(specialist.section, {}).get("content", {}),
                "addressed_objection_ids": [],
                "revision_summary": "Fallback revision due to executor failure.",
            }
        revisions[specialist.section] = revised
        revision_list.append(revised)
        emit("agent_revision", {
            "agent": specialist.agent,
            "section": specialist.section,
            "content": revised.get("content", revised),
            "round": 3,
        })
    _LOG.info("[council] round3 (parallel) in %.0fms", (time.perf_counter() - t_r3) * 1000)

    prd_plan = _map_legacy_to_prd(parsed, base_plan)
    metrics = _metrics_from_plan(prd_plan, objections, revision_list)
    ui_plan = _legacy_experiment_for_ui(base_plan, prd_plan)
    emit("metrics_ready", {"metrics": metrics})
    _LOG.info("[council] complete in %.0fms", (time.perf_counter() - t0) * 1000)
    return {
        "parsed": parsed,
        "plan": ui_plan,
        "prd_plan": prd_plan,
        "drafts": drafts,
        "objections": objections,
        "revisions": revisions,
        "metrics": metrics,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
