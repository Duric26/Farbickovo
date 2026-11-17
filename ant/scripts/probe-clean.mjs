import pw from '/opt/node-tools/node_modules/playwright/index.js'; const {chromium}=pw;
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path'; import { fileURLToPath } from 'node:url';
const root=join(dirname(fileURLToPath(import.meta.url)),'..'); const tmp=join(root,'.testtmp'); mkdirSync(join(tmp,'pdf'),{recursive:true});
const d=await PDFDocument.create(); d.setAuthor('Tajny Autor'); d.setProducer('TajnyProgram'); d.setTitle('Nazov');
const f=await d.embedFont(StandardFonts.Helvetica); const p=d.addPage([300,200]); p.drawText('x',{x:20,y:150,size:14,font:f});
writeFileSync(join(tmp,'pdf','meta.pdf'), await d.save());
const b=await chromium.launch({args:['--no-sandbox']}); const ctx=await b.newContext({acceptDownloads:true}); const pg=await ctx.newPage();
await pg.goto('file://'+join(root,'dist','BajaBaja.html')); await pg.waitForTimeout(900);
await pg.click('button[data-who="obaja"]'); await pg.waitForTimeout(150);
if(await pg.locator('#moodModal:not(.hidden)').count()){ await pg.click('.mood-btn'); await pg.click('#moodSave'); }
await pg.setInputFiles('#hiddenFile', join(tmp,'pdf','meta.pdf')); await pg.waitForTimeout(1200);
await pg.click('#btnConvert'); await pg.waitForTimeout(400);
const [dl]=await Promise.all([ pg.waitForEvent('download',{timeout:15000}).catch(()=>null), pg.click('.card-btn:has-text("Vyčistiť")') ]);
const o=join(tmp,'clean.pdf'); await dl.saveAs(o); const doc=await PDFDocument.load(readFileSync(o));
console.log('Autor po vyčistení:', JSON.stringify(doc.getAuthor()||''), '| Program:', JSON.stringify(doc.getProducer()||''), '| Titulok:', JSON.stringify(doc.getTitle()||''));
console.log('Vyčistené OK:', (doc.getAuthor()||'')==='' && !(doc.getProducer()||'').includes('Tajny'));
await b.close();
