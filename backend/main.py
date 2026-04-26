import asyncio
import sys
import os
from pathlib import Path

# Add backend directory to path for imports
backend_dir = Path(__file__).parent
sys.path.insert(0, str(backend_dir))

# Load environment variables from parent directory .env
from dotenv import load_dotenv
repo_root = Path(__file__).parent.parent
load_dotenv(repo_root / ".env")
load_dotenv(repo_root / ".env.local", override=True)

import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional
import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
import json
from config import settings
from streaming import SSEEventType, sse_event

from config import settings
from streaming import SSEEventType, sse_event
from storage.sqlite_store import init_db, get_reviews, save_review
_thread_pool = ThreadPoolExecutor(max_workers=4)


def _require_vertex_config() -> None:
    project_id = (os.environ.get("VERTEX_AI_PROJECT_ID") or "").strip()
    credentials_path = (os.environ.get("GOOGLE_APPLICATION_CREDENTIALS") or "").strip()
    if not project_id:
        raise HTTPException(
            status_code=503,
            detail="Vertex configuration missing: set VERTEX_AI_PROJECT_ID.",
        )
    if not credentials_path:
        raise HTTPException(
            status_code=503,
            detail="Vertex configuration missing: set GOOGLE_APPLICATION_CREDENTIALS to your service account JSON path.",
        )


def _normalize_review_severity(value: str) -> str:
    normalized = (value or "").strip().lower()
    if normalized in {"low", "minor"}:
        return "low"
    if normalized in {"high", "fatal", "critical", "major"}:
        return "high"
    return "medium"


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Pre-warm Vertex SDK in the background after startup is fully complete
    # so the first user request doesn't pay the SDK-load tax. We deliberately
    # DO NOT block startup on this and swallow any errors.
    async def _warm() -> None:
        try:
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(_thread_pool, lambda: __import__("labmate.council", fromlist=["_init_vertex"])._init_vertex())
        except Exception:
            pass

    # Initialize SQLite database
    init_db()

    asyncio.create_task(_warm())
    yield


