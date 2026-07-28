import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

interface PortalConfig {
  user: string;
  pass: string;
  urlPattern: RegExp;
  name: string;
}

const portals: PortalConfig[] = [
  { user: "admin",         pass: "admin123",    urlPattern: /\/hq/,      name: "HQ Admin" },
  { user: "kathmandu_mgr", pass: "branch123",   urlPattern: /\/branch/,  name: "Branch Manager" },
  { user: "cust001",       pass: "customer123", urlPattern: /\/customer/, name: "Customer" },
];

async function login(page: Parameters<typeof test>[1]["page"], user: string, pass: string, urlPattern: RegExp) {
  await page.goto("/");
  await page.fill('input[type="text"], [name="username"]', user);
  await page.fill('input[type="password"]', pass);
  await page.click('[type="submit"]');
  await page.waitForURL(urlPattern, { timeout: 10000 });
}

for (const portal of portals) {
  test(`${portal.name} dashboard — zero critical axe violations`, async ({ page }) => {
    await login(page, portal.user, portal.pass, portal.urlPattern);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    const criticals = results.violations.filter(v => v.impact === "critical");
    if (criticals.length > 0) {
      const ids = criticals.map(v => `${v.id}: ${v.description}`).join("\n");
      expect.soft(criticals, `Critical a11y violations in ${portal.name}:\n${ids}`).toHaveLength(0);
    }
  });

  test(`${portal.name} dashboard — interactive elements are keyboard-accessible`, async ({ page }) => {
    await login(page, portal.user, portal.pass, portal.urlPattern);

    // Tab through and verify at least 3 focusable elements
    let focusCount = 0;
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(() => document.activeElement?.tagName?.toLowerCase());
      if (focused && focused !== "body") focusCount++;
    }
    expect(focusCount).toBeGreaterThan(2);
  });
}

test("Login page — zero critical axe violations", async ({ page }) => {
  await page.goto("/");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const criticals = results.violations.filter(v => v.impact === "critical");
  expect(criticals, `Critical violations: ${criticals.map(v => v.id).join(", ")}`).toHaveLength(0);
});
