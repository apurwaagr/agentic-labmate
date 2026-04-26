# Agentic Labmate

Agentic Labmate is a full-stack scientific planning app. It takes a hypothesis and produces:

- novelty/literature signal
- council-driven draft + revision trace
- executable protocol/materials/budget/timeline/validation views
- grounded copilot chat over plan context
- review loop persisted in SQLite

## Stack

- Frontend: React + Vite + Tailwind + Radix/Shadcn
- Backend: FastAPI (Python)
- AI provider: Vertex AI (primary path)
- Storage: SQLite (reviews and local state)

## Prerequisites

- Node.js 18+ and npm
- Python 3.11+ (3.12 recommended)
- Google Cloud service account JSON for Vertex AI access

## Installation

From repo root:

```bash
npm install
python3 -m venv venv
./venv/bin/pip install -r backend/requirements.txt
```

## Environment Configuration

Create `.env.local` in repo root (or use `.env`; `.env.local` overrides `.env`):

```env
# Required for Vertex paths
VERTEX_AI_PROJECT_ID=your-gcp-project-id
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json

# Optional runtime knobs
GEMINI_MODEL=gemini-2.5-flash
PORT=8787
```

Notes:

- Keep secrets local; do not commit `.env` or service-account JSON files.
- Backend loads both `.env` and `.env.local`.

## Run Locally

### Option A: Run frontend + backend together

```bash
npm run dev
```

This runs:

- backend at `http://127.0.0.1:8787`
- frontend at Vite default (`http://127.0.0.1:8080` or similar)

### Option B: Run separately

Backend only:

```bash
npm run api
```

Frontend only:

```bash
npm run dev:ui
```

### Optional mock API

```bash
npm run api:mock
```

## Testing

Unit/integration tests:

```bash
npm test
```

Targeted council panel tests:

```bash
npm run test -- --run src/components/lab/CouncilPanels.test.tsx
```

E2E:

```bash
npm run test:e2e
```

## Project Layout

- `src/` frontend app
- `backend/main.py` FastAPI entrypoint
- `backend/labmate/` planning, council, parser, pricing logic
- `backend/storage/` SQLite persistence
- `tests/e2e/` Playwright flows
- `backend/tests/` backend pytest suites

## API Contract

Main app endpoints live under `/api/*` in `backend/main.py`.  
See `docs/api-contract.md` for integration contract notes.
