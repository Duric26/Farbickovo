import pw from '/opt/node-tools/node_modules/playwright/index.js';
const { chromium } = pw;
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path'; import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = join(root,'.testtmp'); mkdirSync(join(tmp,'pdf'),{recursive:true}); mkdirSync(join(tmp,'img'),{recursive:true});
// vzor s formularom
const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica);
const pg = d.addPage([400,300]); pg.drawText('Form', {x:40,y:260,size:18,font:f});
const form=d.getForm(); form.createTextField('meno').addToPage(pg,{x:40,y:200,width:180,height:22});
const chk=form.createCheckBox('suhlas'); chk.addToPage(pg,{x:40,y:160,width:16,height:16});
writeFileSync(join(tmp,'pdf','form.pdf'), await d.save());
// obrazok PNG 1x1
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
writeFileSync(join(tmp,'img','a.png'), png);

const errs=[]; const b = await chromium.launch({args:['--no-sandbox']});
const ctx = await b.newContext({acceptDownloads:true}); const p = await ctx.newPage();
p.on('pageerror',e=>errs.push(e.message));
await p.goto('file://'+join(root,'dist','BajaBaja.html')); await p.waitForTimeout(900);
await p.click('button[data-who="obaja"]'); await p.waitForTimeout(200);
if(await p.locator('#moodModal:not(.hidden)').count()){ await p.click('.mood-btn'); await p.click('#moodSave'); }
await p.waitForTimeout(200);

// --- Diakritika ---
await p.setInputFiles('#hiddenFile', join(tmp,'pdf','form.pdf')); await p.waitForTimeout(1500);
await p.click('.tool[data-tool="text"]');
const boxEl = await p.locator('.anno-layer').first().boundingBox();
await p.mouse.click(boxEl.x+80, boxEl.y+120); await p.waitForTimeout(200);
await p.keyboard.type('Ľščťžýáíé ôňď – test'); await p.waitForTimeout(200);
const [dl] = await Promise.all([ p.waitForEvent('download',{timeout:15000}).catch(()=>null), p.click('#btnSave') ]);
let diaOk=false;
if(dl){ const o=join(tmp,'dia.pdf'); await dl.saveAs(o);
  const b64=readFileSync(o).toString('base64');
  const txt=await p.evaluate(async(b64)=>{ const u8=Uint8Array.from(atob(b64),c=>c.charCodeAt(0)); const doc=await window.pdfjsLib.getDocument({data:u8}).promise; let s=''; for(let i=1;i<=doc.numPages;i++){const pg=await doc.getPage(i);const tc=await pg.getTextContent();s+=tc.items.map(x=>x.str).join('');} return s;},b64);
  diaOk = txt.includes('Ľščťžýáíé'); console.log('Diakritika v PDF:', diaOk, '·', JSON.stringify(txt.slice(-40)));
}

// --- Formular ---
await p.click('.tool[data-tool="select"]');
await p.click('#btnForm'); await p.waitForTimeout(500);
await p.fill('.form-field input[type=text]', 'Pavlína');
await p.check('.form-field input[type=checkbox]');
const [dlf] = await Promise.all([ p.waitForEvent('download',{timeout:15000}).catch(()=>null), p.click('button:has-text("Vyplniť a uložiť")') ]);
let formOk=false;
if(dlf){ const o=join(tmp,'form-out.pdf'); await dlf.saveAs(o);
  const doc=await PDFDocument.load(readFileSync(o)); const fm=doc.getForm();
  formOk = fm.getTextField('meno').getText()==='Pavlína' && fm.getCheckBox('suhlas').isChecked();
  console.log('Formulár vyplnený:', formOk, '· meno =', fm.getTextField('meno').getText());
}

// --- Obrazky -> PDF ---
await p.keyboard.press('Escape'); await p.click('#btnConvert'); await p.waitForTimeout(300);
const [dli] = await Promise.all([ p.waitForEvent('download',{timeout:15000}).catch(()=>null),
  (async()=>{ await p.click('.card-btn:has-text("Obrázky → PDF")'); await p.waitForTimeout(300); await p.setInputFiles('#hiddenImgs', join(tmp,'img','a.png')); })() ]);
let imgOk=false;
if(dli){ const o=join(tmp,'img.pdf'); await dli.saveAs(o); const doc=await PDFDocument.load(readFileSync(o)); imgOk=doc.getPageCount()>=1; console.log('Obrázky→PDF strán:', doc.getPageCount()); }

await b.close();
console.log('\n=== VERIFY2 ===  diakritika:',diaOk,'| formulár:',formOk,'| obrázky→PDF:',imgOk);
if(errs.length){ console.log('CHYBY:',errs.slice(0,8).join(' | ')); } else console.log('Žiadne chyby. ✅');
