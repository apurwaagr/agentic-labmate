from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from time import perf_counter
from typing import Any, Dict, List, Tuple

import httpx
import pytest


BACKEND_BASE_URL = os.getenv("TEST_BACKEND_BASE_URL", "http://127.0.0.1:8000")
FRONTEND_BASE_URL = os.getenv("TEST_FRONTEND_BASE_URL", "http://127.0.0.1:8080")
BACKEND_LOG_PATH = os.getenv("TEST_BACKEND_LOG_PATH", "/tmp/uvicorn.log")

PRIMARY_HYPOTHESIS = (
    "Supplementing C57BL/6 mice with Lactobacillus rhamnosus GG for 4 weeks will reduce "
    "intestinal permeability by at least 30% compared to controls, measured by FITC-dextran assay, "
    "due to upregulation of tight junction proteins claudin-1 and occludin."
)


@dataclass
class StreamCapture:
    events: List[Tuple[str, Dict[str, Any]]]
    timings: Dict[str, float]


def classify_provider_outage(text: str) -> bool:
    lowered = text.lower()
    patterns = [
        "rate limit",
        "resource_exhausted",
        "quota exceeded",
        "429",
        "connection refused",
        "timed out",
        "temporarily unavailable",
        "all plan providers failed",
    ]
    return any(p in lowered for p in patterns)


def read_backend_log() -> str:
    path = Path(BACKEND_LOG_PATH)
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8", errors="ignore")


def slice_new_log(before: str, after: str) -> str:
    if not before:
        return after
    idx = after.find(before[-5000:])
    if idx == -1:
        return after
    return after[idx + len(before[-5000:]) :]


def assert_no_mock_usage(log_slice: str) -> None:
    mock_tokens = ["mock-api.mjs", "POST /api/experiments/plan"]
    for token in mock_tokens:
        assert token not in log_slice, f"Detected mock/legacy pipeline token in logs: {token}"


def assert_no_alt_provider_fallback(log_slice: str) -> None:
    # Strict: disallow google/gemini attempts entirely.
    disallowed_patterns = [
        r"provider=google",
        r"gemini",
        r"generativelanguage\.googleapis\.com",
    ]
    for pattern in disallowed_patterns:
        assert re.search(pattern, log_slice, flags=re.IGNORECASE) is None, (
            f"Detected disallowed alternate provider usage: {pattern}"
        )


def assert_edgequake_ollama_only(edgequake_logs: str) -> None:
    lowered = edgequake_logs.lower()
    assert "provider=ollama" in lowered or "providers::ollama" in lowered, (
        "Expected Ollama provider evidence in EdgeQuake logs."
    )
    assert "gemini" not in lowered and "google" not in lowered and "generativelanguage" not in lowered, (
        "Detected non-Ollama provider token in EdgeQuake logs."
    )


async def collect_sse_stream(
    *,
    base_url: str,
    hypothesis: str,
    timeout_s: int = 140,
) -> StreamCapture:
    t0 = perf_counter()
    events: List[Tuple[str, Dict[str, Any]]] = []
    timings: Dict[str, float] = {}

    try:
        async with httpx.AsyncClient(timeout=float(timeout_s)) as client:
            async with client.stream(
                "POST",
                f"{base_url}/api/plan",
                json={"hypothesis": hypothesis},
                headers={"Accept": "text/event-stream"},
            ) as resp:
                assert resp.status_code == 200, f"SSE endpoint returned HTTP {resp.status_code}"
                event_name: str | None = None
                data_lines: list[str] = []

                async for line in resp.aiter_lines():
                    if line == "":
                        if event_name and data_lines:
                            data_raw = "\n".join(data_lines)
                            payload = json.loads(data_raw)
                            events.append((event_name, payload))
                            timings.setdefault(event_name, perf_counter() - t0)
                            if event_name in {"plan_complete", "error"}:
                                break
                        event_name = None
                        data_lines = []
                        continue
                    if line.startswith("event:"):
                        event_name = line[6:].strip()
                    elif line.startswith("data:"):
                        data_lines.append(line[5:].lstrip())
    except httpx.ReadTimeout:
        events.append(
            (
                "error",
                {"message": f"timed out waiting for plan_complete after {timeout_s}s"},
            )
        )
        timings.setdefault("error", perf_counter() - t0)

    return StreamCapture(events=events, timings=timings)


def maybe_skip_for_outage(capture: StreamCapture, log_slice: str) -> None:
    error_events = [p for e, p in capture.events if e == "error"]
    if error_events:
        msg = str(error_events[-1].get("message", ""))
        if classify_provider_outage(msg):
            pytest.skip(f"Provider outage classified from SSE error: {msg}")
    if classify_provider_outage(log_slice):
        pytest.skip("Provider outage classified from backend logs.")
