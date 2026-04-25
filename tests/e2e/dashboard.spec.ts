import { expect, test } from "@playwright/test";

test("dashboard smoke test", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "agent-fleet" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expect(page.getByLabel("Repository root path")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add repository" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Task Queue" })).toBeVisible();
  await expect(page.getByPlaceholder("Task title")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Remote Nodes" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add remote node" })).toBeVisible();
});
