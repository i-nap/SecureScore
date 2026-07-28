import { test, expect } from "@playwright/test";

test.describe("Authentication flows", () => {
  test("admin login redirects to HQ dashboard", async ({ page }) => {
    await page.goto("/");
    await page.fill('[name="username"], input[placeholder*="username" i], input[type="text"]', "admin");
    await page.fill('[name="password"], input[type="password"]', "admin123");
    await page.click('[type="submit"], button:has-text("Login"), button:has-text("Sign in")');
    await page.waitForURL(/\/hq/, { timeout: 10000 });
    await expect(page).toHaveURL(/\/hq/);
  });

  test("branch manager login redirects to branch dashboard", async ({ page }) => {
    await page.goto("/");
    await page.fill('input[type="text"], [name="username"]', "kathmandu_mgr");
    await page.fill('input[type="password"]', "branch123");
    await page.click('[type="submit"]');
    await page.waitForURL(/\/branch/, { timeout: 10000 });
    await expect(page).toHaveURL(/\/branch/);
  });

  test("customer login redirects to customer dashboard", async ({ page }) => {
    await page.goto("/");
    await page.fill('input[type="text"], [name="username"]', "cust001");
    await page.fill('input[type="password"]', "customer123");
    await page.click('[type="submit"]');
    await page.waitForURL(/\/customer/, { timeout: 10000 });
    await expect(page).toHaveURL(/\/customer/);
  });

  test("wrong password shows error message", async ({ page }) => {
    await page.goto("/");
    await page.fill('input[type="text"], [name="username"]', "admin");
    await page.fill('input[type="password"]', "wrongpassword");
    await page.click('[type="submit"]');
    // Should stay on login page and show an error
    await page.waitForTimeout(2000);
    await expect(page).toHaveURL("/");
    const errorVisible = await page.locator(
      '[class*="error"], [class*="red"], [class*="danger"], [role="alert"]'
    ).first().isVisible().catch(() => false);
    expect(errorVisible || await page.locator("text=/invalid|incorrect|wrong|failed/i").isVisible()).toBeTruthy();
  });

  test("logout clears session and redirects to login", async ({ page }) => {
    // Login first
    await page.goto("/");
    await page.fill('input[type="text"], [name="username"]', "admin");
    await page.fill('input[type="password"]', "admin123");
    await page.click('[type="submit"]');
    await page.waitForURL(/\/hq/, { timeout: 10000 });

    // Click logout
    const logoutBtn = page.locator('button:has-text("Logout"), a:has-text("Logout"), button:has-text("Sign out")');
    await logoutBtn.click();
    await page.waitForURL("/", { timeout: 5000 });
    await expect(page).toHaveURL("/");
  });

  test("unauthenticated user cannot access dashboard", async ({ page }) => {
    await page.goto("/hq/dashboard");
    // Should redirect to login
    await page.waitForURL("/", { timeout: 5000 });
    await expect(page).toHaveURL("/");
  });
});
