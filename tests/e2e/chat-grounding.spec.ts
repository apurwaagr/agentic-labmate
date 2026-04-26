import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
});

test("chat answer shows contextual citations", async ({ page }) => {
  await page.route("**/api/experiments/plan/stream", async (route) => {
    const body = [
      'event: plan_complete\ndata: {"plan":{"experiment":{"id":"chat-exp-1","project":"Chat Grounding Demo","hypothesis":"Trehalose at 200 mM improves post-thaw viability of HeLa cells by at least 20% versus standard 10% DMSO control under identical freezing and thawing conditions.","plainEnglish":"Cryopreservation test","domain":"Cell Biology","metrics":{"confidence":"Medium","novelty":"similar work exists","sustainability":"62/100"},"novelty":{"signal":"similar work exists","summary":"Context available","references":[]},"materials":[],"steps":[],"timeline":[],"budget":{"reagentsUsd":0,"equipmentUsd":0,"totalUsd":0,"budgetCapUsd":1,"savedUsd":1,"lineItems":[]},"benchmark":[],"validation":{"primaryMetric":"viability","successCriteria":">=20%","failureCriteria":[],"decisionGates":["Control quality pass"]},"reviewAdaptations":[],"sources":[{"title":"Trehalose study","source":"OpenAlex","uri":"https://example.org/ref-1"}]}}}\n\n',
      'event: metrics_complete\ndata: {"scores":{"faithfulness":0.8,"step_coverage":0.8,"entity_precision":0.8,"retrieval_recall_at_10":0.8,"convergence_score":0.8,"composite":0.8}}\n\n',
    ].join("");
    await route.fulfill({ status: 200, contentType: "text/event-stream", body });
  });
  await page.route("**/api/reviews?**", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/api/chat", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        answer: "The strongest evidence-backed claim is viability gain from trehalose against DMSO.",
        citations: [{ title: "Trehalose study", source: "OpenAlex", uri: "https://example.org/ref-1" }],
        followUps: ["Which gate can fail first?", "Which material is unresolved?"],
        mode: "grounded",
      }),
    });
  });

  await page.goto("/");
  await page.getByPlaceholder("Example: Trehalose Cryopreservation Study").fill("Chat Grounding Demo");
  await page
    .getByPlaceholder("Enter the intervention, outcome threshold, mechanism, and control condition...")
    .fill("Trehalose at 200 mM improves post-thaw viability of HeLa cells by at least 20% versus 10% DMSO.");
  await page.getByRole("button", { name: "Create project and generate plan" }).click();

  await page.getByRole("button", { name: "Open Scientist Copilot" }).click();
  await page.getByPlaceholder("Ask about risk, novelty, cost, or validation...").fill("Show strongest evidence-backed claim");
  await page.locator('form button[type="submit"]').click();

  await expect(page.getByText("The strongest evidence-backed claim is viability gain from trehalose against DMSO.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Trehalose study/ })).toBeVisible();
});
