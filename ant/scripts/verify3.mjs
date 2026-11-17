import pw from '/opt/node-tools/node_modules/playwright/index.js';
const { chromium } = pw;
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path'; import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)),'..'); const tmp=join(root,'.testtmp'); mkdirSync(join(tmp,'pdf'),{recursive:true});
async function mk(n,pages){ const d=await PDFDocument.create(); const f=await d.embedFont(StandardFonts.Helvetica);
  for(let i=1;i<=pages;i++){const p=d.addPage([400,560]); p.drawText(`${n} s${i}`,{x:40,y:500,size:20,font:f,color:rgb(.2,.2,.5)});}
  return await d.save(); }
writeFileSync(join(tmp,'pdf','A.pdf'), await mk('A',3));
writeFileSync(join(tmp,'pdf','B.pdf'), await mk('B',2));
const errs=[]; const b=await chromium.launch({args:['--no-sandbox']}); const ctx=await b.newContext({acceptDownloads:true}); const p=await ctx.newPage();
p.on('pageerror',e=>errs.push(e.message));
await p.goto('file://'+join(root,'dist','BajaBaja.html')); await p.waitForTimeout(900);
await p.click('button[data-who="Baja #1"]'); await p.waitForTimeout(150);
if(await p.locator('#moodModal:not(.hidden)').count()){ await p.click('.mood-btn'); await p.click('#moodSave'); }
await p.setInputFiles('#hiddenFile', join(tmp,'pdf','A.pdf')); await p.waitForTimeout(1500);

// MERGE: otvor Strany, pripoj B.pdf
await p.click('#btnPages'); await p.waitForTimeout(500);
await p.setInputFiles('#hiddenMerge', join(tmp,'pdf','B.pdf')); await p.waitForTimeout(2000);
const mergedPages = await p.locator('.page-wrap').count();
console.log('Po spojení strán:', mergedPages, '(čakané 5)');

// ROTATE strany 1
await p.keyboard.press("Escape"); await p.waitForTimeout(300); await p.click("#btnPages"); await p.waitForTimeout(600);
await p.click('.thumb .thumb-tools button[title="Otočiť vpravo"]'); await p.waitForTimeout(1800);

// SPLIT: vyber 1-2 do nového
await p.keyboard.press("Escape"); await p.waitForTimeout(300); await p.click("#btnPages"); await p.waitForTimeout(500);
await p.click('button:has-text("Rozdeliť")'); await p.waitForTimeout(300);
await p.fill('.sheet input[type=text]', '1-2');
const [dls]=await Promise.all([ p.waitForEvent('download',{timeout:15000}).catch(()=>null), p.click('button:has-text("Uložiť vybrané")') ]);
let splitPages=0; if(dls){ const o=join(tmp,'split.pdf'); await dls.saveAs(o); splitPages=(await PDFDocument.load(readFileSync(o))).getPageCount(); }
console.log('Split (1-2) strán:', splitPages, '(čakané 2)');

// COMPRESS
await p.keyboard.press('Escape'); await p.click('#btnConvert'); await p.waitForTimeout(300);
const [dlc]=await Promise.all([ p.waitForEvent('download',{timeout:20000}).catch(()=>null), p.click('.card-btn:has-text("Zmenšiť")') ]);
let compOk=false; if(dlc){ const o=join(tmp,'comp.pdf'); await dlc.saveAs(o); compOk=(await PDFDocument.load(readFileSync(o))).getPageCount()===5; }
console.log('Zmenšenie OK:', compOk);

// CLEAN META
await p.click('#btnConvert'); await p.waitForTimeout(300);
const [dlm]=await Promise.all([ p.waitForEvent('download',{timeout:15000}).catch(()=>null), p.click('.card-btn:has-text("Vyčistiť")') ]);
let metaOk=false; if(dlm){ const o=join(tmp,'clean.pdf'); await dlm.saveAs(o); const d=await PDFDocument.load(readFileSync(o)); metaOk=(d.getAuthor()||'')===''; }
console.log('Vyčistené údaje OK:', metaOk);

// SCREENSHOT prostredia
await p.keyboard.press('Escape'); await p.waitForTimeout(400);
await p.setViewportSize({width:1280,height:850});
await p.screenshot({path: join(root,'docs','nahlad.png')});

await b.close();
console.log('\n=== VERIFY3 === merge:',mergedPages===5,'| split:',splitPages===2,'| compress:',compOk,'| clean:',metaOk);
console.log(errs.length? 'CHYBY: '+errs.slice(0,6).join(' | ') : 'Žiadne chyby. ✅');
