import { expect, test } from "@playwright/test";

const hypothesisText =
  "Trehalose at 200 mM improves post-thaw viability of HeLa cells by at least 20% versus standard 10% DMSO control.";

const baseExperiment = {
  id: "exp-e2e-1",
  project: "Agentic Labmate",
  hypothesis: hypothesisText,
  plainEnglish: "Test whether trehalose improves post-thaw viability against DMSO control.",
  domain: "Cell Biology",
  metrics: {
    confidence: "High",
    novelty: "Similar Work Exists",
    sustainability: "66/100",
  },
  novelty: {
    signal: "similar work exists",
    summary: "OpenAlex returned 95 results.",
    references: [
      {
        title: "Cryoprotective effect of trehalose in mammalian cells",
        uri: "https://example.org/ref-1",
        source: "Doe et al. (2024)",
      },
    ],
  },
  materials: [
    {
      name: "Trehalose",
      catalogNumber: "T9531",
      supplier: "Sigma-Aldrich",
      quantity: "100 g",
      unitCostUsd: 45,
      leadTime: "4-10 days",
      status: "order",
      pricingSource: "sigma_live",
      pricingConfidence: 0.7,
    },
  ],
  steps: [],
  timeline: [],
  budget: {
    reagentsUsd: 100,
    equipmentUsd: 50,
    totalUsd: 150,
    budgetCapUsd: 200,
    savedUsd: 50,
  },
  benchmark: [],
  validation: {
    primaryMetric: "Post-thaw viability",
    successCriteria: ">=20% viability improvement vs control",
    failureCriteria: ["No measurable improvement"],
    decisionGates: ["Control quality pass"],
  },
  reviewAdaptations: [],
  sources: [],
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
});

test("shows fallback copy when backend returns empty adaptations", async ({ page }) => {
  await page.route("**/api/experiments/plan", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        experiment: {
          ...baseExperiment,
          reviewAdaptations: [],
        },
      }),
    });
  });

  await page.route("**/api/reviews?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    });
  });

  await page.goto("/");
  await page.getByPlaceholder("Example: Trehalose Cryopreservation Study").fill("E2E Project");
  await page
    .getByPlaceholder("Enter the intervention, outcome threshold, mechanism, and control condition...")
    .fill(hypothesisText);
  await page.getByRole("button", { name: "Create project and generate plan" }).click();

  await expect(page.getByRole("heading", { name: "E2E Project" })).toBeVisible();
  await expect(page.getByText("0 applied")).toBeVisible();
  await expect(page.getByText("Add a scientist review and regenerate to see improvements.")).toBeVisible();
});

test("renders adaptation rows when backend returns non-empty list", async ({ page }) => {
  await page.route("**/api/experiments/plan", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        experiment: {
          ...baseExperiment,
          reviewAdaptations: [
            {
              section: "Protocol",
              change: "Added randomization and stricter control handling.",
              impact: "Improves reproducibility.",
            },
          ],
        },
      }),
    });
  });
  await page.route("**/api/reviews?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    });
  });

  await page.goto("/");
  await page.getByPlaceholder("Example: Trehalose Cryopreservation Study").fill("E2E Adaptation Case");
  await page
    .getByPlaceholder("Enter the intervention, outcome threshold, mechanism, and control condition...")
    .fill(hypothesisText);
  await page.getByRole("button", { name: "Create project and generate plan" }).click();

  await expect(page.getByText("1 applied")).toBeVisible();
  await expect(page.getByText("Added randomization and stricter control handling.")).toBeVisible();
});
