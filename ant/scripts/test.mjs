import pw from '/opt/node-tools/node_modules/playwright/index.js';
const { chromium } = pw;
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = join(root, '.testtmp');
mkdirSync(tmp, { recursive: true });

// 1) vzorové PDF (3 strany + formulár)
const doc = await PDFDocument.create();
const f = await doc.embedFont(StandardFonts.Helvetica);
for (let i = 1; i <= 3; i++) {
  const p = doc.addPage([595, 842]);
  p.drawText(`Testovacia strana ${i}`, { x: 60, y: 760, size: 24, font: f, color: rgb(0.1, 0.1, 0.4) });
  p.drawText('Priklad textu v dokumente pre Baju a Baju.', { x: 60, y: 720, size: 12, font: f });
}
const form = doc.getForm();
const tf = form.createTextField('meno'); tf.addToPage(doc.getPage(0), { x: 60, y: 650, width: 200, height: 24 });
const sampleBytes = await doc.save();
const sampledir = join(tmp, 'pdf'); mkdirSync(sampledir, { recursive: true });
const samplePath = join(sampledir, 'vzor.pdf');
writeFileSync(samplePath, sampleBytes);

const htmlPath = join(root, 'dist', 'BajaBaja.html');
const errors = [];
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ acceptDownloads: true });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push('[console.error] ' + m.text()); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));

await page.goto('file://' + htmlPath);
await page.waitForTimeout(800);

// vstup do appky
await page.click('button[data-who="obaja"]');
await page.waitForTimeout(300);
// nálada
if (await page.locator('#moodModal:not(.hidden)').count()) {
  await page.click('.mood-btn');
  await page.click('#moodSave');
}
await page.waitForTimeout(300);

// otvoriť PDF
await page.setInputFiles('#hiddenFile', samplePath);
await page.waitForTimeout(2500);
const pageCount = await page.locator('.page-wrap').count();
console.log('Vykreslených strán:', pageCount);
const canvasOk = await page.evaluate(() => {
  const c = document.querySelector('.page-wrap canvas'); if (!c) return false;
  const ctx = c.getContext('2d'); const d = ctx.getImageData(0, 0, Math.min(40, c.width), Math.min(40, c.height)).data;
  let nonwhite = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 250 || d[i + 1] < 250 || d[i + 2] < 250) nonwhite++;
  return { w: c.width, h: c.height };
});
console.log('Prvé plátno:', JSON.stringify(canvasOk));

// text layer
const spanCount = await page.locator('.textLayer span').count();
console.log('Textová vrstva span:', spanCount);

// diagnostika viditeľnosti
const diag = await page.evaluate(() => ({
  appHidden: document.getElementById('app').classList.contains('hidden'),
  introHidden: document.getElementById('intro').classList.contains('hidden'),
  moodHidden: document.getElementById('moodModal').classList.contains('hidden'),
  toolbarRect: document.getElementById('toolbar').getBoundingClientRect(),
  toolVisible: !!document.querySelector('.tool[data-tool="text"]')?.offsetParent,
}));
console.log('DIAG:', JSON.stringify(diag));

// pridať text anotáciu nástrojom text
await page.click('.tool[data-tool="text"]', { timeout: 5000 });
const box = await page.locator('.anno-layer').first().boundingBox();
await page.mouse.click(box.x + 120, box.y + 150);
await page.waitForTimeout(300);
await page.keyboard.type('Ahoj Baja!');
await page.waitForTimeout(200);
const annoCount = await page.evaluate(() => Object.values(window).length); // ignore

// uložiť PDF cez tlačidlo (download)
const [dl] = await Promise.all([
  page.waitForEvent('download', { timeout: 15000 }).catch(() => null),
  page.click('#btnSave'),
]);
let savedOk = false, savedPages = 0;
if (dl) {
  const out = join(tmp, 'out.pdf'); await dl.saveAs(out);
  const re = await PDFDocument.load(readFileSync(out));
  savedPages = re.getPageCount(); savedOk = true;
  console.log('Uložené PDF strán:', savedPages, 'veľkosť:', readFileSync(out).length);
}

// konverzie: text
await page.click('.tool[data-tool="select"]');
await page.click('#btnConvert');
await page.waitForTimeout(300);
const [dlTxt] = await Promise.all([
  page.waitForEvent('download', { timeout: 15000 }).catch(() => null),
  page.click('.card-btn:has-text("PDF → text")'),
]);
let txtOk = false;
if (dlTxt) { const out = join(tmp, 'out.txt'); await dlTxt.saveAs(out); const t = readFileSync(out, 'utf8'); txtOk = t.includes('Testovacia'); console.log('TXT obsahuje text:', txtOk, '· ukážka:', JSON.stringify(t.slice(0, 40))); }

// docx
const [dlDocx] = await Promise.all([
  page.waitForEvent('download', { timeout: 15000 }).catch(() => null),
  page.click('.card-btn:has-text("Word")'),
]);
let docxOk = false;
if (dlDocx) { const out = join(tmp, 'out.docx'); await dlDocx.saveAs(out); docxOk = readFileSync(out).length > 400; console.log('DOCX veľkosť:', readFileSync(out).length); }

// screenshot
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.screenshot({ path: join(root, 'docs', 'nahlad.png'), fullPage: false });

await browser.close();

console.log('\n=== VÝSLEDOK ===');
console.log('strán vykreslených:', pageCount, '| textová vrstva:', spanCount > 0, '| uloženie:', savedOk, savedPages, '| txt:', txtOk, '| docx:', docxOk);
if (errors.length) { console.log('\nCHYBY V KONZOLE:'); errors.slice(0, 20).forEach((e) => console.log(' -', e)); }
else console.log('Žiadne chyby v konzole. ✅');
