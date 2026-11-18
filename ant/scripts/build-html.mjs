// Baja & Baja – poskladá jeden samostatný HTML súbor.
// Knižnice (pdf.js, pdf-lib, fontkit), písma a kód appky vloží priamo dovnútra,
// aby sa súbor dal poslať mailom a otvoriť dvojklikom aj bez internetu.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const r = (...p) => readFileSync(join(root, ...p), 'utf8');
const rb = (...p) => readFileSync(join(root, ...p));
const nm = (...p) => join(root, 'node_modules', ...p);

// Vložené reťazce nesmú obsahovať </script>, inak by sa HTML rozbilo.
const guard = (s) => s.replace(/<\/script/gi, '<\\/script');
const b64 = (buf) => Buffer.from(buf).toString('base64');

// --- pdf.js hlavná knižnica: export{...} premeníme na globálnu premennú ---
let pdfMain = readFileSync(nm('pdfjs-dist', 'build', 'pdf.min.mjs'), 'utf8');
pdfMain = pdfMain.replace(/export\s*\{([^}]*)\}\s*;?\s*$/, (_, names) => {
  const pairs = names.split(',').map((seg) => {
    const parts = seg.trim().split(/\s+as\s+/);
    return parts.length === 2 ? `${parts[1].trim()}:${parts[0].trim()}` : `${parts[0].trim()}:${parts[0].trim()}`;
  });
  return `;globalThis.pdfjsLib={${pairs.join(',')}};globalThis.dispatchEvent(new Event('pdfjs-ready'));`;
});
if (!/globalThis\.pdfjsLib=/.test(pdfMain)) throw new Error('Nepodarilo sa premeniť export pdf.js');

// --- pdf.js worker: vložíme ako base64, appka z neho spraví Blob URL ---
const pdfWorkerB64 = b64(rb('node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs'));

// --- pdf-lib + fontkit (UMD, nastavia si globálne premenné samy) ---
const pdfLib = r('node_modules', 'pdf-lib', 'dist', 'pdf-lib.min.js');
const fontkit = r('node_modules', '@pdf-lib', 'fontkit', 'dist', 'fontkit.umd.min.js');

// --- Písma s plnou diakritikou (pre pridávanie vlastného textu) ---
const fontFiles = {
  sans: 'DejaVuSans.ttf',
  sansB: 'DejaVuSans-Bold.ttf',
  sansI: 'DejaVuSans-Oblique.ttf',
  sansBI: 'DejaVuSans-BoldOblique.ttf',
  serif: 'DejaVuSerif.ttf',
  serifB: 'DejaVuSerif-Bold.ttf',
  serifI: 'DejaVuSerif-Italic.ttf',
  serifBI: 'DejaVuSerif-BoldItalic.ttf',
  mono: 'DejaVuSansMono.ttf',
  monoB: 'DejaVuSansMono-Bold.ttf',
  monoI: 'DejaVuSansMono-Oblique.ttf',
  monoBI: 'DejaVuSansMono-BoldOblique.ttf',
};
const fonts = {};
for (const [k, f] of Object.entries(fontFiles)) fonts[k] = b64(rb('node_modules', 'dejavu-fonts-ttf', 'ttf', f));

// --- fflate (na tvorbu .zip a .docx) ---
const fflate = r('node_modules', 'fflate', 'umd', 'index.js');

const css = r('src', 'styles.css');
const appJs = r('src', 'app.js');
let template = r('src', 'template.html');

const vendorScripts = [
  `<script type="module">\n${guard(pdfMain)}\n</script>`,
  `<script>\n${guard(pdfLib)}\n</script>`,
  `<script>\n${guard(fontkit)}\n</script>`,
  `<script>\n${guard(fflate)}\n</script>`,
  `<script>\nwindow.__ASSETS__=${JSON.stringify({ worker: pdfWorkerB64, fonts })};\n</script>`,
].join('\n');

// Pozor: náhradný text obsahuje znaky $ (minifikovaný kód), preto funkcia,
// inak by String.replace interpretoval $&, $', $` a kód by sa poškodil.
template = template
  .replace('<!--STYLES-->', () => `<style>\n${css}\n</style>`)
  .replace('<!--VENDOR-->', () => vendorScripts)
  .replace('<!--APP-->', () => `<script type="module">\n${guard(appJs)}\n</script>`);

mkdirSync(join(root, 'dist'), { recursive: true });
const out = join(root, 'dist', 'BajaBaja.html');
writeFileSync(out, template);
const mb = (Buffer.byteLength(template) / 1048576).toFixed(1);
console.log(`Hotovo: dist/BajaBaja.html (${mb} MB)`);
