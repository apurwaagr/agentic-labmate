export type SourceReference = {
  title: string;
  uri?: string;
  source: string;
};

export type BudgetLineItem = {
  label: string;
  amountUsd: number;
  category: "reagents" | "equipment" | "shipping" | "labor" | "contingency";
  note?: string;
};

export type BudgetRegion = {
  code: string;
  label: string;
  currency: string;
  symbol: string;
  fxRate: number;
  laborMultiplier: number;
  shippingMultiplier: number;
  procurementMultiplier: number;
};

export type NoveltySignal = {
  signal: "not found" | "similar work exists" | "exact match found";
  summary: string;
  references: SourceReference[];
};

export type ProtocolStep = {
  id: string;
  title: string;
  detail: string;
  quantity: string;
  duration: string;
  source: string;
  sourceUri?: string;
  sourceTitle?: string;
  riskLevel?: "low" | "med" | "high";
  riskNote?: string;
  validationChecks: string[];
  decisionGate?: string;
};

export type MaterialItem = {
  name: string;
  catalogNumber: string;
  supplier: string;
  quantity: string;
  unitCostUsd: number;
  leadTime: string;
  status: "owned" | "in-stock" | "order";
  notes?: string;
  pubchemCid?: number;
  molecularFormula?: string;
  molecularWeight?: number;
  canonicalSmiles?: string;
  iupacName?: string;
  sourceUri?: string;
};

export type TimelinePhase = {
  phase: string;
  durationDays: number;
  dependsOn: string[];
  owner: string;
  deliverable: string;
};

export type BenchmarkRow = {
  label: string;
  time: string;
  cost: number;
  sustainability: number;
  ours: boolean;
};

export type ValidationPlan = {
  primaryMetric: string;
  successCriteria: string;
  failureCriteria: string[];
  decisionGates: string[];
};

export type ReviewAdaptation = {
  section: string;
  change: string;
  impact: string;
};

export type ExperimentPlan = {
  id: string;
  project: string;
  hypothesis: string;
  plainEnglish: string;
  domain: string;
  metrics: {
    confidence: string;
    novelty: string;
    sustainability: string;
  };
  novelty: NoveltySignal;
  materials: MaterialItem[];
  steps: ProtocolStep[];
  timeline: TimelinePhase[];
  budget: {
    reagentsUsd: number;
    equipmentUsd: number;
    shippingUsd?: number;
    laborUsd?: number;
    contingencyUsd?: number;
    totalUsd: number;
    budgetCapUsd: number;
    savedUsd: number;
    reliability?: string;
    assumptions?: string[];
    lineItems?: BudgetLineItem[];
  };
  benchmark: BenchmarkRow[];
  validation: ValidationPlan;
  reviewAdaptations: ReviewAdaptation[];
  sources: SourceReference[];
};

export type ReviewRecord = {
  experimentId: string;
  section: string;
  reviewer: string;
  correction: string;
  severity: "low" | "medium" | "high";
  domain?: string;
  hypothesis?: string;
  tags?: string[];
};

export type ChatCitation = {
  title: string;
  source: string;
  uri?: string;
};

export type ChatReply = {
  answer: string;
  citations: ChatCitation[];
  followUps: string[];
  mode?: "grounded" | "fallback";
};

export const budgetRegions: BudgetRegion[] = [
  {
    code: "US",
    label: "United States",
    currency: "USD",
    symbol: "$",
    fxRate: 1,
    laborMultiplier: 1,
    shippingMultiplier: 1,
    procurementMultiplier: 1,
  },
  {
    code: "DE",
    label: "Germany",
    currency: "EUR",
    symbol: "EUR",
    fxRate: 0.93,
    laborMultiplier: 1.12,
    shippingMultiplier: 1.08,
    procurementMultiplier: 1.04,
  },
  {
    code: "GB",
    label: "United Kingdom",
    currency: "GBP",
    symbol: "GBP",
    fxRate: 0.8,
    laborMultiplier: 1.06,
    shippingMultiplier: 1.07,
    procurementMultiplier: 1.02,
  },
  {
    code: "IN",
    label: "India",
    currency: "INR",
    symbol: "INR",
    fxRate: 83,
    laborMultiplier: 0.36,
    shippingMultiplier: 1.18,
    procurementMultiplier: 0.92,
  },
  {
    code: "SG",
    label: "Singapore",
    currency: "SGD",
    symbol: "SGD",
    fxRate: 1.35,
    laborMultiplier: 1.18,
    shippingMultiplier: 1.1,
    procurementMultiplier: 1.05,
  },
];

