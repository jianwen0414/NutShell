/**
 * Drive the operator controls through the actual browser, and record what a
 * presenter would see.
 *
 * Not a test suite — a rehearsal. It clicks the real buttons on /dashboard,
 * watches the six stage cards appear, and prints a timeline with wall-clock
 * offsets so the demo can be scripted against real durations rather than
 * guessed ones.
 *
 *   npx tsx scripts/drive-demo.ts [--scenario scen_bridge_exploit] [--bypass]
 */
import { chromium, type Page } from 'playwright';
import { loadEnv } from '../lib/env';

loadEnv();

const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const scenario = flag('scenario') ?? 'scen_bridge_exploit';
const bypass = args.includes('--bypass');
const BASE = flag('base') ?? 'http://localhost:3000';
const TOKEN = process.env.OPERATOR_TOKEN ?? '';

const STAGES = [
  '01 Detect',
  '02 Investigate',
  '03 Analyze',
  '04 Challenge',
  '05 Decide',
  '06 Protect',
];

async function main() {
  if (!TOKEN) throw new Error('OPERATOR_TOKEN is not set');

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page: Page = await ctx.newPage();

  page.on('pageerror', (e) => console.error(`  ! page error: ${e.message}`));

  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  // The token lives in sessionStorage; seed it the way the console would.
  await page.evaluate((t) => sessionStorage.setItem('nutshell_operator_token', t), TOKEN);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  console.log(`\n═══ DRIVING /dashboard ═══`);
  console.log(`  scenario : ${scenario}`);
  console.log(`  mode     : ${bypass ? 'BYPASS STAGE 02' : 'FULL PIPELINE'}\n`);

  // Operator strip auto-opens when a token is present; open it if not.
  const showBtn = page.getByRole('button', { name: /Show ▼/ }).first();
  if (await showBtn.isVisible().catch(() => false)) {
    await showBtn.click();
    await page.waitForTimeout(300);
  }

  await page.selectOption('select', scenario).catch(() => {
    console.log('  ! scenario select not found');
  });

  const button = bypass
    ? page.getByRole('button', { name: /BYPASS STAGE 02/ })
    : page.getByRole('button', { name: /INJECT — FULL PIPELINE/ });

  const t0 = Date.now();
  const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

  await button.click();
  console.log(`  ${at().padStart(7)}  clicked`);

  const seen = new Set<string>();
  const deadline = Date.now() + 180_000;

  while (Date.now() < deadline && seen.size < STAGES.length) {
    for (const s of STAGES) {
      if (seen.has(s)) continue;
      const found = await page
        .locator(`text=${s}`)
        .first()
        .isVisible()
        .catch(() => false);
      if (found) {
        seen.add(s);
        console.log(`  ${at().padStart(7)}  ${s} card on screen`);
      }
    }
    // The verdict cards are the moment the audience cares about.
    const verdicts = await page.locator('text=/\\/ 100/').count().catch(() => 0);
    if (verdicts > 0 && !seen.has('verdicts')) {
      seen.add('verdicts');
      console.log(`  ${at().padStart(7)}  first model score visible`);
    }
    await page.waitForTimeout(700);
  }

  await page.waitForTimeout(6000);
  await page.screenshot({ path: `.shots/demo-${bypass ? 'bypass' : 'full'}.png`, fullPage: true });

  const jobId = await page.evaluate(() => sessionStorage.getItem('nutshell_active_job'));
  console.log(`\n  total     ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`  job       ${jobId ?? '(finished, cleared)'}`);
  console.log(`  shot      .shots/demo-${bypass ? 'bypass' : 'full'}.png\n`);

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
