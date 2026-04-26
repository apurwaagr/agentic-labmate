import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
});

test("renders live stream result without blank state", async ({ page }) => {
  await page.route("**/api/experiments/plan/stream", async (route) => {
    const body = [
      'event: progress\ndata: {"stage":"heartbeat","message":"Council still working...","pct":24}\n\n',
      'event: progress\ndata: {"stage":"heartbeat","message":"Council still working...","pct":24}\n\n',
      'event: objections\ndata: {"items":[{"section":"protocol","claim":"x","objection":"y","severity":"fatal"}],"fatal_count":1}\n\n',
      'event: plan_complete\ndata: {"plan":{"experiment":{"id":"exp-stream","project":"Stream Test","hypothesis":"h","plainEnglish":"p","domain":"Cell Biology","metrics":{"confidence":"Medium","novelty":"similar work exists","sustainability":"60/100"},"novelty":{"signal":"similar work exists","summary":"","references":[]},"materials":[],"steps":[],"timeline":[],"budget":{"reagentsUsd":0,"equipmentUsd":0,"totalUsd":0,"budgetCapUsd":1,"savedUsd":1,"lineItems":[]},"benchmark":[],"validation":{"primaryMetric":"m","successCriteria":"s","failureCriteria":[],"decisionGates":[]},"reviewAdaptations":[],"sources":[]}}}\n\n',
      'event: metrics_complete\ndata: {"scores":{"faithfulness":0.8,"step_coverage":0.8,"entity_precision":0.8,"retrieval_recall_at_10":0.8,"convergence_score":0.8,"composite":0.8}}\n\n',
    ].join("");
    await route.fulfill({ status: 200, contentType: "text/event-stream", body });
  });
  await page.route("**/api/reviews?**", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));

  await page.goto("/");
  await page.getByPlaceholder("Example: Trehalose Cryopreservation Study").fill("Council Stream");
  await page
    .getByPlaceholder("Enter the intervention, outcome threshold, mechanism, and control condition...")
    .fill("Trehalose at 200 mM improves post-thaw viability of HeLa cells by at least 20% versus 10% DMSO.");
  await page.getByRole("button", { name: "Create project and generate plan" }).click();

  await expect(page.locator("h2", { hasText: "Council Stream" })).toBeVisible();
});
