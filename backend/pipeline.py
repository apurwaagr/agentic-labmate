"""
End-to-end flow: natural-language hypothesis -> structured parse -> OpenAlex literature QC.
"""

from .literature_schemas import LiteratureQCResult
from .literature_qc import check_literature
from .parser import parse_user_input
from .schemas import ParsedHypothesis


def run_pipeline(user_text: str) -> tuple[ParsedHypothesis, LiteratureQCResult]:
    parsed = parse_user_input(user_text)
    qc = check_literature(parsed)
    return parsed, qc


if __name__ == "__main__":
    sample = (
        "I'm curious about running an experiment to measure reaction yield when treating "
        "5 moles of benzene with nitric acid in an ice bath. We usually just use sulfuric "
        "acid at room temp as the control."
    )
    print("Sample input:\n", sample, "\n", sep="")
    print("Running parse + literature QC (requires network)...\n")
    try:
        hyp, lit = run_pipeline(sample)
        print("--- ParsedHypothesis (summary) ---")
        print(f"  domain: {hyp.domain}")
        print(f"  subject: {hyp.subject}")
        print(f"  intervention: {hyp.intervention}")
        print(f"  outcome_metric: {hyp.outcome_metric}")
        print()
        print("--- LiteratureQCResult ---")
        print(lit.model_dump_json(indent=2))
    except Exception as e:
        print(f"Error: {e}")
        raise

