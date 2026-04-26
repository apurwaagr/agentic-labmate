import json
import logging
from openai import AsyncOpenAI
from .config import settings
from .input_parser import ParsedHypothesis

logger = logging.getLogger(__name__)

PLAN_SYSTEM_PROMPT = """You are an expert experimental biologist generating an operationally executable experiment plan.

Given a scientific hypothesis and relevant literature context retrieved from a knowledge graph of published papers,
generate a complete experiment plan as a single JSON object.

The plan MUST contain exactly these 5 top-level keys:
- protocol: {steps: [{step: int, action: str, duration: str, notes: str}]}  (5 to 20 steps)
- materials: {items: [{name: str, catalog: str, vendor: str, quantity: str, unit_price_usd: float}]}
- budget: {total_usd: float, breakdown: [{category: str, amount_usd: float}]}
- timeline: {total_weeks: int, phases: [{name: str, weeks: str, depends_on: list}]}
- validation: {approach: str, success_criteria: str, statistical_test: str}

Ground every step in the literature context provided. Use specific reagent names, concentrations, and
timepoints found in the context. Do not invent catalog numbers — use only those present in the context.
Operational realism requirements:
1) Protocol must include concrete quantities, durations, and dependency-aware sequencing.
2) Materials should prefer real vendors/catalogs from context; if unknown, explicitly mark "TBD (verify with supplier)".
3) Budget breakdown should include practical categories (reagents, equipment, shipping, labor, contingency).
4) Validation must include measurable success criteria, explicit failure criteria, and a statistical test.
5) Notes should avoid generic prose and focus on execution constraints (storage, handling, procurement lead time).
Return ONLY the JSON object — no preamble, no markdown fences, no explanation."""


def _extract_json(text: str) -> str:
    """Strip markdown fences from GLM responses before JSON parsing."""
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        # drop opening fence (```json or ```) and closing fence (```)
        inner = lines[1:-1] if lines[-1].strip() == "```" else lines[1:]
        text = "\n".join(inner).strip()
    return text


def _provider_attempts() -> list[tuple[str, str, str]]:
    """Return ordered provider/model/key attempts for plan generation."""
    provider = (settings.plan_provider or "auto").strip().lower()
    attempts: list[tuple[str, str, str]] = []

    def add_google() -> None:
        for key in settings.google_api_key_list:
            if key:
                attempts.append(("google", settings.plan_model_google, key))

    def add_groq() -> None:
        for key in settings.groq_api_key_list:
            if key:
                attempts.append(("groq", settings.plan_model_groq, key))

    def add_glm() -> None:
        if settings.glm_api_key:
            attempts.append(("glm", settings.glm_model, settings.glm_api_key))

    if provider == "google":
        if settings.plan_enable_google_fallback:
            add_google()
    elif provider == "groq":
        add_groq()
    elif provider == "glm":
        add_glm()
    else:
        # auto: prefer Groq (large daily free quota, fast), then GLM.
        # Google fallback is opt-in only because quota exhaustion creates
        # noisy 429s and stalls the apparent user flow.
        add_groq()
        if settings.plan_enable_google_fallback:
            add_google()
        add_glm()

    return attempts


def resolve_plan_provider_model() -> tuple[str, str]:
    """Resolve the first active provider/model from current configuration."""
    attempts = _provider_attempts()
    if not attempts:
        return "none", "none"
    provider, model, _ = attempts[0]
    return provider, model


def resolve_plan_provider_chain() -> list[tuple[str, str]]:
    """Return all configured plan providers/models in execution order."""
    return [(provider, model) for provider, model, _ in _provider_attempts()]


