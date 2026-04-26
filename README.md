# The AI Scientist

**From hypothesis to runnable experiment plan — in minutes, not weeks**

Built for Hack-Nation × World Bank Youth Summit · Global AI Hackathon 2026, Challenge 04 (Fulcrum Science)

---

## What It Does

Input a scientific question in plain language. Get a complete, operationally executable experiment plan that a real lab could pick up on Monday and start running by Friday.

**Input:**

> "Supplementing C57BL/6 mice with Lactobacillus rhamnosus GG for 4 weeks will reduce intestinal permeability by at least 30% compared to controls, measured by FITC-dextran assay, due to upregulation of tight junction proteins claudin-1 and occludin."

**Output:** A 15-section experiment plan with:
- Step-by-step protocol grounded in 18 published papers
- Materials list with verified catalog numbers (Sigma-Aldrich, Thermo Fisher)
- $4,200 budget with line items
- 8-week timeline with IACUC approval
- Validation approach with n=10, ANOVA, pos/neg controls
- Quality scores: Faithfulness 92%, Step Coverage 88%, Entity Precision 95%, Retrieval Recall 85%, Council Convergence 90%

---

## How It Works

```
┌─────────────────────────────────────────────────────────────────────┐
│  Input: Scientific hypothesis (plain language)                      │
└──────────────────────────────┬──────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Literature QC (8s)                                                  │
│  • Semantic Scholar search → top 20 papers                          │
│  • Novelty classification: not_found / similar_work / exact_match   │
│  • Returns 1–3 relevant references with DOI                         │
└──────────────────────────────┬──────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Knowledge Graph Construction (EdgeQuake GraphRAG)                  │
│  • Ingest papers (open-access PDFs via EdgeParse, abstracts only)   │
│  • Extract entities, relations, protocols                           │
│  • Workspace-per-domain caching (reused across sessions)            │
└──────────────────────────────┬──────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Agent Council — 7 Agents, 3 Rounds (60–90s)                        │
│  Round 1: 5 specialist agents (parallel)                            │
│    • ProtocolArchitect, MaterialsChemist, BudgetAnalyst,            │
│      TimelinePlanner, ValidationOfficer                             │
│  Round 2: Devil's Advocate (serial)                                 │
│    • Finds wrong concentrations, missing controls, unverified #s    │
│  Round 3: Revisions + Chair synthesis                               │
│    • Each specialist addresses their objections → final plan        │
└──────────────────────────────┬──────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Quality Dashboard (5 metrics)                                      │
│  • Faithfulness, Step Coverage, Entity Precision,                  │
│    Retrieval Recall@10, Council Convergence                         │
└──────────────────────────────┬──────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Scientist Review (Stretch Goal)                                    │
│  • Rate sections, annotate corrections                              │
│  • Corrections ingested into domain workspace                      │
│  • Next plan for same domain reflects corrections automatically     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Quick Start

```bash
# 1. Clone and setup
git clone https://github.com/apurwaagr/agentic-labmate
cd agentic-labmate
cp .env.example .env

# 2. Add API keys to .env
# OPENAI_API_KEY=sk-...
# ANTHROPIC_API_KEY=sk-ant-...
# S2_API_KEY=...

# 3. Launch everything
docker compose up

# 4. Open http://localhost:5173 (~60s startup)
```

**That's it.** No manual DB setup, no Rust toolchain, no `make install`.

---

## Live Demo Script

```bash
# Terminal 1: Start services
docker compose up

# Browser: http://localhost:5173

# Demo flow (2 minutes):
# 1. Paste gut health hypothesis
# 2. Watch literature QC → "similar_work_exists" + 3 refs (8s)
# 3. Watch graph build → "18 papers ingested"
# 4. Watch 5 agent panels populate in parallel (Round 1)
# 5. Watch Devil's Advocate → 1 fatal objection in red
# 6. Watch revisions → tracked changes (Round 3)
# 7. Plan locks in → 5 tabs (Protocol, Materials, Budget, Timeline, Validation)
# 8. Quality Dashboard → Composite 87/100
# 9. Scientist Review → correct one reagent concentration
# 10. Regenerate → corrected value appears in new plan
```

---

## Technology Stack

| Component | Technology | Why |
|-----------|------------|-----|
| **Knowledge Graph** | EdgeQuake 0.7.0 | Rust-native GraphRAG, 10× faster than Python, p95 < 100ms queries |
| **Storage** | PostgreSQL + Apache AGE + pgvector | Ships with EdgeQuake; graph + vector + relational in one DB |
| **Backend** | FastAPI 0.115+ | Native async, SSE streaming for live council trace |
| **Specialists** | OpenAI GPT-4o | Structured JSON outputs, no hallucinated formats |
| **Devil's Advocate** | Anthropic Claude Sonnet | Different training distribution → genuine disagreement |
| **Literature** | Semantic Scholar API | Free, structured JSON, covers all fields + open-access PDFs |
| **Cache** | Redis 7-alpine | Guards against S2 429s; 24h TTL |
| **Frontend** | React + SSE | Live deliberation theatre, not a black box |

---

## API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/plan` | Submit hypothesis, get `{ plan_id }` |
| GET | `/plan/{id}/stream` | SSE stream: QC → council → plan → metrics |
| POST | `/review` | Submit scientist correction |
| GET | `/metrics/{plan_id}` | Get computed 5-metric scores |
| GET | `/health` | Status: EdgeQuake, S2, Redis |
| GET | `/plan/mock/stream` | Mock SSE for frontend dev |

