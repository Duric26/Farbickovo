import pw from '/opt/node-tools/node_modules/playwright/index.js'; const {chromium}=pw;
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path'; import { fileURLToPath } from 'node:url';
const root=join(dirname(fileURLToPath(import.meta.url)),'..'); const tmp=join(root,'.testtmp'); mkdirSync(join(tmp,'pdf'),{recursive:true});
const d=await PDFDocument.create(); const f=await d.embedFont(StandardFonts.Helvetica);
for(let i=1;i<=2;i++){const p=d.addPage([420,595]); p.drawText('Strana '+i,{x:40,y:540,size:20,font:f,color:rgb(.2,.2,.5)});}
writeFileSync(join(tmp,'pdf','W.pdf'), await d.save());
const errs=[]; const b=await chromium.launch({args:['--no-sandbox']}); const ctx=await b.newContext({acceptDownloads:true}); const p=await ctx.newPage();
p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push('C:'+m.text());});
await p.goto('file://'+join(root,'dist','BajaBaja.html')); await p.waitForTimeout(900);

// premenovanie – over text tlačidiel
const whoLabels = await p.$$eval('.who-btn', els=>els.map(e=>e.textContent.trim()));
console.log('Tlačidlá:', JSON.stringify(whoLabels));
await p.click('button[data-who="Pája 1"]'); await p.waitForTimeout(150);
if(await p.locator('#moodModal:not(.hidden)').count()){ await p.click('.mood-btn'); await p.click('#moodSave'); }
const hi = await p.textContent('#moodHi'); // už zavreté, ignoruj

await p.setInputFiles('#hiddenFile', join(tmp,'pdf','W.pdf')); await p.waitForTimeout(1500);

// COVER – nakresli čierne prekrytie a ulož, over že na strane je čierna plocha
await p.click('.tool[data-tool="cover"]');
const bx = await p.locator('.anno-layer').first().boundingBox();
await p.mouse.move(bx.x+60, bx.y+80); await p.mouse.down(); await p.mouse.move(bx.x+200, bx.y+140); await p.mouse.up();
await p.waitForTimeout(300);
const [dl]=await Promise.all([ p.waitForEvent('download',{timeout:15000}).catch(()=>null), p.click('#btnSave') ]);
let coverBlack=false;
if(dl){ const o=join(tmp,'cover.pdf'); await dl.saveAs(o);
  // render cez pdf.js a skontroluj čiernu oblasť
  const b64=readFileSync(o).toString('base64');
  coverBlack = await p.evaluate(async(b64)=>{
    const u8=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
    const doc=await window.pdfjsLib.getDocument({data:u8}).promise; const pg=await doc.getPage(1);
    const vp=pg.getViewport({scale:1}); const c=document.createElement('canvas'); c.width=vp.width;c.height=vp.height;
    await pg.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;
    const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data; let black=0;
    for(let i=0;i<d.length;i+=4){ if(d[i]<20&&d[i+1]<20&&d[i+2]<20) black++; }
    return black>200;
  }, b64);
}
console.log('Čierne prekrytie v PDF:', coverBlack);

// VODOZNAK (cez Strany)
await p.click('#btnPages'); await p.waitForTimeout(500);
await p.click('button:has-text("Vodoznak")'); await p.waitForTimeout(300);
await p.fill('.sheet input[type=text]', 'NÁVRH');
const [dlw]=await Promise.all([ p.waitForEvent('download',{timeout:15000}).catch(()=>null).then(()=>null), p.click('button:has-text("Pridať vodoznak")') ]);
await p.waitForTimeout(2000);
const afterWm = await p.locator('.page-wrap').count();
console.log('Po vodoznaku strán (ostalo):', afterWm);

// ČÍSLOVANIE
await p.keyboard.press('Escape'); await p.click('#btnPages'); await p.waitForTimeout(500);
await p.click('button:has-text("Číslovať")'); await p.waitForTimeout(300);
await p.click('button:has-text("Pridať čísla")'); await p.waitForTimeout(2000);

// PRÁZDNA STRANA
await p.keyboard.press('Escape'); await p.click('#btnPages'); await p.waitForTimeout(500);
await p.click('button:has-text("Prázdna strana")'); await p.waitForTimeout(2000);
const afterBlank = await p.locator('.page-wrap').count();
console.log('Po pridaní prázdnej strany:', afterBlank, '(čakané 3)');

// DUPLIKOVANIE prvej strany
await p.keyboard.press('Escape'); await p.click('#btnPages'); await p.waitForTimeout(600);
await p.click('.thumb button[title="Duplikovať stranu"]'); await p.waitForTimeout(2000);
const afterDup = await p.locator('.page-wrap').count();
console.log('Po duplikovaní:', afterDup, '(čakané 4)');

// TLAČ – otvorí nové okno
await p.keyboard.press('Escape'); await p.waitForTimeout(300);
const [popup]=await Promise.all([ ctx.waitForEvent('page',{timeout:10000}).catch(()=>null), p.click('#btnPrint') ]);
console.log('Tlač otvorila okno:', !!popup);

await b.close();
console.log('\n=== VERIFY4 === cover:',coverBlack,'| prázdna:',afterBlank===3,'| duplikát:',afterDup===4,'| tlač:',!!popup);
console.log(errs.length? 'CHYBY: '+errs.slice(0,8).join(' | ') : 'Žiadne chyby. ✅');
