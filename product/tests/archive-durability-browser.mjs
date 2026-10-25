import assert from 'node:assert/strict';
import { createInitialState } from '../src/data/studentModel.js';
import { normalizeLocalStudentDb } from '../src/data/localStudentDb.js';
import { hashParentPin } from '../src/services/parentAccess.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const url = process.env.TEST_URL || 'http://localhost:4173/';
const state = createInitialState(); state.uiVersion = 4;
state.profile = { ...state.profile, name: '耐久测试', configured: true, consent: true };
const db = normalizeLocalStudentDb({ studentModels: { [state.studentModel.studentId]: state.studentModel }, growthMoments: [{
  id: 'durable-one', studentId: state.studentModel.studentId, childQuote: '我喜欢画花', tutorResponse: '一起画吧'
}] });
async function setup({ active = false, width = 1280, parentPinHash = '' } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  await context.route('**/api/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await context.addInitScript(({ state, db }) => {
    if (!localStorage.getItem('durability-seeded')) {
      localStorage.setItem('xiaoyuji-learning-state-v1', JSON.stringify(state));
      localStorage.setItem('xiaoyuji-local-student-db-v1', JSON.stringify(db));
      localStorage.setItem('durability-seeded', 'yes');
    }
    window.archiveRequests = [];
    const fetch = window.fetch.bind(window);
    window.fetch = (url, options = {}) => {
      const item = { url: String(url), aborted: false, settled: false };
      window.archiveRequests.push(item);
      options.signal?.addEventListener('abort', () => { item.aborted = true; });
      return fetch(url, options).then(result => { item.settled = true; return result; }, error => { item.settled = true; throw error; });
    };
  }, { state: { ...state, profile: { ...state.profile, parentPinHash },
    ...(active ? { session: { status: 'active', id: 'archive-clear-test', turnCount: 0 } } : {}) }, db });
  const page = await context.newPage();
  await page.goto(url);
  await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
  await page.evaluate(async () => (await import('/src/services/indexedArchive.js')).flushDurableArchive());
  return { context, page };
}
try {
  {
    const { context, page } = await setup({ parentPinHash: await hashParentPin('1234') });
    await page.evaluate(() => document.querySelector('#clearData').click());
    await page.locator('#parentLock').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#clearArchiveDialog').isVisible(), false);
    await page.locator('#parentUnlockPin').fill('0000');
    await page.locator('#parentUnlockForm button[type=submit]').click();
    await page.waitForFunction(() => document.querySelector('#parentLockStatus').textContent.length > 0);
    assert.equal(await page.locator('#clearArchiveDialog').isVisible(), false);
    await page.locator('#parentUnlockPin').fill('1234');
    await page.locator('#parentUnlockForm button[type=submit]').click();
    await page.locator('#clearArchiveDialog').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('xiaoyuji-local-student-db-v1')).growthMoments.length), 1);
    await page.locator('#clearArchiveDialog').getByRole('button', { name: '保留资料' }).click();
    console.log('PASS clear confirmation requires the configured parent PIN even when invoked directly');
    await context.close();
  }
  for (const width of [390, 1440]) {
    const { context, page } = await setup({ width });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    if (width <= 900) {
      await page.locator('#mobileMenuButton').click();
      await page.locator('#mobileDrawer [data-nav-action=backup]').click();
    } else await page.locator('#desktopNavigation [data-nav-action=backup]').click();
    await page.locator('.memory-settings summary').click();
    const readRaw = () => page.evaluate(() => Object.fromEntries([
      'xiaoyuji-learning-state-v1', 'xiaoyuji-local-student-db-v1', 'xiaoyuji-archive-revision-v1'
    ].map(key => [key, localStorage.getItem(key)])));
    const original = await readRaw();
    const dialog = page.locator('#clearArchiveDialog');
    await page.locator('#clearData').click();
    await dialog.waitFor({ state: 'visible' });
    assert.deepEqual(await readRaw(), original);
    assert.equal(await dialog.getByRole('button', { name: '保留资料' }).evaluate(el => el === document.activeElement), true);
    await page.screenshot({ path: `screenshots/archive-clear-${width}.png` });
    const bounds = await dialog.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.deepEqual(await readRaw(), original);
    await page.waitForFunction(() => document.activeElement.id === 'clearData');
    // A submit without an open, confirmed dialog must never clear anything.
    await page.evaluate(() => document.querySelector('#clearArchiveForm').requestSubmit());
    assert.deepEqual(await readRaw(), original);
    await page.locator('#clearData').click();
    await dialog.getByRole('button', { name: '保留资料' }).click();
    assert.deepEqual(await readRaw(), original);
    await page.locator('#clearData').click();
    await page.evaluate(() => {
      const key = 'xiaoyuji-local-student-db-v1';
      const db = JSON.parse(localStorage.getItem(key));
      db.growthMoments[0].parentNote = '确认期间新增的观察';
      localStorage.setItem(key, JSON.stringify(db));
    });
    const changed = await readRaw();
    await dialog.getByRole('button', { name: '确认清空' }).click();
    assert.match(await page.locator('#clearArchiveStatus').textContent(), /变化/);
    assert.deepEqual(await readRaw(), changed);
    await dialog.getByRole('button', { name: '保留资料' }).click();
    await page.locator('#clearData').click();
    await page.evaluate(() => {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'xiaoyuji-archive-transaction-v1') {
          Storage.prototype.setItem = set;
          throw new DOMException('Synthetic clear failure', 'QuotaExceededError');
        }
        return set.call(this, key, value);
      };
    });
    await dialog.getByRole('button', { name: '确认清空' }).click();
    assert.match(await page.locator('#clearArchiveStatus').textContent(), /尚未修改/);
    assert.deepEqual(await readRaw(), changed);
    assert.equal(await dialog.isVisible(), true);
    await dialog.getByRole('button', { name: '确认清空' }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement.id === 'startChildName');
    const cleared = await readRaw();
    assert.equal(JSON.parse(cleared['xiaoyuji-learning-state-v1']).profile.configured, false);
    assert.equal(cleared['xiaoyuji-local-student-db-v1'], null);
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: clear confirmation, keyboard cancellation, changed-data rejection and failed-clear retry`);
    await context.close();
  }
  {
    const { context, page } = await setup();
    const result = await page.evaluate(async () => {
      const durable = await import('/src/services/indexedArchive.js');
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function () { throw new DOMException('Synthetic quota', 'QuotaExceededError'); };
      try { await durable.scheduleDurableArchive(localStorage); }
      finally { IDBObjectStore.prototype.put = put; }
      const failed = durable.getDurableArchiveStatus();
      const warned = !document.querySelector('#durableStorageWarning').hidden;
      const retained = JSON.parse(localStorage.getItem('xiaoyuji-local-student-db-v1')).growthMoments.length;
      await durable.scheduleDurableArchive(localStorage);
      return { failed, warned, retained, recovered: durable.getDurableArchiveStatus(), hidden: document.querySelector('#durableStorageWarning').hidden };
    });
    assert.equal(result.failed.status, 'error');
    assert.equal(result.warned, true); assert.equal(result.retained, 1);
    assert.equal(result.recovered.status, 'saved'); assert.equal(result.hidden, true);
    console.log('PASS durable quota failure is visible, primary records survive, later writes recover');
    await context.close();
  }
  {
    const { context, page } = await setup();
    const stale = await context.newPage();
    // Delay the notification deliberately; correctness must not rely on its timely delivery.
    await stale.addInitScript(() => addEventListener('storage', event => event.stopImmediatePropagation(), true));
    await stale.goto(url); await stale.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
    await page.evaluate(async () => {
      const { commitArchivePair } = await import('/src/services/localPersistence.js');
      const state = JSON.parse(localStorage.getItem('xiaoyuji-learning-state-v1'));
      const db = JSON.parse(localStorage.getItem('xiaoyuji-local-student-db-v1'));
      db.growthMoments = []; db.studentModels = {};
      commitArchivePair(localStorage, state, db);
    });
    const blocked = await stale.evaluate(async () => {
      const { persistStudentModel } = await import('/src/data/localStudentDb.js');
      const { saveState } = await import('/src/services/storage.js');
      const state = JSON.parse(localStorage.getItem('xiaoyuji-learning-state-v1'));
      let rejected = 0;
      try { persistStudentModel(state.studentModel); } catch { rejected++; }
      try { saveState(state); } catch { rejected++; }
      return { rejected, db: JSON.parse(localStorage.getItem('xiaoyuji-local-student-db-v1')) };
    });
    assert.equal(blocked.rejected, 2);
    assert.equal(blocked.db.growthMoments.length, 0);
    assert.deepEqual(blocked.db.studentModels, {});
    console.log('PASS second tab cannot rewrite model or state after archive replacement, without storage notification');
    await context.close();
  }
  {
    const { context, page } = await setup();
    await page.evaluate(async () => {
      const { clearState } = await import('/src/services/storage.js');
      const durable = await import('/src/services/indexedArchive.js');
      const remove = IDBObjectStore.prototype.delete;
      IDBObjectStore.prototype.delete = function () { throw new DOMException('Synthetic interruption', 'AbortError'); };
      try { clearState(); await durable.flushDurableArchive(); }
      finally { IDBObjectStore.prototype.delete = remove; }
      if (durable.getDurableArchiveStatus().status !== 'error') throw new Error('Failure injection did not execute');
    });
    await page.reload(); await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
    const cleared = await page.evaluate(() => ({ state: JSON.parse(localStorage.getItem('xiaoyuji-learning-state-v1')), db: localStorage.getItem('xiaoyuji-local-student-db-v1') }));
    assert.equal(cleared.state.profile.configured, false);
    assert.equal(cleared.db, null);
    console.log('PASS interrupted durable deletion cannot resurrect cleared records on reload');
    await context.close();
  }
  {
    const { context, page } = await setup({ active: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/whiteboard/route') return route.fulfill({ json: { mode: 'chat' } });
      if (path === '/api/tutor/quick') return route.fulfill({ json: { reply: '你给大家讲了今天的发现。', llmStatus: { used: true } } });
      if (path.startsWith('/api/speech')) return route.fulfill({ status: 503, body: 'Synthetic speech unavailable' });
      if (path === '/api/tutor') {
        await gate;
        const body = route.request().postDataJSON();
        return route.fulfill({ json: { ...body.state, growthEvidence: { shouldSave: true, sourceQuote: body.input, topics: ['发现'], domains: ['explore'] } } });
      }
      return route.fulfill({ json: {} });
    });
    await page.evaluate(() => {
      window.failedMomentWrites = 0;
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'xiaoyuji-local-student-db-v1' && JSON.parse(value).growthMoments.length > 1) {
          Storage.prototype.setItem = set;
          window.failedMomentWrites++;
          throw new DOMException('Synthetic first-save failure', 'QuotaExceededError');
        }
        return set.call(this, key, value);
      };
      document.querySelector('#childInput').value = '我今天在公园有一个新发现';
      document.querySelector('#askForm').requestSubmit();
    });
    await page.waitForFunction(() => window.archiveRequests.some(item => item.url.endsWith('/api/tutor') && !item.settled));
    assert.equal(await page.evaluate(() => window.failedMomentWrites), 1);
    assert.equal(await page.locator('#storageWarning').isVisible(), true);
    release();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('xiaoyuji-learning-state-v1')).llmStatus?.stage === 'complete');
    const retained = await page.evaluate(() => JSON.parse(localStorage.getItem('xiaoyuji-local-student-db-v1')).growthMoments);
    assert.deepEqual(retained.map(item => item.id), ['durable-one']);
    assert.deepEqual(errors, []);
    console.log('PASS failed first moment save is visible and enrichment cannot create a replacement moment');
    await context.close();
  }
  for (const stage of ['quick', 'speech']) {
    const { context, page } = await setup({ active: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/whiteboard/route') return route.fulfill({ json: { mode: 'chat' } });
      if (path === '/api/tutor/quick') {
        if (stage === 'quick') await gate;
        return route.fulfill({ json: { reply: '你想和我分享今天的事情呀。', llmStatus: { used: true } } });
      }
      if (path.startsWith('/api/speech')) {
        if (stage === 'speech') await gate;
        return route.fulfill({ status: 503, body: 'Synthetic speech unavailable' });
      }
      return route.fulfill({ json: {} });
    });
    await page.evaluate(() => {
      document.querySelector('#childInput').value = '我今天有一件开心的事情';
      document.querySelector('#askForm').requestSubmit();
    });
    const target = stage === 'quick' ? '/api/tutor/quick' : '/api/speech';
    await page.waitForFunction(target => window.archiveRequests.some(item => item.url.includes(target) && !item.settled), target);
    await page.evaluate(() => document.querySelector('#clearData').click());
    await page.locator('#clearArchiveForm button[type=submit]').click();
    const stopped = await page.evaluate(target => ({
      cancelled: window.archiveRequests.some(item => item.url.includes(target) && item.aborted),
      state: JSON.parse(localStorage.getItem('xiaoyuji-learning-state-v1')),
      db: localStorage.getItem('xiaoyuji-local-student-db-v1')
    }), target);
    release();
    assert.equal(stopped.cancelled, true, `Clearing data must abort pending ${stage}`);
    assert.equal(stopped.state.profile.configured, false);
    assert.equal(stopped.state.session.status, 'idle');
    assert.equal(stopped.db, null);
    await page.waitForFunction(target => window.archiveRequests.filter(item => item.url.includes(target)).every(item => item.settled), target);
    await page.evaluate(async () => (await import('/src/services/indexedArchive.js')).flushDurableArchive());
    assert.equal(await page.evaluate(() => localStorage.getItem('xiaoyuji-local-student-db-v1')), null);
    assert.deepEqual(errors, []);
    console.log(`PASS clearing data cancels pending ${stage} and rejects late work`);
    await context.close();
  }
} finally { await browser.close(); }
