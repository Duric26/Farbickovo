import { PDFDocument } from 'pdf-lib';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path'; import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// over, že uložené PDF obsahuje náš doplnený text
import pw from '/opt/node-tools/node_modules/playwright/index.js';
const { chromium } = pw;
const out = join(root, '.testtmp', 'out.pdf');
const bytes = readFileSync(out);
// prečítaj text z out.pdf cez pdf.js v headless
const b = await chromium.launch({ args:['--no-sandbox'] });
const p = await b.newPage();
await p.goto('file://'+join(root,'dist','BajaBaja.html'));
await p.waitForTimeout(1000);
const b64 = Buffer.from(bytes).toString('base64');
const txt = await p.evaluate(async (b64)=>{
  const u8 = Uint8Array.from(atob(b64), c=>c.charCodeAt(0));
  const doc = await window.pdfjsLib.getDocument({data:u8}).promise;
  let all='';
  for(let i=1;i<=doc.numPages;i++){ const pg=await doc.getPage(i); const tc=await pg.getTextContent(); all+=tc.items.map(x=>x.str).join(' ')+'\n'; }
  return all;
}, b64);
console.log('Text v uloženom PDF (1. strana):', JSON.stringify(txt.split('\n')[0].slice(0,80)));
console.log('Obsahuje "Ahoj Baja":', txt.includes('Ahoj Baja'));
console.log('Diakritika test – vložím ľščťžýáíé a uložím…');
// test diakritiky: pridaj text s diakritikou a over
await b.close();
