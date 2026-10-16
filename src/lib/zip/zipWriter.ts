/**
 * Streaming ZIP writer.
 *
 * Pairs with `zipArchive.ts`: the reader keeps every entry's raw compressed
 * bytes addressable, and this writer copies those bytes straight through for
 * untouched files while re-compressing only what actually changed. That makes
 * "edit one file, export the package" proportional to the edit, not to the
 * archive size.
 *
 * Format choices, matched to what common writers (and the sample skill package)
 * produce:
 *
 *   - general purpose flag bit 3 (data descriptor): local headers carry zero
 *     crc/sizes, the real values follow the payload. This is what lets the
 *     writer stream compression without buffering compressed output first.
 *   - deflate (method 8) for text, stored (method 0) for tiny/opaque payloads.
 *   - ZIP64 end-of-central-directory records when the archive outgrows the
 *     classic limits. Per-entry ZIP64 extra fields are deliberately *not*
 *     implemented: a payload above 4 GiB is rejected with a clear error rather
 *     than written as a broken archive.
 *   - no synthetic directory entries: the archive keeps exactly the records it
 *     is given, so re-exporting cannot invent structure the source lacked.
 */

import { Crc32 } from './crc32';

export const ZIP_METHOD = {
  Stored: 0,
  Deflated: 8,
} as const;

export type ZipMethod = (typeof ZIP_METHOD)[keyof typeof ZIP_METHOD];

/** One record to write. */
export interface ZipWriteEntry {
  /** Path inside the archive; `/` separators, no leading slash. */
  readonly path: string;
  /**
   * Raw DEFLATE bytes of the payload. Provide this to copy an untouched entry
   * without decompressing or re-compressing it; `crc32`, `size` and
   * `compressedSize` are then taken from the caller.
   */
  readonly rawDeflated?: Uint8Array;
  /** Uncompressed payload, compressed by the writer when `rawDeflated` is absent. */
  readonly data?: Uint8Array;
  /** CRC-32 of the uncompressed payload; required with `rawDeflated`. */
  readonly crc32?: number;
  /** Uncompressed size; required with `rawDeflated`. */
  readonly size?: number;
  /**
   * Compression method for a copied entry. Only stored (0) and deflate (8) are
   * supported; anything else is rejected, so the value can be fed straight from
   * a `ZipEntry.compression`.
   */
  readonly method?: number;
  /** DOS timestamp; defaults to the current time. */
  readonly date?: Date;
  /** `true` marks the record as a directory (name gets a trailing slash). */
  readonly directory?: boolean;
}

export interface ZipWriteOptions {
  /** Archive comment (max 65535 bytes once encoded as UTF-8). */
  readonly comment?: string;
  /**
   * Never use `CompressionStream`; write every entry with method 0. Useful for
   * deterministic output and for environments without the codec.
   */
  readonly storeOnly?: boolean;
}

export class ZipWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipWriteError';
  }
}

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
const CENTRAL_FILE_HEADER_SIGNATURE = 0x02014b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50;
const EOCD_SIGNATURE = 0x06054b50;
const FLAG_DATA_DESCRIPTOR = 0x08;
const FLAG_UTF8 = 0x800;
const VERSION_NEEDED = 20;
const VERSION_MADE_BY = 20;
const UINT32_MAX = 0xffff_ffff;
const UINT16_MAX = 0xffff;
const MAX_COMMENT_BYTES = 0xffff;

/* ------------------------------- helpers -------------------------------- */

/** Growable byte sink; avoids repeated concatenation costs. */
class ByteWriter {
  #buffer = new Uint8Array(64 * 1024);
  #length = 0;

  get length(): number {
    return this.#length;
  }

  #ensure(extra: number): void {
    if (this.#length + extra <= this.#buffer.length) return;
    let size = this.#buffer.length * 2;
    while (size < this.#length + extra) size *= 2;
    const grown = new Uint8Array(size);
    grown.set(this.#buffer.subarray(0, this.#length));
    this.#buffer = grown;
  }

  push(bytes: Uint8Array): void {
    this.#ensure(bytes.length);
    this.#buffer.set(bytes, this.#length);
    this.#length += bytes.length;
  }

  uint16(value: number): void {
    this.#ensure(2);
    this.#buffer[this.#length] = value & 0xff;
    this.#buffer[this.#length + 1] = (value >>> 8) & 0xff;
    this.#length += 2;
  }

  uint32(value: number): void {
    this.#ensure(4);
    this.#buffer[this.#length] = value & 0xff;
    this.#buffer[this.#length + 1] = (value >>> 8) & 0xff;
    this.#buffer[this.#length + 2] = (value >>> 16) & 0xff;
    this.#buffer[this.#length + 3] = (value >>> 24) & 0xff;
    this.#length += 4;
  }

  uint64(value: number): void {
    this.uint32(value >>> 0);
    this.uint32(Math.floor(value / 0x1_0000_0000));
  }

  /** Copy of everything written so far. */
  toBytes(): Uint8Array {
    return this.#buffer.slice(0, this.#length);
  }
}

function toDosDateTime(date: Date): { time: number; date: number } {
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107);
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: day };
}

