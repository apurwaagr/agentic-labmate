import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Index from "@/pages/Index";

vi.mock("@/lib/labApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/labApi")>();
  return {
    ...actual,
    fetchExperimentPlan: vi.fn(),
    fetchReviews: vi.fn(),
  };
});

vi.mock("@/components/lab/Navigator", () => ({
  Navigator: ({ onCreateProject }: { onCreateProject: () => void }) => (
    <button onClick={onCreateProject}>Open Composer</button>
  ),
}));

vi.mock("@/components/lab/ContextStore", () => ({ ContextStore: () => <div>ContextStore</div> }));
vi.mock("@/components/lab/ProtocolCard", () => ({ ProtocolCard: () => <div>ProtocolCard</div> }));
vi.mock("@/components/lab/SupplyChainCard", () => ({ SupplyChainCard: () => <div>SupplyChainCard</div> }));
vi.mock("@/components/lab/TimelineCard", () => ({ TimelineCard: () => <div>TimelineCard</div> }));
vi.mock("@/components/lab/ComparisonCard", () => ({ ComparisonCard: () => <div>ComparisonCard</div> }));
vi.mock("@/components/lab/Chatbot", () => ({ Chatbot: () => <div>Chatbot</div> }));
vi.mock("@/components/lab/PhaseTracker", () => ({ PhaseTracker: () => <div>PhaseTracker</div> }));
vi.mock("@/components/lab/ValidationCard", () => ({ ValidationCard: () => <div>ValidationCard</div> }));

describe("Index page flow", () => {
  it("enables create button when form is complete", () => {
    localStorage.clear();
    render(<Index />);

    const createButton = screen.getByRole("button", { name: /create project and generate plan/i });
    expect(createButton).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/Trehalose Cryopreservation Study/i), { target: { value: "My Study" } });
    fireEvent.change(screen.getByPlaceholderText(/Enter the intervention/i), { target: { value: "Hypothesis text" } });
    expect(createButton).toBeEnabled();
  });
});
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Index from "@/pages/Index";

const mocks = vi.hoisted(() => ({
  fetchExperimentPlan: vi.fn(),
  fetchReviews: vi.fn(),
}));

vi.mock("@/components/lab/Navigator", () => ({
  Navigator: () => <div data-testid="navigator" />,
}));
vi.mock("@/components/lab/ProtocolCard", () => ({ ProtocolCard: () => <div /> }));
vi.mock("@/components/lab/ValidationCard", () => ({ ValidationCard: () => <div /> }));
vi.mock("@/components/lab/SupplyChainCard", () => ({ SupplyChainCard: () => <div /> }));
vi.mock("@/components/lab/TimelineCard", () => ({ TimelineCard: () => <div /> }));
vi.mock("@/components/lab/ComparisonCard", () => ({ ComparisonCard: () => <div /> }));
vi.mock("@/components/lab/ContextStore", () => ({ ContextStore: () => <div /> }));
vi.mock("@/components/lab/Chatbot", () => ({ Chatbot: () => <div /> }));
vi.mock("@/components/lab/PhaseTracker", () => ({ PhaseTracker: () => <div /> }));

vi.mock("@/lib/labApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/labApi")>();
  return {
    ...actual,
    fetchExperimentPlan: mocks.fetchExperimentPlan,
    fetchReviews: mocks.fetchReviews,
  };
});

describe("Index page project flow", () => {
  it("creates project and triggers plan generation", async () => {
    mocks.fetchExperimentPlan.mockResolvedValueOnce({
      experiment: {
        id: "exp-1",
        project: "Agentic",
        hypothesis: "H",
        plainEnglish: "P",
        domain: "Cell Biology",
        metrics: { confidence: "Medium", novelty: "Similar", sustainability: "Moderate" },
        novelty: { signal: "similar work exists", summary: "S", references: [] },
        materials: [],
        steps: [],
        timeline: [],
        budget: { reagentsUsd: 1, equipmentUsd: 2, totalUsd: 3, budgetCapUsd: 10, savedUsd: 7 },
        benchmark: [],
        validation: { primaryMetric: "m", successCriteria: "s", failureCriteria: [], decisionGates: [] },
        reviewAdaptations: [],
        sources: [],
      },
    });
    mocks.fetchReviews.mockResolvedValueOnce([]);

    render(<Index />);
    fireEvent.change(screen.getByPlaceholderText(/Trehalose Cryopreservation Study/i), {
      target: { value: "Project A" },
    });
    fireEvent.change(screen.getByPlaceholderText(/Enter the intervention, outcome threshold/i), {
      target: { value: "Test intervention improves outcome by 30% vs control" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Create project and generate plan/i }));

    await waitFor(() => expect(mocks.fetchExperimentPlan).toHaveBeenCalledTimes(1));
    expect(mocks.fetchReviews).toHaveBeenCalledTimes(1);
  });
});
