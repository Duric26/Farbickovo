import pw from '/opt/node-tools/node_modules/playwright/index.js'; const {chromium}=pw;
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { writeFileSync, mkdirSync } from 'node:fs'; import { join, dirname } from 'node:path'; import { fileURLToPath } from 'node:url';
const root=join(dirname(fileURLToPath(import.meta.url)),'..'); const tmp=join(root,'.testtmp'); mkdirSync(join(tmp,'pdf'),{recursive:true});
const d=await PDFDocument.create(); const f=await d.embedFont(StandardFonts.Helvetica);
for(let i=1;i<=2;i++){const p=d.addPage([595,842]); p.drawText('Zmluva — strana '+i,{x:60,y:770,size:22,font:f,color:rgb(.15,.15,.4)}); p.drawText('Text dokumentu pre Páju a Páju.',{x:60,y:730,size:12,font:f});}
writeFileSync(join(tmp,'pdf','S.pdf'), await d.save());
const b=await chromium.launch({args:['--no-sandbox']}); const ctx=await b.newContext(); const p=await ctx.newPage();
await p.setViewportSize({width:1280,height:860});
await p.goto('file://'+join(root,'dist','BajaBaja.html')); await p.waitForTimeout(900);
await p.click('button[data-who="obaja"]'); await p.waitForTimeout(150);
if(await p.locator('#moodModal:not(.hidden)').count()){ await p.locator('.mood-btn').nth(2).click(); await p.click('#moodSave'); }
await p.setInputFiles('#hiddenFile', join(tmp,'pdf','S.pdf')); await p.waitForTimeout(1600);
await p.click('.tool[data-tool="text"]');
const bx=await p.locator('.anno-layer').first().boundingBox();
await p.mouse.click(bx.x+120,bx.y+200); await p.waitForTimeout(200); await p.keyboard.type('Doplnené: Pája ✍');
await p.click('.tool[data-tool="select"]'); await p.waitForTimeout(300);
await p.screenshot({path: join(root,'docs','nahlad.png')});
await b.close(); console.log('screenshot OK');
