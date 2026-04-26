import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MoleculeCard } from "@/components/lab/MoleculeCard";
import { type ExperimentPlan } from "@/lib/labApi";

function makePlan(): ExperimentPlan {
  return {
    id: "exp-1",
    project: "P",
    hypothesis: "H",
    plainEnglish: "E",
    domain: "Cell Biology",
    metrics: { confidence: "Medium", novelty: "Similar", sustainability: "Moderate" },
    novelty: { signal: "similar work exists", summary: "S", references: [] },
    materials: [],
    steps: [],
    timeline: [],
    budget: { reagentsUsd: 1, equipmentUsd: 1, totalUsd: 2, budgetCapUsd: 10, savedUsd: 8 },
    benchmark: [],
    validation: { primaryMetric: "M", successCriteria: "S", failureCriteria: [], decisionGates: [] },
    reviewAdaptations: [],
    sources: [],
  };
}

describe("MoleculeCard", () => {
  it("toggles 2D and 3D views", () => {
    render(<MoleculeCard plan={makePlan()} />);
    const view2d = screen.getByRole("button", { name: "2D" });
    const view3d = screen.getByRole("button", { name: "3D" });
    fireEvent.click(view2d);
    fireEvent.click(view3d);
    expect(view2d).toBeInTheDocument();
    expect(view3d).toBeInTheDocument();
  });

  it("adds atom annotations in 2D mode", () => {
    render(<MoleculeCard plan={makePlan()} />);
    expect(screen.getByText(/4 atoms/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /add atom/i }));
    expect(screen.getByText(/5 atoms/i)).toBeInTheDocument();
  });
});
