from __future__ import annotations

import os
import re
from typing import Any, List, Set, Tuple

import requests
from dotenv import load_dotenv

from .literature_schemas import LiteratureQCResult, PaperReference
from .schemas import ParsedHypothesis

OPENALEX_WORKS_URL = "https://api.openalex.org/works"
DEFAULT_PER_PAGE = 10
REQUEST_TIMEOUT_S = 30


def _configure_network_env() -> None:
    if os.environ.get("ALLOW_SYSTEM_PROXY", "0").strip() == "1":
        return
    for key in [
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "http_proxy",
        "https_proxy",
        "all_proxy",
    ]:
        os.environ.pop(key, None)


_STOPWORDS: Set[str] = {
    "and", "are", "the", "for", "from", "with", "this", "that", "has", "was", "not", "all", "its",
    "our", "out", "any", "use", "one", "using", "used", "can", "but", "per", "vs", "when", "where",
    "while", "here", "over", "more", "less", "may", "how", "new", "be", "at", "in", "on", "or", "an",
    "a", "is", "it", "as", "if", "we", "of", "to", "by", "up", "so", "no", "do", "et", "al", "e.g",
    "e.g.", "i.e", "i.e.", "which", "what", "about", "some", "only", "other", "after", "then", "also",
    "just", "most", "even", "will", "each", "such", "into", "through", "including", "compared",
    "comparison", "compared to", "compared with",
}


def _tokenize(text: str) -> List[str]:
    if not text or not text.strip():
        return []
    words = re.findall(r"[A-Za-z0-9][A-Za-z0-9\-/]*", text.lower())
    return [w for w in words if w not in _STOPWORDS and len(w) >= 2]


def _reconstruct_abstract(abstract_inverted_index: Any) -> str:
    if not abstract_inverted_index or not isinstance(abstract_inverted_index, dict):
        return ""
    n = 0
    for positions in abstract_inverted_index.values():
        for p in positions:
            if p > n:
                n = p
    n += 1
    parts: list[str] = [""] * n
    for word, positions in abstract_inverted_index.items():
        for p in positions:
            if 0 <= p < n:
                parts[p] = word
    return " ".join(parts).strip().lower()


def _build_openalex_params(search_query: str, per_page: int) -> dict[str, Any]:
    load_dotenv()
    _configure_network_env()
    params: dict[str, Any] = {
        "search": search_query,
        "per_page": per_page,
    }
    api_key = os.environ.get("OPENALEX_API_KEY", "").strip()
    if api_key:
        params["api_key"] = api_key
    mailto = os.environ.get("OPENALEX_MAILTO", "").strip()
    if mailto:
        params["mailto"] = mailto
    return params


def _pick_work_url(work: dict[str, Any]) -> str:
    primary = work.get("primary_location") or {}
    url = primary.get("landing_page_url") or primary.get("pdf_url")
    if url:
        return url
    oa = work.get("open_access") or {}
    if oa.get("oa_url"):
        return oa["oa_url"]
    doi = work.get("doi")
    if isinstance(doi, str) and doi.startswith("http"):
        return doi
    wid = work.get("id")
    if isinstance(wid, str) and wid.startswith("http"):
        return wid
    return ""


def _format_authors(work: dict[str, Any]) -> str:
    auths: List[str] = []
    for a in (work.get("authorships") or [])[:4]:
        author = (a or {}).get("author") or {}
        name = author.get("display_name")
        if name:
            auths.append(name)
    if not auths and work.get("author"):
        return str(work.get("author"))
    if not auths:
        return "Unknown"
    if len((work.get("authorships") or [])) > 4:
        return ", ".join(auths[:3]) + " et al."
    return ", ".join(auths)


def _work_to_paper_ref(work: dict[str, Any]) -> PaperReference:
    title = work.get("title") or work.get("display_name") or "Untitled"
    year = work.get("publication_year")
    if not isinstance(year, int):
        year = None
    return PaperReference(
        title=title,
        authors=_format_authors(work),
        year=year,
        url=_pick_work_url(work) or (work.get("id") or ""),
    )


def _work_text_fields(work: dict[str, Any]) -> str:
    title = (work.get("title") or work.get("display_name") or "").lower()
    ab = _reconstruct_abstract(work.get("abstract_inverted_index"))
    return f"{title} {ab}"