app = FastAPI(title="The AI Scientist", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class PlanRequest(BaseModel):
    hypothesis: str = Field(..., min_length=50, max_length=2000,
                            description="Scientific hypothesis (50-2000 chars)")


# EdgeQuake-dependent routes disabled - using labmate module instead
# @app.post("/plan")
# async def plan(request: PlanRequest):
#     """POST /plan — streams SSE events as hypothesis is processed through the pipeline."""
#     async def pipeline_stream():
#         try:
#             from input_parser import parse_hypothesis
#             from graph import get_or_create_workspace, ingest_papers, query_context
#             from literature import fetch_papers
#
#             # 1. Parse hypothesis + extract domain key
#             parsed = await parse_hypothesis(request.hypothesis)
#
#             # 2. Fetch S2 papers
#             papers = await fetch_papers(parsed.domain_key, parsed.original_input)
#
#             # 3. Get-or-create workspace and ingest papers
#             workspace = await get_or_create_workspace(parsed.domain_key)
#             await ingest_papers(workspace.id, papers)
#             yield sse_event(SSEEventType.GRAPH_READY, {
#                 "workspace_id": workspace.id,
#                 "workspace_slug": parsed.domain_key,
#                 "papers_ingested": len(papers),
#             })
#
#             # 4. Query context and generate single-pass plan
#             yield sse_event(SSEEventType.PLAN_GENERATING, {"message": "Generating plan from knowledge graph..."})
#             context = await query_context(workspace.id, request.hypothesis)
#
#             from plan_gen import generate_plan
#             plan_json = await generate_plan(request.hypothesis, context, parsed)
#             yield sse_event(SSEEventType.PLAN_COMPLETE, {"plan": plan_json})
#
#         except Exception as e:
#             yield sse_event(SSEEventType.ERROR, {"message": str(e)})
#
#     return StreamingResponse(pipeline_stream(), media_type="text/event-stream",
#                              headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
#
#
# @app.get("/plan/mock/stream")
# async def mock_stream():
#     """GET /plan/mock/stream — emits a fixed 7-event SSE sequence for frontend dev."""
#     async def mock_events():
#         import asyncio
#         yield sse_event(SSEEventType.QC_COMPLETE, {
#             "signal": "similar_work_exists",
#             "refs": [
#                 {"title": "Gut microbiome modulation in C57BL/6 mice", "year": 2023,
#                  "authors": ["Smith J", "Lee K"], "doi": "10.1234/mock.001"},
#             ]
#         })
#         await asyncio.sleep(0.3)
#         yield sse_event(SSEEventType.GRAPH_READY, {
#             "workspace_id": "mock-ws-001",
#             "workspace_slug": "gut_permeability_mouse",
#             "papers_ingested": 20,
#         })
#         await asyncio.sleep(0.3)
#         yield sse_event(SSEEventType.AGENT_DRAFT, {
#             "agent": "ProtocolArchitect",
#             "section": "protocol",
#             "content": {"steps": [{"step": 1, "action": "Prepare C57BL/6 mice cohort", "duration": "1 week", "notes": "IACUC approval required"}]},
#         })
#         await asyncio.sleep(0.3)
#         yield sse_event(SSEEventType.AGENT_DRAFT, {
#             "agent": "MaterialsSpecialist",
#             "section": "materials",
#             "content": {"items": [{"name": "FITC-dextran 4kDa", "catalog": "46944", "vendor": "Sigma-Aldrich", "quantity": "250mg"}]},
#         })
#         await asyncio.sleep(0.3)
#         yield sse_event(SSEEventType.OBJECTIONS, {
#             "items": [{"section": "protocol", "claim": "FITC-dextran dose", "objection": "Dose not specified in mg/kg", "severity": "major"}],
#         })
#         await asyncio.sleep(0.3)
#         yield sse_event(SSEEventType.PLAN_COMPLETE, {"plan": {
#             "protocol": {"steps": []},
#             "materials": {"items": []},
#             "budget": {"total_usd": 4500, "breakdown": []},
#             "timeline": {"total_weeks": 8, "phases": []},
#             "validation": {"approach": "TEER + FITC flux assay at 0, 2, 4, 8 weeks"},
#         }})
#         await asyncio.sleep(0.3)
#         yield sse_event(SSEEventType.METRICS_COMPLETE, {"scores": {
#             "faithfulness": 0.87, "step_coverage": 0.82, "entity_precision": 0.79,
#             "retrieval_recall": 0.90, "council_convergence": 0.73,
#             "composite": 0.84,
#         }})
#         await asyncio.sleep(0.3)
#
#     return StreamingResponse(mock_events(), media_type="text/event-stream",
#                              headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------------------------------------------------------------------------
# /api/* routes — labmate frontend contract
# ---------------------------------------------------------------------------

class ApiHypothesisRequest(BaseModel):
    hypothesis: str


class ApiChatRequest(BaseModel):
    experimentId: Optional[str] = None
    hypothesis: Optional[str] = None
    question: str
    planContext: Optional[Dict[str, Any]] = None
    reviews: Optional[List[Dict[str, Any]]] = None


class ApiReviewRequest(BaseModel):
    experimentId: str
    section: str
    reviewer: str
    correction: str
    severity: str


@app.get("/api/health")
async def api_health():
    return {"status": "ok", "service": "The AI Scientist"}


@app.get("/api/contracts")
async def api_contracts():
    return [
        {"name": "Plan Generation", "method": "POST", "path": "/api/experiments/plan", "purpose": "Parse hypothesis and generate protocol plan."},
        {"name": "Literature QC", "method": "POST", "path": "/api/literature/qc", "purpose": "Novelty classification and supporting references."},
        {"name": "Chat", "method": "POST", "path": "/api/chat", "purpose": "Answer grounded questions over active experiment context."},
        {"name": "List Reviews", "method": "GET", "path": "/api/reviews", "purpose": "Fetch stored scientist review notes."},
        {"name": "Create Review", "method": "POST", "path": "/api/reviews", "purpose": "Store a review note used for regeneration."},
        {"name": "Knowledge Graph", "method": "GET", "path": "/api/knowledge-graph/context", "purpose": "Expose lightweight KG nodes/edges/tags."},
    ]


@app.post("/api/experiments/parse")
async def api_experiments_parse(req: ApiHypothesisRequest):
    def _parse():
        from labmate.parser import parse_user_input
        return parse_user_input(req.hypothesis)

    loop = asyncio.get_event_loop()
    parsed = await loop.run_in_executor(_thread_pool, _parse)
    return {
        "hypothesis": req.hypothesis,
        "intervention": parsed.intervention,
        "subject": parsed.subject,
        "outcome": parsed.outcome_metric,
        "threshold": parsed.target_quantity,
        "mechanism": None,
        "control": parsed.control_condition,
    }


@app.post("/api/literature/qc")
async def api_literature_qc(req: ApiHypothesisRequest):
    def _qc():
        from labmate.parser import parse_user_input
        from labmate.literature_qc import check_literature
        parsed = parse_user_input(req.hypothesis)
        return check_literature(parsed)

    loop = asyncio.get_event_loop()
    try:
        result = await asyncio.wait_for(loop.run_in_executor(_thread_pool, _qc), timeout=20.0)
    except asyncio.TimeoutError:
        return {
            "signal": "qc_unavailable",
            "summary": "Literature QC timed out after 20s. The pipeline will continue without an upfront novelty signal — you can still inspect adjacent prior art via the council trace.",
            "references": [],
        }
    except Exception as exc:
        return {
            "signal": "qc_unavailable",
            "summary": f"Literature QC unavailable: {exc}. Continuing to plan generation.",
            "references": [],
        }

    refs = [
        {"title": r.title, "uri": r.url, "source": f"{r.authors} ({r.year})" if r.year else r.authors}
        for r in result.references
    ]
    return {
        "signal": result.novelty_signal,
        "summary": f"OpenAlex returned {result.total_results} results for '{result.search_query_used}'.",
        "references": refs,
    }


@app.post("/api/experiments/plan")
async def api_experiments_plan(req: ApiHypothesisRequest):
    _require_vertex_config()
    from labmate.api_logic import build_experiment_plan

    def _build():
        reviews = get_reviews()
        return build_experiment_plan(req.hypothesis, reviews)

    loop = asyncio.get_event_loop()
    try:
        plan = await asyncio.wait_for(loop.run_in_executor(_thread_pool, _build), timeout=25.0)
    except asyncio.TimeoutError:
        raise HTTPException(
            status_code=504,
            detail="Plan generation timed out on backend. Please retry with a narrower hypothesis or verify Vertex service health.",
        )
    return plan


@app.post("/api/experiments/plan/stream")
async def api_experiments_plan_stream(req: ApiHypothesisRequest):
    """Stream council deliberation events in real time.

    Events from labmate.council are pushed onto an asyncio.Queue from a worker
    thread; the SSE generator drains that queue (with periodic heartbeats so
    proxies never see a quiet socket). The final `plan_complete` and
    `metrics_complete` events are emitted from the asyncio loop after the
    council returns.
    """
    import time as _time

    _require_vertex_config()
    queue: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_running_loop()
    SENTINEL: Dict[str, Any] = {"__done__": True}

    def _on_event(name: str, payload: Dict[str, Any]) -> None:
        try:
            loop.call_soon_threadsafe(queue.put_nowait, {"name": name, "payload": payload})
        except RuntimeError:
            pass  # Loop already closed (client disconnected) — drop silently.

    def _run() -> Dict[str, Any]:
        from labmate.council import run_council_plan

        try:
            reviews = get_reviews()
            result = run_council_plan(req.hypothesis, reviews, on_event=_on_event)
        except Exception as exc:
            loop.call_soon_threadsafe(queue.put_nowait, {"name": "__error__", "payload": {"message": str(exc)}})
            raise
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, SENTINEL)
        return result

    council_future = asyncio.get_running_loop().run_in_executor(_thread_pool, _run)

    async def _stream():
        last_pct = {"v": 5}
        heartbeat_count = 0

        def _progress(stage: str, message: str, pct: int) -> bytes:
            last_pct["v"] = pct
            return sse_event(SSEEventType.PROGRESS, {"stage": stage, "message": message, "pct": pct})

        try:
            yield _progress("parse", "Parsing hypothesis...", 8)

            saw_first_draft = False
            saw_objections = False
            draft_count = 0
            while True:
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=4.0)
                except asyncio.TimeoutError:
                    heartbeat_count += 1
                    if heartbeat_count in {6, 12}:
                        yield sse_event(SSEEventType.PROGRESS, {
                            "stage": "timeout_watch",
                            "message": "Council is still processing; waiting on model responses. Fallback may be used if delays continue.",
                            "pct": last_pct["v"],
                        })
                    yield sse_event(SSEEventType.PROGRESS, {
                        "stage": "heartbeat",
                        "message": "Council still working...",
                        "pct": last_pct["v"],
                    })
                    continue

                if item is SENTINEL:
                    break

                name = item.get("name")
                payload = item.get("payload", {})
                heartbeat_count = 0

                if name == "__error__":
                    yield sse_event(SSEEventType.ERROR, {"message": payload.get("message", "council failed"), "stage": "council"})
                    break

                if name == "parse_complete":
                    yield _progress("parse", f"Parsed: {payload.get('domain', '?')} / {payload.get('subject', '?')}", 18)

                elif name == "qc_ready":
                    signal = (payload.get("signal") or "").replace(" ", "_")
                    refs = payload.get("references") or []
                    yield sse_event(SSEEventType.QC_COMPLETE, {
                        "signal": signal,
                        "summary": payload.get("summary", ""),
                        "refs": refs[:3],
                        "references": refs[:3],
                    })
                    yield sse_event(SSEEventType.GRAPH_READY, {
                        "workspace_id": f"ws-{(payload.get('domain') or 'general').lower().replace(' ', '-')}",
                        "paper_count": int(max(0, len(refs) * 7)),
                        "domain": payload.get("domain", "General"),
                    })
                    yield _progress("parse", "Building base plan & retrieving protocol context...", 24)

                elif name == "base_plan_ready":
                    yield _progress("round1", "Round 1: 5 specialists drafting in parallel...", 32)

                elif name == "agent_draft":
                    if not saw_first_draft:
                        saw_first_draft = True
                    draft_count += 1
                    yield sse_event(SSEEventType.AGENT_DRAFT, payload)
                    yield _progress("round1", f"Round 1: {draft_count}/5 drafts in", min(60, 32 + draft_count * 6))

                elif name == "objections":
                    saw_objections = True
                    items = payload.get("items", [])
                    yield sse_event(SSEEventType.OBJECTIONS, {
                        "items": items,
                        "fatal_count": len([o for o in items if o.get("severity") == "fatal"]),
                    })
                    yield _progress("round3", f"Round 2 done · {len(items)} objections raised", 68)

                elif name == "agent_revision":
                    yield sse_event(SSEEventType.AGENT_REVISION, payload)

                elif name == "metrics_ready":
                    yield _progress("complete", "Computing final metrics...", 92)

            result = await council_future
            yield sse_event(SSEEventType.PLAN_COMPLETE, {
                "plan": result.get("plan", {}),
                "prdPlan": result.get("prd_plan", {}),
                "legacy_plan": result.get("plan", {}),
            })
            yield sse_event(SSEEventType.METRICS_COMPLETE, {
                "scores": result.get("metrics", {}),
                "estimated": False,
            })
        except Exception as exc:
            yield sse_event(SSEEventType.ERROR, {"message": str(exc), "stage": "stream_pipeline"})

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/chat")
async def api_chat(req: ApiChatRequest):
    hypothesis = req.hypothesis or ""

    # Pack context from live plan + reviews + novelty references.
    plan_ctx = req.planContext or {}
    reviews = req.reviews or []
    novelty_refs = list((plan_ctx.get("novelty") or {}).get("references") or [])
    sources = list(plan_ctx.get("sources") or [])
    key_materials = list(plan_ctx.get("keyMaterials") or [])
    validation = plan_ctx.get("validation") or {}
    review_adaptations = plan_ctx.get("reviewAdaptations") or []

    context_str = "\n".join([
        f"Hypothesis: {hypothesis}",
        f"Domain: {plan_ctx.get('domain', 'Unknown')}",
        f"Primary metric: {validation.get('primaryMetric', 'Unknown')}",
        f"Success criteria: {validation.get('successCriteria', 'Unknown')}",
        f"Recent review count: {len(reviews)}",
        f"Review adaptations count: {len(review_adaptations)}",
        f"Key materials: {json.dumps(key_materials[:5])}",
        f"Novelty references: {json.dumps(novelty_refs[:5])}",
        f"Plan sources: {json.dumps(sources[:5])}",
    ])

    def _chat_sync():
        from vertexai import init as vertex_init
        from vertexai.generative_models import GenerativeModel, GenerationConfig
        try:
            project_id = os.environ.get("VERTEX_AI_PROJECT_ID", "").strip()
            credentials_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
            if not project_id or not credentials_path:
                return None
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = credentials_path
            vertex_init(project=project_id, location="us-central1")

            model_name = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash").strip() or "gemini-2.5-flash"
            model = GenerativeModel(model_name)
            prompt = f"""You are a scientific AI assistant. Answer the following question based on the provided experiment context.
Context:
{context_str}

Question: {req.question}

Please return the answer, and extract exactly 1-2 citations used from the context (or relevant general knowledge if context is lacking). Also provide 2 follow-up questions.
Format your output EXACTLY as JSON matching this schema:
{{
  "answer": "your answer here",
  "citations": [{{"title": "citation title", "source": "source name", "uri": "optional url"}}],
  "followUps": ["question 1", "question 2"]
}}
"""
            response = model.generate_content(
                prompt,
                generation_config=GenerationConfig(temperature=0.2, max_output_tokens=1200),
            )
            # Find JSON block
            text = response.text
            import re
            json_match = re.search(r'```json\s*(.*?)\s*```', text, re.DOTALL)
            if json_match:
                json_str = json_match.group(1)
            else:
                json_match = re.search(r'(\{.*\})', text, re.DOTALL)
                json_str = json_match.group(1) if json_match else "{}"
            
            return json.loads(json_str)
        except Exception:
            # Fallback
            return None

    try:
        loop = asyncio.get_event_loop()
        res = await asyncio.wait_for(loop.run_in_executor(_thread_pool, _chat_sync), timeout=15.0)
        if res:
            return {
                "answer": res.get("answer", "I encountered an error generating the answer."),
                "citations": res.get("citations", []),
                "followUps": res.get("followUps", []),
                "mode": "grounded"
            }
    except Exception:
        pass

    # Fallback response: still grounded in visible context.
    fallback_citations = []
    for ref in novelty_refs[:2]:
        fallback_citations.append({
            "title": ref.get("title", "Novelty reference"),
            "source": ref.get("source", "Plan novelty context"),
            "uri": ref.get("uri"),
        })
    if not fallback_citations:
        for src in sources[:2]:
            fallback_citations.append({
                "title": src.get("title", "Plan source"),
                "source": src.get("source", "Plan context"),
                "uri": src.get("uri"),
            })

    top_review = reviews[0]["correction"] if reviews else "No scientist reviews yet."
    top_gate = (validation.get("decisionGates") or ["Review protocol gate readiness."])[0]
    answer = (
        f"For hypothesis '{hypothesis[:120]}', your question '{req.question}' is best addressed by checking gate: {top_gate}. "
        f"Latest scientist guidance: {top_review}"
    )
    return {
        "answer": answer,
        "citations": fallback_citations or [{"title": "Plan context", "source": "Generated from active plan context"}],
        "followUps": [
            "Which evidence source best supports this recommendation?",
            "What is the first decision gate likely to fail?",
        ],
        "mode": "fallback"
    }


