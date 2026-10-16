/**
 * Build a small archive that links between its own files, for exercising
 * in-package Markdown navigation in a real browser.
 *
 *   node --experimental-strip-types scripts/make-link-zip.mts <out.zip>
 */
import { register } from 'node:module';
import { writeFile } from 'node:fs/promises';

register('./ts-loader.mjs', import.meta.url);

const { createZip } = await import('@/test/zipCreator.ts');

const skill = [
  '---',
  'name: link-demo',
  'description: "相对链接跳转演示"',
  '---',
  '',
  '# 链接演示',
  '',
  '- [查看接口索引](references/api-index.md)',
  '- [带锚点跳转](references/api-index.md#检索命令)',
  '- [同级目录文件](./agents/openai.yaml)',
  '- [跳出到顶层](../link-demo/SKILL.md)',
  '- [不存在的文件](references/missing.md)',
  '- [外部文档](https://example.com/docs)',
  '',
  '## 本文锚点',
  '',
  '[跳到下面](#结尾)',
  '',
  '## 结尾',
  '',
  '结束。',
].join('\n');

const index = [
  '# 接口索引',
  '',
  '## 检索命令',
  '',
  '```powershell',
  'youdaonote -s ydn search "<关键词>"',
  '```',
  '',
  '## 已知文档',
  '',
  '| 文档 | 用途 |',
  '| --- | --- |',
  '| api.md | 接口总览 |',
].join('\n');

const zip = createZip([
  { name: 'link-demo/SKILL.md', content: skill },
  { name: 'link-demo/references/api-index.md', content: index },
  { name: 'link-demo/agents/openai.yaml', content: 'interface:\n  display_name: 链接演示\n' },
]);

const out = process.argv[2] ?? 'link-demo.zip';
await writeFile(out, zip);
console.log(`wrote ${out} (${zip.byteLength} bytes)`);
