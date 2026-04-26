import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
});

test("guided demo starter hypothesis runs and renders project", async ({ page }) => {
  await page.route("**/api/experiments/plan/stream", async (route) => {
    const body = [
      'event: plan_complete\ndata: {"plan":{"experiment":{"id":"demo-journey-exp","project":"Cell Biology Demo","hypothesis":"Trehalose at 200 mM improves post-thaw viability of HeLa cells by at least 20% versus standard 10% DMSO control under identical freezing and thawing conditions.","plainEnglish":"Check cryopreservation viability versus DMSO.","domain":"Cell Biology","metrics":{"confidence":"High","novelty":"similar work exists","sustainability":"74/100"},"novelty":{"signal":"similar work exists","summary":"Adjacent prior work exists.","references":[]},"materials":[],"steps":[],"timeline":[],"budget":{"reagentsUsd":0,"equipmentUsd":0,"totalUsd":0,"budgetCapUsd":100,"savedUsd":100,"lineItems":[]},"benchmark":[],"validation":{"primaryMetric":"viability","successCriteria":">=20%","failureCriteria":[],"decisionGates":[]},"reviewAdaptations":[],"sources":[]}}}\n\n',
      'event: metrics_complete\ndata: {"scores":{"faithfulness":0.8,"step_coverage":0.8,"entity_precision":0.8,"retrieval_recall_at_10":0.8,"convergence_score":0.8,"composite":0.8}}\n\n',
    ].join("");
    await route.fulfill({ status: 200, contentType: "text/event-stream", body });
  });
  await page.route("**/api/reviews?**", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));

  await page.goto("/");
  await page.getByRole("button", { name: "Cell Biology" }).click();
  await page.getByRole("button", { name: "Create project and generate plan" }).click();

  await expect(page.locator("h2", { hasText: "Cell Biology Demo" })).toBeVisible();
});
test.describe('Demo Journey', () => {
  test('User completes full reference project flow', async ({ page }) => {
    await page.goto('/');

    // Wait for load reference project to be visible
    const loadRefBtn = page.getByRole('button', { name: /load full reference project/i });
    await expect(loadRefBtn).toBeVisible();
    await loadRefBtn.click();

    // Verify UI components load
    await expect(page.locator("h2", { hasText: "Turkevich Gold Nanoparticle Synthesis" })).toBeVisible();
    
    // Switch tabs
    await page.getByRole('button', { name: 'Validation' }).click();
    await expect(page.getByRole("heading", { name: "Validation & Go / No-Go Gates" })).toBeVisible();
  });
});
