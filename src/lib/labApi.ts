export type SourceReference = {
  title: string;
  uri?: string;
  source: string;
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
    totalUsd: number;
    budgetCapUsd: number;
    savedUsd: number;
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
};

export type ChatCitation = {
  title: string;
  source: string;
};

export type ChatReply = {
  answer: string;
  citations: ChatCitation[];
  followUps: string[];
};

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

export const sampleHypotheses = [
  {
    id: "diagnostics",
    label: "Diagnostics",
    hypothesis:
      "A paper-based electrochemical biosensor functionalized with anti-CRP antibodies will detect C-reactive protein in whole blood at concentrations below 0.5 mg/L within 10 minutes, matching laboratory ELISA sensitivity without requiring sample preprocessing.",
  },
  {
    id: "gut-health",
    label: "Gut Health",
    hypothesis:
      "Supplementing C57BL/6 mice with Lactobacillus rhamnosus GG for 4 weeks will reduce intestinal permeability by at least 30% compared to controls, measured by FITC-dextran assay, due to upregulation of tight junction proteins claudin-1 and occludin.",
  },
  {
    id: "cell-biology",
    label: "Cell Biology",
    hypothesis:
      "Replacing sucrose with trehalose as a cryoprotectant in the freezing medium will increase post-thaw viability of HeLa cells by at least 15 percentage points compared to the standard DMSO protocol, due to trehalose's superior membrane stabilization at low temperatures.",
  },
  {
    id: "climate",
    label: "Climate",
    hypothesis:
      "Introducing Sporomusa ovata into a bioelectrochemical system at a cathode potential of -400 mV vs SHE will fix CO2 into acetate at a rate of at least 150 mmol/L/day, outperforming current biocatalytic carbon capture benchmarks by at least 20%.",
  },
];

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function fetchExperimentPlan(hypothesis: string): Promise<{ experiment: ExperimentPlan }> {
  const response = await fetch("/api/experiments/plan", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ hypothesis }),
  });

  return readJson<{ experiment: ExperimentPlan }>(response);
}

export async function fetchChatReply(experimentId: string, hypothesis: string, question: string): Promise<ChatReply> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      experimentId,
      hypothesis,
      question,
    }),
  });

  return readJson<ChatReply>(response);
}

export async function fetchReviews(experimentId: string): Promise<ReviewRecord[]> {
  const response = await fetch(`/api/reviews?experimentId=${encodeURIComponent(experimentId)}`);
  return readJson<ReviewRecord[]>(response);
}

export async function createReview(review: ReviewRecord): Promise<ReviewRecord> {
  const response = await fetch("/api/reviews", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(review),
  });

  return readJson<ReviewRecord>(response);
}

export async function fetchApiContracts(): Promise<ApiContract[]> {
  const response = await fetch("/api/contracts");
  return readJson<ApiContract[]>(response);
}

export async function fetchKnowledgeGraphContext(hypothesis?: string): Promise<KnowledgeGraphContext> {
  const query = hypothesis ? `?hypothesis=${encodeURIComponent(hypothesis)}` : "";
  const response = await fetch(`/api/knowledge-graph/context${query}`);
  return readJson<KnowledgeGraphContext>(response);
}