async def generate_plan(
    hypothesis: str,
    context: str,
    parsed: ParsedHypothesis,
) -> dict:
    """Single-pass plan generation using configured provider (Gemini or GLM).

    Phase 1 quality: grounded by EdgeQuake context but without 7-agent council deliberation.
    Phase 3 will replace this with the full council pipeline.

    Returns dict with keys: protocol, materials, budget, timeline, validation.
    On JSON parse failure, returns a minimal valid structure rather than crashing the stream.
    """
    attempts = _provider_attempts()
    if not attempts:
        raise RuntimeError(
            "No plan provider keys configured. Set PLAN_PROVIDER and corresponding API keys."
        )

    # Bound context size so slower providers (especially fallback providers)
    # can return within interactive latency budgets.
    context_limit_chars = 6000
    compact_context = context.strip()
    if len(compact_context) > context_limit_chars:
        compact_context = compact_context[:context_limit_chars]

    user_content = (
        f"HYPOTHESIS: {hypothesis}\n\n"
        f"PARSED DETAILS:\n"
        f"- Domain: {parsed.domain}\n"
        f"- Subject: {parsed.subject}\n"
        f"- Intervention: {parsed.intervention}\n"
        f"- Outcome metric: {parsed.outcome_metric}\n"
        f"- Control condition: {parsed.control_condition or 'not specified'}\n\n"
        f"LITERATURE CONTEXT (from EdgeQuake knowledge graph):\n{compact_context}\n\n"
        "Generate the complete 5-section experiment plan as JSON."
    )

    response = None
    last_error: Exception | None = None
    for provider, model_name, api_key in attempts:
        if provider == "google":
            client = AsyncOpenAI(
                base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
                api_key=api_key,
            )
        elif provider == "groq":
            client = AsyncOpenAI(
                base_url="https://api.groq.com/openai/v1",
                api_key=api_key,
            )
        else:
            client = AsyncOpenAI(
                base_url="https://open.bigmodel.cn/api/paas/v4/",
                api_key=api_key,
            )

        try:
            logger.info("Plan generation attempt provider=%s model=%s", provider, model_name)
            token_budget = 6144 if provider == "glm" else 4096
            response = await client.chat.completions.create(
                model=model_name,
                messages=[
                    {"role": "system", "content": PLAN_SYSTEM_PROMPT},
                    {"role": "user", "content": user_content},
                ],
                temperature=0.3,
                max_tokens=token_budget,
            )
            finish = getattr(response.choices[0], "finish_reason", "unknown")
            logger.info(
                "Plan generation success provider=%s model=%s finish_reason=%s",
                provider,
                model_name,
                finish,
            )
            # Treat truncation as failure so we fall over to the next provider
            # instead of returning a half-plan that will fail JSON parsing.
            if finish == "length":
                logger.warning(
                    "Plan generation truncated provider=%s model=%s at max_tokens=%s — retrying with larger budget",
                    provider,
                    model_name,
                    token_budget,
                )
                retry_budget = 8192
                retry_response = await client.chat.completions.create(
                    model=model_name,
                    messages=[
                        {"role": "system", "content": PLAN_SYSTEM_PROMPT},
                        {"role": "user", "content": user_content},
                    ],
                    temperature=0.3,
                    max_tokens=retry_budget,
                )
                retry_finish = getattr(retry_response.choices[0], "finish_reason", "unknown")
                if retry_finish == "length":
                    last_error = RuntimeError(
                        f"response truncated by max_tokens on provider={provider} model={model_name}"
                    )
                    logger.warning(
                        "Plan generation still truncated provider=%s model=%s after retry budget=%s — trying next provider",
                        provider,
                        model_name,
                        retry_budget,
                    )
                    response = None
                    continue
                response = retry_response
                finish = retry_finish
            break
        except Exception as exc:
            last_error = exc
            logger.warning(
                "Plan generation failed provider=%s model=%s err=%s",
                provider,
                model_name,
                exc,
            )
            continue

    if response is None:
        raise RuntimeError(f"All plan providers failed. Last error: {last_error}")

    raw = _extract_json(response.choices[0].message.content or "{}")
    try:
        plan = json.loads(raw)
    except json.JSONDecodeError as exc:
        logger.error(
            "Plan JSON parse failed: %s — raw len=%d head=%s tail=%s",
            exc,
            len(raw),
            raw[:200],
            raw[-200:],
        )
        plan = {
            "protocol": {"steps": []},
            "materials": {"items": []},
            "budget": {"total_usd": 0.0, "breakdown": []},
            "timeline": {"total_weeks": 0, "phases": []},
            "validation": {
                "approach": raw[:500],
                "success_criteria": "",
                "statistical_test": "",
            },
        }

    for section in ("protocol", "materials", "budget", "timeline", "validation"):
        if section not in plan:
            plan[section] = {}

    return plan
