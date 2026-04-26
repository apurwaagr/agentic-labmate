import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ContextStore } from "@/components/lab/ContextStore";
import { type BudgetRegion, type ExperimentPlan, type ReviewRecord } from "@/lib/labApi";

vi.mock("@/components/lab/MoleculeCard", () => ({
  MoleculeCard: () => <div data-testid="molecule-card" />,
}));

vi.mock("@/lib/labApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/labApi")>();
  return {
    ...actual,
    createReview: vi.fn().mockResolvedValue({}),
    scientistGapsForPlan: vi.fn().mockReturnValue(["Gap 1"]),
  };
});

function makePlan(): ExperimentPlan {
  return {
    id: "exp-123",
    project: "Agentic",
    hypothesis: "Test L-DOPA",
    plainEnglish: "Plain text",
    domain: "Pharmacology",
    citationConfidence: 0.72,
    sectionConfidence: { novelty: 0.71, protocol: 0.6, materials: 0.66, timeline: 0.63, validation: 0.58 },
    metrics: { confidence: "Medium", novelty: "Similar", sustainability: "Moderate" },
    novelty: {
      signal: "similar work exists",
      summary: "Retrieval summary",
      references: [
        { title: "Paper A", source: "Kelly et al. (1998)", uri: "https://example.com/a" },
        { title: "Paper B", source: "Francardo et al. (2014)" },
      ],
    },
    materials: [],
    steps: [],
    timeline: [],
    budget: {
      reagentsUsd: 100,
      equipmentUsd: 50,
      shippingUsd: 10,
      laborUsd: 20,
      totalUsd: 180,
      budgetCapUsd: 250,
      savedUsd: 70,
      assumptions: [],
      lineItems: [],
    },
    benchmark: [],
    validation: { primaryMetric: "m", successCriteria: "s", failureCriteria: [], decisionGates: [] },
    reviewAdaptations: [],
    sources: [],
  };
}

const region: BudgetRegion = {
  code: "US",
  label: "United States",
  currency: "USD",
  symbol: "$",
  fxRate: 1,
  laborMultiplier: 1,
  shippingMultiplier: 1,
  procurementMultiplier: 1,
};

describe("ContextStore novelty panel", () => {
  it("renders reference title and source separately with links", () => {
    const plan = makePlan();
    render(
      <ContextStore
        plan={plan}
        reviews={[] as ReviewRecord[]}
        onReviewAdded={async () => {}}
        budgetRegion={region}
        onBudgetRegionChange={() => {}}
      />,
    );

    expect(screen.getByText("Literature and Novelty")).toBeInTheDocument();
    expect(screen.getByText("Kelly et al. (1998)")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Kelly et al\. \(1998\)/i });
    expect(link).toHaveAttribute("href", "https://example.com/a");
  });
});
