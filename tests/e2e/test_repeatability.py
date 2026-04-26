from __future__ import annotations

import json
import os
from pathlib import Path
from statistics import mean

import pytest

from ._pipeline_utils import (
    BACKEND_BASE_URL,
    PRIMARY_HYPOTHESIS,
    classify_provider_outage,
    collect_sse_stream,
    read_backend_log,
    slice_new_log,
)


@pytest.mark.asyncio
async def test_repeatability_and_emit_artifact():
    runs = int(os.getenv("TEST_REPEAT_RUNS", "3"))
    artifact_path = Path(os.getenv("TEST_ARTIFACT_PATH", "tests/artifacts/repeatability_results.json"))
    artifact_path.parent.mkdir(parents=True, exist_ok=True)

    results = []
    for i in range(runs):
        before = read_backend_log()
        capture = await collect_sse_stream(base_url=BACKEND_BASE_URL, hypothesis=PRIMARY_HYPOTHESIS)
        after = read_backend_log()
        log_slice = slice_new_log(before, after)
        error_events = [p for e, p in capture.events if e == "error"]
        if error_events:
            msg = str(error_events[-1].get("message", ""))
            if classify_provider_outage(msg) or classify_provider_outage(log_slice):
                results.append(
                    {
                        "run": i + 1,
                        "events": [name for name, _ in capture.events],
                        "timings_s": {k: round(v, 3) for k, v in capture.timings.items()},
                        "success": False,
                        "skipped": True,
                        "reason": msg or "provider outage",
                    }
                )
                continue

        events = [name for name, _ in capture.events]
        if "plan_complete" not in events:
            pytest.fail(f"Run {i+1}: missing plan_complete event. events={events}")
        if "qc_complete" not in events:
            pytest.fail(f"Run {i+1}: missing qc_complete event. events={events}")

        result = {
            "run": i + 1,
            "events": events,
            "timings_s": {k: round(v, 3) for k, v in capture.timings.items()},
            "success": True,
        }
        results.append(result)

    qc_times = [r["timings_s"]["qc_complete"] for r in results if "qc_complete" in r["timings_s"]]
    plan_times = [r["timings_s"]["plan_complete"] for r in results if "plan_complete" in r["timings_s"]]
    summary = {
        "runs": runs,
        "qc_avg_s": round(mean(qc_times), 3) if qc_times else None,
        "plan_avg_s": round(mean(plan_times), 3) if plan_times else None,
        "completion_rate": round(len(plan_times) / runs, 3) if runs else 0.0,
        "skipped_runs": sum(1 for r in results if r.get("skipped")),
    }

    artifact = {"summary": summary, "results": results}
    artifact_path.write_text(json.dumps(artifact, indent=2), encoding="utf-8")

    # Keep thresholds practical for non-mocked live providers.
    if summary["completion_rate"] == 0.0 and summary["skipped_runs"] == runs:
        pytest.skip("All repeatability runs skipped due to provider outage.")

    assert summary["completion_rate"] > 0.0
    assert summary["qc_avg_s"] is not None and summary["qc_avg_s"] < 8.0
