from __future__ import annotations

import json
import os
import subprocess

import pytest

from ._pipeline_utils import (
    BACKEND_BASE_URL,
    FRONTEND_BASE_URL,
    PRIMARY_HYPOTHESIS,
    assert_edgequake_ollama_only,
    assert_no_alt_provider_fallback,
    assert_no_mock_usage,
    collect_sse_stream,
    maybe_skip_for_outage,
    read_backend_log,
    slice_new_log,
)


@pytest.mark.asyncio
@pytest.mark.parametrize("base_url", [BACKEND_BASE_URL, FRONTEND_BASE_URL])
async def test_pipeline_stream_end_to_end(base_url: str):
    before = read_backend_log()
    capture = await collect_sse_stream(base_url=base_url, hypothesis=PRIMARY_HYPOTHESIS)
    after = read_backend_log()
    log_slice = slice_new_log(before, after)

    maybe_skip_for_outage(capture, log_slice)

    event_names = [name for name, _ in capture.events]
    expected_order = ["qc_complete", "graph_ready", "plan_generating", "plan_complete"]
    for expected in expected_order:
        assert expected in event_names, f"Missing expected event: {expected}. Events: {event_names}"
    assert event_names.index("qc_complete") < event_names.index("plan_complete"), (
        "QC must appear before plan completion."
    )

    qc_payload = dict(capture.events)[ "qc_complete" ]
    assert qc_payload["signal"] in {"not found", "similar work exists", "exact match found"}
    assert isinstance(qc_payload["summary"], str) and qc_payload["summary"]
    assert isinstance(qc_payload["references"], list)
    assert len(qc_payload["references"]) <= 3

    plan_payload = dict(capture.events)["plan_complete"]
    experiment = plan_payload.get("experiment", {})
    required_keys = ["id", "hypothesis", "materials", "steps", "timeline", "budget", "validation", "sources"]
    for key in required_keys:
        assert key in experiment, f"Missing experiment key: {key}"

    assert_no_mock_usage(log_slice)
    assert_no_alt_provider_fallback(log_slice)


def test_edgequake_ollama_only_logs():
    cmd = os.getenv("TEST_EDGEQUAKE_LOG_CMD", "docker compose logs --tail=400 edgequake")
    proc = subprocess.run(
        cmd,
        shell=True,
        check=False,
        capture_output=True,
        text=True,
    )
    logs = f"{proc.stdout}\n{proc.stderr}"
    if proc.returncode != 0:
        pytest.skip(f"Could not read edgequake logs (exit={proc.returncode}).")
    assert_edgequake_ollama_only(logs)
