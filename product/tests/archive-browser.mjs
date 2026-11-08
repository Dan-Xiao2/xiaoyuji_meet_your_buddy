import assert from 'node:assert/strict';
import { createInitialState } from '../src/data/studentModel.js';
import { normalizeLocalStudentDb } from '../src/data/localStudentDb.js';
import { createInitialFamily } from '../src/data/familyModel.js';
import { createLocalArchiveExport } from '../src/services/storage.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({headless:true, ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {})});
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({viewport:{width,height:900}, acceptDownloads:true});
    const page = await context.newPage();
    const errors=[]; page.on('pageerror', error=>errors.push(error.message));
    await page.route('**/api/**', route=>route.fulfill({status:200,contentType:'application/json',body:'{}'}));
    const state = createInitialState(); state.uiVersion=4;
    state.profile={...state.profile,name:'测试孩子',configured:true,consent:true,consentVersion:2};
    state.studentModel.profile.nickname='测试孩子';
    state.family=createInitialFamily(state.profile);
    const date=new Date().toISOString();
    const db=normalizeLocalStudentDb({studentModels:{[state.studentModel.studentId]:state.studentModel},growthMoments:[
      {id:'one',studentId:state.studentModel.studentId,childQuote:'我想去公园',tutorResponse:'一起看看吧',topics:['公园'],domain:'explore',createdAt:date,observedAt:date},
      {id:'two',studentId:state.studentModel.studentId,childQuote:'我喜欢画画',tutorResponse:'想画什么呢',topics:['画画'],domain:'art',createdAt:date,observedAt:date}
    ]});
    await page.addInitScript(({state,db})=>{
      if(!localStorage.getItem('xiaoyuji-learning-state-v1')) {
        localStorage.setItem('xiaoyuji-learning-state-v1',JSON.stringify(state));
        localStorage.setItem('xiaoyuji-local-student-db-v1',JSON.stringify(db));
      }
    },{state,db});
    const navigate=async(action)=>{
      // From the child's screen, the parent button (keyboard activation enters directly) opens the parent area.
      await page.waitForFunction(()=>document.documentElement.dataset.appReady==='true');
      if(action!=='talk'&&await page.locator('#parentEntry').isVisible()) await page.locator('#parentEntry').press('Enter');
      await page.locator(`[data-nav-action="${action}"]:visible`).click();
    };
    const stored=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('xiaoyuji-local-student-db-v1')));
    await page.goto(process.env.TEST_URL || 'http://localhost:4173/');
    await navigate('backup');
    await page.locator('[data-memory-action="edit"][data-moment-id="one"]').click();
    await page.locator('#momentEditor [name="childQuote"]').fill('我想去看花');
    await page.locator('#momentEditor [name="parentNote"]').fill('这是家长修正的记录');
    await page.locator('#momentEditor [name="parentConfirmed"]').check();
    await page.screenshot({path:`screenshots/archive-editor-${width}.png`});
    assert.ok(await page.locator('#momentEditor').evaluate(el=>el.scrollWidth<=el.clientWidth));
    await page.locator('#momentEditor button[type="submit"]').click();
    await page.locator('#momentEditor').waitFor({state:'hidden'});
    assert.equal((await stored()).growthMoments[0].childQuote,'我想去看花');
    await page.locator('[data-memory-action="edit"][data-moment-id="one"]').click();
    await page.locator('#momentEditor [name="reviewEligible"]').uncheck();
    await page.locator('#momentEditor button[type="submit"]').click();
    assert.equal((await stored()).growthMoments[0].reviewEligible,false);
    await page.locator('[data-memory-action="edit"][data-moment-id="two"]').click();
    await page.locator('#requestMomentDelete').click();
    await page.locator('#cancelMomentDelete').click();
    assert.equal((await stored()).growthMoments.length,2);
    await page.locator('#requestMomentDelete').click();
    await page.locator('#confirmMomentDelete').click();
    assert.equal((await stored()).growthMoments.length,1);
    const downloading=page.waitForEvent('download');
    await page.locator('#backupExportData').click();
    const download=await downloading;
    const chunks=[]; for await(const chunk of await download.createReadStream()) chunks.push(chunk);
    const exported=JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(exported.localArchive.growthMoments.length,1);
    await page.locator('#backupImportFile').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{}')});
    await page.waitForFunction(()=>document.querySelector('#archiveControlStatus').textContent.includes('完整备份'));
    assert.equal((await stored()).growthMoments.length,1);
    const payload={name:'test-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(createLocalArchiveExport(state,db)))};
    await page.locator('#backupImportFile').setInputFiles(payload);
    await page.locator('#restoreDialog').waitFor({state:'visible'});
    assert.ok((await page.locator('#restorePreview').textContent()).includes('2 条记录'));
    await page.screenshot({path:`screenshots/archive-restore-${width}.png`});
    await page.locator('#restoreDialog [data-close-archive-dialog]').click();
    assert.equal((await stored()).growthMoments.length,1);
    await page.locator('#backupImportFile').setInputFiles(payload);
    await page.locator('#restoreConsent').check();
    await page.locator('#restoreConfirmForm button[type="submit"]').click();
    await page.locator('#restoreDialog').waitFor({state:'hidden'});
    assert.equal((await stored()).growthMoments.length,2);
    await page.reload(); await navigate('backup');
    assert.equal(await page.locator('[data-memory-action="edit"]').count(),2);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.deepEqual(errors,[]);
    console.log(`${width}px: edit, confirm, exclude, delete, export, reject, cancel, restore and reload passed`);
    await context.close();
  }
} finally { await browser.close(); }
