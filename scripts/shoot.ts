/**
 * Screenshot every surface, for looking at the thing rather than the markup.
 *
 * Dev-only. Not part of any build, and not something the app depends on.
 *
 *   npx tsx scripts/shoot.ts [outDir] [baseUrl]
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright";

const OUT = process.argv[2] ?? join(process.cwd(), ".shots");
const BASE = process.argv[3] ?? "http://localhost:3000";

const SHOTS: Array<{ name: string; path: string; full?: boolean; wait?: number }> = [
  { name: "01-landing-hero", path: "/", wait: 2500 },
  { name: "02-landing-full", path: "/", full: true, wait: 2500 },
  { name: "03-dashboard", path: "/dashboard", full: true, wait: 1800 },
  { name: "04-signals", path: "/signals", full: true, wait: 1800 },
  { name: "05-protection", path: "/protection", full: true, wait: 1800 },
  { name: "06-console", path: "/console", full: true, wait: 1800 },
    // Takes a bare id, not a path: MSYS bash rewrites a leading slash in an
  // env var into a Windows path before tsx ever sees it.
  { name: "08-incident", path: `/incident/${process.env.INCIDENT_ID ?? "none"}`, full: true, wait: 2000 },
];

async function shoot(page: Page, s: (typeof SHOTS)[number], suffix = "") {
  await page.goto(`${BASE}${s.path}`, { waitUntil: "networkidle", timeout: 45_000 }).catch(() => {});
  await page.waitForTimeout(s.wait ?? 1200);
  await page.screenshot({
    path: join(OUT, `${s.name}${suffix}.png`),
    fullPage: Boolean(s.full),
  });
  console.log(`  ${s.name}${suffix}`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  console.log("desktop 1440x900");
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desktop.newPage();
  page.on("pageerror", (e) => console.error(`  ! page error: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") console.error(`  ! console: ${m.text().slice(0, 200)}`);
  });
  for (const s of SHOTS) await shoot(page, s);
  await desktop.close();

  console.log("mobile 390x844");
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mpage = await mobile.newPage();
  for (const s of SHOTS.filter((s) => ["02-landing-full", "04-signals", "05-protection"].includes(s.name))) {
    await shoot(mpage, s, "-mobile");
  }
  await mobile.close();

  await browser.close();
  console.log(`\nwritten to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
