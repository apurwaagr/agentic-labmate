# Full Pipeline Strict Tests

This suite validates the end-to-end AI Scientist pipeline with real services and strict policy checks.

## Guarantees

- No mocked planning pipeline calls.
- No alternate-provider fallback usage (google/gemini disallowed).
- Provider outage scenarios are marked as skipped with evidence.
- Browser flow confirms QC appears before plan completion.

## Prerequisites

1. FastAPI backend running on `127.0.0.1:8000`.
2. Frontend Vite server running on `127.0.0.1:8080`.
3. EdgeQuake + Ollama services running.
4. Backend logs written to `/tmp/uvicorn.log`.

Use `.env.test.example` as the environment contract.

## Commands

- Backend strict E2E:
  - `npm run test:pipeline:backend`
- Browser strict E2E:
  - `npm run test:pipeline:browser`
- Repeatability/load smoke:
  - `npm run test:pipeline:repeatability`
- All:
  - `npm run test:pipeline:all`

## Artifacts

- Repeatability output JSON:
  - `tests/artifacts/repeatability_results.json`

## Notes

- The backend policy tests fail on disallowed provider usage.
- If provider outages are detected (e.g. 429/quota/network unavailable), tests skip with explicit reason.