export type ApiContract = {
  name: string;
  method: string;
  path: string;
  purpose: string;
};

export type KnowledgeGraphContext = {
  experimentId: string;
  nodes: { id: string; type: string; label: string }[];
  edges: { source: string; target: string; relation: string }[];
  tags: string[];
  materials: MaterialItem[];
  protocolSteps: { id: string; title: string; rationale: string }[];
  reviews: ReviewRecord[];
};

export type MoleculeModel = {
  name: string;
  formula: string;
  note: string;
  editableHint?: string;
  atoms: { id: string; element: string; x: number; y: number; z: number }[];
  bonds: { from: string; to: string }[];
};

function planSearchText(plan: ExperimentPlan) {
  return [
    plan.project,
    plan.hypothesis,
    plan.plainEnglish,
    plan.domain,
    ...plan.materials.map((item) => `${item.name} ${item.supplier}`),
    ...plan.steps.map((step) => `${step.title} ${step.detail} ${step.source}`),
    ...plan.sources.map((source) => `${source.title} ${source.source}`),
  ]
    .join(" ")
    .toLowerCase();
}

function genericMoleculeCue(label: string, note: string): MoleculeModel {
  const normalized = label.trim() || "Hypothesis-linked molecular cue";

  return {
    name: normalized,
    formula: "Hypothesis cue",
    note,
    editableHint: "This view is generated from the active hypothesis and material list. Refine it while checking whether the plan is tracking the right intervention or control molecule.",
    atoms: [
      { id: "c1", element: "C", x: -1.1, y: 0.1, z: 0.2 },
      { id: "o1", element: "O", x: -0.2, y: -0.8, z: 0 },
      { id: "n1", element: "N", x: 0.9, y: -0.1, z: 0.3 },
      { id: "c2", element: "C", x: 1.5, y: 0.9, z: -0.2 },
    ],
    bonds: [
      { from: "c1", to: "o1" },
      { from: "o1", to: "n1" },
      { from: "n1", to: "c2" },
    ],
  };
}

