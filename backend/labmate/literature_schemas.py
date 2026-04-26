from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class PaperReference(BaseModel):
    title: str = Field(description="Work title as returned by OpenAlex.")
    authors: str = Field(
        description="Author list (truncated, e.g. 'First, Second et al.')."
    )
    year: Optional[int] = Field(default=None, description="Publication year if known.")
    url: str = Field(description="Best landing page URL (DOI, journal, or OpenAlex).")


class LiteratureQCResult(BaseModel):
    novelty_signal: Literal["not_found", "similar_work_exists", "exact_match_found"] = Field(
        description="Heuristic match strength vs. the search query and parsed hypothesis."
    )
    references: List[PaperReference] = Field(
        default_factory=list, description="Top 1–3 most relevant works from the search."
    )
    search_query_used: str = Field(
        description="The query string sent to OpenAlex /works full-text search."
    )
    total_results: int = Field(
        description="Total work count in OpenAlex matching the search (from meta.count)."
    )

