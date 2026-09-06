// Run against npm start. Set PLAYWRIGHT_MODULE to an installed Playwright module if needed.
import assert from 'node:assert/strict';
import { createExampleObject } from '../fixtures/example-object.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let generationDelay = 0;
  // Browser integration tests mock the paid provider; live results are recorded by test/eval/.
  await page.route('**/api/generate', async route => {
    const input = route.request().postDataJSON();
    const definition = { ...createExampleObject(), creationId: input.creationId, revision: input.revision, requestId: input.requestId, source: input.source };
    if (generationDelay) await new Promise(resolve => setTimeout(resolve, generationDelay));
    const events=['validating','generating','checking'].map(stage=>({type:'progress',requestId:input.requestId,stage}));
    events.push({type:'result',definition});
    await route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: events.map(e=>JSON.stringify(e)+'\n').join('') }).catch(() => {});
  });
  const open = () => page.goto('http://localhost:4173/');
  const paint = async () => {
    await page.locator('#sketch').scrollIntoViewIfNeeded();
    const r = await page.locator('#sketch').boundingBox();
    await page.mouse.move(r.x + 70, r.y + 70);
    await page.mouse.down();
    await page.mouse.move(r.x + 160, r.y + 130, { steps: 10 });
  };
  const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const pixels = () => page.locator('#sketch').evaluate(c => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    return d.reduce((n, v, i) => n + (i % 4 === 3 && v > 0 ? 1 : 0), 0);
  });
  const capture = async () => {
    await page.locator('#bring').click();
    await page.waitForFunction(() => !document.querySelector('#snapshot-image').hidden && document.querySelector('#snapshot-image').naturalWidth === 800);
  };
  for (const interruption of ['normal', 'blur', 'lostcapture', 'pointercancel']) {
    await open();
    await page.evaluate(() => document.querySelector('#sketch').addEventListener('pointerdown', e => { window.testPointer = e.pointerId; }));
    await paint(); await frame();
    const before = await pixels(); assert.ok(before > 0);
    await page.evaluate(kind => {
      const c = document.querySelector('#sketch');
      if (kind === 'blur') window.dispatchEvent(new Event('blur'));
      if (kind === 'lostcapture') c.releasePointerCapture(window.testPointer);
      if (kind === 'pointercancel') c.dispatchEvent(new PointerEvent('pointercancel', { pointerId: window.testPointer }));
    }, interruption);
    await page.mouse.up(); await frame();
    assert.equal(await pixels(), before, interruption + ' preserves collected ink');
    await capture();
    const digest = await page.evaluate(async () => (await import('/paper-machines.js')).getPreparedSketch().source.sha256);
    await page.locator('#undo').click(); await frame(); assert.equal(await pixels(), 0);
    await page.locator('#redo').click(); await frame(); assert.ok(await pixels() > 0);
    // Compare the canonical snapshot, not display-canvas antialiasing after readbacks.
    await capture();
    assert.equal(await page.evaluate(async () => (await import('/paper-machines.js')).getPreparedSketch().source.sha256), digest);
    console.log('PASS interruption:', interruption);
  }
  for (const pointerType of ['pen', 'touch']) {
    await open();
    await page.evaluate(type => {
      const c = document.querySelector('#sketch'), r = c.getBoundingClientRect();
      // Synthetic stylus/touch routing test, not a physical-device test.
      c.setPointerCapture = () => {};
      for (const [event, delta] of [['pointerdown', 60], ['pointermove', 120], ['pointerup', 150]]) {
        c.dispatchEvent(new PointerEvent(event, { pointerId: 5, pointerType: type, isPrimary: true, button: 0, clientX: r.x + delta, clientY: r.y + delta }));
      }
    }, pointerType);
    await frame(); assert.ok(await pixels() > 0);
    console.log('PASS emulated input:', pointerType);
  }
  await open(); assert.equal(await page.locator('#bring').isDisabled(), true);
  assert.equal(await page.locator('input[type=file],input[capture]').count(), 0);
  await paint(); await page.mouse.up(); await frame();
  const original = await page.locator('#sketch').evaluate(c => c.toDataURL());
  await capture(); generationDelay=1800; await page.locator('#bring').click();
  assert.equal(await page.locator('#generation-progress').isVisible(),true);
  assert.equal(await page.locator('#generation-progress').getAttribute('data-stage'),'sending');
  await page.waitForTimeout(1050);
  assert.match(await page.locator('.generation-elapsed').textContent(),/1s elapsed/);
  assert.equal(await page.locator('#generation-progress').getAttribute('data-stage'),'sending');
  await page.locator('#stage').screenshot({path:'/tmp/paper-machines-progress.png'});
  generationDelay=0;
  assert.equal(await page.evaluate(async () => {
    const app = await import('/paper-machines.js');
    const s = app.getPreparedSketch(), r = app.getGenerationRequest();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await r.blob.arrayBuffer())), b => b.toString(16).padStart(2, '0')).join('');
    return s.revision === r.revision && s.creationId === r.creationId && s.source.imageId === r.source.imageId && hash === r.source.sha256;
  }), true);
  await page.waitForFunction(() => ['ready','error'].includes(document.querySelector('#runtime-view').dataset.state),{},{timeout:15000});
  assert.equal(await page.locator('#runtime-view').getAttribute('data-state'),'ready',await page.locator('#notice').textContent());
  assert.equal(await page.locator('#generation-progress').isHidden(),true);
  assert.equal(await page.locator('#runtime-view').evaluate(el=>getComputedStyle(el).animationName),'creation-reveal');
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('#runtime-view').evaluate(el=>getComputedStyle(el).animationName),'none');
  await page.emulateMedia({reducedMotion:'no-preference'});
  assert.equal(await page.evaluate(async () => !!(await import('/paper-machines.js')).getGeneratedObject()), true);
  await page.locator('#play').click();
  assert.equal(await page.locator('#play').getAttribute('aria-label'),'Play animation');
  await page.waitForTimeout(300);
  const creationFrame=page.locator('#runtime-view iframe');
  const pausedImage=await creationFrame.screenshot();
  await page.waitForTimeout(150);
  assert.deepEqual(await creationFrame.screenshot(),pausedImage,'Pause freezes the visible creation');
  assert.equal(await page.locator('#zoom').isEnabled(),true);
  await page.locator('#zoom').evaluate(el=>{el.value='125';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.waitForTimeout(300);
  assert.notDeepEqual(await creationFrame.screenshot(),pausedImage,'Scale changes the paused 3D view');
  await page.locator('#zoom').evaluate(el=>{el.value='100';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.waitForTimeout(300);
  assert.deepEqual(await creationFrame.screenshot(),pausedImage,'Scale does not advance animation');
  await page.locator('#restart').click();
  await page.waitForFunction(()=>document.querySelector('#runtime-view').dataset.state==='ready',{},{timeout:10000});
  assert.equal(await page.locator('#play').getAttribute('aria-label'),'Play animation');
  await page.locator('#play').click();
  assert.equal(await page.locator('#play').getAttribute('aria-label'),'Pause animation');
  console.log('PASS generated-object pause, camera scale while paused, restart and resume');
  await page.locator('#runtime-back').click();
  assert.equal(await page.locator('#runtime-view').isHidden(), true);
  // Cleanup has a 250 ms grace period; allow browser scheduling overhead while
  // still requiring the hidden iframe to be removed promptly.
  await page.waitForFunction(() => document.querySelectorAll('#runtime-view iframe').length === 0, {}, { timeout: 1000 });
  assert.equal(await page.locator('#runtime-view iframe').count(), 0);
  assert.equal(await page.locator('#sketch').evaluate(c => c.toDataURL()), original);
  await capture(); generationDelay = 500;
  await page.locator('#bring').click(); await page.locator('#edit-sketch').click();
  await page.waitForTimeout(700);
  assert.equal(await page.evaluate(async () => (await import('/paper-machines.js')).getGeneratedObject()), null);
  await capture(); await page.locator('#bring').click(); await paint(); await page.mouse.up();
  await page.waitForTimeout(700);
  assert.equal(await page.evaluate(async () => (await import('/paper-machines.js')).getGeneratedObject()), null);
  generationDelay = 0;
  page.once('dialog', d => d.dismiss()); await page.locator('#clear').click();
  assert.ok(await pixels() > 0);
  await page.evaluate(() => {
    const encode = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (cb, ...args) { encode.call(this, b => setTimeout(() => cb(b), 400), ...args); };
  });
  await page.locator('#bring').click(); await page.locator('#edit-sketch').click();
  await page.waitForTimeout(600); assert.equal(await page.locator('#snapshot-preview').isHidden(), true);
  await page.locator('#bring').click(); await paint(); await page.mouse.up();
  await page.waitForTimeout(600); assert.equal(await page.locator('#snapshot-preview').isHidden(), true);
  await page.evaluate(() => { HTMLCanvasElement.prototype.toBlob = cb => cb(null); });
  await page.locator('#bring').click(); await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('Could not encode'));
  assert.ok(await pixels() > 0);
  await open(); await page.setViewportSize({ width: 390, height: 844 });
  await paint(); await page.mouse.up(); await capture();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const preview = await page.locator('#snapshot-preview').boundingBox(), back = await page.locator('#edit-sketch').boundingBox();
  assert.ok(back.y + back.height <= preview.y + preview.height);
  generationDelay=1800; await page.locator('#bring').click();
  assert.equal(await page.locator('#generation-progress').isVisible(),true);
  const mobileProgress=await page.locator('#snapshot-preview').boundingBox(), mobileCancel=await page.locator('#edit-sketch').boundingBox();
  assert.ok(mobileCancel.y+mobileCancel.height<=mobileProgress.y+mobileProgress.height);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('#edit-sketch').click();
  assert.equal(await page.locator('#generation-progress').isHidden(),true);
  assert.deepEqual(errors, []);
  console.log('PASS handoff provenance, edit preservation, clear protection, capture failure/cancel/revision races, mobile layout, no page errors.');
} finally { await browser.close(); }
