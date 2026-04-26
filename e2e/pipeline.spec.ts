import { expect, test } from "@playwright/test";

const hypothesis =
  "Supplementing C57BL/6 mice with Lactobacillus rhamnosus GG for 4 weeks will reduce intestinal permeability by at least 30% compared to controls, measured by FITC-dextran assay, due to upregulation of tight junction proteins claudin-1 and occludin.";

test.describe("AI Scientist full pipeline", () => {
  test("shows QC before full plan and uses /api/plan only", async ({ page }) => {
    const apiCalls: string[] = [];

    page.on("request", (request) => {
      const url = request.url();
      if (url.includes("/api/")) {
        apiCalls.push(url);
      }
    });

    await page.goto("/");
    await page.evaluate(() => {
      localStorage.clear();
    });
    await page.reload();

    const openNewProject = page.getByRole("button", { name: "New Project" });
    if (await openNewProject.isVisible().catch(() => false)) {
      await openNewProject.click();
    }

    await page.getByPlaceholder("Example: Trehalose Cryopreservation Study").fill("E2E Pipeline Test");
    await page.getByPlaceholder("Enter the intervention, outcome threshold, mechanism, and control condition...").fill(hypothesis);
    await page.getByRole("button", { name: "Create project and generate plan" }).click();

    await expect(page.getByText("Literature QC · early signal")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/not found|similar work exists|exact match found/i).first()).toBeVisible();

    const planLocator = page.getByText("Protocol").first();
    const errorLocator = page.locator("section").filter({ hasText: /error|failed|rate limit|timed out|quota/i }).first();

    await Promise.race([
      planLocator.waitFor({ state: "visible", timeout: 180_000 }),
      errorLocator.waitFor({ state: "visible", timeout: 180_000 }).catch(() => Promise.resolve()),
    ]);

    if (await errorLocator.isVisible().catch(() => false)) {
      const errorText = (await errorLocator.textContent()) ?? "";
      if (/rate limit|quota|timed out|provider|429/i.test(errorText)) {
        test.skip(true, `Provider outage in browser run: ${errorText}`);
      }
      throw new Error(`Pipeline failed in browser test: ${errorText}`);
    }

    await expect(planLocator).toBeVisible();
    await expect(page.getByText("Validation", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Materials", { exact: true }).first()).toBeVisible();

    const callsJoined = apiCalls.join("\n");
    expect(callsJoined).toContain("/api/plan");
    expect(callsJoined).not.toContain("/api/experiments/plan");
  });
});
