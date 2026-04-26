import asyncio
import logging
from graph import get_or_create_workspace, ingest_papers
from literature import fetch_papers

logger = logging.getLogger(__name__)

# 4 demo domains pre-warmed at startup so judges see zero cold-start latency (GRAPH-05)
SAMPLE_DOMAINS: list[tuple[str, str]] = [
    (
        "gut_permeability_mouse",
        "Does Lactobacillus rhamnosus GG supplementation improve intestinal permeability in C57BL/6 mice by >20% compared to placebo?",
    ),
    (
        "crispr_t_cell_therapy",
        "Can CRISPR-Cas9 knockout of PD-1 in CAR-T cells improve tumor clearance by >50% in a B16-F10 melanoma mouse model?",
    ),
    (
        "alzheimers_tau_phosphorylation",
        "Does pharmacological inhibition of CDK5 reduce tau hyperphosphorylation by >30% in 3xTg-AD mice compared to vehicle control?",
    ),
    (
        "antibiotic_resistance_ecoli",
        "Does combinatorial treatment of colistin and rifampicin reduce MCR-1 E. coli colony counts by >3 log CFU compared to monotherapy?",
    ),
]


async def pre_warm_workspaces() -> None:
    """Pre-ingest papers for the 4 sample domains.

    Called via asyncio.create_task() from lifespan — never blocks API readiness.
    Processes domains sequentially to avoid overwhelming EdgeQuake at startup.
    Each domain failure is caught and logged; it must not crash the server.
    """
    logger.info("Starting workspace pre-warm for %d domains", len(SAMPLE_DOMAINS))
    for domain_key, representative_hypothesis in SAMPLE_DOMAINS:
        try:
            workspace = await get_or_create_workspace(domain_key)
            papers = await fetch_papers(domain_key, representative_hypothesis)
            if papers:
                count = await ingest_papers(workspace.id, papers)
                logger.info(
                    "Pre-warm %s: ingested %d papers (workspace=%s)",
                    domain_key,
                    count,
                    workspace.id,
                )
            else:
                logger.warning(
                    "Pre-warm %s: no papers fetched (S2 unavailable?)", domain_key
                )
        except Exception as exc:
            logger.error("Pre-warm failed for %s: %s", domain_key, exc)
    logger.info("Workspace pre-warm complete")
