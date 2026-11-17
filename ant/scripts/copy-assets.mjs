// Skopíruje offline súbory (OCR, písma, pdf.js dáta) do public/vendor,
// aby Ant fungoval úplne bez internetu.
import { cpSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = (...p) => join(root, 'node_modules', ...p);
const out = (...p) => join(root, 'public', 'vendor', ...p);

rmSync(out(), { recursive: true, force: true });
mkdirSync(out('tess', 'lang'), { recursive: true });
mkdirSync(out('fonts'), { recursive: true });

// Tesseract (OCR)
cpSync(nm('tesseract.js', 'dist', 'worker.min.js'), out('tess', 'worker.min.js'));
for (const f of ['tesseract-core-lstm', 'tesseract-core-simd-lstm', 'tesseract-core-relaxedsimd-lstm']) {
  for (const ext of ['.wasm.js', '.wasm', '.js']) {
    const src = nm('tesseract.js-core', f + ext);
    if (existsSync(src)) cpSync(src, out('tess', f + ext));
  }
}
for (const l of ['slk', 'ces', 'eng']) {
  cpSync(nm('@tesseract.js-data', l, '4.0.0_best_int', `${l}.traineddata.gz`), out('tess', 'lang', `${l}.traineddata.gz`));
}

// pdf.js dáta
for (const d of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  if (existsSync(nm('pdfjs-dist', d))) cpSync(nm('pdfjs-dist', d), out('pdfjs', d), { recursive: true });
}

// Písma s plnou slovenskou a českou diakritikou
const fonts = ['DejaVuSans', 'DejaVuSans-Bold', 'DejaVuSans-Oblique', 'DejaVuSans-BoldOblique',
  'DejaVuSerif', 'DejaVuSerif-Bold', 'DejaVuSerif-Italic', 'DejaVuSerif-BoldItalic',
  'DejaVuSansMono', 'DejaVuSansMono-Bold', 'DejaVuSansMono-Oblique', 'DejaVuSansMono-BoldOblique',
  'DejaVuSansCondensed', 'DejaVuSansCondensed-Bold', 'DejaVuSerifCondensed', 'DejaVuSerifCondensed-Bold'];
for (const f of fonts) cpSync(nm('dejavu-fonts-ttf', 'ttf', f + '.ttf'), out('fonts', f + '.ttf'));
console.log('Ant: offline súbory pripravené v public/vendor');
