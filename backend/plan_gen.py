import json
import logging
from openai import AsyncOpenAI
from config import settings
from input_parser import ParsedHypothesis

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


async def generate_plan(
    hypothesis: str,
    context: str,
    parsed: ParsedHypothesis,
) -> dict:
    """Single-pass plan generation via GLM-4.5-air (zhipu AI OpenAI-compatible API).

    Phase 1 quality: grounded by EdgeQuake context but without 7-agent council deliberation.
    Phase 3 will replace this with the full council pipeline.

    Returns dict with keys: protocol, materials, budget, timeline, validation.
    On JSON parse failure, returns a minimal valid structure rather than crashing the stream.
    """
    client = AsyncOpenAI(
        base_url="https://open.bigmodel.cn/api/paas/v4/",
        api_key=settings.glm_api_key,
    )

    user_content = (
        f"HYPOTHESIS: {hypothesis}\n\n"
        f"PARSED DETAILS:\n"
        f"- Domain: {parsed.domain}\n"
        f"- Subject: {parsed.subject}\n"
        f"- Intervention: {parsed.intervention}\n"
        f"- Outcome metric: {parsed.outcome_metric}\n"
        f"- Control condition: {parsed.control_condition or 'not specified'}\n\n"
        f"LITERATURE CONTEXT (from EdgeQuake knowledge graph):\n{context}\n\n"
        "Generate the complete 5-section experiment plan as JSON."
    )

    response = await client.chat.completions.create(
        model="glm-4.5-air",
        messages=[
            {"role": "system", "content": PLAN_SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        temperature=0.3,
        max_tokens=6000,
    )

    raw = _extract_json(response.choices[0].message.content or "{}")
    try:
        plan = json.loads(raw)
    except json.JSONDecodeError as exc:
        logger.error("Plan JSON parse failed: %s — raw excerpt: %s", exc, raw[:300])
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
