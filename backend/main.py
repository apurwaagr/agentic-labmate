import asyncio
import hashlib
import logging
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
from .config import settings
from .streaming import SSEEventType, sse_event

# In-memory review store shared across the /api/reviews endpoints
_REVIEWS: List[Dict[str, Any]] = []
_thread_pool = ThreadPoolExecutor(max_workers=4)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Keep startup resilient in local mode when optional services
    # (e.g., EdgeQuake/Redis) are not installed or reachable.
    try:
        from .plan_gen import resolve_plan_provider_chain, resolve_plan_provider_model
        provider, model = resolve_plan_provider_model()
        logger.info("Configured /plan LLM provider=%s model=%s", provider, model)
        chain = resolve_plan_provider_chain()
        logger.info(
            "Configured /plan provider chain=%s google_fallback_enabled=%s",
            " -> ".join(f"{p}:{m}" for p, m in chain) if chain else "none",
            settings.plan_enable_google_fallback,
        )
        from .graph import get_eq_client
        get_eq_client()  # init singleton on startup
        from .startup import pre_warm_workspaces
        asyncio.create_task(pre_warm_workspaces())
    except Exception:
        pass
    yield


app = FastAPI(title="The AI Scientist", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class PlanRequest(BaseModel):
    hypothesis: str = Field(..., min_length=50, max_length=2000,
                            description="Scientific hypothesis (50-2000 chars)")


@app.post("/plan")
async def plan(request: PlanRequest):
    """POST /plan — streams SSE events as hypothesis is processed through the pipeline."""
    async def pipeline_stream():
        try:
            from .input_parser import parse_hypothesis
            from .graph import get_or_create_workspace, ingest_papers, query_context
            from .literature import fetch_papers
            from .cache import get_json, set_json
            from .labmate.literature_qc import FAST_PER_PAGE, FAST_TIMEOUT_S, check_literature
            from .labmate.literature_schemas import LiteratureQCResult, PaperReference
            from .labmate.schemas import ParsedHypothesis as LabmateParsed
            from .plan_translator import build_frontend_experiment
            from .plan_gen import resolve_plan_provider_chain

            # 1. Parse hypothesis + extract domain key
            parsed = await parse_hypothesis(request.hypothesis)

            hypothesis_hash = hashlib.sha256(request.hypothesis.strip().lower().encode("utf-8")).hexdigest()[:24]
            qc_cache_key = f"qc:{hypothesis_hash}"
            chain = resolve_plan_provider_chain()
            chain_key = "|".join(f"{p}:{m}" for p, m in chain) if chain else "none"
            plan_cache_key = f"plan:{hypothesis_hash}:{hashlib.sha256(chain_key.encode('utf-8')).hexdigest()[:12]}"

            # 2. Literature QC first — scientists need this signal before committing to plan generation.
            def _qc_sync():
                lab_parsed = LabmateParsed(
                    original_input=parsed.original_input,
                    domain=parsed.domain,
                    subject=parsed.subject,
                    intervention=parsed.intervention,
                    outcome_metric=parsed.outcome_metric,
                    is_novelty_search=parsed.is_novelty_search,
                    control_condition=parsed.control_condition,
                    target_quantity=parsed.target_quantity,
                    environmental_constraints=parsed.environmental_constraints,
                    clarifying_questions=parsed.clarifying_questions,
                )
                return check_literature(
                    lab_parsed,
                    per_page=FAST_PER_PAGE,
                    timeout_s=FAST_TIMEOUT_S,
                )

            loop = asyncio.get_event_loop()
            qc_result: LiteratureQCResult | None = None
            cached_qc = await get_json(qc_cache_key)
            if cached_qc:
                try:
                    qc_result = LiteratureQCResult(
                        novelty_signal=cached_qc["novelty_signal"],
                        references=[
                            PaperReference(
                                title=r.get("title", ""),
                                authors=r.get("authors", "Unknown"),
                                year=r.get("year"),
                                url=r.get("url", ""),
                            )
                            for r in cached_qc.get("references", [])
                        ],
                        search_query_used=cached_qc.get("search_query_used", ""),
                        total_results=int(cached_qc.get("total_results", 0)),
                    )
                except Exception as parse_err:
                    logger.debug("Ignoring invalid cached QC payload: %s", parse_err)
                    qc_result = None
            if qc_result is None:
                try:
                    qc_result = await loop.run_in_executor(_thread_pool, _qc_sync)
                    if qc_result is not None:
                        await set_json(
                            qc_cache_key,
                            {
                                "novelty_signal": qc_result.novelty_signal,
                                "references": [
                                    {
                                        "title": r.title,
                                        "authors": r.authors,
                                        "year": r.year,
                                        "url": r.url,
                                    }
                                    for r in qc_result.references
                                ],
                                "search_query_used": qc_result.search_query_used,
                                "total_results": qc_result.total_results,
                            },
                            settings.cache_qc_ttl_s,
                        )
                except Exception as qc_err:
                    logger.warning("Literature QC failed: %s", qc_err)
                    qc_result = None

            qc_refs_payload: list[dict] = []
            novelty_label = "similar work exists"
            qc_summary = "Literature QC unavailable."
            if qc_result is not None:
                novelty_label = {
                    "not_found": "not found",
                    "similar_work_exists": "similar work exists",
                    "exact_match_found": "exact match found",
                }.get(qc_result.novelty_signal, "similar work exists")
                qc_summary = (
                    f"OpenAlex returned {qc_result.total_results} results for "
                    f"'{qc_result.search_query_used}'."
                )
                qc_refs_payload = [
                    {
                        "title": r.title,
                        "uri": r.url,
                        "source": f"{r.authors} ({r.year})" if r.year else r.authors,
                    }
                    for r in qc_result.references[:3]
                ]

            yield sse_event(SSEEventType.QC_COMPLETE, {
                "signal": novelty_label,
                "summary": qc_summary,
                "references": qc_refs_payload,
            })

            # 2b. Cache-first fast path: return fully cached plan payload if available.
            cached_plan = await get_json(plan_cache_key)
            if cached_plan and isinstance(cached_plan.get("experiment"), dict):
                yield sse_event(SSEEventType.GRAPH_READY, {
                    "workspace_id": "cached",
                    "workspace_slug": parsed.domain_key,
                    "papers_ingested": 0,
                })
                yield sse_event(SSEEventType.PLAN_GENERATING, {"message": "Using cached plan payload..."})
                yield sse_event(SSEEventType.PLAN_COMPLETE, {
                    "plan": cached_plan.get("plan") or {},
                    "experiment": cached_plan["experiment"],
                })
                return

            # 3. Fetch S2 papers
            papers = await fetch_papers(parsed.domain_key, parsed.original_input)

            # 4. Get-or-create workspace and ingest papers
            workspace = await get_or_create_workspace(parsed.domain_key)
            await ingest_papers(workspace.id, papers)
            yield sse_event(SSEEventType.GRAPH_READY, {
                "workspace_id": workspace.id,
                "workspace_slug": parsed.domain_key,
                "papers_ingested": len(papers),
            })

            # 5. Query context and generate single-pass plan
            yield sse_event(SSEEventType.PLAN_GENERATING, {"message": "Generating plan from knowledge graph..."})
            try:
                context = await query_context(workspace.id, request.hypothesis)
            except Exception:
                # EdgeQuake query can fail when upstream provider quotas are exhausted.
                # Fall back to concise context from fetched papers so /plan still runs.
                snippets: list[str] = []
                for p in papers[:8]:
                    title = (p.get("title") or "").strip()
                    text = (p.get("text") or "").strip().replace("\n", " ")
                    excerpt = text[:600]
                    if title or excerpt:
                        snippets.append(f"Title: {title}\nExcerpt: {excerpt}")
                context = "\n\n".join(snippets) if snippets else request.hypothesis

            from .plan_gen import generate_plan
            plan_json = await generate_plan(request.hypothesis, context, parsed)

            # 6. Translate plan_gen JSON into the frontend ExperimentPlan shape.
            experiment = build_frontend_experiment(
                hypothesis=request.hypothesis,
                parsed=parsed,
                plan_json=plan_json,
                qc_result=qc_result,
                papers=papers,
            )
            yield sse_event(SSEEventType.PLAN_COMPLETE, {
                "plan": plan_json,
                "experiment": experiment,
            })
            await set_json(
                plan_cache_key,
                {
                    "plan": plan_json,
                    "experiment": experiment,
                },
                settings.cache_plan_ttl_s,
            )

        except Exception as e:
            yield sse_event(SSEEventType.ERROR, {"message": str(e)})

    return StreamingResponse(pipeline_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/plan")
async def api_plan(request: PlanRequest):
    """Frontend-facing alias for POST /plan so the Vite proxy forwards `/api/*` uniformly."""
    return await plan(request)


@app.get("/plan/mock/stream")
async def mock_stream():
    """GET /plan/mock/stream — emits a fixed 7-event SSE sequence for frontend dev."""
    async def mock_events():
        import asyncio
        yield sse_event(SSEEventType.QC_COMPLETE, {
            "signal": "similar_work_exists",
            "refs": [
                {"title": "Gut microbiome modulation in C57BL/6 mice", "year": 2023,
                 "authors": ["Smith J", "Lee K"], "doi": "10.1234/mock.001"},
            ]
        })
        await asyncio.sleep(0.3)
        yield sse_event(SSEEventType.GRAPH_READY, {
            "workspace_id": "mock-ws-001",
            "workspace_slug": "gut_permeability_mouse",
            "papers_ingested": 20,
        })
        await asyncio.sleep(0.3)
        yield sse_event(SSEEventType.AGENT_DRAFT, {
            "agent": "ProtocolArchitect",
            "section": "protocol",
            "content": {"steps": [{"step": 1, "action": "Prepare C57BL/6 mice cohort", "duration": "1 week", "notes": "IACUC approval required"}]},
        })
        await asyncio.sleep(0.3)
        yield sse_event(SSEEventType.AGENT_DRAFT, {
            "agent": "MaterialsSpecialist",
            "section": "materials",
            "content": {"items": [{"name": "FITC-dextran 4kDa", "catalog": "46944", "vendor": "Sigma-Aldrich", "quantity": "250mg"}]},
        })
        await asyncio.sleep(0.3)
        yield sse_event(SSEEventType.OBJECTIONS, {
            "items": [{"section": "protocol", "claim": "FITC-dextran dose", "objection": "Dose not specified in mg/kg", "severity": "major"}],
        })
        await asyncio.sleep(0.3)
        yield sse_event(SSEEventType.PLAN_COMPLETE, {"plan": {
            "protocol": {"steps": []},
            "materials": {"items": []},
            "budget": {"total_usd": 4500, "breakdown": []},
            "timeline": {"total_weeks": 8, "phases": []},
            "validation": {"approach": "TEER + FITC flux assay at 0, 2, 4, 8 weeks"},
        }})
        await asyncio.sleep(0.3)
        yield sse_event(SSEEventType.METRICS_COMPLETE, {"scores": {
            "faithfulness": 0.87, "step_coverage": 0.82, "entity_precision": 0.79,
            "retrieval_recall": 0.90, "council_convergence": 0.73,
            "composite": 0.84,
        }})
        await asyncio.sleep(0.3)

    return StreamingResponse(mock_events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


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


def _safe_labmate_parse(hypothesis: str):
    from .labmate.parser import parse_user_input
    from .labmate.schemas import ParsedHypothesis

    try:
        return parse_user_input(hypothesis)
    except Exception as exc:
        err_msg = str(exc).strip() or "Unknown parser error."
        return ParsedHypothesis(
            original_input=hypothesis,
            domain="General Science",
            subject="unspecified subject",
            intervention="unspecified intervention",
            outcome_metric="quantitative change > 0%",
            is_novelty_search=False,
            control_condition="baseline/control group",
            clarifying_questions=[
                f"Parser fallback: {err_msg}",
                "Please confirm subject, intervention, and metric.",
            ],
        )


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
        return _safe_labmate_parse(req.hypothesis)

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
        from .labmate.literature_qc import check_literature
        parsed = _safe_labmate_parse(req.hypothesis)
        return check_literature(parsed)

    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(_thread_pool, _qc)
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
    from .labmate.api_logic import build_experiment_plan

    def _build():
        return build_experiment_plan(req.hypothesis, _REVIEWS)

    loop = asyncio.get_event_loop()
    plan = await loop.run_in_executor(_thread_pool, _build)
    return plan


@app.post("/api/chat")
async def api_chat(req: ApiChatRequest):
    hypothesis = req.hypothesis or ""
    answer = (
        f"For hypothesis '{hypothesis[:120]}', the key next check is: {req.question}. "
        "Review novelty references, validate control integrity, then confirm the primary metric thresholds."
    )
    return {
        "answer": answer,
        "citations": [{"title": "Literature QC", "source": "Generated from current plan context"}],
        "followUps": [
            "Should we tighten the success criteria?",
            "Which step has highest execution risk?",
        ],
    }


@app.get("/api/reviews")
async def api_reviews_list(experimentId: Optional[str] = Query(default=None)):
    if experimentId:
        return [r for r in _REVIEWS if r.get("experimentId") == experimentId]
    return _REVIEWS


@app.post("/api/reviews")
async def api_reviews_create(req: ApiReviewRequest):
    record = {
        "experimentId": req.experimentId,
        "section": req.section,
        "reviewer": req.reviewer,
        "correction": req.correction,
        "severity": req.severity.lower(),
    }
    _REVIEWS.append(record)
    return record


@app.get("/api/knowledge-graph/context")
async def api_knowledge_graph(hypothesis: Optional[str] = Query(default=None)):
    def _parse(h: str):
        return _safe_labmate_parse(h)

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
        "reviews": _REVIEWS[-5:],
    }


@app.get("/health")
async def health():
    """Check liveness of EdgeQuake, Redis, and Semantic Scholar. Always returns HTTP 200."""
    result: dict = {"status": "ok", "edgequake": "unknown", "redis": "unknown", "s2": "unknown"}

    try:
        from .graph import get_eq_client
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
        from .config import settings as cfg
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