export function moleculeForPlan(plan: ExperimentPlan): MoleculeModel {
  const domain = plan.domain.toLowerCase();
  const searchText = planSearchText(plan);
  const protocolLinked = searchText.includes("protocols.io");
  const firstMaterial = plan.materials[0]?.name || "";

  if (searchText.includes("trehalose")) {
    return {
      name: "Trehalose",
      formula: "C12H22O11",
      note: protocolLinked
        ? "Representative cryoprotectant inferred from the active plan and protocol-linked source trail."
        : "Representative cryoprotectant in the active plan.",
      editableHint: "Scientists can reposition atoms or adjust depth to compare alternative cryoprotectant conformations during discussion.",
      atoms: [
        { id: "c1", element: "C", x: -1.2, y: -0.1, z: 0.2 },
        { id: "o1", element: "O", x: -0.4, y: -0.8, z: -0.1 },
        { id: "c2", element: "C", x: 0.4, y: -0.2, z: 0.5 },
        { id: "o2", element: "O", x: 1.2, y: -0.9, z: 0.1 },
        { id: "c3", element: "C", x: 1.1, y: 0.9, z: -0.2 },
        { id: "o3", element: "O", x: 0.1, y: 1.4, z: -0.5 },
        { id: "c4", element: "C", x: -0.9, y: 0.9, z: -0.1 },
        { id: "o4", element: "O", x: -1.8, y: 0.3, z: 0.4 },
      ],
      bonds: [
        { from: "c1", to: "o1" },
        { from: "o1", to: "c2" },
        { from: "c2", to: "o2" },
        { from: "c2", to: "c3" },
        { from: "c3", to: "o3" },
        { from: "o3", to: "c4" },
        { from: "c4", to: "o4" },
        { from: "c4", to: "c1" },
      ],
    };
  }

  if (searchText.includes("dmso")) {
    return {
      name: "DMSO",
      formula: "C2H6OS",
      note: "Control cryoprotectant inferred directly from the plan materials and freeze-media setup.",
      editableHint: "Use this control structure to compare whether the intervention story really differs from the standard cryopreservation baseline.",
      atoms: [
        { id: "s1", element: "S", x: 0, y: 0, z: 0.2 },
        { id: "o1", element: "O", x: 1.1, y: -0.4, z: 0.3 },
        { id: "c1", element: "C", x: -1.1, y: -0.2, z: -0.1 },
        { id: "c2", element: "C", x: 0.1, y: 1.2, z: -0.2 },
      ],
      bonds: [
        { from: "s1", to: "o1" },
        { from: "s1", to: "c1" },
        { from: "s1", to: "c2" },
      ],
    };
  }

  if (searchText.includes("c-reactive protein") || searchText.includes("crp")) {
    // CRP is a 115 kDa pentameric protein — it has no meaningful small-molecule sketch.
    // The chemically correct entity to show for a CRP biosensor is the SAM linker:
    // 3-Mercaptopropionic acid (3-MPA, PubChem CID 75763).
    // The –SH end chemisorbs onto the electrode; the –COOH end activates via EDC/NHS
    // for covalent anti-CRP IgG attachment.
    return {
      name: "3-Mercaptopropionic acid (SAM linker)",
      formula: "C3H6O2S · PubChem CID 75763",
      note: protocolLinked
        ? "The thiol SAM linker that covalently couples anti-CRP IgG to the electrode surface (protocol-linked). –SH end bonds to the electrode; –COOH end activates for EDC/NHS antibody coupling."
        : "The thiol self-assembled monolayer (SAM) linker for anti-CRP functionalisation. –SH chemisorbs onto the electrode surface; –COOH is activated by EDC/NHS to covalently bind anti-CRP IgG. CRP (115 kDa protein) is the target — it cannot be sketched as a small molecule.",
      editableHint: "Adjust the –COOH end orientation to assess steric accessibility for EDC/NHS coupling. The electrode–SAM interface controls functionalisation yield and antibody orientation, which directly sets the LoD.",
      atoms: [
        { id: "s1", element: "S",  x: -1.8, y:  0.0, z:  0.0 },  // thiol –SH (electrode bond)
        { id: "c1", element: "C",  x: -0.7, y:  0.1, z:  0.0 },  // CH₂
        { id: "c2", element: "C",  x:  0.4, y: -0.2, z:  0.0 },  // CH₂
        { id: "c3", element: "C",  x:  1.5, y:  0.2, z:  0.0 },  // carboxyl carbon
        { id: "o1", element: "O",  x:  2.2, y:  0.9, z:  0.1 },  // C=O
        { id: "o2", element: "O",  x:  1.8, y: -0.9, z:  0.0 },  // –OH (EDC/NHS active ester site)
      ],
      bonds: [
        { from: "s1", to: "c1" },
        { from: "c1", to: "c2" },
        { from: "c2", to: "c3" },
        { from: "c3", to: "o1" },
        { from: "c3", to: "o2" },
      ],
    };
  }

  if (searchText.includes("acetate")) {
    return {
      name: "Acetate",
      formula: "C2H3O2-",
      note: protocolLinked
        ? "Representative product molecule inferred from the active protocol-backed carbon-fixation plan."
        : "Representative product molecule for the carbon-fixation workflow.",
      editableHint: "Adjust the view to inspect the product geometry and annotate alternative reaction-state ideas.",
      atoms: [
        { id: "c1", element: "C", x: -0.8, y: 0.2, z: 0.2 },
        { id: "c2", element: "C", x: 0.4, y: -0.1, z: -0.1 },
        { id: "o1", element: "O", x: 1.5, y: 0.5, z: 0.1 },
        { id: "o2", element: "O", x: 0.6, y: -1.3, z: -0.3 },
      ],
      bonds: [
        { from: "c1", to: "c2" },
        { from: "c2", to: "o1" },
        { from: "c2", to: "o2" },
      ],
    };
  }

  if (searchText.includes("co2") || searchText.includes("carbon dioxide")) {
    return {
      name: "Carbon dioxide",
      formula: "CO2",
      note: "Substrate cue inferred from the reactor protocol and gas-feed steps in the active plan.",
      editableHint: "Use this substrate view to compare feed and product logic before accepting the benchmark claim.",
      atoms: [
        { id: "o1", element: "O", x: -1.1, y: 0, z: 0.1 },
        { id: "c1", element: "C", x: 0, y: 0, z: -0.1 },
        { id: "o2", element: "O", x: 1.1, y: 0, z: 0.1 },
      ],
      bonds: [
        { from: "o1", to: "c1" },
        { from: "c1", to: "o2" },
      ],
    };
  }

  if (searchText.includes("fitc-dextran") || searchText.includes("dextran")) {
    return {
      name: "FITC-dextran assay cue",
      formula: "Assay marker",
      note: protocolLinked
        ? "Assay marker inferred from the active permeability protocol and supporting references."
        : "Simplified visual cue for the active experiment's representative molecular system.",
      editableHint: "Scientists can drag atoms or tune coordinates to sketch alternative assay-state interpretations.",
      atoms: [
        { id: "c1", element: "C", x: -1.1, y: 0.1, z: 0.2 },
        { id: "o1", element: "O", x: -0.2, y: -0.8, z: 0 },
        { id: "c2", element: "C", x: 0.9, y: -0.1, z: 0.3 },
        { id: "n1", element: "N", x: 1.5, y: 0.9, z: -0.2 },
        { id: "o2", element: "O", x: -0.4, y: 1, z: -0.3 },
      ],
      bonds: [
        { from: "c1", to: "o1" },
        { from: "o1", to: "c2" },
        { from: "c2", to: "n1" },
        { from: "c1", to: "o2" },
      ],
    };
  }

  if (firstMaterial) {
    return genericMoleculeCue(
      firstMaterial,
      protocolLinked
        ? `Representative molecular workspace generated from the first protocol-linked material in the active plan: ${firstMaterial}.`
        : `Representative molecular workspace generated from the leading material in the active hypothesis: ${firstMaterial}.`,
    );
  }

  if (plan.hypothesis.trim()) {
    return genericMoleculeCue(
      plan.hypothesis.split(/[,.]/)[0].slice(0, 60),
      "Representative molecular workspace generated from the active hypothesis because no specific reagent match was inferred yet.",
    );
  }

  if (domain.includes("cell biology")) {
    return {
      name: "Trehalose",
      formula: "C12H22O11",
      note: "Representative cryoprotectant in the active plan.",
      editableHint: "Scientists can reposition atoms or adjust depth to compare alternative cryoprotectant conformations during discussion.",
      atoms: [
        { id: "c1", element: "C", x: -1.2, y: -0.1, z: 0.2 },
        { id: "o1", element: "O", x: -0.4, y: -0.8, z: -0.1 },
        { id: "c2", element: "C", x: 0.4, y: -0.2, z: 0.5 },
        { id: "o2", element: "O", x: 1.2, y: -0.9, z: 0.1 },
        { id: "c3", element: "C", x: 1.1, y: 0.9, z: -0.2 },
        { id: "o3", element: "O", x: 0.1, y: 1.4, z: -0.5 },
        { id: "c4", element: "C", x: -0.9, y: 0.9, z: -0.1 },
        { id: "o4", element: "O", x: -1.8, y: 0.3, z: 0.4 },
      ],
      bonds: [
        { from: "c1", to: "o1" },
        { from: "o1", to: "c2" },
        { from: "c2", to: "o2" },
        { from: "c2", to: "c3" },
        { from: "c3", to: "o3" },
        { from: "o3", to: "c4" },
        { from: "c4", to: "o4" },
        { from: "c4", to: "c1" },
      ],
    };
  }

  if (domain.includes("diagnostics")) {
    // Default diagnostics SAM linker: 3-MPA (same as CRP biosensor pathway)
    return {
      name: "3-Mercaptopropionic acid (SAM linker)",
      formula: "C3H6O2S · PubChem CID 75763",
      note: "The thiol SAM linker used for antibody immobilisation on electrochemical biosensors. –SH bonds to the electrode; –COOH activates for EDC/NHS antibody coupling.",
      editableHint: "Adjust the –COOH end orientation to assess steric accessibility for EDC/NHS coupling. The electrode–SAM interface controls functionalisation yield and antibody orientation.",
      atoms: [
        { id: "s1", element: "S",  x: -1.8, y:  0.0, z:  0.0 },
        { id: "c1", element: "C",  x: -0.7, y:  0.1, z:  0.0 },
        { id: "c2", element: "C",  x:  0.4, y: -0.2, z:  0.0 },
        { id: "c3", element: "C",  x:  1.5, y:  0.2, z:  0.0 },
        { id: "o1", element: "O",  x:  2.2, y:  0.9, z:  0.1 },
        { id: "o2", element: "O",  x:  1.8, y: -0.9, z:  0.0 },
      ],
      bonds: [
        { from: "s1", to: "c1" },
        { from: "c1", to: "c2" },
        { from: "c2", to: "c3" },
        { from: "c3", to: "o1" },
        { from: "c3", to: "o2" },
      ],
    };
  }

  if (domain.includes("electrochemistry")) {
    return {
      name: "Acetate",
      formula: "C2H3O2-",
      note: "Representative product molecule for the carbon-fixation workflow.",
      editableHint: "Adjust the view to inspect the product geometry and annotate alternative reaction-state ideas.",
      atoms: [
        { id: "c1", element: "C", x: -0.8, y: 0.2, z: 0.2 },
        { id: "c2", element: "C", x: 0.4, y: -0.1, z: -0.1 },
        { id: "o1", element: "O", x: 1.5, y: 0.5, z: 0.1 },
        { id: "o2", element: "O", x: 0.6, y: -1.3, z: -0.3 },
      ],
      bonds: [
        { from: "c1", to: "c2" },
        { from: "c2", to: "o1" },
        { from: "c2", to: "o2" },
      ],
    };
  }

  return {
    name: "FITC-dextran assay cue",
    formula: "Assay marker",
    note: "Simplified visual cue for the active experiment's representative molecular system.",
    editableHint: "Scientists can drag atoms or tune coordinates to sketch alternative assay-state interpretations.",
    atoms: [
      { id: "c1", element: "C", x: -1.1, y: 0.1, z: 0.2 },
      { id: "o1", element: "O", x: -0.2, y: -0.8, z: 0 },
      { id: "c2", element: "C", x: 0.9, y: -0.1, z: 0.3 },
      { id: "n1", element: "N", x: 1.5, y: 0.9, z: -0.2 },
      { id: "o2", element: "O", x: -0.4, y: 1, z: -0.3 },
    ],
    bonds: [
      { from: "c1", to: "o1" },
      { from: "o1", to: "c2" },
      { from: "c2", to: "n1" },
      { from: "c1", to: "o2" },
    ],
  };
}

