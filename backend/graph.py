import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from edgequake import AsyncEdgeQuake
    from edgequake.types.workspaces import WorkspaceInfo

logger = logging.getLogger(__name__)

_eq_client: "AsyncEdgeQuake | None" = None


def get_eq_client() -> "AsyncEdgeQuake":
    global _eq_client
    if _eq_client is None:
        from edgequake import AsyncEdgeQuake
        from config import settings
        _eq_client = AsyncEdgeQuake(
            base_url=settings.edgequake_base_url,
            api_key=settings.edgequake_api_key or None,
        )
    return _eq_client


async def get_or_create_workspace(domain_key: str) -> "WorkspaceInfo":
    from edgequake._errors import NotFoundError
    from edgequake.types.workspaces import WorkspaceCreate
    from config import settings

    client = get_eq_client()
    try:
        workspaces = await client.workspaces.list(settings.edgequake_tenant_id)
        workspace = next((w for w in workspaces if w.slug == domain_key), None)
        if workspace:
            logger.info("Workspace cache hit: %s (id=%s)", domain_key, workspace.id)
            return workspace
        else:
            raise NotFoundError("Not found", status_code=404)
    except NotFoundError:
        workspace = await client.workspaces.create(
            settings.edgequake_tenant_id,
            WorkspaceCreate(name=domain_key, slug=domain_key),
        )
        logger.info("Workspace created: %s (id=%s)", domain_key, workspace.id)
        return workspace


async def ingest_papers(workspace_id: str, papers: list[dict]) -> int:
    import asyncio
    scoped = get_eq_client().with_workspace(workspace_id)
    success = 0
    failed = []
    
    for i, paper in enumerate(papers):
        max_retries = 2
        for attempt in range(max_retries):
            try:
                await scoped.documents.upload(
                    paper["text"],
                    title=paper["title"],
                    metadata={
                        "source": "s2",
                        "paper_id": paper["paper_id"],
                        "year": str(paper.get("year", "")),
                        "doi": paper.get("doi") or "",
                    },
                )
                success += 1
                logger.info("Successfully ingested paper %d/%d: %s", i+1, len(papers), paper.get("title", "?")[:50])
                break  # Success, exit retry loop
            except Exception as exc:
                error_str = str(exc)
                # Check for rate limit errors
                is_rate_limit = "429" in error_str or "quota" in error_str.lower() or "rate limit" in error_str.lower()
                
                if is_rate_limit and attempt < max_retries - 1:
                    wait_time = (attempt + 1) * 5  # Exponential backoff: 5s, 10s
                    logger.warning(
                        "Rate limit hit for paper %s (attempt %d/%d). Waiting %ds before retry...",
                        paper.get("paper_id", "?"),
                        attempt + 1,
                        max_retries,
                        wait_time,
                    )
                    await asyncio.sleep(wait_time)
                else:
                    failed.append({
                        "paper_id": paper.get("paper_id", "?"),
                        "title": paper.get("title", "?"),
                        "error": str(exc),
                    })
                    logger.warning(
                        "Ingestion failed for paper %s after %d attempts: %s",
                        paper.get("paper_id", "?"),
                        max_retries,
                        exc,
                    )
                    break
    
    if failed:
        logger.error("Failed to ingest %d papers:", len(failed))
        for f in failed[:5]:  # Log first 5 failures
            logger.error("  - %s: %s", f["title"][:40], f["error"])
        if len(failed) > 5:
            logger.error("  ... and %d more failures", len(failed) - 5)
    
    logger.info("Successfully ingested %d/%d papers into workspace %s", success, len(papers), workspace_id)
    return success


async def query_context(workspace_id: str, hypothesis: str) -> str:
    scoped = get_eq_client().with_workspace(workspace_id)
    result = await scoped.query.execute(hypothesis, mode="hybrid", top_k=10)
    return result.answer
