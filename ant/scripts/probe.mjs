import pw from '/opt/node-tools/node_modules/playwright/index.js';
const { chromium } = pw;
import { join, dirname } from 'node:path'; import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const b = await chromium.launch({ args:['--no-sandbox'] });
const p = await b.newPage();
const errs=[];
p.on('pageerror', e=>errs.push('PAGEERR: '+e.message));
p.on('console', m=>{ if(m.type()==='error') errs.push('CONSOLE: '+m.text()); });
await p.goto('file://'+join(root,'dist','BajaBaja.html'));
await p.waitForTimeout(1500);
const st = await p.evaluate(()=>({
  hasPdfjs: typeof window.pdfjsLib, hasPDFLib: typeof window.PDFLib, hasFontkit: typeof window.fontkit, hasFflate: typeof window.fflate,
  assets: typeof window.__ASSETS__,
  whoBtnHandler: !!document.querySelector('.who-btn'),
  status: document.getElementById('status')?.textContent,
}));
console.log('STATE:', JSON.stringify(st,null,1));
console.log('ERRORS:\n'+(errs.join('\n')||'(žiadne)'));
await b.close();