export function budgetRegionByCode(code?: string): BudgetRegion {
  return budgetRegions.find((region) => region.code === code) || budgetRegions[0];
}

export function adjustedBudgetAmount(amountUsd: number, region: BudgetRegion, category: BudgetLineItem["category"] | "total" = "reagents") {
  const multiplier =
    category === "labor"
      ? region.laborMultiplier
      : category === "shipping"
        ? region.shippingMultiplier
        : category === "equipment" || category === "reagents" || category === "contingency" || category === "total"
          ? region.procurementMultiplier
          : 1;

  return amountUsd * multiplier * region.fxRate;
}

export function formatCurrency(amount: number, region: BudgetRegion) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: region.currency,
    maximumFractionDigits: region.currency === "INR" ? 0 : 2,
  }).format(amount);
}

export function scientistGapsForPlan(plan: ExperimentPlan) {
  const shared = [
    "No statistical power or replicate strategy is shown, so a scientist cannot judge whether the validation thresholds are actually testable.",
    "The plan still lacks biosafety, ethics, waste-disposal, and instrument-compatibility checks that many labs need before they can start.",
    "Supplier and protocol references are present, but the system still does not prove that the exact reagent format, assay chemistry, and local equipment match the intended workflow.",
  ];

  if (plan.domain.includes("Cell Biology")) {
    return [
      ...shared,
      "Cryopreservation parameters like cooling rate, thaw temperature, and post-thaw recovery media are still under-specified for a real cell-biology handoff.",
    ];
  }

  if (plan.domain.includes("Gut")) {
    return [
      ...shared,
      "Animal randomization, blinding, welfare approval, and cage-effect controls need to be explicit before this would pass a serious in vivo review.",
    ];
  }

  if (plan.domain.includes("Diagnostics")) {
    return [
      ...shared,
      "Matrix effects, clinical comparator sample counts, and false-positive handling are still not specified tightly enough for translational diagnostics work.",
    ];
  }

  if (plan.domain.includes("Electrochemistry")) {
    return [
      ...shared,
      "Electrode geometry, reactor volume, gas-transfer setup, and reference-electrode calibration cadence are still too loose for a real electrochemical build.",
    ];
  }

  return shared;
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
}

