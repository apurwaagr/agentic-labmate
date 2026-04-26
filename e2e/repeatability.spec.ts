import { expect, test } from "@playwright/test";

const hypothesis =
  "Replacing sucrose with trehalose as a cryoprotectant in the freezing medium will increase post-thaw viability of HeLa cells by at least 15 percentage points compared to the standard DMSO protocol, due to trehalose's superior membrane stabilization at low temperatures.";

test("repeatability smoke: two consecutive runs complete", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.reload();

  for (let run = 0; run < 2; run += 1) {
    const openNewProject = page.getByRole("button", { name: "New Project" });
    if (await openNewProject.isVisible().catch(() => false)) {
      await openNewProject.click();
    }
    await page.getByPlaceholder("Example: Trehalose Cryopreservation Study").fill(`Repeatability Run ${run + 1}`);
    await page.getByPlaceholder("Enter the intervention, outcome threshold, mechanism, and control condition...").fill(hypothesis);
    await page.getByRole("button", { name: "Create project and generate plan" }).click();

    await expect(page.getByText("Literature QC · early signal")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Run Planning Agent" })).toBeVisible({ timeout: 180_000 });

    if (run === 0) {
      await page.getByRole("button", { name: "New Project" }).click();
    }
  }
});
