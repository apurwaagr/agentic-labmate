import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CouncilTracePanel } from "@/components/lab/CouncilTracePanel";
import { CouncilAgentPanels } from "@/components/lab/CouncilAgentPanels";
import type { PlanSSEEvent } from "@/lib/labApi";

describe("CouncilTracePanel", () => {
  it("collapses repeated heartbeat events for readability", () => {
    const events: PlanSSEEvent[] = [
      { type: "progress", stage: "parse", message: "Parsing hypothesis...", pct: 8 },
      { type: "progress", stage: "heartbeat", message: "Council still working...", pct: 24 },
      { type: "progress", stage: "heartbeat", message: "Council still working...", pct: 24 },
      { type: "progress", stage: "heartbeat", message: "Council still working...", pct: 24 },
      { type: "agent_draft", agent: "ProtocolArchitect", section: "protocol", content: { steps: [] }, round: 1 },
    ];

    render(<CouncilTracePanel events={events} />);

    expect(screen.getByText(/Council still working\.\.\. \(3 heartbeat updates\)/)).toBeInTheDocument();
    expect(screen.getByText(/ProtocolArchitect submitted draft/)).toBeInTheDocument();
  });
});

describe("CouncilAgentPanels", () => {
  it("pretty-prints JSON-like string revisions and renders severity badges", () => {
    const view = render(
      <CouncilAgentPanels
        drafts={{
          protocol: "## Protocol\n\n**Objective:** Validate post-thaw viability.\n\n- HeLa cells\n- Trehalose",
        }}
        revisions={{ protocol: "{\"steps\":[{\"id\":\"s1\",\"note\":\"updated\"}]}" }}
        objections={[
          {
            section: "protocol",
            claim: "Control missing",
            objection: "Add explicit control definition",
            severity: "major",
          },
        ]}
      />,
    );

    expect(screen.getByText("1 Major")).toBeInTheDocument();
    expect(screen.getByText(/Devil's Advocate Objections/)).toBeInTheDocument();
    expect(screen.getByText("Protocol")).toBeInTheDocument();
    expect(view.container.querySelector("h2")).not.toBeNull();
    expect(screen.queryByText("## Protocol")).not.toBeInTheDocument();
  });
});