const API_TIMEOUT_MS = 4500;

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`Local API timed out after ${API_TIMEOUT_MS / 1000}s. Make sure the mock API is running on port 8787.`);
    }

    throw new Error("Local API is unavailable on port 8787. Start it with `npm run api` or use `npm run dev` to launch both services.");
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function fetchExperimentPlan(hypothesis: string): Promise<{ experiment: ExperimentPlan }> {
  const response = await fetchWithTimeout("/api/experiments/plan", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ hypothesis }),
  });

  return readJson<{ experiment: ExperimentPlan }>(response);
}

export async function fetchChatReply(
  experimentId: string,
  hypothesis: string,
  question: string,
  plan?: ExperimentPlan,
  reviews?: ReviewRecord[],
): Promise<ChatReply> {
  const response = await fetchWithTimeout("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      experimentId,
      hypothesis,
      question,
      planContext: plan
        ? {
            domain: plan.domain,
            novelty: plan.novelty,
            validation: plan.validation,
            reviewAdaptations: plan.reviewAdaptations,
            keyMaterials: plan.materials.slice(0, 5),
            budget: plan.budget,
            sources: plan.sources.slice(0, 5),
          }
        : undefined,
      reviews,
    }),
  });

  return readJson<ChatReply>(response);
}

export async function fetchReviews(experimentId: string): Promise<ReviewRecord[]> {
  const response = await fetchWithTimeout(`/api/reviews?experimentId=${encodeURIComponent(experimentId)}`);
  return readJson<ReviewRecord[]>(response);
}

export async function createReview(review: ReviewRecord): Promise<ReviewRecord> {
  const response = await fetchWithTimeout("/api/reviews", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(review),
  });

  return readJson<ReviewRecord>(response);
}

export async function fetchApiContracts(): Promise<ApiContract[]> {
  const response = await fetchWithTimeout("/api/contracts");
  return readJson<ApiContract[]>(response);
}

export async function fetchKnowledgeGraphContext(hypothesis?: string): Promise<KnowledgeGraphContext> {
  const query = hypothesis ? `?hypothesis=${encodeURIComponent(hypothesis)}` : "";
  const response = await fetchWithTimeout(`/api/knowledge-graph/context${query}`);
  return readJson<KnowledgeGraphContext>(response);
}
