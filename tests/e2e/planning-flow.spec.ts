import { expect, test } from "@playwright/test";

const hypothesisText =
  "Trehalose at 200 mM improves post-thaw viability of HeLa cells by at least 20% versus standard 10% DMSO control.";

const experimentPayload = {
  experiment: {
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
    materials: [],
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
  },
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
});

test("creates project and renders generated plan shell", async ({ page }) => {
  await page.route("**/api/experiments/plan", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(experimentPayload),
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
  await expect(page.getByText("OpenAlex returned 95 results.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Run Planning Agent" })).toBeVisible();
});

test("shows an error banner when generation fails", async ({ page }) => {
  await page.route("**/api/experiments/plan", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Simulated failure" }),
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
  await page.getByPlaceholder("Example: Trehalose Cryopreservation Study").fill("E2E Failure Case");
  await page
    .getByPlaceholder("Enter the intervention, outcome threshold, mechanism, and control condition...")
    .fill(hypothesisText);
  await page.getByRole("button", { name: "Create project and generate plan" }).click();

  await expect(page.getByText(/Request failed with status 500|Local API timed out/)).toBeVisible({ timeout: 15000 });
});
