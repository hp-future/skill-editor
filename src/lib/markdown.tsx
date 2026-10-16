/**
 * Small, dependency-free Markdown renderer for the preview pane.
 *
 * It deliberately supports a subset — headings, paragraphs, lists, tables,
 * fenced code, blockquotes, rules and inline emphasis/links/code — because it
 * only ever renders files from an uploaded archive. All text is escaped and
 * link targets are filtered, so a hostile archive cannot inject markup.
 */
import { createElement, Fragment, type ReactNode } from 'react';
import { parseFrontmatter } from './frontmatter';

export interface MarkdownHeading {
  readonly id: string;
  readonly text: string;
  readonly level: number;
}

export interface RenderedMarkdown {
  readonly nodes: readonly ReactNode[];
  readonly frontmatter: Readonly<Record<string, string>>;
  readonly headings: readonly MarkdownHeading[];
}

export interface MarkdownOptions {
  /** Render the leading frontmatter block as a definition list. Default `true`. */
  showFrontmatter?: boolean;
}

/* ------------------------------- inline -------------------------------- */

type InlineToken =
  | { type: 'text'; value: string }
  | { type: 'code'; value: string }
  | { type: 'strong'; value: string }
  | { type: 'em'; value: string }
  | { type: 'del'; value: string }
  | { type: 'link'; href: string; value: string };

const INLINE_PATTERN =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*|__[^_\n]+__)|(\*[^*\n]+\*|(?<![\w*])_[^_\n]+_(?![\w*]))|(~~[^~\n]+~~)|(\[[^\]\n]*\]\([^()\s]*(?:\([^()]*\)[^()\s]*)*\))/;

/** Only allow targets that cannot execute script when clicked. */
function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (/^(https?:|mailto:|#|\/|\.\/|\.\.\/)/i.test(href)) return href;
  // Relative paths without a scheme, e.g. `references/api-index.md`.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) return href;
  return null;
}

function tokenizeInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let rest = text;

  while (rest.length > 0) {
    const match = INLINE_PATTERN.exec(rest);
    if (!match || match.index === undefined) break;
    if (match.index > 0) tokens.push({ type: 'text', value: rest.slice(0, match.index) });
    const [raw] = match;

    if (raw.startsWith('`')) {
      tokens.push({ type: 'code', value: raw.slice(1, -1) });
    } else if (raw.startsWith('**') || raw.startsWith('__')) {
      tokens.push({ type: 'strong', value: raw.slice(2, -2) });
    } else if (raw.startsWith('~~')) {
      tokens.push({ type: 'del', value: raw.slice(2, -2) });
    } else if (raw.startsWith('[')) {
      const closing = raw.lastIndexOf('](');
      const label = raw.slice(1, closing);
      const href = safeHref(raw.slice(closing + 2, -1));
      if (href) tokens.push({ type: 'link', href, value: label });
      else tokens.push({ type: 'text', value: label });
    } else {
      tokens.push({ type: 'em', value: raw.slice(1, -1) });
    }

    rest = rest.slice(match.index + raw.length);
  }

  if (rest.length > 0) tokens.push({ type: 'text', value: rest });
  return tokens;
}

let keySeed = 0;
const nextKey = (): string => `md-${(keySeed += 1)}`;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return tokenizeInline(text).map((token, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (token.type) {
      case 'text':
        return <Fragment key={key}>{token.value}</Fragment>;
      case 'code':
        return (
          <code key={key} className="se-md__code">
            {token.value}
          </code>
        );
      case 'strong':
        return <strong key={key}>{renderInline(token.value, `${key}s`)}</strong>;
      case 'em':
        return <em key={key}>{renderInline(token.value, `${key}e`)}</em>;
      case 'del':
        return <del key={key}>{renderInline(token.value, `${key}d`)}</del>;
      case 'link':
        return (
          <a key={key} className="se-md__link" href={token.href} target="_blank" rel="noreferrer noopener">
            {renderInline(token.value, `${key}l`)}
          </a>
        );
      default:
        return null;
    }
  });
}

/* -------------------------------- blocks ------------------------------- */

type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; lines: string[] }
  | { type: 'code'; language: string | null; lines: string[] }
  | { type: 'list'; ordered: boolean; items: string[][] }
  | { type: 'quote'; lines: string[] }
  | { type: 'rule' }
  | { type: 'table'; head: string[]; rows: string[][]; align: (('left' | 'center' | 'right') | null)[] };

const HEADING_PATTERN = /^(#{1,6})\s+(.*)$/;
const LIST_PATTERN = /^([-*+]|\d{1,9}[.)])\s+(.*)$/;
const RULE_PATTERN = /^ {0,3}([-*_])\s*(?:\1\s*){2,}$/;
const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)\s*$/;

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < trimmed.length; i += 1) {
    const char = trimmed[i];
    if (char === '\\' && trimmed[i + 1] === '|') {
      current += '|';
      i += 1;
      continue;
    }
    if (char === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function parseAlignments(line: string): (('left' | 'center' | 'right') | null)[] {
  return splitTableRow(line).map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return null;
  });
}

