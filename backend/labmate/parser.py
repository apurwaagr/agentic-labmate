import os
import re
import concurrent.futures as _cf
from typing import Optional
from vertexai.generative_models import GenerativeModel, GenerationConfig
from dotenv import load_dotenv
from .schemas import ParsedHypothesis
from .prompt import SYSTEM_PROMPT

_PARSER_VERTEX_TIMEOUT_S = float(os.environ.get("PARSER_VERTEX_TIMEOUT_S", "12"))


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
    """Heuristic fallback when LLM parsing fails."""
    text_lower = user_text.lower()
    
    # Extract domain (general patterns only, no hardcoded entities)
    domain = "General Science"
    if "cell" in text_lower or "hepatocyte" in text_lower or "cryoprotect" in text_lower:
        domain = "Cell Biology"
    elif "mouse" in text_lower or "rat" in text_lower or "animal" in text_lower:
        domain = "Pharmacology"
    elif "chemical" in text_lower or "reaction" in text_lower or "synthesis" in text_lower or "co2" in text_lower:
        domain = "Chemistry"
    elif "sensor" in text_lower or "biosensor" in text_lower or "diagnostic" in text_lower:
        domain = "Diagnostics"
    
    # Extract subject (general patterns only)
    subject = "unspecified subject"
    if "cells" in text_lower:
        subject = "cells"
    elif "mice" in text_lower or "mouse" in text_lower:
        subject = "mice"
    elif "rat" in text_lower or "rats" in text_lower:
        subject = "rats"
    
    # Extract intervention (general patterns only)
    intervention = "unspecified intervention"
    if "treating" in text_lower or "treatment" in text_lower:
        intervention = "treatment"
    elif "supplementing" in text_lower or "supplement" in text_lower:
        intervention = "supplement"
    elif "replacing" in text_lower or "replacement" in text_lower:
        intervention = "replacement"
    
    # Extract outcome (general patterns only)
    outcome = "quantitative change > 0%"
    if "viability" in text_lower:
        outcome = "viability"
    elif "permeability" in text_lower:
        outcome = "permeability"
    elif "concentration" in text_lower:
        outcome = "concentration"
    elif "production" in text_lower:
        outcome = "production"
    
    # Extract control
    control = "baseline/control group"
    if "control" in text_lower:
        control = "control group"
    
    # Extract target quantity
    target_quantity = None
    quantity_match = re.search(r"(\d+\s*(?:percentage\s+points?|mg/L|mmol/L/day|weeks?|days?))", user_text, re.IGNORECASE)
    if quantity_match:
        target_quantity = quantity_match.group(1).strip()
    
    # Check if hypothesis has sufficient detail
    clarifying_questions = []
    if subject == "unspecified subject":
        clarifying_questions.append("What is the exact subject/system (cell line, organism strain, cohort, or material identity)?")
    if intervention == "unspecified intervention":
        clarifying_questions.append("What is the exact intervention (specific compound, strain, protocol, or model)?")
    if not any(char.isdigit() for char in outcome):
        clarifying_questions.append("How will the outcome be quantified (numeric threshold, percentage, or cutoff)?")
    
    if clarifying_questions:
        clarifying_questions.insert(0, f"LLM parser fallback used ({reason}).")
    
    return ParsedHypothesis(
        original_input=user_text,
        domain=domain,
        subject=subject,
        intervention=intervention,
        outcome_metric=outcome,
        is_novelty_search=any(k in user_text.lower() for k in ["has anyone", "done before", "novel", "novelty"]),
        control_condition=control,
        target_quantity=target_quantity,
        clarifying_questions=clarifying_questions,
    )


def _parse_with_vertex_ai(user_text: str) -> ParsedHypothesis:
    """Parse hypothesis using Vertex AI."""
    load_dotenv()
    project_id = os.environ.get("VERTEX_AI_PROJECT_ID", "").strip()
    credentials_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
    
    if not project_id:
        raise ValueError("VERTEX_AI_PROJECT_ID is not set.")
    if not credentials_path:
        raise ValueError("GOOGLE_APPLICATION_CREDENTIALS is not set.")
    
    # Set credentials environment variable for Vertex AI
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = credentials_path
    
    try:
        from vertexai import init as vertex_init
        vertex_init(project=project_id, location="us-central1")

        model_name = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash").strip() or "gemini-2.5-flash"
        model = GenerativeModel(model_name)
        prompt = f"{SYSTEM_PROMPT}\n\nUser Input: {user_text}\n\nReturn ONLY valid JSON. Complete the entire JSON object including all fields. Do not truncate."
        
        # Hard timeout to prevent UI retry loops caused by long-hanging provider calls.
        with _cf.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(
                model.generate_content,
                prompt,
                generation_config=GenerationConfig(
                    temperature=0.1,
                    max_output_tokens=8192,
                ),
            )
            response = future.result(timeout=_PARSER_VERTEX_TIMEOUT_S)
        
        json_text = response.text
        print(f"Vertex AI raw response: {json_text[:500]}")
        
        # Extract JSON if wrapped in markdown
        if "```json" in json_text:
            json_text = json_text.split("```json")[1].split("```")[0].strip()
        elif "```" in json_text:
            json_text = json_text.split("```")[1].split("```")[0].strip()
        
        return ParsedHypothesis.model_validate_json(json_text)
    except Exception as exc:
        print(f"Vertex AI error: {exc}")
        raise RuntimeError(f"Vertex AI parser error: {exc}")


def parse_user_input(user_text: str) -> ParsedHypothesis:
    load_dotenv()
    _configure_network_env()

    try:
        return _parse_with_vertex_ai(user_text)
    except Exception as exc:
        # Vertex is the only supported provider in this deployment.
        # Keep a deterministic heuristic fallback so UI/tests can continue to work
        # without silently switching to other AI APIs.
        return _fallback_parse(user_text, f"Vertex-only parser path failed: {exc}")

