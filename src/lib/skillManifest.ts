import type { LocatedZipEntry, ZipEntry } from './zip/zipArchive';
import { parseFrontmatter } from './frontmatter';

/** Frontmatter fields seen in skill manifests, kept as raw strings. */
export interface SkillManifestSummary {
  /** Path of the manifest inside the archive. */
  readonly path: string;
  /** Raw `key: value` pairs from the leading `---` block. */
  readonly frontmatter: Readonly<Record<string, string>>;
  /** Manifest title: frontmatter `name`, else the first `#` heading. */
  readonly title: string | null;
  /** Manifest description: frontmatter `description`, else the first paragraph. */
  readonly description: string | null;
}

/** Cap manifest reads so a stray huge file cannot stall loading. */
const MAX_MANIFEST_BYTES = 512 * 1024;

/**
 * Look up the `SKILL.md` manifest of an archive: prefer one at the archive root,
 * otherwise the shallowest match (archives often wrap everything in one folder).
 *
 * `pathOf` maps an entry to the path it should be reported under; the default
 * is the archive path, while callers that unwrap a top-level folder pass the
 * tree-relative path so the result lines up with `SkillTree.byPath`.
 */
export function findSkillManifest(
  entries: readonly ZipEntry[],
  pathOf: (entry: ZipEntry) => string = (entry) => entry.path,
): ZipEntry | undefined {
  const candidates = entries.filter(
    (entry) => !entry.isDirectory && entry.name.toLowerCase() === 'skill.md',
  );
  const rootManifest = candidates.find((entry) => !pathOf(entry).includes('/'));
  if (rootManifest) return rootManifest;
  return candidates
    .slice()
    .sort(
      (a, b) =>
        pathOf(a).split('/').length - pathOf(b).split('/').length ||
        pathOf(a).localeCompare(pathOf(b)),
    )[0];
}

function firstHeading(body: string): string | null {
  for (const line of body.split('\n')) {
    const match = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line.trim());
    if (match) return match[1].trim();
  }
  return null;
}

function firstParagraph(body: string): string | null {
  const blocks = body.split(/\n\s*\n/);
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    if (/^(#{1,6}\s|```|>|[-*+]\s|\d+\.\s|\|)/.test(trimmed)) continue;
    return trimmed.replace(/\s+/g, ' ');
  }
  return null;
}

/** Extract a short summary (title, description, frontmatter) from a manifest. */
export function summarizeManifest(
  entry: ZipEntry,
  text: string,
  path: string = entry.path,
): SkillManifestSummary {
  const { frontmatter, body } = parseFrontmatter(text);
  return {
    path,
    frontmatter,
    title: frontmatter.name ?? frontmatter.title ?? firstHeading(body),
    description: frontmatter.description ?? firstParagraph(body),
  };
}

/** Read and summarize the archive's `SKILL.md`, tolerating any failure. */
export async function readSkillManifest(
  entries: readonly LocatedZipEntry[],
  readText: (entry: LocatedZipEntry) => Promise<string>,
  options: { pathOf?: (entry: LocatedZipEntry) => string; limitBytes?: number } = {},
): Promise<SkillManifestSummary | undefined> {
  const { pathOf = (entry: LocatedZipEntry) => entry.path, limitBytes = MAX_MANIFEST_BYTES } = options;
  const entry = findSkillManifest(entries, pathOf);
  if (!entry) return undefined;
  const path = pathOf(entry);
  if (entry.size > limitBytes) {
    return { path, frontmatter: {}, title: null, description: null };
  }
  try {
    return summarizeManifest(entry, await readText(entry), path);
  } catch {
    return { path, frontmatter: {}, title: null, description: null };
  }
}
