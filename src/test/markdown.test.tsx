import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderMarkdown } from '../lib/markdown.tsx';
import { parseFrontmatter } from '../lib/frontmatter';

function html(source: string, options?: { showFrontmatter?: boolean }): string {
  const { nodes } = renderMarkdown(source, options);
  return renderToStaticMarkup(<>{nodes}</>);
}

/** Text content of rendered markup, with HTML entities decoded again. */
function textOf(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

describe('parseFrontmatter', () => {
  it('splits a leading block from the body', () => {
    const parsed = parseFrontmatter('---\nname: demo\ntags: "a, b"\n---\n# Title\n');
    expect(parsed.frontmatter).toEqual({ name: 'demo', tags: 'a, b' });
    expect(parsed.body.trim()).toBe('# Title');
  });

  it('leaves documents without frontmatter untouched', () => {
    const parsed = parseFrontmatter('# Title\n\nBody');
    expect(parsed.frontmatter).toEqual({});
    expect(parsed.body).toBe('# Title\n\nBody');
  });

  it('normalises CRLF line endings', () => {
    const parsed = parseFrontmatter('---\r\nname: demo\r\n---\r\nBody');
    expect(parsed.frontmatter.name).toBe('demo');
    expect(parsed.body).toBe('Body');
  });
});

describe('renderMarkdown', () => {
  it('renders headings with slug ids and collects them', () => {
    const result = renderMarkdown('# API 知识库调用规划\n\n## 核心约束\n');
    expect(result.headings).toEqual([
      { id: 'api-知识库调用规划', text: 'API 知识库调用规划', level: 1 },
      { id: '核心约束', text: '核心约束', level: 2 },
    ]);
    const markup = renderToStaticMarkup(<>{result.nodes}</>);
    expect(markup).toContain('<h2 id="api-知识库调用规划"');
    expect(markup).toContain('<h3 id="核心约束"');
  });

  it('keeps heading anchors unique for repeated and slug-less headings', () => {
    const result = renderMarkdown('# 核心约束\n\n## 核心约束\n\n### ？？？\n\n#### ？？？\n');

    expect(result.headings.map((heading) => heading.id)).toEqual([
      '核心约束',
      '核心约束-2',
      'section',
      'section-2',
    ]);
    const markup = renderToStaticMarkup(<>{result.nodes}</>);
    expect(markup.match(/id="核心约束"/g)).toHaveLength(1);
    expect(markup.match(/id="核心约束-2"/g)).toHaveLength(1);
  });

  it('renders inline emphasis, code and links', () => {
    const markup = html('**加粗** 与 *斜体* 以及 `code` 和 [链接](references/api-index.md)。');
    expect(markup).toContain('<strong>加粗</strong>');
    expect(markup).toContain('<em>斜体</em>');
    expect(markup).toContain('<code class="se-md__code">code</code>');
    expect(markup).toContain('href="references/api-index.md"');
  });

  it('escapes raw HTML instead of rendering it', () => {
    const markup = html('<img src=x onerror="alert(1)"> 与 <script>alert(2)</script>');
    expect(markup).not.toContain('<img');
    expect(markup).not.toContain('<script');
    expect(markup).toContain('&lt;img');
  });

  it('drops script-bearing link targets', () => {
    const markup = html('[点我](javascript:alert(1))');
    expect(markup).not.toContain('javascript:');
    expect(markup).toContain('点我');
  });

  it('renders fenced code blocks with their language and highlights tokens', () => {
    const markup = html('```json\n{"a": 1}\n```\n');
    expect(markup).toContain('data-language="json"');
    // Highlighting wraps tokens; the text content still round-trips.
    expect(textOf(markup)).toContain('{"a": 1}');
    expect(markup).toContain('se-code__property');
    expect(markup).toContain('se-code__number');
  });

  it('keeps Markdown inside code fences literal', () => {
    const markup = html('```text\n**not bold**\n```\n');
    expect(markup).not.toContain('<strong>');
    expect(textOf(markup)).toContain('**not bold**');
  });

  it('renders unordered and ordered lists', () => {
    const unordered = html('- 第一项\n- 第二项\n');
    expect(unordered).toContain('<ul class="se-md__list">');
    expect(unordered.match(/<li>/g)).toHaveLength(2);

    const ordered = html('1. 第一步\n2. 第二步\n');
    expect(ordered).toContain('<ol class="se-md__list">');
  });

  it('renders tables with alignment', () => {
    const markup = html('| 字段 | 展示名 |\n| --- | :---: |\n| `id` | 主键 ID |\n');
    expect(markup).toContain('<table class="se-md__table">');
    expect(markup).toContain('<th');
    expect(markup).toContain('text-align:center');
    expect(markup).toContain('主键 ID');
  });

  it('renders blockquotes and horizontal rules', () => {
    const markup = html('> 提示\n\n---\n');
    expect(markup).toContain('<blockquote class="se-md__quote">提示</blockquote>');
    expect(markup).toContain('<hr class="se-md__rule"');
  });

  it('shows frontmatter as a definition list by default', () => {
    const source = '---\nname: api-call-by-knowledge\ndescription: "查询接口"\n---\n\n# 标题\n';
    const withFrontmatter = html(source);
    expect(withFrontmatter).toContain('se-md__frontmatter');
    expect(withFrontmatter).toContain('api-call-by-knowledge');

    const without = html(source, { showFrontmatter: false });
    expect(without).not.toContain('se-md__frontmatter');
    expect(without).toContain('标题');
  });

  it('joins wrapped paragraph lines', () => {
    expect(html('第一行\n第二行\n')).toContain('<p class="se-md__p">第一行 第二行</p>');
  });
});
