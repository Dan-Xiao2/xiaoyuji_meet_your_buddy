import assert from 'node:assert/strict';
import { createInitialState } from '../src/data/studentModel.js';
import { normalizeLocalStudentDb } from '../src/data/localStudentDb.js';
import { createLocalArchiveExport } from '../src/services/storage.js';
import { STATE_KEY, DB_KEY } from '../src/services/localPersistence.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const state = createInitialState();
state.uiVersion = 4;
state.profile = { ...state.profile, name: '恢复测试', configured: true, consent: true, consentVersion: 2 };
const db = normalizeLocalStudentDb({ studentModels: { [state.studentModel.studentId]: state.studentModel }, growthMoments: [{
  id: 'recovery-one', studentId: state.studentModel.studentId, childQuote: '我想画一朵花', tutorResponse: '一起画吧', topics: ['花'], domain: 'art'
}] });
const backup = JSON.stringify(createLocalArchiveExport(state, db));
try {
  for (const { width, damagedJournal } of [390, 1440].flatMap(width => [false, true].map(damagedJournal => ({ width, damagedJournal })))) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
    const page = await context.newPage();
    const errors = [], apiRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => { apiRequests.push(route.request().url()); return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); });
    const originalState = damagedJournal ? JSON.stringify(state) : 'damaged-original';
    await page.addInitScript(({ stateKey, dbKey, db, originalState, damagedJournal }) => {
      if (!sessionStorage.getItem('seeded-recovery')) {
        localStorage.setItem(stateKey, originalState);
        localStorage.setItem(dbKey, JSON.stringify(db));
        if (damagedJournal) localStorage.setItem('xiaoyuji-archive-transaction-v1', 'broken-journal');
        sessionStorage.setItem('seeded-recovery', 'yes');
      }
    }, { stateKey: STATE_KEY, dbKey: DB_KEY, db, originalState, damagedJournal });
    await page.goto(process.env.TEST_URL || 'http://localhost:4173/');
    await page.locator('#archiveRecovery').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.workspace').isVisible(), false);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), STATE_KEY), originalState);
    assert.deepEqual(apiRequests, []);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `screenshots/archive-recovery-${width}${damagedJournal ? '-journal' : ''}.png` });
    const downloading = page.waitForEvent('download');
    await page.locator('[data-recovery-download]').click();
    const download = await downloading;
    const chunks = []; for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    const raw = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(raw.storage[STATE_KEY], originalState);
    if (damagedJournal) assert.equal(raw.storage['xiaoyuji-archive-transaction-v1'], 'broken-journal');
    assert.equal(JSON.parse(raw.storage[DB_KEY]).growthMoments.length, 1);
    const input = page.locator('#archiveRecovery input[type=file]');
    await input.setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
    await page.waitForFunction(() => document.querySelector('#archiveRecovery [role=status]').textContent.includes('完整备份'));
    assert.equal(await page.locator('[data-recovery-confirm]').isVisible(), false);
    await input.setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(backup) });
    await page.locator('[data-recovery-confirm]').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(key => localStorage.getItem(key), STATE_KEY), originalState);
    await page.locator('[data-recovery-consent]').check();
    if (damagedJournal) {
      await page.evaluate(dbKey => {
        const set = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (key === dbKey) {
            Storage.prototype.setItem = set;
            throw new DOMException('Simulated quota failure', 'QuotaExceededError');
          }
          return set.call(this, key, value);
        };
      }, DB_KEY);
      await page.locator('[data-recovery-confirm] button').click();
      await page.waitForFunction(() => document.querySelector('#archiveRecovery [role=status]').textContent.includes('保存失败'));
      assert.deepEqual(await page.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), Object.keys(raw.storage)), raw.storage);
    }
    await page.locator('[data-recovery-confirm] button').click();
    await page.locator('#archiveRecovery').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.querySelector('#desktopNavigation').children.length > 0);
    assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).growthMoments.length, DB_KEY), 1);
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px ${damagedJournal ? 'journal with failed-write retry' : 'state'}: originals retained, no API startup, raw download, rejected file, confirmed restore`);
    await context.close();
  }
} finally { await browser.close(); }