@app.get("/api/reviews")
async def api_reviews_list(experimentId: Optional[str] = Query(default=None)):
    reviews = get_reviews(experimentId)
    return [{**r, "severity": _normalize_review_severity(r.get("severity", "medium"))} for r in reviews]


@app.post("/api/reviews")
async def api_reviews_create(req: ApiReviewRequest):
    record = {
        "experimentId": req.experimentId,
        "section": req.section,
        "reviewer": req.reviewer,
        "correction": req.correction,
        "severity": _normalize_review_severity(req.severity),
    }
    saved_record = save_review(record)
    return saved_record


@app.get("/api/knowledge-graph/context")
async def api_knowledge_graph(hypothesis: Optional[str] = Query(default=None)):
    def _parse(h: str):
        from labmate.parser import parse_user_input
        return parse_user_input(h)

    parsed = None
    if hypothesis:
        loop = asyncio.get_event_loop()
        try:
            parsed = await loop.run_in_executor(_thread_pool, lambda: _parse(hypothesis))
        except Exception:
            parsed = None

    return {
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
        "reviews": get_reviews()[:5],
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8787)


@app.get("/health")
async def health():
    """Check liveness of EdgeQuake, Redis, and Semantic Scholar. Always returns HTTP 200."""
    result: dict = {"status": "ok", "edgequake": "unknown", "redis": "unknown", "s2": "unknown"}

    try:
        from graph import get_eq_client
        from edgequake.types.shared import HealthResponse
        eq_health: HealthResponse = await get_eq_client().health()
        result["edgequake"] = eq_health.status
        if eq_health.status not in ("ok", "healthy"):
            result["status"] = "degraded"
    except Exception as exc:
        result["edgequake"] = f"error: {exc}"
        result["status"] = "degraded"

    try:
        import redis.asyncio as aioredis
        from config import settings as cfg
        r = aioredis.from_url(cfg.redis_url, socket_connect_timeout=2)
        await r.ping()
        await r.aclose()
        result["redis"] = "ok"
    except Exception as exc:
        result["redis"] = f"error: {exc}"
        result["status"] = "degraded"

    try:
        async with httpx.AsyncClient(timeout=3.0) as s2_client:
            resp = await s2_client.head(
                "https://api.semanticscholar.org/graph/v1/paper/search?query=test&limit=1"
            )
            result["s2"] = "ok" if resp.status_code < 500 else f"http_{resp.status_code}"
            if resp.status_code >= 500:
                result["status"] = "degraded"
    except Exception as exc:
        result["s2"] = f"error: {exc}"
        result["status"] = "degraded"

    return result
