import pw from '/opt/node-tools/node_modules/playwright/index.js'; const {chromium}=pw;
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path'; import { fileURLToPath } from 'node:url';
const root=join(dirname(fileURLToPath(import.meta.url)),'..'); const tmp=join(root,'.testtmp'); mkdirSync(join(tmp,'pdf'),{recursive:true});
const d=await PDFDocument.create(); const f=await d.embedFont(StandardFonts.Helvetica);
const p=d.addPage([520,320]);
p.drawText('Zmluva medzi stranami', {x:50,y:260,size:20,font:f,color:rgb(.1,.1,.4)});
p.drawText('Suma: 1000 EUR splatna ihned', {x:50,y:210,size:13,font:f});
p.drawText('Dalsi riadok na vyhladavanie', {x:50,y:170,size:12,font:f});
writeFileSync(join(tmp,'pdf','Z.pdf'), await d.save());
const errs=[]; const b=await chromium.launch({args:['--no-sandbox']}); const ctx=await b.newContext({acceptDownloads:true}); const pg=await ctx.newPage();
pg.on('pageerror',e=>errs.push(e.message)); pg.on('console',m=>{if(m.type()==='error')errs.push('C:'+m.text());});
await pg.goto('file://'+join(root,'dist','BajaBaja.html')); await pg.waitForTimeout(900);
await pg.click('button[data-who="obaja"]'); await pg.waitForTimeout(150);
if(await pg.locator('#moodModal:not(.hidden)').count()){ await pg.click('.mood-btn'); await pg.click('#moodSave'); }
await pg.setInputFiles('#hiddenFile', join(tmp,'pdf','Z.pdf')); await pg.waitForTimeout(1500);

// --- ÚPRAVA TEXTU (celý riadok, auto pozadie) ---
await pg.click('.tool[data-tool="edittext"]');
await pg.locator('.textLayer span', {hasText:'Suma'}).first().click({force:true});
await pg.waitForTimeout(400);
const editInfo = await pg.evaluate(()=>{
  const t=document.querySelector('.anno-text'); return t? {text:t.textContent, size:t.style.fontSize} : null;
});
console.log('Edit box prevzal text:', JSON.stringify(editInfo));
await pg.keyboard.press('Control+A'); await pg.keyboard.type('Suma: 2500 EUR splatna do 30 dni');
await pg.waitForTimeout(200);
const [dl]=await Promise.all([ pg.waitForEvent('download',{timeout:15000}).catch(()=>null), pg.click('#btnSave') ]);
let newOk=false;
if(dl){ const o=join(tmp,'z-edit.pdf'); await dl.saveAs(o); const b64=readFileSync(o).toString('base64');
  const txt=await pg.evaluate(async(b64)=>{const u8=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));const doc=await window.pdfjsLib.getDocument({data:u8}).promise;const p=await doc.getPage(1);const tc=await p.getTextContent();return tc.items.map(x=>x.str).join(' ');},b64);
  newOk = txt.includes('2500 EUR splatna do 30 dni');
  console.log('Nový text v PDF:', newOk);
}

// --- UNDO / REDO ---
const beforeUndo = await pg.evaluate(()=>document.querySelectorAll('.anno').length);
await pg.keyboard.press('Control+z'); await pg.waitForTimeout(300);
const afterUndo = await pg.evaluate(()=>document.querySelectorAll('.anno').length);
await pg.keyboard.press('Control+y'); await pg.waitForTimeout(300);
const afterRedo = await pg.evaluate(()=>document.querySelectorAll('.anno').length);
console.log('Anotácie: pred undo',beforeUndo,'po undo',afterUndo,'po redo',afterRedo);

// --- VYHĽADÁVANIE ---
await pg.fill('#searchInp', 'riadok'); await pg.waitForTimeout(500);
const count = await pg.textContent('#searchCount');
const hits = await pg.evaluate(()=>document.querySelectorAll('.textLayer span.search-hit').length);
console.log('Hľadanie "riadok": count=',JSON.stringify(count),' zvýraznené=',hits);

await b.close();
console.log('\n=== VERIFY6 === edit prevzal text:',!!editInfo&&editInfo.text.includes('Suma'),'| nový text:',newOk,'| undo:',afterUndo<beforeUndo,'| redo:',afterRedo>afterUndo,'| hľadanie:',hits>0);
console.log(errs.length? 'CHYBY: '+errs.slice(0,6).join(' | ') : 'Žiadne chyby. ✅');
