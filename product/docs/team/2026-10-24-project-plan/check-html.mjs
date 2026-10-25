import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { writeFile, access } from 'node:fs/promises';
import { resolveBrowserExecutable } from '../../../scripts/browser-runtime.mjs';
import { outputFolder } from './planning-data.mjs';

const root = new URL('../../../', import.meta.url);
const { chromium } = createRequire(new URL('package.json', root))('playwright');
const base = new URL(`${outputFolder}/`, root);
const browser = await chromium.launch({ executablePath: await resolveBrowserExecutable({ chromium }), headless: true });
const errors = [], requests = [];
try {
  for (const width of [1440, 768, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    await page.goto(new URL('小宇记团队启动会议.html', base).href);
    for (const id of ['overview', 'system', 'tasks', 'release', 'weekly']) {
      await page.locator(`[data-view="${id}"]`).click();
      assert.equal(await page.locator('.panel:visible').count(), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}-${id} overflow`);
      if (width === 1440 || width === 390) await page.screenshot({ path: fileURLToPath(new URL(`qa/html-${width}-${id}.png`, base)), fullPage: true });
    }
    await page.locator('[data-view="tasks"]').click();
    await page.locator('#search').fill('VOICE-01');
    const target = page.locator('details.task').filter({ has: page.locator('summary > .task-id').filter({ hasText: /^VOICE-01$/ }) });
    assert.equal(await target.count(), 1);
    assert.equal(await target.isVisible(), true);
    assert.ok(await page.locator('details.task:visible').count() >= 1);
    await target.locator('summary').click();
    assert.match(await target.innerText(), /阶段耗时/);
    await page.locator('#search').fill('');
    await page.locator('#domainFilter').selectOption('AI');
    assert.equal(await page.locator('details.task:visible').count(), 7);
    await page.locator('#phaseFilter').selectOption('G1核心体验');
    assert.equal(await page.locator('details.task:visible').count(), 6);
    await page.locator('#search').fill('no-such-task');
    assert.equal(await page.locator('#taskCount').textContent(), '0 项');
    await page.locator('#tab-overview').click();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#system').isVisible(), true);
    await page.close();
  }
  for (const filename of ['小宇记团队开发计划与跟进.xlsx', '行动跟踪_飞书导入.csv', '任务验收_飞书导入.csv', '会议与执行说明.md']) await access(new URL(filename, base));
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  await writeFile(new URL('qa/html-verification.json', base), JSON.stringify({ views: 15, screenshots: 10, searchAndFilters: true, details: true, keyboardNavigation: true, pageErrors: errors, httpRequests: requests }, null, 2));
  console.log('PASS: 15 responsive views, full-text search including dependencies, details, combined filters, keyboard navigation and local links; no page errors or HTTP requests.');
} finally { await browser.close(); }
