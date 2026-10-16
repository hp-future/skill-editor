/**
 * Resolves Markdown link targets that point inside a skill package.
 *
 * Pure path logic, kept out of the components so it can be unit tested:
 * the preview asks "what does this link mean?" and this answers, leaving the
 * "which file is that?" lookup to the document/tree.
 */

export type LinkTargetKind = 'anchor' | 'internal' | 'external' | 'out-of-scope';

export interface LinkTarget {
  readonly kind: LinkTargetKind;
  /** URL-decoded, normalised archive-relative path (no `#` fragment). */
  readonly path: string;
  /** Fragment without the leading `#`, or `null`. */
  readonly fragment: string | null;
}

const EXTERNAL_PATTERN = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/**
 * Normalise a relative reference against the directory of `basePath`.
 *
 * `../` never escapes the package root: `../a.md` from `refs/b.md` resolves to
 * `a.md`, and `../../x.md` also resolves to `x.md`. Returning `null` means the
 * reference is unusable (empty or malformed).
 */
export function normalizeArchivePath(reference: string, basePath = ''): string | null {
  const cleaned = reference.replace(/\\/g, '/').trim();
  if (cleaned === '') return null;

  const baseDirectory = basePath.includes('/') ? basePath.slice(0, basePath.lastIndexOf('/')) : '';
  const segments = cleaned.startsWith('/')
    ? []
    : baseDirectory.split('/').filter(Boolean);

  for (const segment of cleaned.replace(/^\/+/, '').split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  if (segments.length === 0) return null;
  // Keep the trailing slash: it marks a directory, which callers must know.
  return cleaned.endsWith('/') ? `${segments.join('/')}/` : segments.join('/');
}

/** Classify a Markdown link target relative to the document showing it. */
export function resolveLinkTarget(href: string, basePath = ''): LinkTarget {
  const raw = href.trim();
  if (raw === '') return { kind: 'out-of-scope', path: '', fragment: null };

  // Same-document jump: `#section`, and any URL that is only a fragment.
  if (raw.startsWith('#')) {
    return { kind: 'anchor', path: basePath, fragment: decodeFragment(raw.slice(1)) };
  }

  if (EXTERNAL_PATTERN.test(raw)) {
    // A scheme (http:, mailto:, data:, javascript:) or a protocol-relative URL
    // leaves the package; `safeHref` already dropped dangerous schemes.
    return { kind: 'external', path: '', fragment: null };
  }

  if (raw.startsWith('/')) {
    // A root-absolute path addresses the host filesystem, not the package.
    return { kind: 'out-of-scope', path: '', fragment: null };
  }

  const hash = raw.indexOf('#');
  const pathPart = hash === -1 ? raw : raw.slice(0, hash);
  const fragment = hash === -1 ? null : decodeFragment(raw.slice(hash + 1));

  // `other.md#section` addresses another file *and* a heading inside it.
  if (pathPart === '') {
    return { kind: 'anchor', path: basePath, fragment };
  }
  if (pathPart.startsWith('?')) {
    // Query-only reference: nothing to navigate to.
    return { kind: 'out-of-scope', path: '', fragment };
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(pathPart);
  } catch {
    // A malformed escape sequence is not a usable path.
    return { kind: 'out-of-scope', path: '', fragment };
  }

  const path = normalizeArchivePath(decoded, basePath);
  if (!path) return { kind: 'out-of-scope', path: '', fragment };
  if (path.endsWith('/')) {
    // Directory link: the preview cannot show a folder.
    return { kind: 'out-of-scope', path, fragment };
  }
  return { kind: 'internal', path, fragment };
}

function decodeFragment(fragment: string): string | null {
  try {
    const decoded = decodeURIComponent(fragment);
    return decoded === '' ? null : decoded;
  } catch {
    return fragment === '' ? null : fragment;
  }
}
