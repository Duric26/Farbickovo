import pw from '/opt/node-tools/node_modules/playwright/index.js'; const {chromium}=pw;
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path'; import { fileURLToPath } from 'node:url';
const root=join(dirname(fileURLToPath(import.meta.url)),'..'); const tmp=join(root,'.testtmp'); mkdirSync(join(tmp,'pdf'),{recursive:true});
const d=await PDFDocument.create(); const f=await d.embedFont(StandardFonts.Helvetica);
const p=d.addPage([500,300]);
p.drawText('Povodny nadpis dokumentu', {x:50,y:240,size:20,font:f,color:rgb(.1,.1,.4)});
p.drawText('Druhy riadok textu', {x:50,y:200,size:14,font:f});
writeFileSync(join(tmp,'pdf','E.pdf'), await d.save());
const errs=[]; const b=await chromium.launch({args:['--no-sandbox']}); const ctx=await b.newContext({acceptDownloads:true}); const pg=await ctx.newPage();
pg.on('pageerror',e=>errs.push(e.message)); pg.on('console',m=>{if(m.type()==='error')errs.push('C:'+m.text());});
await pg.goto('file://'+join(root,'dist','BajaBaja.html')); await pg.waitForTimeout(900);
await pg.click('button[data-who="obaja"]'); await pg.waitForTimeout(150);
if(await pg.locator('#moodModal:not(.hidden)').count()){ await pg.click('.mood-btn'); await pg.click('#moodSave'); }
await pg.setInputFiles('#hiddenFile', join(tmp,'pdf','E.pdf')); await pg.waitForTimeout(1500);

// over, že textová vrstva má spany
const spans = await pg.locator('.textLayer span').count();
console.log('Text spanov:', spans);

// vyber nástroj Upraviť text a klikni na prvý span
await pg.click('.tool[data-tool="edittext"]');
const first = pg.locator('.textLayer span').first();
await first.click({ force:true });
await pg.waitForTimeout(400);
// mal by vzniknúť editovateľný text anno so zameraním
const annoCount = await pg.evaluate(()=>document.querySelectorAll('.anno-text').length);
console.log('Anotácií s textom:', annoCount);
// prepíš obsah
await pg.keyboard.press('Control+A');
await pg.keyboard.type('Novy upraveny nadpis');
await pg.waitForTimeout(200);
const [dl]=await Promise.all([ pg.waitForEvent('download',{timeout:15000}).catch(()=>null), pg.click('#btnSave') ]);
let hasNew=false, hasOld=true, covered=false;
if(dl){ const o=join(tmp,'edited.pdf'); await dl.saveAs(o);
  const b64=readFileSync(o).toString('base64');
  const res=await pg.evaluate(async(b64)=>{
    const u8=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
    const doc=await window.pdfjsLib.getDocument({data:u8}).promise; const p=await doc.getPage(1);
    const tc=await p.getTextContent(); const txt=tc.items.map(x=>x.str).join(' ');
    // render a skontroluj bielu oblasť pod pôvodným nadpisom
    const vp=p.getViewport({scale:1}); const c=document.createElement('canvas'); c.width=vp.width;c.height=vp.height;
    const ctx=c.getContext('2d'); ctx.fillStyle='#ccc'; ctx.fillRect(0,0,c.width,c.height);
    await p.render({canvasContext:ctx,viewport:vp}).promise;
    return { txt };
  }, b64);
  hasNew = res.txt.includes('Novy upraveny nadpis');
  console.log('Text v PDF:', JSON.stringify(res.txt.slice(0,120)));
}
console.log('Obsahuje nový text:', hasNew);
await b.close();
console.log('\n=== VERIFY5 === spany:',spans>0,'| vznikol edit text:',annoCount>0,'| nový text v PDF:',hasNew);
console.log(errs.length? 'CHYBY: '+errs.slice(0,6).join(' | ') : 'Žiadne chyby. ✅');