def _key_tokens(h: ParsedHypothesis) -> Tuple[List[str], List[str]]:
    bits = " ".join(
        [
            h.domain or "",
            h.subject or "",
            h.intervention or "",
            h.outcome_metric or "",
        ]
    )
    all_t = _tokenize(bits)
    int_t = _tokenize(h.intervention or "")
    if len(all_t) < 2 and bits.strip():
        all_t = re.findall(r"[A-Za-z0-9][A-Za-z0-9\-/]+", bits.lower())
    return all_t, int_t


def _intervention_substantial_in_text(int_tokens: List[str], work_text: str) -> bool:
    if not int_tokens:
        return True
    hit = 0
    for t in int_tokens:
        if t in work_text or re.search(r"\b" + re.escape(t) + r"\b", work_text):
            hit += 1
    if hit >= max(1, (len(int_tokens) + 1) // 2):
        return True
    if len(int_tokens) <= 1:
        return hit == 1
    return hit >= 2 and hit >= len(int_tokens) * 0.5


def _novelty_and_references(
    key_tokens: List[str],
    int_tokens: List[str],
    results: list[dict[str, Any]],
) -> Tuple[str, list[PaperReference]]:
    if not results:
        return "not_found", []
    work_scores: list[tuple[dict[str, Any], float, bool, bool, float]] = []
    uniq = list(dict.fromkeys(key_tokens))
    for w in results:
        wt = _work_text_fields(w)
        if uniq:
            hit = sum(1 for t in uniq if t in wt)
            coverage = hit / max(len(uniq), 1)
        else:
            rsc = w.get("relevance_score", 0) or 0
            coverage = min(1.0, float(rsc) / 500.0) if rsc else 0.0
        int_match = _intervention_substantial_in_text(int_tokens, wt) if int_tokens else True
        is_exact = coverage >= 0.88 and int_match and len(uniq) >= 3
        is_sim = (coverage >= 0.25 and (int_match or len(uniq) <= 2)) or (coverage >= 0.35)
        rel = float(w.get("relevance_score", 0) or 0)
        work_scores.append((w, coverage, is_exact, is_sim, rel))
    work_scores.sort(
        key=lambda t: (t[2], t[1] + 0.0001 * t[4]),
        reverse=True,
    )
    any_exact = any(t[2] for t in work_scores)
    any_sim = any(t[2] or (t[3] and t[1] >= 0.2) for t in work_scores)
    ranked = sorted(
        work_scores,
        key=lambda t: (t[2] or t[3], t[1], t[4]),
        reverse=True,
    )[:3]
    refs = [_work_to_paper_ref(t[0]) for t in ranked]
    top_rel = ranked[0][4] if ranked else 0.0
    top_cov = ranked[0][1] if ranked else 0.0
    if any_exact:
        return "exact_match_found", refs
    if any_sim and any(t[1] > 0.0 or t[2] for t in work_scores):
        return "similar_work_exists", refs
    if top_cov >= 0.12 or top_rel >= 45:
        return "similar_work_exists", refs
    return "not_found", refs


def check_literature(parsed_hypothesis: ParsedHypothesis) -> LiteratureQCResult:
    h = parsed_hypothesis
    query_parts = [h.domain, h.subject, h.intervention, h.outcome_metric]
    search_query = " ".join(p.strip() for p in query_parts if p and str(p).strip())
    if not search_query:
        return LiteratureQCResult(
            novelty_signal="not_found",
            references=[],
            search_query_used="",
            total_results=0,
        )

    params = _build_openalex_params(search_query, DEFAULT_PER_PAGE)
    resp = requests.get(OPENALEX_WORKS_URL, params=params, timeout=REQUEST_TIMEOUT_S)
    resp.raise_for_status()
    data = resp.json()
    total = int((data.get("meta") or {}).get("count", 0) or 0)
    results: list[dict[str, Any]] = list(data.get("results") or [])

    key_t, int_t = _key_tokens(h)
    novelty, references = _novelty_and_references(key_t, int_t, results)

    if h.clarifying_questions and novelty == "exact_match_found":
        novelty = "similar_work_exists" if references else "not_found"
    if total > 0 and novelty == "not_found":
        novelty = "similar_work_exists"

    return LiteratureQCResult(
        novelty_signal=novelty,  # type: ignore[arg-type]
        references=references,
        search_query_used=search_query,
        total_results=total,
    )

