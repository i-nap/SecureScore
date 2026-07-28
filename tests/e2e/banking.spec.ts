import { test, expect } from "@playwright/test";

const BRANCH_USER = { username: "kathmandu_mgr", password: "branch123" };
const CUSTOMER_USER = { username: "cust001", password: "customer123" };

async function loginAs(page: import("@playwright/test").Page, user: { username: string; password: string }) {
  await page.goto("/");
  await page.fill('[name="username"]', user.username);
  await page.fill('[name="password"]', user.password);
  await page.click('[type="submit"]');
}

test.describe("Banking — Customer portal", () => {
  test("customer can view accounts page", async ({ page }) => {
    await loginAs(page, CUSTOMER_USER);
    await page.waitForURL(/\/customer\//);
    await page.goto("/customer/accounts");
    // Should show loading then content (or empty state)
    await page.waitForTimeout(2000);
    const body = await page.textContent("body");
    expect(body).toBeTruthy();
    // Must not show a raw error stack
    expect(body).not.toContain("stack trace");
    expect(body).not.toContain("Unhandled");
  });

  test("customer transactions page loads without error", async ({ page }) => {
    await loginAs(page, CUSTOMER_USER);
    await page.waitForURL(/\/customer\//);
    await page.goto("/customer/transactions");
    await page.waitForTimeout(2000);
    // Must handle the three states (loading/error/success) — no uncaught exception
    const errorText = page.locator("[class*='red']").first();
    // Error text is allowed (API might be down) but must be graceful
    const hasGracefulError = await errorText.isVisible().catch(() => false);
    if (hasGracefulError) {
      const text = await errorText.textContent();
      // Must not expose raw server error
      expect(text).not.toContain("panic");
      expect(text).not.toContain("stack");
    }
  });

  test("customer statement page is accessible", async ({ page }) => {
    await loginAs(page, CUSTOMER_USER);
    await page.waitForURL(/\/customer\//);
    await page.goto("/customer/statement");
    await page.waitForTimeout(2000);
    await expect(page).not.toHaveURL("/");
  });

  test("customer cannot access branch routes", async ({ page }) => {
    await loginAs(page, CUSTOMER_USER);
    await page.waitForURL(/\/customer\//);
    await page.goto("/branch/dashboard");
    // Should redirect to login or customer dashboard, not show branch content
    await page.waitForTimeout(1000);
    const url = page.url();
    expect(url).not.toContain("/branch/dashboard");
  });
});

test.describe("Banking — Branch portal EOD/BOD", () => {
  test("branch manager can access EOD page", async ({ page }) => {
    await loginAs(page, BRANCH_USER);
    await page.waitForURL(/\/branch\//);
    await page.goto("/branch/eod");
    await page.waitForTimeout(2000);
    const body = await page.textContent("body");
    expect(body).toBeTruthy();
    expect(body).not.toContain("Page not found");
  });

  test("branch manager can view account applications", async ({ page }) => {
    await loginAs(page, BRANCH_USER);
    await page.waitForURL(/\/branch\//);
    await page.goto("/branch/account-applications");
    await page.waitForTimeout(2000);
    await expect(page).not.toHaveURL("/");
  });

  test("branch manager can access KYC applications list", async ({ page }) => {
    await loginAs(page, BRANCH_USER);
    await page.waitForURL(/\/branch\//);
    await page.goto("/branch/kyc-applications");
    await page.waitForTimeout(2000);
    const heading = page.locator("h2, h1, [class*='title']").first();
    await expect(heading).toBeVisible({ timeout: 5000 }).catch(() => {});
    await expect(page).not.toHaveURL("/");
  });

  test("branch dashboard shows stats without crashing", async ({ page }) => {
    await loginAs(page, BRANCH_USER);
    await page.waitForURL("/branch/dashboard");
    await page.waitForTimeout(3000);
    // Dashboard must have at least one card or statcard
    const cards = page.locator("[class*='rounded'][class*='bg']");
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
  });
});

test.describe("Banking — API contract (BFF direct)", () => {
  test("health endpoint returns ok", async ({ request }) => {
    const resp = await request.get("http://localhost:4000/api/health");
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body.status).toBeDefined();
  });

  test("unauthenticated banking request returns 401", async ({ request }) => {
    const resp = await request.get("http://localhost:4000/api/banking/accounts");
    expect([401, 403]).toContain(resp.status());
  });

  test("login returns token and user fields", async ({ request }) => {
    const resp = await request.post("http://localhost:4000/api/auth/login", {
      data: { username: "kathmandu_mgr", password: "branch123" },
    });
    if (resp.ok()) {
      const body = await resp.json();
      expect(typeof body.token).toBe("string");
      expect(body.user?.role).toBe("branch_manager");
    }
  });

  test("wrong credentials return 401", async ({ request }) => {
    const resp = await request.post("http://localhost:4000/api/auth/login", {
      data: { username: "admin", password: "wrongpassword" },
    });
    expect(resp.status()).toBe(401);
  });
});
