/**
 * Editable view over a read-only skill archive.
 *
 * The source `.zip` is never modified — a browser cannot write back to a `File`
 * anyway. Instead this keeps a sparse overlay of the files the user saved, and
 * re-exports by copying every untouched entry's original compressed bytes while
 * re-compressing only the edited ones.
 *
 * Scope: content edits to *existing* text files. Adding, deleting or renaming
 * entries is deliberately not part of the document model yet.
 */

import { parseZipArchive } from '../zip/zipArchive';
import type { LocatedZipEntry, ZipArchive, ZipEntry } from '../zip/zipArchive';
import { writeZipBlob } from '../zip/zipWriter';
import type { ZipWriteEntry } from '../zip/zipWriter';

/** One saved edit. */
export interface FileEdit {
  /** Path inside the archive (never rewritten by wrapper collapsing). */
  readonly path: string;
  /** The entry the edit applies to. */
  readonly entry: ZipEntry;
  /** Saved UTF-8 content. */
  readonly text: string;
  /** Encoded size in bytes, kept so callers do not re-encode to show it. */
  readonly byteLength: number;
  /** When the edit was saved. */
  readonly savedAt: Date;
}

export interface ExportStats {
  readonly files: number;
  readonly modified: number;
  readonly bytes: number;
}

export interface ExportResult {
  readonly blob: Blob;
  readonly fileName: string;
  readonly stats: ExportStats;
  /** Non-fatal notes the host should surface, e.g. dropped ZIP metadata. */
  readonly warnings: readonly string[];
}

export interface ExportOptions {
  /** Output file name; defaults to `<source name without .zip>-edited.zip`. */
  readonly fileName?: string;
  /** Progress callback, called after each entry is written. */
  readonly onProgress?: (written: number, total: number) => void;
}

export interface CreateSkillDocumentOptions {
  /** Name used to derive the export file name. */
  readonly fileName?: string;
}

/** An entry to write on export: either copied through or replaced. */
interface PreparedEntry {
  readonly write: ZipWriteEntry;
  readonly archivePath: string;
}

/** Compression method for deflate, the only method we can copy verbatim. */
const DEFLATE_METHOD = 8;

export class SkillDocument {
  readonly archive: ZipArchive;
  readonly sourceFileName: string;

  /** Raw bytes of the source archive, used to slice untouched payloads. */
  readonly #sourceBytes: Uint8Array;
  /** Every archive path, for exact and suffix lookups. */
  readonly #archivePaths: string[];
  readonly #fileNameToArchivePath = new Map<string, string>();
  /** Memoised `pathToArchive` results; `''` marks an ambiguous/unknown path. */
  readonly #resolvedPaths = new Map<string, string>();
  readonly #edits = new Map<string, FileEdit>();
  #entries: LocatedZipEntry[] | null = null;

