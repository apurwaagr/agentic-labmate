import re
import logging
import httpx

from config import settings

logger = logging.getLogger(__name__)

SYNONYM_MAP: dict[str, str] = {
    "FD4": "FITC-dextran 4kDa",
    "FITC dextran": "FITC-dextran",
    "fluorescein isothiocyanate-dextran": "FITC-dextran",
    "fluorescein isothiocyanate–dextran": "FITC-dextran",
    "LGG": "Lactobacillus rhamnosus GG",
    "HFD": "high-fat diet",
    "STZ": "streptozotocin",
    "DMSO": "dimethyl sulfoxide",
    "PBS": "phosphate-buffered saline",
    "TEER": "transepithelial electrical resistance",
    "IACUC": "Institutional Animal Care and Use Committee",
    "i.p.": "intraperitoneally",
    "s.c.": "subcutaneously",
    "i.v.": "intravenously",
    "p.o.": "orally",
    "CFU": "colony-forming units",
    "KO": "knockout",
    "WT": "wild-type",
    "BW": "body weight",
    "qPCR": "quantitative PCR",
}

_S2_BASE = "https://api.semanticscholar.org/graph/v1"
_S2_FIELDS = "title,year,authors,abstract,tldr,openAccessPdf,externalIds"


async def normalise_text(text: str) -> str:
    for abbr, full in SYNONYM_MAP.items():
        pattern = r"\b" + re.escape(abbr) + r"\b"
        text = re.sub(pattern, full, text, flags=re.IGNORECASE)

    paragraphs = text.split("\n\n")
    merged: list[str] = []
    buf = ""
    for para in paragraphs:
        if buf:
            combined = buf + " " + para
            if len(buf) < 100:
                buf = combined
                continue
            else:
                merged.append(buf)
                buf = para
        else:
            buf = para
    if buf:
        merged.append(buf)

    return "\n\n".join(merged)


async def fetch_pdf_text(url: str) -> str | None:
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(url)
        if resp.status_code != 200:
            return None
        content = resp.content
        try:
            import fitz  # PyMuPDF
            doc = fitz.open(stream=content, filetype="pdf")
            pages = [page.get_text() for page in doc]
            return "\n".join(pages)
        except ImportError:
            return None
    except Exception as exc:
        logger.debug("PDF fetch failed for %s: %s", url, exc)
        return None


async def fetch_papers(
    domain_key: str, hypothesis: str, limit: int = 20
) -> list[dict]:
    query = hypothesis[:200]
    headers: dict[str, str] = {}
    if settings.s2_api_key:
        headers["X-API-KEY"] = settings.s2_api_key

    url = f"{_S2_BASE}/paper/search"
    params = {"query": query, "limit": limit, "fields": _S2_FIELDS}

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(url, params=params, headers=headers)
    except Exception as exc:
        logger.warning("S2 request failed: %s", exc)
        return []

    if resp.status_code == 429:
        logger.warning("S2 rate limit hit — returning empty paper list")
        return []

    if resp.status_code != 200:
        logger.warning("S2 returned HTTP %d — returning empty paper list", resp.status_code)
        return []

    try:
        data = resp.json().get("data", [])
    except Exception as exc:
        logger.warning("S2 JSON parse failed: %s", exc)
        return []

    results: list[dict] = []
    for paper in data:
        # Use abstract instead of full PDF to reduce token usage and fit within API quota
        raw_text: str | None = paper.get("abstract") or None
        
        # Fallback to TLDR if abstract not available (shortest option)
        if raw_text is None:
            tldr = paper.get("tldr") or {}
            raw_text = tldr.get("text") or None
        
        # Skip papers without abstract or TLDR (no PDF download to avoid quota issues)
        if not raw_text:
            logger.debug("Skipping paper %s: no abstract or TLDR available", paper.get("paperId", "?"))
            continue

        text = await normalise_text(raw_text)
        doi = (paper.get("externalIds") or {}).get("DOI")

        results.append({
            "paper_id": paper.get("paperId", ""),
            "title": paper.get("title", ""),
            "year": paper.get("year") or 0,
            "text": text,
            "doi": doi,
        })

    return results
