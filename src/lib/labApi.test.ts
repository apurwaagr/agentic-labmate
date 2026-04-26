import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  fetchExperimentPlan,
  fetchChatReply,
  fetchReviews,
  createReview,
  fetchApiContracts,
  fetchKnowledgeGraphContext,
  moleculeForPlan,
  type ExperimentPlan,
} from "@/lib/labApi";

function mockResponse(payload: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => payload,
  } as Response;
}

function basePlan(domain = "Cell Biology"): ExperimentPlan {
  return {
    id: "exp-1",
    project: "P",
    hypothesis: "H",
    plainEnglish: "E",
    domain,
    metrics: { confidence: "M", novelty: "Similar", sustainability: "Moderate" },
    novelty: { signal: "similar work exists", summary: "S", references: [] },
    materials: [],
    steps: [],
    timeline: [],
    budget: { reagentsUsd: 1, equipmentUsd: 2, totalUsd: 3, budgetCapUsd: 10, savedUsd: 7 },
    benchmark: [],
    validation: { primaryMetric: "M", successCriteria: "S", failureCriteria: [], decisionGates: [] },
    reviewAdaptations: [],
    sources: [],
  };
}

describe("labApi client", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetchExperimentPlan posts hypothesis and returns experiment", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ experiment: { id: "e-1" } }));
    const result = await fetchExperimentPlan("test hypothesis");
    expect(result.experiment.id).toBe("e-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/experiments/plan");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ hypothesis: "test hypothesis" });
  });

  it("fetchChatReply sends plan context and reviews when provided", async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({ answer: "ok", citations: [], followUps: [] }),
    );
    await fetchChatReply(
      "exp-1",
      "h",
      "q",
      basePlan(),
      [{ experimentId: "exp-1", reviewer: "r", section: "s", correction: "c", severity: "medium" }],
    );
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.experimentId).toBe("exp-1");
    expect(body.planContext.domain).toBe("Cell Biology");
    expect(Array.isArray(body.reviews)).toBe(true);
  });

  it("throws useful error when API returns non-ok", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ error: "bad" }, false, 500));
    await expect(fetchReviews("exp-1")).rejects.toThrow("Request failed with status 500");
  });

  it("calls expected REST paths for review/contracts/graph", async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse({ experimentId: "exp-1" }))
      .mockResolvedValueOnce(mockResponse([]))
      .mockResolvedValueOnce(mockResponse([]))
      .mockResolvedValueOnce(mockResponse({ experimentId: "k", nodes: [], edges: [], tags: [], materials: [], protocolSteps: [], reviews: [] }));

    await createReview({ experimentId: "exp-1", reviewer: "r", section: "s", correction: "c", severity: "medium" });
    await fetchReviews("exp-1");
    await fetchApiContracts();
    await fetchKnowledgeGraphContext("abc");

    expect(fetchMock.mock.calls[0][0]).toBe("/api/reviews");
    expect(fetchMock.mock.calls[1][0]).toContain("/api/reviews?experimentId=exp-1");
    expect(fetchMock.mock.calls[2][0]).toBe("/api/contracts");
    expect(fetchMock.mock.calls[3][0]).toContain("/api/knowledge-graph/context?hypothesis=abc");
  });
});

describe("moleculeForPlan", () => {
  it("returns domain-specific molecule cues", () => {
    expect(moleculeForPlan(basePlan("Cell Biology")).name).toBeTruthy();
    expect(moleculeForPlan(basePlan("Diagnostics")).name).toBeTruthy();
    expect(moleculeForPlan(basePlan("Electrochemistry")).name).toBeTruthy();
  });
});
