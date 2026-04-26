import json
from enum import Enum
from typing import AsyncIterator


class SSEEventType(str, Enum):
    PROGRESS = "progress"
    QC_COMPLETE = "qc_complete"
    GRAPH_READY = "graph_ready"
    AGENT_DRAFT = "agent_draft"
    OBJECTIONS = "objections"
    AGENT_REVISION = "agent_revision"
    PLAN_COMPLETE = "plan_complete"
    METRICS_COMPLETE = "metrics_complete"
    ERROR = "error"
    # Phase 1 single-pass intermediate event
    PLAN_GENERATING = "plan_generating"


def sse_event(event_type: SSEEventType | str, data: dict) -> str:
    """Format a single SSE event string. Caller yields this from an async generator."""
    name = event_type.value if isinstance(event_type, SSEEventType) else str(event_type)
    return f"event: {name}\ndata: {json.dumps(data)}\n\n"
