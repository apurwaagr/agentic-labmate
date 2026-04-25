# Agentic Labmate

Agentic Labmate is a hackathon prototype for the Fulcrum Science "AI Scientist" challenge. It turns a scientific hypothesis into a literature QC signal, an operational experiment plan, and a scientist review loop that can improve future generations.

## Why this can win

The strongest part of the current prototype is the product framing. It already presents the right objects: protocol, supply chain, budget, timeline, novelty, and human corrections. That maps tightly to the brief and gives judges a believable front-end story.

The current risk is trust. Before these changes, the app looked polished but behaved like a static concept. The highest-leverage improvements are:

- Ground every plan section in structured evidence and make the citations visible.
- Show a scientist copilot that can explain protocol choices instead of just displaying them.
- Capture structured corrections so the next plan can improve.
- Expose a clean API so retrieval, knowledge-graph enrichment, and generation services can evolve independently.

## What is in this repo now

- A polished React/Vite interface for protocol planning
- A contextual `Scientist Copilot` chat panel
- A mock API server for plan, chat, reviews, and knowledge-graph handoff
- An integration-ready contract for a teammate building a knowledge graph

## Environment

Create `/.env.local` in the project root:

```env
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash
PORT=8787
```

The server reads `GEMINI_API_KEY` from `.env.local`. Do not put real API keys in the frontend.

## Run it

Frontend:

```bash
npm run dev
```

Mock API:

```bash
npm run api
```

The frontend proxies `/api/*` requests to `http://127.0.0.1:8787`.

## Winning product direction

If you want the judges to remember this project, position it as an operating system for experimental execution, not a generic science chatbot.

Three product moves matter most:

1. `Novelty before generation`
   The first screen should tell a scientist whether they are repeating known work, modifying an established protocol, or attempting something genuinely new.

2. `Operational realism over generic text`
   The plan should feel executable: catalog numbers, lead times, critical-path risks, decision gates, and validation criteria.

3. `Scientist feedback becomes memory`
   A correction should not disappear into notes. It should become structured review data that influences the next similar plan.

## Suggested next build priorities

1. Replace mock plan data with live retrieval over protocols, literature, and supplier references.
2. Add explicit validation gates and failure criteria to each protocol section.
3. Store corrections by experiment family so the next run can visibly improve.
4. Add experiment-type templates for diagnostics, in vivo studies, cell biology, and climate workflows.

## API

The API contract for teammate integration is documented in `docs/api-contract.md`.
