import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadFixtures } from './vision-fixtures.mjs';

const url = process.argv[2] || 'http://127.0.0.1:4191/smile-live-ar/';
const engine = process.env.BROWSER_ENGINE || 'chromium';
const output = path.resolve('artifacts/browser-' + engine);
await mkdir(output, { recursive: true });
const fixtures = await loadFixtures();
const browser = await (engine === 'webkit' ? webkit : chromium).launch({
  headless: true,
  ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}),
  ...(process.env.BROWSER_PROXY ? { proxy: { server: process.env.BROWSER_PROXY, bypass: '127.0.0.1,localhost' } } : {}),
});
const results = [];

async function newContext(viewport = { width: 390, height: 844 }) {
  const context = await browser.newContext({ viewport, isMobile: viewport.width < 600 });
  await context.addInitScript((fixtures) => {
    const images = Object.fromEntries(Object.entries(fixtures).map(([key, src]) => {
      const image = new Image(); image.src = src; return [key, image];
    }));
    window.cameraFixture = 'neutral';
    window.cameraStreams = [];
    const getUserMedia = async () => {
      if (window.denyCamera) throw new DOMException('Blocked in permission test', 'NotAllowedError');
      await Promise.all(Object.values(images).map((image) => image.decode()));
      const canvas = document.createElement('canvas');
      canvas.width = 480; canvas.height = 640;
      const painter = canvas.getContext('2d');
      const draw = () => {
        painter.fillStyle = '#343438'; painter.fillRect(0, 0, 480, 640);
        const image = images[window.cameraFixture];
        if (!image) return;
        const scale = Math.min(384 / image.width, 512 / image.height);
        painter.save();
        painter.translate(240 + (window.cameraOffsetX || 0), 320);
        painter.rotate(window.cameraRotation || 0);
        painter.drawImage(image, -image.width * scale / 2, -image.height * scale / 2, image.width * scale, image.height * scale);
        painter.restore();
      };
      draw();
      const timer = setInterval(draw, 80);
      const stream = canvas.captureStream(12);
      const track = stream.getVideoTracks()[0];
      const stop = track.stop.bind(track);
      track.stop = () => { clearInterval(timer); stop(); };
      window.cameraStreams.push(stream);
      return stream;
    };
    // Keep the fixture source stable when WebKit recreates native API wrappers.
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  }, fixtures);
  return context;
}

const snapshot = (page) => page.evaluate(() => ({
  state: document.querySelector('#app').dataset.state,
  ...window.__SMILE_LIVE_METRICS__,
}));
async function ready(page) {
  await page.waitForFunction(() => window.__SMILE_LIVE_METRICS__?.startup.firstInferenceAt != null && document.querySelector('#app').dataset.state === 'live', null, { timeout: 35000 });
}
async function pixels(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('#fx-canvas');
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]) count++;
    return count;
  });
}

async function headBoundaryScreenshot(page, name) {
  await page.evaluate(() => {
    const head = window.__SMILE_LIVE_METRICS__.headCollider;
    const overlay = document.createElement('canvas');
    overlay.id = 'qa-head-boundary';
    overlay.width = innerWidth; overlay.height = innerHeight;
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100;pointer-events:none';
    const ctx = overlay.getContext('2d');
    ctx.strokeStyle = '#00ff00'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(head.cx, head.cy, head.rx, head.ry, head.rotation || 0, 0, Math.PI * 2); ctx.stroke();
    document.body.append(overlay);
  });
  await page.screenshot({ path: path.join(output, name) });
  await page.locator('#qa-head-boundary').evaluate((element) => element.remove());
}

