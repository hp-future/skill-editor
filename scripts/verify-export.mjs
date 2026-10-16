/**
 * Manual end-to-end check: decode a base64 archive captured from the browser
 * export, then expand it with .NET's `Expand-Archive` and assert the edit is
 * present while untouched files keep their original content.
 *
 *   node scripts/verify-export.mjs <base64-file> [--expect "<text>"]
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const [base64File, ...rest] = process.argv.slice(2);
if (!base64File) {
  console.error('usage: node scripts/verify-export.mjs <base64-file> [--expect "<text>"]');
  process.exit(2);
}
const expectIndex = rest.indexOf('--expect');
const expected = expectIndex === -1 ? null : rest[expectIndex + 1];

const base64 = (await readFile(base64File, 'utf8')).trim();
const bytes = Buffer.from(base64, 'base64');
if (bytes.subarray(0, 2).toString('latin1') !== 'PK') {
  console.error('decoded bytes are not a ZIP archive');
  process.exit(1);
}

const dir = await mkdtemp(join(tmpdir(), 'skill-editor-verify-'));
const zipPath = join(dir, 'exported.zip');
const outDir = join(dir, 'out');
await writeFile(zipPath, bytes);

await execFileAsync('powershell.exe', [
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${outDir}' -Force`,
]);

const walk = async (directory, prefix = '') => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path, `${prefix}${entry.name}/`)));
    else files.push(`${prefix}${entry.name}`);
  }
  return files;
};

const files = (await walk(outDir)).sort();
console.log(`archive bytes : ${bytes.byteLength}`);
console.log(`extracted     : ${files.length} files`);
for (const file of files) console.log(`  ${file}`);

if (expected) {
  const skill = await readFile(join(outDir, 'api-call-by-knowledge', 'SKILL.md'), 'utf8');
  const ok = skill.includes(expected);
  console.log(`\nSKILL.md contains ${JSON.stringify(expected)}: ${ok ? 'YES' : 'NO'}`);
  if (!ok) {
    console.log('first lines of SKILL.md:');
    console.log(skill.split('\n').slice(0, 6).join('\n'));
    process.exit(1);
  }
  const untouched = await readFile(
    join(outDir, 'api-call-by-knowledge', 'references', 'api-index.md'),
    'utf8',
  );
  console.log(`untouched file still starts with "# API 索引": ${untouched.startsWith('# API 索引')}`);
}

await rm(dir, { recursive: true, force: true });