  private constructor(archive: ZipArchive, sourceBytes: Uint8Array, sourceFileName: string) {
    this.archive = archive;
    this.#sourceBytes = sourceBytes;
    this.sourceFileName = sourceFileName;
    this.#archivePaths = archive.entries.map((entry) => entry.path);
    for (const path of this.#archivePaths) this.#fileNameToArchivePath.set(path, path);
  }

  /** Open a document from raw archive bytes. */
  static fromBytes(bytes: Uint8Array, options: CreateSkillDocumentOptions = {}): SkillDocument {
    const archive = parseZipArchive(bytes);
    return new SkillDocument(archive, bytes, options.fileName ?? 'archive.zip');
  }

  /** Open a document from a `Blob`/`File`. */
  static async fromBlob(
    blob: Blob,
    options: CreateSkillDocumentOptions = {},
  ): Promise<SkillDocument> {
    const name =
      options.fileName ??
      (typeof (blob as File).name === 'string' ? (blob as File).name : 'archive.zip');
    // Keep the bytes: untouched entries are copied straight from here on export.
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return SkillDocument.fromBytes(bytes, { fileName: name });
  }

  /**
   * Archive entries. With `prefixToStrip`, paths are rewritten relative to that
   * prefix (what the directory tree shows when a wrapper folder is collapsed)
   * while `zipEntry` keeps pointing at the original record.
   */
  entries(options: { prefixToStrip?: string } = {}): LocatedZipEntry[] {
    if (!this.#entries) this.#entries = [...this.archive.entries];
    const { prefixToStrip = '' } = options;
    if (!prefixToStrip) return this.#entries;
    const prefix = `${prefixToStrip}/`;
    return this.#entries
      .filter((entry) => entry.path.startsWith(prefix))
      .map((entry) => ({
        ...entry,
        path: entry.path.slice(prefix.length),
        zipEntry: entry,
      }));
  }

  /* ------------------------------ editing ------------------------------- */

  /** Paths with saved edits, in insertion order (archive paths). */
  get dirtyPaths(): string[] {
    return [...this.#edits.keys()];
  }

  get dirtyCount(): number {
    return this.#edits.size;
  }

  get hasUnsavedChanges(): boolean {
    return this.#edits.size > 0;
  }

  isDirty(path: string): boolean {
    const archivePath = this.pathToArchive(path);
    return archivePath !== undefined && this.#edits.has(archivePath);
  }

  /** The saved edit for a path, if any (archive path or tree-relative path). */
  getEdit(path: string): FileEdit | undefined {
    const archivePath = this.pathToArchive(path);
    return archivePath ? this.#edits.get(archivePath) : undefined;
  }

  /**
   * Save text for an existing entry and return the recorded edit.
   *
   * `path` may be the archive path or the tree-relative path, so callers can
   * pass whatever the UI is showing.
   */
  write(path: string, text: string): FileEdit {
    const archivePath = this.pathToArchive(path);
    if (!archivePath) {
      throw new Error(`找不到文件 "${path}"，无法保存。`);
    }
    const entry = this.archive.entries.find((item) => item.path === archivePath);
    if (!entry) {
      throw new Error(`找不到文件 "${path}"，无法保存。`);
    }
    const edit: FileEdit = {
      path: archivePath,
      entry,
      text,
      byteLength: new TextEncoder().encode(text).length,
      savedAt: new Date(),
    };
    this.#edits.set(archivePath, edit);
    return edit;
  }

  /** Drop the saved edit for a path, or all of them when called without one. */
  revert(path?: string): void {
    if (path === undefined) {
      this.#edits.clear();
      return;
    }
    const archivePath = this.pathToArchive(path);
    this.#edits.delete(archivePath ?? path);
  }

  /* ------------------------------ reading ------------------------------- */

  /** Current bytes of an entry: the saved edit if present, else the archive's. */
  async read(path: string): Promise<Uint8Array> {
    const archivePath = this.pathToArchive(path);
    if (!archivePath) throw new Error(`找不到文件 "${path}"。`);
    const edit = this.#edits.get(archivePath);
    if (edit) return new TextEncoder().encode(edit.text);
    const entry = this.archive.entries.find((item) => item.path === archivePath);
    if (!entry) throw new Error(`找不到文件 "${path}"。`);
    return this.archive.readEntry(entry);
  }

  /**
   * Map a user-facing path to its archive path. Accepts the exact archive path
   * or a tree-relative path, which covers names after a wrapper folder was
   * collapsed (`SKILL.md` → `api-call-by-knowledge/SKILL.md`).
   *
   * The result is cached, so repeated lookups (dirty checks run per tree row,
   * per render) stay cheap and, more importantly, stable.
   */
  pathToArchive(path: string): string | undefined {
    if (this.#fileNameToArchivePath.has(path)) return path;
    const cached = this.#resolvedPaths.get(path);
    if (cached !== undefined) return cached || undefined;

    const suffix = path.startsWith('/') ? path : `/${path}`;
    const matches = this.#archivePaths.filter((candidate) => candidate.endsWith(suffix));
    if (matches.length !== 1) {
      // Ambiguous (or unknown) paths must not silently resolve to a file.
      this.#resolvedPaths.set(path, '');
      return undefined;
    }
    this.#resolvedPaths.set(path, matches[0]);
    return matches[0];
  }

  /* ------------------------------ export -------------------------------- */

  /** Rebuild the archive as a `Blob` with every saved edit applied. */
  async exportArchive(options: ExportOptions = {}): Promise<ExportResult> {
    const entries = this.entries();
    const prepared: PreparedEntry[] = [];
    let modified = 0;
    let bytes = 0;
    let written = 0;

    for (const entry of entries) {
      if (entry.isDirectory) {
        prepared.push({
          archivePath: entry.path,
          write: { path: entry.path, directory: true, date: entry.dosDateTime ?? undefined },
        });
        continue;
      }

      const edit = this.#edits.get(entry.path);
      if (edit) {
        const data = new TextEncoder().encode(edit.text);
        modified += 1;
        bytes += data.length;
        prepared.push({
          archivePath: entry.path,
          write: { path: entry.path, data, date: new Date() },
        });
        continue;
      }

      const raw = this.#rawDeflated(entry);
      if (raw) {
        bytes += Math.max(0, entry.size);
        prepared.push({
          archivePath: entry.path,
          write: {
            path: entry.path,
            rawDeflated: raw,
            crc32: entry.crc32,
            size: entry.size,
            method: entry.compression,
            date: entry.dosDateTime ?? undefined,
          },
        });
        continue;
      }

      // Cannot be copied verbatim (streamed sizes or an exotic method):
      // decompress and write it fresh.
      const data = await this.archive.readEntry(entry);
      bytes += data.length;
      prepared.push({
        archivePath: entry.path,
        write: { path: entry.path, data, date: entry.dosDateTime ?? undefined },
      });
    }

    const writes = prepared.map((item) => item.write);
    const blob = await writeZipBlob(writes);

    if (options.onProgress) {
      for (let index = 0; index < writes.length; index += 1) {
        written = index + 1;
        options.onProgress(written, writes.length);
      }
    }

    return {
      blob,
      fileName: options.fileName ?? defaultExportName(this.sourceFileName),
      stats: { files: prepared.length, modified, bytes },
      warnings: buildWarnings(modified),
    };
  }

  /**
   * The raw DEFLATE payload of an untouched entry, sliced straight out of the
   * source bytes. Returns `null` when the entry cannot be copied verbatim.
   */
  #rawDeflated(entry: ZipEntry): Uint8Array | null {
    if (entry.compression !== DEFLATE_METHOD || entry.compressedSize < 0 || entry.isDirectory) {
      return null;
    }
    const bytes = this.#sourceBytes;
    if (entry.localHeaderOffset + 30 > bytes.byteLength) return null;

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const nameLength = view.getUint16(entry.localHeaderOffset + 26, true);
    const extraLength = view.getUint16(entry.localHeaderOffset + 28, true);
    const start = entry.localHeaderOffset + 30 + nameLength + extraLength;
    const end = start + entry.compressedSize;
    if (end > bytes.byteLength) return null;
    return bytes.subarray(start, end);
  }
}

function defaultExportName(sourceFileName: string): string {
  const base = sourceFileName.replace(/\.zip$/i, '') || 'archive';
  return `${base}-edited.zip`;
}

function buildWarnings(modified: number): string[] {
  const warnings = ['重打包会丢失源压缩包的 extra field、压缩包注释与文件属性等元数据。'];
  if (modified === 0) {
    warnings.push('本次导出没有任何内容改动，产物与原压缩包内容一致。');
  }
  return warnings;
}