try {
  const context = await newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const requests = [];
  context.on('request', (request) => requests.push(request.url()));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('#start-button').click();
  await ready(page);
  const cold = await snapshot(page);
  results.push({ name: 'cold', ...cold });
  assert.ok(cold.startup.firstInferenceAt < 5000, `Cold navigation to first inference: ${cold.startup.firstInferenceAt}ms`);
  assert.ok(cold.startup.clickToReadyMs < 5000, `Click to first inference: ${cold.startup.clickToReadyMs}ms`);
  await page.waitForFunction(() => window.__SMILE_LIVE_METRICS__.faceCount > 0);
  assert.equal((await snapshot(page)).expressionMode, 'neutral');
  assert.equal(await pixels(page), 0);
  assert.ok(!requests.some((request) => /\.task|vision_wasm/.test(request)), 'No legacy runtime downloads');
  assert.equal(cold.visionBackend, 'wasm');
  assert.match(await page.locator('#toast').textContent(), /Smile for rain. Laugh for fireworks/);

  const smileStartedAt = Date.now();
  await page.evaluate(() => { window.cameraFixture = 'smile'; });
  await page.waitForFunction(() => window.__SMILE_LIVE_METRICS__.expressionMode === 'rain' && window.__SMILE_LIVE_METRICS__.rainAmount > 0.4);
  const smileResponseMs = Date.now() - smileStartedAt;
  assert.ok(smileResponseMs < 800, `Smile response: ${smileResponseMs}ms`);
  await page.waitForTimeout(1000);
  assert.ok(await pixels(page) > 100, 'Smile must draw visible rain');
  assert.equal((await snapshot(page)).fireworkCount, 0, 'Small smile must not fire rockets');
  await page.screenshot({ path: path.join(output, 'mobile-rain.png') });
  results.push({ name: 'smile', responseMs: smileResponseMs, ...await snapshot(page), pixels: await pixels(page) });

  const laughStartedAt = Date.now();
  await page.evaluate(() => { window.cameraFixture = 'laugh'; });
  await page.waitForFunction(() => window.__SMILE_LIVE_METRICS__.fireworkCount === 1);
  const laughResponseMs = Date.now() - laughStartedAt;
  assert.ok(laughResponseMs < 800, `Laugh response: ${laughResponseMs}ms`);
  await page.waitForTimeout(1900);
  assert.equal((await snapshot(page)).expressionMode, 'laugh');
  assert.ok(await pixels(page) > 100, 'Large smile must draw visible fireworks');
  await page.screenshot({ path: path.join(output, 'mobile-fireworks.png') });
  results.push({ name: 'laugh', responseMs: laughResponseMs, ...await snapshot(page), pixels: await pixels(page) });
  await page.waitForTimeout(4200);
  assert.equal((await snapshot(page)).fireworkCount, 1, 'Held smile must not repeatedly ignite');
  assert.equal(await page.locator('#smile-callout strong').textContent(), 'Fireworks');
  await headBoundaryScreenshot(page, 'head-boundary.png');

  const headBefore = (await snapshot(page)).headCollider;
  // The fixture crown is at source pixel (335, 3). Check its projected position,
  // independently of the landmark-to-ellipse formula.
  const crown = await page.evaluate(() => {
    const scale = innerHeight / 640;
    return { x: innerWidth / 2 + (250 - 335) * 384 / 500 * scale, y: (320 - 282 * 384 / 500 / 2 + 3 * 384 / 500) * scale };
  });
  const crownRadius = ((crown.x - headBefore.cx) * Math.cos(headBefore.rotation) + (crown.y - headBefore.cy) * Math.sin(headBefore.rotation)) ** 2 / headBefore.rx ** 2
    + (-(crown.x - headBefore.cx) * Math.sin(headBefore.rotation) + (crown.y - headBefore.cy) * Math.cos(headBefore.rotation)) ** 2 / headBefore.ry ** 2;
  assert.ok(Math.abs(Math.sqrt(crownRadius) - 1) < 0.13, 'Collision surface must reach the visible crown, not stop at the forehead');
  await page.evaluate(() => { window.cameraRotation = 0.25; });
  await page.waitForFunction((rotation) => window.__SMILE_LIVE_METRICS__.headCollider?.rotation < rotation - 0.12, headBefore.rotation, { timeout: 800 });
  await headBoundaryScreenshot(page, 'head-boundary-tilted.png');
  await page.evaluate(() => { window.cameraRotation = 0; });
  await page.waitForFunction((rotation) => Math.abs(window.__SMILE_LIVE_METRICS__.headCollider?.rotation - rotation) < 0.06, headBefore.rotation, { timeout: 800 });

  await page.locator('#app').evaluate((app) => { app.style.height = '644px'; });
  await page.waitForFunction((head) => {
    const canvas = document.querySelector('#fx-canvas'), current = window.__SMILE_LIVE_METRICS__.headCollider;
    return canvas.height === 644 && current && Math.abs(current.cy - head.cy * 644 / 844) < 5;
  }, headBefore, { timeout: 800 });
  await page.locator('#app').evaluate((app) => app.style.removeProperty('height'));
  await page.waitForFunction((head) => Math.abs(window.__SMILE_LIVE_METRICS__.headCollider?.cy - head.cy) < 5, headBefore, { timeout: 800 });
  await page.evaluate(() => { window.cameraOffsetX = 48; });
  await page.waitForFunction((cx) => window.__SMILE_LIVE_METRICS__.headCollider?.cx < cx - 25, headBefore.cx, { timeout: 800 });
  const movedHead = (await snapshot(page)).headCollider;
  assert.ok(Math.abs(movedHead.rx / headBefore.rx - 1) < 0.2, 'Moving head must not resize its collision boundary');
  await page.evaluate(() => { window.cameraFixture = ''; });
  await page.waitForFunction(() => window.__SMILE_LIVE_METRICS__.collisionSource === 'none', null, { timeout: 800 });
  await page.evaluate(() => { window.cameraOffsetX = 0; });

  await page.evaluate(() => { window.cameraFixture = 'neutral'; });
  await page.waitForFunction(() => window.__SMILE_LIVE_METRICS__.smileScore < 0.12);
  await page.evaluate(() => { window.cameraFixture = 'laugh'; });
  await page.waitForFunction(() => window.__SMILE_LIVE_METRICS__.fireworkCount === 2);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(1900);
  await page.screenshot({ path: path.join(output, 'desktop-fireworks.png') });
  assert.ok((await snapshot(page)).collisionCount > 0, 'Tracked head must collide with particles');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

  await page.locator('#close-button').click();
  assert.equal((await snapshot(page)).state, 'idle');
  assert.equal((await snapshot(page)).particleCount, 0);
  assert.equal(await page.evaluate(() => window.cameraStreams.every((stream) => stream.getTracks().every((track) => track.readyState === 'ended'))), true);
  await page.locator('#start-button').click();
  await ready(page);
  const restarted = await snapshot(page);
  results.push({ name: 'restart', ...restarted });
  assert.ok(restarted.startup.clickToReadyMs < 5000, `Restart to first inference: ${restarted.startup.clickToReadyMs}ms`);
  await page.locator('#close-button').click();
  assert.deepEqual(errors, []);
  await context.close();

  // A denied permission and a close during loading must remain recoverable.
  const retryContext = await newContext();
  const retry = await retryContext.newPage();
  await retry.goto(url, { waitUntil: 'domcontentloaded' });
  await retry.evaluate(() => { window.denyCamera = true; });
  await retry.locator('#start-button').click();
  await retry.waitForFunction(() => document.querySelector('#app').dataset.state === 'error');
  await retry.evaluate(() => { window.denyCamera = false; });
  await retry.locator('#retry-button').click();
  await ready(retry);
  await retry.locator('#close-button').click();
  await retry.locator('#start-button').click();
  await retry.locator('#close-button').click();
  await retry.waitForTimeout(1000);
  assert.equal((await snapshot(retry)).state, 'idle');
  await retry.locator('#start-button').click();
  await ready(retry);
  await retryContext.close();
  console.log(JSON.stringify({ passed: true, url, engine, results }, null, 2));
} finally {
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ url, engine, results }, null, 2));
  await browser.close();
}