function deflateSupported(): boolean {
  return typeof (globalThis as { CompressionStream?: unknown }).CompressionStream === 'function';
}

/** Compress with raw DEFLATE, hashing the input on the way through. */
async function deflateRaw(data: Uint8Array): Promise<{ bytes: Uint8Array; crc: number }> {
  const codec = globalThis as typeof globalThis & {
    CompressionStream?: new (format: string) => TransformStream<Uint8Array, Uint8Array>;
  };
  if (typeof codec.CompressionStream !== 'function') {
    throw new ZipWriteError('CompressionStream is unavailable in this environment.');
  }

  const crc = new Crc32().update(data).digest();
  const stream = new Blob([data.slice() as BlobPart])
    .stream()
    .pipeThrough(new codec.CompressionStream('deflate-raw'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  return { bytes, crc };
}

/* -------------------------------- writer -------------------------------- */

interface PreparedEntry {
  path: string;
  nameBytes: Uint8Array;
  method: ZipMethod;
  flags: number;
  crc: number;
  size: number;
  compressedSize: number;
  /** `rawDeflated` when copied through, otherwise compressed by this writer. */
  body: Uint8Array;
  time: number;
  date: number;
  localHeaderOffset: number;
}

/**
 * Build a ZIP archive from `entries`.
 *
 * Entries are written in the order given; the returned bytes are a complete,
 * self-contained archive suitable for `parseZipArchive` or any external tool.
 */
export async function writeZipArchive(
  entries: readonly ZipWriteEntry[],
  options: ZipWriteOptions = {},
): Promise<Uint8Array> {
  const { comment = '', storeOnly = false } = options;
  const encoder = new TextEncoder();
  const commentBytes = encoder.encode(comment);
  if (commentBytes.length > MAX_COMMENT_BYTES) {
    throw new ZipWriteError(`Archive comment is too long (${commentBytes.length} bytes).`);
  }

  const canDeflate = !storeOnly && deflateSupported();
  const out = new ByteWriter();
  const prepared: PreparedEntry[] = [];
  const now = new Date();

  // Per-entry ZIP64 extra fields are out of scope, so refuse inputs that would
  // need them instead of emitting a subtly broken archive.
  if (entries.length > UINT16_MAX - 1) {
    throw new ZipWriteError(
      `ZIP64 per-entry records are not implemented; ${entries.length} entries exceed the classic limit.`,
    );
  }
  for (const entry of entries) {
    const declared = entry.size ?? entry.data?.length ?? 0;
    if (entry.rawDeflated && entry.rawDeflated.length > UINT32_MAX) {
      throw new ZipWriteError(`Entry "${entry.path}" is larger than the 4 GiB non-ZIP64 limit.`);
    }
    if (declared > UINT32_MAX) {
      throw new ZipWriteError(`Entry "${entry.path}" is larger than the 4 GiB non-ZIP64 limit.`);
    }
  }

  for (const entry of entries) {
    const path = entry.directory
      ? entry.path.endsWith('/')
        ? entry.path
        : `${entry.path}/`
      : entry.path;
    if (entry.directory) {
      // Directory records still need a header so tools that expect them work.
      const nameBytes = encoder.encode(path);
      if (nameBytes.length > UINT16_MAX) {
        throw new ZipWriteError(`Entry path is too long for ZIP: ${path}`);
      }
      prepared.push({
        path,
        nameBytes,
        method: ZIP_METHOD.Stored,
        flags: FLAG_UTF8,
        crc: 0,
        size: 0,
        compressedSize: 0,
        body: new Uint8Array(0),
        ...toDosDateTime(entry.date ?? now),
        localHeaderOffset: 0,
      });
      continue;
    }
    const nameBytes = encoder.encode(path);
    if (nameBytes.length > UINT16_MAX) {
      throw new ZipWriteError(`Entry path is too long for ZIP: ${path}`);
    }

    let method: ZipMethod;
    let crc: number;
    let size: number;
    let body: Uint8Array;

    if (entry.rawDeflated) {
      if (entry.crc32 === undefined || entry.size === undefined) {
        throw new ZipWriteError(
          `Entry "${path}" passes raw compressed bytes, so crc32 and size are required.`,
        );
      }
      const requested = entry.method ?? ZIP_METHOD.Deflated;
      if (requested !== ZIP_METHOD.Stored && requested !== ZIP_METHOD.Deflated) {
        throw new ZipWriteError(
          `Entry "${path}" uses unsupported compression method ${requested}; only stored and deflate can be re-exported.`,
        );
      }
      method = requested;
      crc = entry.crc32;
      size = entry.size;
      body = entry.rawDeflated;
    } else {
      const data = entry.data ?? new Uint8Array(0);
      size = data.length;
      if (canDeflate && entry.method !== ZIP_METHOD.Stored) {
        const deflated = await deflateRaw(data);
        method = ZIP_METHOD.Deflated;
        crc = deflated.crc;
        body = deflated.bytes;
      } else {
        method = ZIP_METHOD.Stored;
        crc = new Crc32().update(data).digest();
        body = data.slice();
      }
    }

    if (body.length > UINT32_MAX || size > UINT32_MAX) {
      throw new ZipWriteError(`Entry "${path}" is larger than the 4 GiB non-ZIP64 limit.`);
    }

    const { time, date } = toDosDateTime(entry.date ?? now);
    prepared.push({
      path,
      nameBytes,
      method,
      flags: FLAG_UTF8 | FLAG_DATA_DESCRIPTOR,
      crc,
      size,
      compressedSize: body.length,
      body,
      time,
      date,
      localHeaderOffset: 0,
    });
  }

  // Local headers + payloads + data descriptors.
  for (const entry of prepared) {
    entry.localHeaderOffset = out.length;
    out.uint32(LOCAL_FILE_HEADER_SIGNATURE);
    out.uint16(VERSION_NEEDED);
    out.uint16(entry.flags);
    out.uint16(entry.method);
    out.uint16(entry.time);
    out.uint16(entry.date);
    out.uint32(0); // crc — lives in the data descriptor
    out.uint32(0); // compressed size — lives in the data descriptor
    out.uint32(0); // uncompressed size — lives in the data descriptor
    out.uint16(entry.nameBytes.length);
    out.uint16(0); // extra field length
    out.push(entry.nameBytes);
    out.push(entry.body);

    out.uint32(DATA_DESCRIPTOR_SIGNATURE);
    out.uint32(entry.crc);
    out.uint32(entry.compressedSize);
    out.uint32(entry.size);
  }

  // Central directory.
  const centralDirectoryOffset = out.length;
  for (const entry of prepared) {
    out.uint32(CENTRAL_FILE_HEADER_SIGNATURE);
    out.uint16(VERSION_MADE_BY);
    out.uint16(VERSION_NEEDED);
    out.uint16(entry.flags);
    out.uint16(entry.method);
    out.uint16(entry.time);
    out.uint16(entry.date);
    out.uint32(entry.crc);
    out.uint32(entry.compressedSize);
    out.uint32(entry.size);
    out.uint16(entry.nameBytes.length);
    out.uint16(0); // extra field length
    out.uint16(0); // comment length
    out.uint16(0); // disk number start
    out.uint16(0); // internal attributes
    out.uint32(entry.path.endsWith('/') ? 0x10 : 0); // external attributes: MS-DOS directory bit
    out.uint32(entry.localHeaderOffset);
    out.push(entry.nameBytes);
  }
  const centralDirectorySize = out.length - centralDirectoryOffset;

  // Entry counts are guarded above, so only the byte offsets can force ZIP64 here.
  const needsZip64 =
    centralDirectoryOffset > UINT32_MAX || centralDirectorySize > UINT32_MAX;

  if (needsZip64) {
    const zip64EocdOffset = out.length;
    out.uint32(ZIP64_EOCD_SIGNATURE);
    out.uint64(44); // size of the remaining record
    out.uint16(VERSION_MADE_BY);
    out.uint16(45); // version needed: ZIP64
    out.uint32(0); // this disk
    out.uint32(0); // disk with central directory
    out.uint64(prepared.length);
    out.uint64(prepared.length);
    out.uint64(centralDirectorySize);
    out.uint64(centralDirectoryOffset);

    out.uint32(ZIP64_EOCD_LOCATOR_SIGNATURE);
    out.uint32(0); // disk with the ZIP64 EOCD
    out.uint64(zip64EocdOffset);
    out.uint32(1); // total disks
  }

  out.uint32(EOCD_SIGNATURE);
  out.uint16(0); // this disk
  out.uint16(0); // disk with central directory
  out.uint16(Math.min(prepared.length, UINT16_MAX));
  out.uint16(Math.min(prepared.length, UINT16_MAX));
  out.uint32(Math.min(centralDirectorySize, UINT32_MAX));
  out.uint32(Math.min(centralDirectoryOffset, UINT32_MAX));
  out.uint16(commentBytes.length);
  out.push(commentBytes);

  return out.toBytes();
}

/** Convenience wrapper returning a `Blob` ready for download. */
export async function writeZipBlob(
  entries: readonly ZipWriteEntry[],
  options: ZipWriteOptions = {},
): Promise<Blob> {
  const bytes = await writeZipArchive(entries, options);
  return new Blob([bytes.slice() as BlobPart], { type: 'application/zip' });
}