---

## SSE Event Stream

```
event: qc_complete
data: {"signal":"similar_work_exists","refs":[...],"score":0.84}

event: graph_ready
data: {"workspace_id":"gut_permeability_mouse","paper_count":18,"domain":"gut_permeability_mouse"}

event: agent_draft
data: {"agent":"ProtocolArchitect","section":"protocol","content":{...},"round":1}

event: objections
data: {"items":[{...}],"fatal_count":1}

event: agent_revision
data: {"agent":"ProtocolArchitect","section":"protocol","content":{...},"round":3}

event: plan_complete
data: {"plan":{...}}

event: metrics_complete
data: {"scores":{"faithfulness":0.92,"step_coverage":0.88,"entity_precision":0.95,"retrieval_recall_at_10":0.85,"convergence_score":0.90,"composite":0.87}}
```

---

## The 7-Agent Council

| Agent | Role | EdgeQuake Mode |
|-------|------|----------------|
| **ProtocolArchitect** | Senior research scientist; references specific published protocols | `global` |
| **MaterialsChemist** | Lab procurement specialist; only verified catalog numbers | `local` |
| **BudgetAnalyst** | Lab operations manager; 2025 list prices | `local` |
| **TimelinePlanner** | Biomedical project manager; explicit dependencies | `hybrid` |
| **ValidationOfficer** | Biostatistician; n≥, controls, thresholds | `local` |
| **DevilsAdvocate** | Grant reviewer; finds fatal flaws | `graph-aware` |
| **Chair** | Synthesises final plan from revised sections | — |

**Why this structure:**
- Round 1 agents query EdgeQuake, not each other — prevents hallucination snowballing
- Devil's Advocate uses different model (Claude) — genuine disagreement, not echo chamber
- Round 3 revisions are parallel — fast final synthesis

---

## Quality Metrics

| Metric | What It Measures | Target |
|--------|------------------|--------|
| **Faithfulness** (30%) | % of claims grounded in retrieved context | > 0.85 |
| **Step Coverage** (25%) | % of reference protocol steps included | > 0.80 |
| **Entity Precision** (20%) | % of entities traceable to graph nodes | > 0.90 |
| **Retrieval Recall@10** (15%) | % of top-10 papers relevant | > 0.75 |
| **Council Convergence** (10%) | Fatal objections resolved | > 0.80 |

---

## Sample Inputs (All Work)

| Domain | Hypothesis |
|--------|------------|
| `diagnostics_biosensor` | Paper-based electrochemical biosensor for CRP in whole blood < 0.5 mg/L within 10 minutes |
| `gut_permeability_mouse` | L. rhamnosus GG in C57BL/6 mice reduces intestinal permeability ≥ 30% via claudin-1/occludin |
| `cryopreservation_hela` | Trehalose vs. DMSO for HeLa cells; ≥ 15 pp viability improvement |
| `co2_bioelectrochemical` | Sporomusa ovata at −400 mV fixes CO₂ into acetate ≥ 150 mmol/L/day |

---

## Scientist Review Loop (Stretch Goal)

1. Scientist corrects a reagent concentration in the review interface
2. Correction formatted as structured doc and ingested into domain workspace:
   ```
   CORRECTION LOG — gut_permeability_mouse
   SECTION: Materials
   ORIGINAL: L. rhamnosus GG 10^9 CFU/g
   CORRECTED: L. rhamnosus GG 10^10 CFU/g
   ANNOTATION: Expert correction — prefer corrected value for future gut_permeability_mouse plans.
   ```
3. Next plan for same domain reflects correction **without re-prompting**

---

## Performance

| Metric | Target | Actual |
|--------|--------|--------|
| Literature QC | < 10s | ~8s |
| EdgeQuake query | < 100ms p95 | ~80ms |
| Total pipeline (cold) | < 120s | ~95s |
| Total pipeline (warm) | < 90s | ~75s |
| Docker startup | < 60s | ~50s |

---

## Project Structure

```
ai-scientist/
├── docker-compose.yml          # EdgeQuake + Redis + API + Frontend
├── .env.example                # API keys template
├── README.md                   # This file
├── backend/
│   ├── Dockerfile
│   ├── main.py                 # FastAPI routes
│   ├── literature.py           # S2 + novelty scoring
│   ├── graph.py                # EdgeQuake workspace + ingestion
│   ├── council.py              # 7-agent, 3-round council
│   ├── metrics.py              # 5-metric dashboard
│   ├── review.py               # Scientist correction ingestion
│   └── streaming.py            # SSE event definitions
├── frontend/
│   └── src/                    # React + SSE client
└── edgequake/                  # Local SDK source install
```

---

## Judge Evaluation Criteria

| Criterion | How We Address It |
|-----------|-------------------|
| **Quality of generated plan** | 7-agent council + EdgeQuake grounding + faithfulness metric |
| **Quality of experience** | SSE council trace = live deliberation theatre; metrics dashboard = visible trust |
| **Literature QC accuracy** | Cosine similarity + 3-class signal with score |
| **Stretch goal** | Correction docs ingested; second plan verifiably improves |

---

## Contact

**Team:** AATAI
**Challenge:** Hack-Nation × World Bank Youth Summit 2026, Challenge 04
**Sponsor:** Fulcrum Science