/** `| --- | :--: |` style divider row that turns the previous row into a header. */
function isTableDivider(line: string | undefined): boolean {
  if (!line || !line.includes('-')) return false;
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

function parseBlocks(body: string): Block[] {
  const lines = body.split('\n');
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.trim() === '') {
      index += 1;
      continue;
    }

    const fence = FENCE_PATTERN.exec(line);
    if (fence) {
      const marker = fence[1][0];
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !new RegExp(`^ {0,3}${marker}{3,}\\s*$`).test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      index += 1; // closing fence (or EOF)
      blocks.push({ type: 'code', language: fence[2] || null, lines: codeLines });
      continue;
    }

    const heading = HEADING_PATTERN.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() });
      index += 1;
      continue;
    }

    if (RULE_PATTERN.test(line)) {
      blocks.push({ type: 'rule' });
      index += 1;
      continue;
    }

    if (/^ {0,3}>/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && (/^ {0,3}>/.test(lines[index]) || lines[index].trim() === '')) {
        if (lines[index].trim() === '' && !/^ {0,3}>/.test(lines[index + 1] ?? '')) break;
        quoteLines.push(lines[index].replace(/^ {0,3}>\s?/, ''));
        index += 1;
      }
      blocks.push({ type: 'quote', lines: quoteLines });
      continue;
    }

    const list = LIST_PATTERN.exec(line);
    if (list) {
      const ordered = /\d/.test(list[1]);
      const items: string[][] = [];
      let current: string[] | null = null;
      while (index < lines.length) {
        const itemLine = lines[index];
        const match = LIST_PATTERN.exec(itemLine);
        if (match) {
          if (current) items.push(current);
          current = [match[2]];
          index += 1;
          continue;
        }
        // Continuation lines of the current item (lazy or indented).
        if (current && itemLine.trim() !== '' && /^\s{2,}/.test(itemLine)) {
          current.push(itemLine.trim());
          index += 1;
          continue;
        }
        break;
      }
      if (current) items.push(current);
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    // A table needs a header row followed by a divider row.
    if (line.includes('|') && isTableDivider(lines[index + 1] ?? '')) {
      const head = splitTableRow(line);
      const align = parseAlignments(lines[index + 1]);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].includes('|') && lines[index].trim() !== '') {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      blocks.push({ type: 'table', head, rows, align });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const next = lines[index];
      if (
        next.trim() === '' ||
        HEADING_PATTERN.test(next) ||
        FENCE_PATTERN.test(next) ||
        LIST_PATTERN.test(next) ||
        RULE_PATTERN.test(next) ||
        /^ {0,3}>/.test(next)
      ) {
        break;
      }
      paragraphLines.push(next);
      index += 1;
    }
    blocks.push({ type: 'paragraph', lines: paragraphLines });
  }

  return blocks;
}

function slugify(text: string, fallback: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

/* -------------------------------- render ------------------------------- */

/** Render Markdown to React nodes (no `dangerouslySetInnerHTML` anywhere). */
export function renderMarkdown(source: string, options: MarkdownOptions = {}): RenderedMarkdown {
  const { showFrontmatter = true } = options;
  const { frontmatter, body } = parseFrontmatter(source);
  const blocks = parseBlocks(body);
  const nodes: ReactNode[] = [];
  const headings: MarkdownHeading[] = [];
  const entries = Object.entries(frontmatter);

  if (showFrontmatter && entries.length > 0) {
    nodes.push(
      <dl key={nextKey()} className="se-md__frontmatter">
        {entries.map(([key, value]) => (
          <Fragment key={`${key}`}>
            <dt>{key}</dt>
            <dd>{renderInline(value, `fm-${key}`)}</dd>
          </Fragment>
        ))}
      </dl>,
    );
  }

  blocks.forEach((block, index) => {
    const key = `block-${index}`;
    switch (block.type) {
      case 'heading': {
        const id = slugify(block.text, `section-${index}`);
        headings.push({ id, text: block.text, level: block.level });
        nodes.push(
          createElement(
            `h${Math.min(block.level + 1, 6)}`,
            { key, id, className: `se-md__heading se-md__h${block.level}` },
            renderInline(block.text, key),
          ),
        );
        break;
      }
      case 'paragraph':
        nodes.push(
          <p key={key} className="se-md__p">
            {renderInline(block.lines.join(' '), key)}
          </p>,
        );
        break;
      case 'code':
        nodes.push(
          <pre key={key} className="se-md__pre" data-language={block.language ?? undefined}>
            <code>{block.lines.join('\n')}</code>
          </pre>,
        );
        break;
      case 'rule':
        nodes.push(<hr key={key} className="se-md__rule" />);
        break;
      case 'quote':
        nodes.push(
          <blockquote key={key} className="se-md__quote">
            {renderInline(block.lines.join(' '), key)}
          </blockquote>,
        );
        break;
      case 'list': {
        const items = block.items.map((item, itemIndex) => (
          <li key={`${key}-${itemIndex}`}>{renderInline(item.join(' '), `${key}-${itemIndex}`)}</li>
        ));
        nodes.push(
          block.ordered ? (
            <ol key={key} className="se-md__list">
              {items}
            </ol>
          ) : (
            <ul key={key} className="se-md__list">
              {items}
            </ul>
          ),
        );
        break;
      }
      case 'table':
        nodes.push(
          <div key={key} className="se-md__table-wrap">
            <table className="se-md__table">
              <thead>
                <tr>
                  {block.head.map((cell, cellIndex) => (
                    <th key={`${key}-h-${cellIndex}`} style={{ textAlign: block.align[cellIndex] ?? undefined }}>
                      {renderInline(cell, `${key}-h-${cellIndex}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={`${key}-r-${rowIndex}`}>
                    {row.map((cell, cellIndex) => (
                      <td
                        key={`${key}-r-${rowIndex}-${cellIndex}`}
                        style={{ textAlign: block.align[cellIndex] ?? undefined }}
                      >
                        {renderInline(cell, `${key}-r-${rowIndex}-${cellIndex}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        );
        break;
      default:
        break;
    }
  });

  return { nodes, frontmatter, headings };
}
