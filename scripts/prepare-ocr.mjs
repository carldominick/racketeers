import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const target = path.join(root, 'public', 'ocr');
await mkdir(path.join(target, 'core'), { recursive: true });
await mkdir(path.join(target, 'lang'), { recursive: true });
await copyFile(path.join(root, 'node_modules/tesseract.js/dist/worker.min.js'), path.join(target, 'worker.min.js'));
const core = path.join(root, 'node_modules/tesseract.js-core');
for (const filename of await readdir(core)) {
  if (/^tesseract-core(?:-simd|-relaxedsimd)?-lstm\.wasm(?:\.js)?$/.test(filename)) await copyFile(path.join(core, filename), path.join(target, 'core', filename));
}
await copyFile(path.join(root, 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'), path.join(target, 'lang/eng.traineddata.gz'));
for (const [source, filename] of [['tesseract.js/LICENSE.md', 'TESSERACT-LICENSE'], ['tesseract.js-core/LICENSE', 'CORE-LICENSE']]) await copyFile(path.join(root, 'node_modules', source), path.join(target, filename));
await writeFile(path.join(target, 'NOTICE.txt'), 'OCR runs locally. Tesseract.js and its core: Apache-2.0, https://github.com/naptha/tesseract.js . English traineddata: https://github.com/naptha/tessdata . Assets are copied from the npm lockfile dependencies during build.\n');
console.log('Prepared same-origin OCR worker, WebAssembly and English language assets.');
