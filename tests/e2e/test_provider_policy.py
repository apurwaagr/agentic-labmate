from __future__ import annotations

import os
import re

import pytest

from ._pipeline_utils import (
    BACKEND_BASE_URL,
    PRIMARY_HYPOTHESIS,
    assert_no_alt_provider_fallback,
    collect_sse_stream,
    maybe_skip_for_outage,
    read_backend_log,
    slice_new_log,
)


@pytest.mark.asyncio
async def test_no_alternate_provider_attempts_in_logs():
    before = read_backend_log()
    capture = await collect_sse_stream(base_url=BACKEND_BASE_URL, hypothesis=PRIMARY_HYPOTHESIS)
    after = read_backend_log()
    log_slice = slice_new_log(before, after)

    maybe_skip_for_outage(capture, log_slice)

    # Enforce configured policy as evidence in runtime logs.
    if os.getenv("PLAN_ENABLE_GOOGLE_FALLBACK", "false").lower() not in {"false", "0", "no"}:
        pytest.fail("PLAN_ENABLE_GOOGLE_FALLBACK must be disabled for strict tests.")

    assert_no_alt_provider_fallback(log_slice)

    # If provider chain is logged, verify it does not include google.
    chain_match = re.search(r"provider chain=([^\n]+)", log_slice, flags=re.IGNORECASE)
    if chain_match:
        assert "google" not in chain_match.group(1).lower(), "Provider chain includes disallowed google provider."
