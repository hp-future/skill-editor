import type { ReactNode } from 'react';
import { detectFileKind, extensionOf, type FileKind } from '../../lib/fileKind';

/** What a previewer needs to know about the file it is being asked to show. */
export interface PreviewFileInfo {
  /** Path inside the archive (as shown by the tree). */
  readonly path: string;
  /** Final path segment. */
  readonly name: string;
  /** Lower-case extension without the dot, or `''`. */
  readonly extension: string;
  /** How the editor classified the file. */
  readonly kind: FileKind;
  /** Uncompressed size in bytes. */
  readonly size: number;
}

/** Everything handed to a custom previewer once the payload has been read. */
export interface CustomPreviewProps {
  readonly info: PreviewFileInfo;
  /** Raw file bytes, exactly as stored in the archive. */
  readonly bytes: Uint8Array;
  /** The same bytes as a `Blob`, typed with the detected MIME type. */
  readonly blob: Blob;
  /** Object URL for `blob`; revoked automatically when the selection changes. */
  readonly objectUrl: string;
}

/** A host-supplied preview for one kind of file. */
export interface FilePreviewer {
  /** Stable identifier, used as the React key and for debugging. */
  readonly id: string;
  /** Claims a file. The first matching previewer wins. */
  readonly match: (file: PreviewFileInfo) => boolean;
  /** Renders the body of the preview pane; the header stays the editor's. */
  readonly render: (props: CustomPreviewProps) => ReactNode;
}

/** Build the description passed to `match`/`render`. */
export function describePreviewFile(path: string, size: number): PreviewFileInfo {
  return {
    path,
    name: path.slice(path.lastIndexOf('/') + 1),
    extension: extensionOf(path),
    kind: detectFileKind(path),
    size,
  };
}

/**
 * Matcher shorthand for the common "by file extension" case.
 *
 * ```ts
 * const ttf = byExtension('ttf', 'otf');
 * ```
 */
export function byExtension(
  ...extensions: readonly string[]
): (file: PreviewFileInfo) => boolean {
  const wanted = new Set(extensions.map((extension) => extension.toLowerCase().replace(/^\./, '')));
  return (file) => wanted.has(file.extension);
}

/**
 * Pick the previewer for a file.
 *
 * Registration order is the priority order: the first previewer that claims the
 * file wins, so a generic catch-all should be registered last.
 */
export function findPreviewer(
  previewers: readonly FilePreviewer[] | undefined,
  file: PreviewFileInfo,
): FilePreviewer | undefined {
  if (!previewers || previewers.length === 0) return undefined;
  for (const previewer of previewers) {
    try {
      if (previewer.match(file)) return previewer;
    } catch {
      // A throwing matcher must not take the whole editor down.
    }
  }
  return undefined;
}
