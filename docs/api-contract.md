# API Contract

This mock API exists to unblock backend, retrieval, and knowledge-graph work in parallel.

Base URL:

```text
http://127.0.0.1:8787
```

Environment:

```env
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash
PORT=8787
```

## Endpoints

### `GET /api/health`

Returns service status.

### `GET /api/contracts`

Returns the published API surface for teammates and UI integration checks.

### `POST /api/experiments/parse`

Turns a natural-language hypothesis into structured planning fields.

Request:

```json
{
  "hypothesis": "Replacing sucrose with trehalose as a cryoprotectant will increase post-thaw viability of HeLa cells by at least 15 percentage points."
}
```

Response:

```json
{
  "hypothesis": "Replacing sucrose with trehalose as a cryoprotectant will increase post-thaw viability of HeLa cells by at least 15 percentage points.",
  "intervention": "Novel sgRNA scaffold variant",
  "subject": "E. coli BL21(DE3)",
  "outcome": "CRISPR-Cas9 cleavage efficiency",
  "threshold": ">= 15%",
  "mechanism": "Improved low-GC locus performance",
  "control": "Standard sgRNA scaffold in BL21(DE3)"
}
```

### `POST /api/literature/qc`

Returns novelty classification and supporting references.

Response fields:

- `signal`
- `summary`
- `references`

### `POST /api/experiments/plan`

Returns a domain-aware experiment plan object. When `GEMINI_API_KEY` is set, the server uses Gemini with Google Search grounding plus structured JSON output. Without the key, the server falls back to curated template data so the UI still demos cleanly.

Response fields:

- `experiment.id`
- `experiment.hypothesis`
- `experiment.novelty`
- `experiment.materials`
- `experiment.steps`
- `experiment.timeline`
- `experiment.budget`
- `validation.primaryMetric`
- `validation.successCriteria`
- `validation.failureCriteria`
- `validation.decisionGates`
- `experiment.reviewAdaptations`

### `POST /api/chat`

Scientist copilot endpoint grounded in the current plan and review memory.

Request:

```json
{
  "experimentId": "crispr-scaffolding",
  "question": "Why use 4000 rpm instead of 6000?"
}
```

Response:

```json
{
  "answer": "The current plan uses 4000 rpm because it gives a clean pellet while reducing pre-lysis shear stress.",
  "citations": [
    {
      "title": "High-yield expression of recombinant proteins in BL21(DE3)",
      "source": "Nature Methods, 2024"
    }
  ],
  "followUps": [
    "Show me a safer harvest alternative"
  ]
}
```

### `GET /api/reviews`

Returns structured review memory. Supports `experimentId` query filtering.

### `POST /api/reviews`

Adds a new structured correction.

Request:

```json
{
  "experimentId": "crispr-scaffolding",
  "section": "step-4",
  "reviewer": "Dr. Patel",
  "correction": "Reduce sonication to 5 x 15 s to lower thermal damage risk.",
  "severity": "high"
}
```

### `GET /api/knowledge-graph/context`

Primary teammate handoff endpoint. Returns graph-ready entities and relationships plus plan context.

Response fields:

- `experimentId`
- `nodes`
- `edges`
- `tags`
- `parsedHypothesis`
- `materials`
- `protocolSteps`
- `validation`
- `sources`
- `reviews`

## Notes

- Review memory submitted to `POST /api/reviews` is folded back into the next `POST /api/experiments/plan` response for the same experiment family.
- Domain templates currently branch across diagnostics, in vivo gut health, cell biology, electrochemistry climate, and a custom molecular biology fallback.

## Integration notes

- The frontend proxies `/api/*` to the mock API via `vite.config.ts`.
- The knowledge-graph teammate should start with `GET /api/knowledge-graph/context`.
- Retrieval or graph enrichment services can later write back into `POST /api/reviews` or replace the mock server entirely while keeping the same contract.
