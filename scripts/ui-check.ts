/**
 * Headless UI check script using Playwright.
 * Takes screenshots of all key pages, checks for console errors and color violations.
 *
 * Usage: npx tsx scripts/ui-check.ts
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chromium } = require("/opt/homebrew/lib/node_modules/playwright");
import { writeFileSync } from "fs";

const BASE = "http://localhost:3000";
const SCREENSHOT_DIR = "screenshots";

interface PageCheck {
  path: string;
  name: string;
  waitFor?: string; // CSS selector to wait for
}

const PAGES: PageCheck[] = [
  { path: "/", name: "home", waitFor: "main" },
  { path: "/bounties", name: "bounties-list", waitFor: "main" },
  { path: "/search?q=algorithm", name: "search", waitFor: "main" },
  { path: "/leaderboard", name: "leaderboard", waitFor: "main" },
];

// Allowed monochrome colors (rgb format) — light theme palette
const ALLOWED_COLORS = new Set([
  // Core palette
  "rgb(250, 250, 250)",     // --color-bg-primary #fafafa
  "rgb(245, 245, 245)",     // --color-bg-secondary #f5f5f5
  "rgb(237, 237, 237)",     // --color-bg-tertiary #ededed
  "rgb(240, 240, 240)",     // --color-bg-hover #f0f0f0
  "rgb(224, 224, 224)",     // --color-border #e0e0e0
  "rgb(200, 200, 200)",     // --color-border-light #c8c8c8
  "rgb(23, 23, 23)",        // --color-border-hover #171717
  "rgb(10, 10, 10)",        // --color-text-primary #0a0a0a
  "rgb(64, 64, 64)",        // --color-text-secondary #404040
  "rgb(115, 115, 115)",     // --color-text-muted #737373
  // Standard transparency / system values
  "rgba(0, 0, 0, 0)",       // transparent
  "rgb(0, 0, 0)",           // black
  "rgb(255, 255, 255)",     // white
  "rgba(10, 10, 10, 0.08)", // selection highlight
  // System state colors (allowed in semantic contexts only)
  "rgb(34, 197, 94)",       // --color-success #22c55e
  "rgb(239, 68, 68)",       // --color-error #ef4444
]);

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
  });

  const results: Array<{
    page: string;
    screenshot: string;
    consoleErrors: string[];
    colorViolations: Array<{ color: string; tag: string; text: string }>;
    title: string;
    status: number;
  }> = [];

  for (const check of PAGES) {
    const page = await context.newPage();
    const consoleErrors: string[] = [];

    // Capture console errors (hydration, etc.)
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    const url = `${BASE}${check.path}`;
    console.log(`Checking ${url}...`);

    const response = await page.goto(url, { waitUntil: "networkidle" });
    const status = response?.status() ?? 0;

    if (check.waitFor) {
      await page.waitForSelector(check.waitFor, { timeout: 5000 }).catch(() => {});
    }

    // Wait for hydration
    await page.waitForTimeout(1000);

    const title = await page.title();

    // Screenshot
    const screenshotPath = `${SCREENSHOT_DIR}/check-${check.name}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });

    // Color audit
    const colorViolations = await page.evaluate((allowedStr) => {
      const allowed = new Set(JSON.parse(allowedStr) as string[]);
      const violations: Array<{ color: string; tag: string; text: string }> = [];
      const seen = new Set<string>();

      for (const el of document.querySelectorAll("*")) {
        const style = getComputedStyle(el);
        const color = style.color;
        const bg = style.backgroundColor;

        for (const c of [color, bg]) {
          // Skip oklab values (browser-computed from opacity/backdrop-filter)
          if (c && !allowed.has(c) && !c.startsWith("oklab(") && !seen.has(c)) {
            seen.add(c);
            const text = (el as HTMLElement).innerText?.slice(0, 40) || "";
            violations.push({
              color: c,
              tag: el.tagName.toLowerCase(),
              text,
            });
          }
        }
      }
      return violations;
    }, JSON.stringify([...ALLOWED_COLORS]));

    results.push({
      page: check.path,
      screenshot: screenshotPath,
      consoleErrors,
      colorViolations,
      title,
      status,
    });

    await page.close();
  }

  // Now find a bounty ID and check its detail page
  const listPage = await context.newPage();
  const listConsoleErrors: string[] = [];
  listPage.on("console", (msg) => {
    if (msg.type() === "error") {
      listConsoleErrors.push(msg.text());
    }
  });

  await listPage.goto(`${BASE}/bounties`, { waitUntil: "networkidle" });
  const bountyLink = await listPage.$eval(
    'a[href^="/bounties/"]',
    (el) => (el as HTMLAnchorElement).href
  ).catch(() => null);

  if (bountyLink) {
    const bountyUrl = new URL(bountyLink);
    const detailPage = await context.newPage();
    const detailErrors: string[] = [];
    detailPage.on("console", (msg) => {
      if (msg.type() === "error") {
        detailErrors.push(msg.text());
      }
    });

    console.log(`Checking bounty detail: ${bountyUrl.pathname}...`);
    await detailPage.goto(bountyLink, { waitUntil: "networkidle" });
    await detailPage.waitForTimeout(1000);

    const detailTitle = await detailPage.title();
    await detailPage.screenshot({
      path: `${SCREENSHOT_DIR}/check-bounty-detail.png`,
      fullPage: true,
    });

    const detailViolations = await detailPage.evaluate((allowedStr) => {
      const allowed = new Set(JSON.parse(allowedStr) as string[]);
      const violations: Array<{ color: string; tag: string; text: string }> = [];
      const seen = new Set<string>();
      for (const el of document.querySelectorAll("*")) {
        const c = getComputedStyle(el).color;
        if (c && !allowed.has(c) && !seen.has(c)) {
          seen.add(c);
          violations.push({ color: c, tag: el.tagName.toLowerCase(), text: (el as HTMLElement).innerText?.slice(0, 40) || "" });
        }
      }
      return violations;
    }, JSON.stringify([...ALLOWED_COLORS]));

    results.push({
      page: bountyUrl.pathname,
      screenshot: `${SCREENSHOT_DIR}/check-bounty-detail.png`,
      consoleErrors: detailErrors,
      colorViolations: detailViolations,
      title: detailTitle,
      status: 200,
    });

    await detailPage.close();
  }

  await listPage.close();
  await browser.close();

  // Print report
  console.log("\n========== UI CHECK REPORT ==========\n");

  let hasIssues = false;

  for (const r of results) {
    const errCount = r.consoleErrors.length;
    const violCount = r.colorViolations.length;
    const statusOk = r.status >= 200 && r.status < 400;
    const icon = statusOk && errCount === 0 ? "OK" : "ISSUE";

    console.log(`[${icon}] ${r.page}`);
    console.log(`  Title: ${r.title}`);
    console.log(`  Status: ${r.status}`);
    console.log(`  Screenshot: ${r.screenshot}`);
    console.log(`  Console errors: ${errCount}`);
    if (errCount > 0) {
      hasIssues = true;
      for (const e of r.consoleErrors.slice(0, 5)) {
        console.log(`    - ${e.slice(0, 200)}`);
      }
    }
    console.log(`  Color violations: ${violCount}`);
    if (violCount > 0) {
      for (const v of r.colorViolations.slice(0, 5)) {
        console.log(`    - ${v.color} on <${v.tag}> "${v.text.slice(0, 40)}"`);
      }
    }
    console.log();
  }

  // Save JSON report
  writeFileSync(
    `${SCREENSHOT_DIR}/ui-check-report.json`,
    JSON.stringify(results, null, 2)
  );
  console.log(`Report saved to ${SCREENSHOT_DIR}/ui-check-report.json`);

  if (hasIssues) {
    console.log("\n*** ISSUES FOUND - review above ***");
    process.exit(1);
  } else {
    console.log("\n*** ALL PAGES OK ***");
  }
}

main().catch((err) => {
  console.error("UI check failed:", err);
  process.exit(1);
});
