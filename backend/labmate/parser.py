import os
import re
from typing import Optional
from groq import (
    APIConnectionError,
    APITimeoutError,
    AuthenticationError,
    BadRequestError,
    Groq,
    PermissionDeniedError,
    RateLimitError,
)
from dotenv import load_dotenv
from .schemas import ParsedHypothesis
from .prompt import SYSTEM_PROMPT


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


def _infer_domain(text: str) -> str:
    t = text.lower()
    if any(k in t for k in ["hela", "cell", "culture", "cytotoxic", "viability"]):
        return "Cell Biology"
    if any(k in t for k in ["mouse", "mice", "rat", "in vivo", "pharmacology", "l-dopa"]):
        return "Pharmacology"
    if any(k in t for k in ["benzene", "acid", "reaction yield", "molar", "chemistry"]):
        return "Chemistry"
    if any(k in t for k in ["biosensor", "diagnostic", "elisa", "blood"]):
        return "Diagnostics"
    return "General Science"


def _extract_subject(text: str) -> Optional[str]:
    patterns = [
        r"\bin\s+([a-z0-9/\-\+\s]{3,40}?)(?:\s+with|\s+using|\s+to|\s+for|,|\.|$)",
        r"\bon\s+([a-z0-9/\-\+\s]{3,40}?)(?:\s+with|\s+using|\s+to|\s+for|,|\.|$)",
    ]
    for p in patterns:
        m = re.search(p, text, flags=re.IGNORECASE)
        if m:
            return m.group(1).strip()
    for k in ["C57BL/6 mice", "mice", "HeLa cells", "cells"]:
        if k.lower() in text.lower():
            return k
    return None


def _extract_intervention(text: str) -> Optional[str]:
    m = re.search(r"\b(with|using|treating with|administering)\s+([a-z0-9/\-\+\s]{2,60}?)(?:\s+in|\s+on|\s+to|\s+for|,|\.|$)", text, flags=re.IGNORECASE)
    if m:
        return m.group(2).strip()
    for k in ["L-DOPA", "doxorubicin", "aspirin", "nitric acid", "trehalose"]:
        if k.lower() in text.lower():
            return k
    return None


def _fallback_parse(user_text: str, reason: str) -> ParsedHypothesis:
    subject = _extract_subject(user_text) or "unspecified subject"
    intervention = _extract_intervention(user_text) or "unspecified intervention"
    outcome = user_text if any(c.isdigit() or c in "%/<>" for c in user_text) else "quantitative change > 0%"
    control = "baseline/control group" if "control" not in user_text.lower() else "control"
    return ParsedHypothesis(
        original_input=user_text,
        domain=_infer_domain(user_text),
        subject=subject,
        intervention=intervention,
        outcome_metric=outcome,
        is_novelty_search=any(k in user_text.lower() for k in ["has anyone", "done before", "novel", "novelty"]),
        control_condition=control,
        clarifying_questions=[
            f"LLM parser fallback used ({reason}).",
            "Please confirm exact subject/system, intervention identity, and quantitative outcome metric.",
        ],
    )


def parse_user_input(user_text: str) -> ParsedHypothesis:
    load_dotenv()
    _configure_network_env()
    api_key = os.environ.get("GROQ_API_KEY", "").strip()
    if not api_key:
        raise ValueError("GROQ_API_KEY is not set. Add it to your environment or .env file.")

    client = Groq(api_key=api_key)
    configured_model = os.environ.get("GROQ_MODEL", "").strip()
    candidate_models = [
        configured_model,
        "llama-3.3-70b-versatile",
        "llama-3.1-8b-instant",
    ]
    candidate_models = [m for m in candidate_models if m]

    try:
        response = None
        last_bad_request: Exception | None = None
        for model_name in candidate_models:
            try:
                response = client.chat.completions.create(
                    model=model_name,
                    messages=[
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": f"User Input: {user_text}"},
                    ],
                    response_format={
                        "type": "json_object",
                    },
                    temperature=0.1,
                )
                break
            except BadRequestError as exc:
                last_bad_request = exc
                msg = str(exc).lower()
                if "decommissioned" in msg or "no longer supported" in msg or "model_decommissioned" in msg:
                    continue
                raise
        if response is None:
            raise RuntimeError(
                f"No available Groq model succeeded. Last error: {last_bad_request}"
            )
    except RateLimitError:
        return _fallback_parse(
            user_text,
            "Groq rate limit (429). Retry later or switch key/model.",
        )
    except (AuthenticationError, PermissionDeniedError):
        return _fallback_parse(
            user_text,
            "Groq auth failed (invalid/unauthorized GROQ_API_KEY).",
        )
    except (APIConnectionError, APITimeoutError):
        return _fallback_parse(
            user_text,
            "Groq network connection failed (internet/proxy/DNS issue).",
        )
    except Exception as exc:
        return _fallback_parse(user_text, f"Groq parser error: {exc}")

    return ParsedHypothesis.model_validate_json(response.choices[0].message.content)

