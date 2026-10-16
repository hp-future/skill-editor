/**
 * Build a throwaway `.zip` containing an image, for exercising the image branch
 * of the preview in a real browser.
 *
 *   node --experimental-strip-types scripts/make-image-zip.mts <out.zip>
 */
import { register } from 'node:module';
import { writeFile } from 'node:fs/promises';

register('./ts-loader.mjs', import.meta.url);

const { createZip } = await import('@/test/zipCreator.ts');

// 2x2 red PNG.
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGP8z8DAwMDAwMDEAAOMDAwAFvcBaZzXl0kAAAAASUVORK5CYII=',
  ),
  (char) => char.charCodeAt(0),
);

const zip = createZip([
  { name: 'demo/SKILL.md', content: '---\nname: image-demo\n---\n\n# 图片预览演示\n' },
  { name: 'demo/assets/logo.png', content: PNG, stored: true },
  { name: 'demo/notes/readme.txt', content: '纯文本预览示例。\n' },
]);

const out = process.argv[2] ?? 'image-demo.zip';
await writeFile(out, zip);
console.log(`wrote ${out} (${zip.byteLength} bytes)`);
