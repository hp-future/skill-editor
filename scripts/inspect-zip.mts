/**
 * Inspect a `.zip` skill package with the same code the component runs.
 *
 *   node --experimental-strip-types scripts/inspect-zip.mts <file.zip>
 *
 * Useful for verifying the browser-independent part of the pipeline (central
 * directory parsing, tree building, `SKILL.md` summarising) outside a browser.
 */
import { register } from 'node:module';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

// Let Node follow this project's bundler-style extensionless TS imports.
register('./ts-loader.mjs', import.meta.url);

const { loadSkillArchive } = await import('../src/lib/loadSkillArchive.ts');

const target = process.argv[2];
if (!target) {
  console.error('usage: node scripts/inspect-zip.mts <file.zip>');
  process.exit(2);
}

const bytes = await readFile(target);
const file = new File([bytes], basename(target), { type: 'application/zip' });
const result = await loadSkillArchive(file);

console.log(`archive      : ${file.name} (${bytes.byteLength} bytes)`);
console.log(`root         : ${result.tree.rootName}`);
console.log(`files/folders: ${result.tree.fileCount} / ${result.tree.folderCount}`);
console.log(`SKILL.md     : ${result.hasManifest ? result.manifest?.path : 'not found'}`);
if (result.manifest?.title) console.log(`title        : ${result.manifest.title}`);
if (result.manifest?.description) console.log(`description  : ${result.manifest.description}`);
console.log('\ntree:');

const print = (nodes: readonly (typeof result.tree.children)[number][], depth = 0): void => {
  for (const node of nodes) {
    const marker = node.kind === 'folder' ? '/' : `  (${node.size} B)`;
    console.log(`${'  '.repeat(depth + 1)}${node.name}${marker}`);
    if (node.kind === 'folder') print(node.children, depth + 1);
  }
};
print(result.tree.children);

// Exercise payload decompression for the manifest as well.
if (result.manifest) {
  const entry = result.archive.entries.find((item) => item.path.endsWith('SKILL.md'));
  if (entry) {
    const text = await result.archive.readText(entry);
    console.log(`\nfirst line of ${entry.path}: ${text.split('\n')[0]}`);
  }
}
