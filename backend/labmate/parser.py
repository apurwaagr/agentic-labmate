import os
import re
import time
import json
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
from zhipuai import ZhipuAI
from vertexai import generative_models
from vertexai.generative_models import GenerativeModel, GenerationConfig
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


def _parse_with_glm(user_text: str) -> ParsedHypothesis:
    """Parse hypothesis using GLM API."""
    load_dotenv()
    api_key = os.environ.get("GLM_API_KEY", "").strip()
    if not api_key:
        raise ValueError("GLM_API_KEY is not set.")
    
    client = ZhipuAI(api_key=api_key)
    
    try:
        response = client.chat.completions.create(
            model="glm-4",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": f"User Input: {user_text}\n\nReturn ONLY valid JSON, no other text."},
            ],
            temperature=0.1,
        )
        
        json_text = response.choices[0].message.content
        print(f"GLM raw response: {json_text[:500]}")
        
        # Extract JSON if wrapped in markdown
        if "```json" in json_text:
            json_text = json_text.split("```json")[1].split("```")[0].strip()
        elif "```" in json_text:
            json_text = json_text.split("```")[1].split("```")[0].strip()
        
        return ParsedHypothesis.model_validate_json(json_text)
    except Exception as exc:
        print(f"GLM validation error: {exc}")
        raise RuntimeError(f"GLM parser error: {exc}")


def _parse_with_groq_with_retry(user_text: str, max_retries: int = 3) -> ParsedHypothesis:
    """Parse hypothesis using Groq with retry logic for rate limits."""
    load_dotenv()
    api_key = os.environ.get("GROQ_API_KEY", "").strip()
    if not api_key:
        raise ValueError("GROQ_API_KEY is not set.")
    
    client = Groq(api_key=api_key)
    configured_model = os.environ.get("GROQ_MODEL", "").strip()
    candidate_models = [
        configured_model,
        "llama-3.3-70b-versatile",
        "llama-3.1-8b-instant",
    ]
    candidate_models = [m for m in candidate_models if m]
    
    print(f"Groq attempting with models: {candidate_models}")
    
    for attempt in range(max_retries):
        for model_name in candidate_models:
            try:
                print(f"Groq attempt {attempt+1}/{max_retries} with model {model_name}")
                response = client.chat.completions.create(
                    model=model_name,
                    messages=[
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": f"User Input: {user_text}"},
                    ],
                    response_format={"type": "json_object"},
                    temperature=0.1,
                )
                json_text = response.choices[0].message.content
                print(f"Groq response: {json_text[:200]}")
                return ParsedHypothesis.model_validate_json(json_text)
            except RateLimitError as exc:
                print(f"Groq RateLimitError: {exc}")
                if attempt < max_retries - 1:
                    time.sleep(2 ** attempt)  # Exponential backoff
                    continue
                raise
            except BadRequestError as exc:
                msg = str(exc).lower()
                print(f"Groq BadRequestError: {exc}")
                if "decommissioned" in msg or "no longer supported" in msg or "model_decommissioned" in msg:
                    continue
                raise
            except Exception as exc:
                print(f"Groq exception: {exc}")
                raise RuntimeError(f"Groq parser error: {exc}")
    
    raise RuntimeError("Groq parser failed after all retries")


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
        
        response = model.generate_content(
            prompt,
            generation_config=GenerationConfig(
                temperature=0.1,
                max_output_tokens=8192,
            )
        )
        
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
    
    # Try Vertex AI first (primary)
    try:
        return _parse_with_vertex_ai(user_text)
    except Exception as exc:
        print(f"Vertex AI parser error: {exc}")
        # Fall back to Groq with retry
        try:
            return _parse_with_groq_with_retry(user_text)
        except Exception as exc2:
            print(f"Groq parser error: {exc2}")
            # Fall back to heuristic
            return _fallback_parse(user_text, f"Vertex AI and Groq parsers failed. Last error: {exc2}")

