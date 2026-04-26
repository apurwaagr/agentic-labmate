"""Council orchestration streams events incrementally via on_event callback.

This test does NOT call Vertex — it monkey-patches the Vertex JSON helper to a
fast deterministic stub so we can verify ordering & timing of events without
paying real network latency.
"""
from __future__ import annotations

import time
from typing import Any, Dict, List


def test_run_council_plan_emits_events_in_expected_order(monkeypatch):
    from labmate import council

    def _fake_call(prompt: str, label: str = "vertex") -> Dict[str, Any]:
        # Mimic a 50ms Vertex round-trip per call.
        time.sleep(0.05)
        if "DevilsAdvocate" in prompt:
            return {"items": [
                {"id": "obj-1", "section": "protocol", "claim": "claim", "objection": "obj", "severity": "minor"}
            ]}
        return {"section": "x", "content": {"step": "ok"}, "notes": "stub"}

    monkeypatch.setattr(council, "_call_vertex_json", _fake_call)

    events: List[tuple[str, Dict[str, Any]]] = []

    def emit(name: str, payload: Dict[str, Any]) -> None:
        events.append((name, payload))

    hypothesis = (
        "Trehalose at 200 mM improves post-thaw viability of HeLa cells by at "
        "least 20% versus standard 10% DMSO control."
    )
    result = council.run_council_plan(hypothesis, [], on_event=emit)

    names = [name for name, _ in events]

    assert "parse_complete" in names
    assert "qc_ready" in names or "base_plan_ready" in names  # qc_ready is best-effort
    assert names.count("agent_draft") == 5, f"expected 5 round-1 drafts, got {names.count('agent_draft')}"
    assert "objections" in names
    assert names.count("agent_revision") == 5, f"expected 5 round-3 revisions, got {names.count('agent_revision')}"
    assert "metrics_ready" in names

    # Drafts must complete before objections; objections before revisions.
    first_draft = names.index("agent_draft")
    last_draft = len(names) - 1 - names[::-1].index("agent_draft")
    objections_idx = names.index("objections")
    first_revision = names.index("agent_revision")
    assert last_draft < objections_idx < first_revision

    # Final result must contain the PRD plan and metrics.
    assert "prd_plan" in result and result["prd_plan"]
    assert "metrics" in result and "composite" in result["metrics"]


def test_run_council_plan_handles_vertex_failure_via_fallback(monkeypatch):
    from labmate import council

    def _empty_call(prompt: str, label: str = "vertex") -> Dict[str, Any]:
        return {}  # Simulate Vertex unavailable / timeout — every call returns nothing.

    monkeypatch.setattr(council, "_call_vertex_json", _empty_call)

    events: List[tuple[str, Dict[str, Any]]] = []
    result = council.run_council_plan(
        "Test hypothesis: intervention X increases metric Y by 20% in subject Z.",
        [],
        on_event=lambda n, p: events.append((n, p)),
    )

    # Even when Vertex is fully unavailable, the council must still complete
    # using deterministic fallbacks — no event should be missing.
    names = [n for n, _ in events]
    assert names.count("agent_draft") == 5
    assert names.count("agent_revision") == 5
    assert "objections" in names
    assert "metrics_ready" in names
    assert result["objections"], "fallback objections must be non-empty"
