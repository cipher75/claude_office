import { expect, test } from "@playwright/test";

test("사무실 화면이 열리고 제목이 보인다", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("오늘의 사무실");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("오늘의 사무실");
});
