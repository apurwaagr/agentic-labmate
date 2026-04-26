import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Index from "@/pages/Index";

const mocks = vi.hoisted(() => ({
  fetchExperimentPlanStream: vi.fn(),
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
vi.mock("@/components/lab/CouncilTracePanel", () => ({ CouncilTracePanel: () => <div /> }));
vi.mock("@/components/lab/CouncilAgentPanels", () => ({ CouncilAgentPanels: () => <div /> }));
vi.mock("@/components/lab/CouncilMetricsCard", () => ({ CouncilMetricsCard: () => <div /> }));

vi.mock("@/lib/labApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/labApi")>();
  return {
    ...actual,
    fetchExperimentPlanStream: mocks.fetchExperimentPlanStream,
    fetchReviews: mocks.fetchReviews,
  };
});

describe("Index page project flow", () => {
  it("enables create button when form is complete", () => {
    localStorage.clear();
    render(<Index />);

    const createButton = screen.getByRole("button", { name: /create project and generate plan/i });
    expect(createButton).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/Trehalose Cryopreservation Study/i), { target: { value: "My Study" } });
    fireEvent.change(screen.getByPlaceholderText(/Enter the intervention/i), { target: { value: "Hypothesis text" } });
    expect(createButton).toBeEnabled();
  });

  it("creates project and triggers plan generation", async () => {
    mocks.fetchReviews.mockResolvedValue([]);
    mocks.fetchExperimentPlanStream.mockImplementation((_hypothesis, onEvent, _onError, onComplete) => {
      onEvent({
        type: "plan_complete",
        plan: {
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
        },
      });
      onComplete();
      return () => {};
    });
    render(<Index />);
    fireEvent.change(screen.getByPlaceholderText(/Trehalose Cryopreservation Study/i), {
      target: { value: "Project A" },
    });
    fireEvent.change(screen.getByPlaceholderText(/Enter the intervention, outcome threshold/i), {
      target: { value: "Test intervention improves outcome by 30% vs control" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Create project and generate plan/i }));

    await waitFor(() => expect(mocks.fetchExperimentPlanStream).toHaveBeenCalledTimes(1));
    expect(mocks.fetchReviews).toHaveBeenCalled();
  });

});
