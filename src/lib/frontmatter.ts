/** Frontmatter parsing shared by the manifest summariser and the preview pane. */

export interface ParsedFrontmatter {
  /** Raw `key: value` pairs from the leading `---` block. */
  readonly frontmatter: Readonly<Record<string, string>>;
  /** Everything after the block, with the frontmatter removed. */
  readonly body: string;
}

function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/**
 * Split a Markdown document into its leading `---` frontmatter block and body.
 * A document without frontmatter is returned unchanged in `body`.
 */
export function parseFrontmatter(text: string): ParsedFrontmatter {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const frontmatter: Record<string, string> = {};

  if (lines[0]?.trim() === '---') {
    let end = -1;
    for (let i = 1; i < lines.length; i += 1) {
      if (lines[i].trim() === '---') {
        end = i;
        break;
      }
    }
    if (end !== -1) {
      for (const line of lines.slice(1, end)) {
        const match = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line.trim());
        if (!match) continue;
        frontmatter[match[1].toLowerCase()] = stripQuotes(match[2].trim());
      }
      return { frontmatter, body: lines.slice(end + 1).join('\n') };
    }
  }

  return { frontmatter, body: normalized };
}
