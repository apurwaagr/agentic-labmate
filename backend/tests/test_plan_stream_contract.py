from __future__ import annotations

import json
from fastapi.testclient import TestClient

from backend.main import app


def test_plan_endpoint_includes_non_empty_review_adaptations(monkeypatch):
    monkeypatch.setenv("VERTEX_AI_PROJECT_ID", "demo-project")
    monkeypatch.setenv("GOOGLE_APPLICATION_CREDENTIALS", "/tmp/demo.json")

    with TestClient(app) as client:
        create_review = client.post(
            "/api/reviews",
            json={
                "experimentId": "exp-review-1",
                "section": "protocol",
                "reviewer": "Scientist",
                "correction": "Add explicit control randomization steps.",
                "severity": "major",
            },
        )
        assert create_review.status_code == 200

        response = client.post(
            "/api/experiments/plan",
            json={
                "hypothesis": (
                    "Trehalose at 200 mM improves post-thaw viability of HeLa cells by at least "
                    "20% versus standard 10% DMSO control under identical freezing and thawing conditions."
                )
            },
        )
        assert response.status_code == 200
        payload = response.json()
        assert "experiment" in payload
        adaptations = payload["experiment"].get("reviewAdaptations", [])
        assert isinstance(adaptations, list)
        assert adaptations, "Expected non-empty reviewAdaptations after review submission."


def test_stream_contract_emits_objections_and_wrapped_plan(monkeypatch):
    monkeypatch.setenv("VERTEX_AI_PROJECT_ID", "demo-project")
    monkeypatch.setenv("GOOGLE_APPLICATION_CREDENTIALS", "/tmp/demo.json")

    def _fake_run(_hypothesis: str, _reviews, on_event=None):
        if on_event:
            on_event("parse_complete", {"domain": "Cell Biology", "subject": "HeLa", "intervention": "Trehalose"})
            on_event("agent_draft", {"agent": "ProtocolArchitect", "section": "protocol", "content": {"steps": []}})
            on_event(
                "objections",
                {
                    "items": [
                        {
                            "id": "obj-1",
                            "section": "protocol",
                            "claim": "No randomization details",
                            "objection": "Missing randomization and control constraints",
                            "severity": "major",
                        }
                    ]
                },
            )
            on_event("agent_revision", {"agent": "ProtocolArchitect", "section": "protocol", "content": {"steps": ["updated"]}})
            on_event("metrics_ready", {"metrics": {"composite": 0.8}})
        return {
            "plan": {"experiment": {"id": "exp-stream-1", "reviewAdaptations": [{"section": "protocol", "change": "Added control randomization."}]}},
            "prd_plan": {"plan_id": "prd-1"},
            "metrics": {"composite": 0.8},
        }

    monkeypatch.setattr("labmate.council.run_council_plan", _fake_run)

    with TestClient(app) as client:
        response = client.post(
            "/api/experiments/plan/stream",
            json={
                "hypothesis": (
                    "Trehalose at 200 mM improves post-thaw viability of HeLa cells by at least "
                    "20% versus standard 10% DMSO control under identical freezing and thawing conditions."
                )
            },
        )
        assert response.status_code == 200
        body = response.text
        assert "event: objections" in body
        assert "event: plan_complete" in body

        payloads = []
        for line in body.splitlines():
            if line.startswith("data: "):
                payloads.append(json.loads(line[6:]))

        objections_payloads = [p for p in payloads if isinstance(p, dict) and "items" in p]
        assert objections_payloads, "Expected objections payload in stream."
        assert objections_payloads[-1]["items"], "Objections items should not be empty."

        plan_payloads = [p for p in payloads if isinstance(p, dict) and "plan" in p and "prdPlan" in p]
        assert plan_payloads, "Expected plan_complete payload with plan and prdPlan keys."
        assert "experiment" in plan_payloads[-1]["plan"], "Expected wrapped plan.experiment for frontend compatibility."
