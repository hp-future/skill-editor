/**
 * Minimal, dependency-free ZIP reader.
 *
 * Scope: read the archive index (central directory) and lazily decompress a
 * single entry on demand. This is deliberately not a full ZIP implementation —
 * it covers the subset that skill packages use in practice:
 *
 *   - stored (method 0) and deflate (method 8) entries
 *   - data descriptors (bit 3 of the general purpose flags)
 *   - ZIP64 end-of-central-directory locator
 *   - UTF-8 and CP437 entry names
 */

/** Compression methods this reader understands. */
export const CompressionMethod = {
  Stored: 0,
  Deflated: 8,
} as const;

export type CompressionMethod =
  (typeof CompressionMethod)[keyof typeof CompressionMethod];

/** One entry of the archive index. */
export interface ZipEntry {
  /** Absolute path inside the archive, using `/` separators, no leading `/`. */
  readonly path: string;
  /** Lower-case path, pre-computed for cheap filtering. */
  readonly pathLower: string;
  /** Final path segment. */
  readonly name: string;
  /** `true` when the entry name ends with `/` (an explicit directory record). */
  readonly isDirectory: boolean;
  /** Uncompressed size in bytes. `-1` when the writer used a streamed record. */
  readonly size: number;
  /** Compressed size in bytes. */
  readonly compressedSize: number;
  /** CRC-32 of the uncompressed data. */
  readonly crc32: number;
  /** Compression method used for this entry. */
  readonly compression: number;
  /** MS-DOS date/time as stored in the record, or `null` when absent. */
  readonly dosDateTime: Date | null;
  /** Byte offset of the local file header. */
  readonly localHeaderOffset: number;
  /** Raw general purpose bit flag. */
  readonly flags: number;
}

/**
 * An entry that may point back at the record it should read its payload from.
 *
 * Consumers that rewrite paths (for example when a wrapper folder is collapsed)
 * copy the entry with a new `path` and set `zipEntry` to the original record, so
 * payload reads still resolve against the archive.
 */
export type LocatedZipEntry = ZipEntry & { readonly zipEntry?: ZipEntry };

export interface ZipArchive {
  /** Every entry, in central-directory order. */
  readonly entries: readonly ZipEntry[];
  /** Uncompressed payload for one entry. */
  readEntry(entry: ZipEntry): Promise<Uint8Array>;
  /** Uncompressed payload decoded as UTF-8 text. */
  readText(entry: ZipEntry): Promise<string>;
  /** Uncompressed payload decoded as a Blob. */
  readBlob(entry: ZipEntry, mimeType?: string): Promise<Blob>;
}

export class ZipFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipFormatError';
  }
}

const EOCD_SIGNATURE = 0x06054b50;
const EOCD_MIN_SIZE = 22;
const MAX_COMMENT_SIZE = 0xffff;
const CENTRAL_FILE_HEADER_SIGNATURE = 0x02014b50;
const CENTRAL_FILE_HEADER_SIZE = 46;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const LOCAL_FILE_HEADER_SIZE = 30;
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const FLAG_ENCRYPTED = 0x1;
const FLAG_UTF8 = 0x800;
const UTF8_DECODER = new TextDecoder('utf-8');
const CP437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00a0';

function readUint16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function readUint32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function readUint64(view: DataView, offset: number): number {
  const low = view.getUint32(offset, true);
  const high = view.getUint32(offset + 4, true);
  return high * 0x1_0000_0000 + low;
}

/** Find the end-of-central-directory record by scanning backwards. */
function findEndOfCentralDirectory(view: DataView): number {
  const length = view.byteLength;
  if (length < EOCD_MIN_SIZE) {
    throw new ZipFormatError(
      `File is too small to be a ZIP archive (${length} bytes).`,
    );
  }
  const earliest = Math.max(0, length - EOCD_MIN_SIZE - MAX_COMMENT_SIZE);
  for (let offset = length - EOCD_MIN_SIZE; offset >= earliest; offset -= 1) {
    if (readUint32(view, offset) === EOCD_SIGNATURE) {
      const commentLength = readUint16(view, offset + 20);
      if (offset + EOCD_MIN_SIZE + commentLength <= length) {
        return offset;
      }
    }
  }
  throw new ZipFormatError('Not a ZIP archive: end-of-central-directory record not found.');
}

/** Resolve the central-directory offset, following the ZIP64 locator when present. */
function resolveCentralDirectory(view: DataView, eocdOffset: number): {
  offset: number;
  entryCount: number;
} {
  let offset = readUint32(view, eocdOffset + 16);
  let entryCount = readUint16(view, eocdOffset + 10);

  const locatorOffset = eocdOffset - 20;
  const needsZip64 =
    offset === 0xffff_ffff ||
    entryCount === 0xffff ||
    (locatorOffset >= 0 &&
      readUint32(view, locatorOffset) === ZIP64_EOCD_LOCATOR_SIGNATURE);

  if (!needsZip64 || locatorOffset < 0) {
    return { offset, entryCount };
  }

  const zip64Offset = readUint64(view, locatorOffset + 8);
  if (
    zip64Offset + 56 > view.byteLength ||
    readUint32(view, zip64Offset) !== ZIP64_EOCD_SIGNATURE
  ) {
    throw new ZipFormatError('ZIP64 end-of-central-directory record is missing or truncated.');
  }
  entryCount = readUint64(view, zip64Offset + 32);
  offset = readUint64(view, zip64Offset + 48);
  return { offset, entryCount };
}

function decodeName(bytes: Uint8Array, flags: number): string {
  if ((flags & FLAG_UTF8) !== 0) {
    return UTF8_DECODER.decode(bytes);
  }
  let ascii = true;
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] >= 0x80) {
      ascii = false;
      break;
    }
  }
  if (ascii) return UTF8_DECODER.decode(bytes);
  // Legacy writers (and Windows' "send to > compressed folder") use CP437.
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i];
    out += byte < 0x80 ? String.fromCharCode(byte) : CP437_HIGH[byte - 0x80];
  }
  return out;
}

function normalizePath(rawName: string, isDirectory: boolean): string {
  let name = rawName.replace(/\\/g, '/');
  while (name.startsWith('/')) name = name.slice(1);
  if (isDirectory && !name.endsWith('/')) name += '/';
  return name;
}

function toDosDateTime(date: number, time: number): Date | null {
  if (date === 0 && time === 0) return null;
  const year = 1980 + ((date >> 9) & 0x7f);
  const month = ((date >> 5) & 0x0f) - 1;
  const day = date & 0x1f;
  const hours = (time >> 11) & 0x1f;
  const minutes = (time >> 5) & 0x3f;
  const seconds = (time & 0x1f) * 2;
  const parsed = new Date(year, month, day, hours, minutes, seconds);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isImplausibleDate(value: Date): boolean {
  return value.getFullYear() < 1980 || value.getFullYear() > 2107;
}

/** Build the archive index without decompressing any payload. */
export function parseZipArchive(buffer: ArrayBuffer | Uint8Array): ZipArchive {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const eocdOffset = findEndOfCentralDirectory(view);
  const { offset: cdOffset, entryCount } = resolveCentralDirectory(view, eocdOffset);

  if (cdOffset > view.byteLength) {
    throw new ZipFormatError('Central directory offset points past the end of the file.');
  }

  const entries: ZipEntry[] = [];
  const decoder = new TextDecoder('utf-8');
  let cursor = cdOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + CENTRAL_FILE_HEADER_SIZE > view.byteLength) {
      throw new ZipFormatError(
        `Central directory ended early: expected ${entryCount} entries, found ${index}.`,
      );
    }
    if (readUint32(view, cursor) !== CENTRAL_FILE_HEADER_SIGNATURE) {
      throw new ZipFormatError(`Corrupt central directory at byte ${cursor}.`);
    }

    const flags = readUint16(view, cursor + 8);
    const compression = readUint16(view, cursor + 10);
    const dosTime = readUint16(view, cursor + 12);
    const dosDate = readUint16(view, cursor + 14);
    const crc32 = readUint32(view, cursor + 16);
    let compressedSize = readUint32(view, cursor + 20);
    let size = readUint32(view, cursor + 24);
    const nameLength = readUint16(view, cursor + 28);
    const extraLength = readUint16(view, cursor + 30);
    const commentLength = readUint16(view, cursor + 32);
    let localHeaderOffset = readUint32(view, cursor + 42);

    const nameStart = cursor + CENTRAL_FILE_HEADER_SIZE;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > view.byteLength) {
      throw new ZipFormatError('Central directory entry has a truncated file name.');
    }
    const rawName = decodeName(bytes.subarray(nameStart, nameEnd), flags);

    // ZIP64 extended information extra field.
    if (
      size === 0xffff_ffff ||
      compressedSize === 0xffff_ffff ||
      localHeaderOffset === 0xffff_ffff
    ) {
      const extraStart = nameEnd;
      const extraEnd = Math.min(extraStart + extraLength, view.byteLength);
      let extra = extraStart;
      while (extra + 4 <= extraEnd) {
        const headerId = readUint16(view, extra);
        const dataSize = readUint16(view, extra + 2);
        const dataStart = extra + 4;
        if (headerId === 0x0001) {
          let field = dataStart;
          if (size === 0xffff_ffff && field + 8 <= extraEnd) {
            size = readUint64(view, field);
            field += 8;
          }
          if (compressedSize === 0xffff_ffff && field + 8 <= extraEnd) {
            compressedSize = readUint64(view, field);
            field += 8;
          }
          if (localHeaderOffset === 0xffff_ffff && field + 8 <= extraEnd) {
            localHeaderOffset = readUint64(view, field);
          }
          break;
        }
        extra = dataStart + dataSize;
      }
    }

    if ((flags & FLAG_ENCRYPTED) !== 0) {
      throw new ZipFormatError(
        `Entry "${rawName}" is encrypted; encrypted archives are not supported.`,
      );
    }

    const isDirectory = rawName.endsWith('/') || rawName.endsWith('\\');
    const path = normalizePath(rawName, isDirectory);
    const normalizedName = path.endsWith('/') ? path.slice(0, -1) : path;
    const slash = normalizedName.lastIndexOf('/');
    const parsedDate = toDosDateTime(dosDate, dosTime);
    const dosDateTime =
      parsedDate && !isImplausibleDate(parsedDate) ? parsedDate : null;

    entries.push({
      path,
      pathLower: path.toLowerCase(),
      name: slash === -1 ? normalizedName : normalizedName.slice(slash + 1),
      isDirectory,
      size,
      compressedSize,
      crc32,
      compression,
      dosDateTime,
      localHeaderOffset,
      flags,
    });

    cursor = nameEnd + extraLength + commentLength;
  }

  async function readEntry(entry: ZipEntry): Promise<Uint8Array> {
    const start = entry.localHeaderOffset;
    if (start + LOCAL_FILE_HEADER_SIZE > view.byteLength) {
      throw new ZipFormatError(`Entry "${entry.path}" has a truncated local header.`);
    }
    if (readUint32(view, start) !== LOCAL_FILE_HEADER_SIGNATURE) {
      throw new ZipFormatError(`Entry "${entry.path}" has an invalid local header.`);
    }
    const localNameLength = readUint16(view, start + 26);
    const localExtraLength = readUint16(view, start + 28);
    const dataStart = start + LOCAL_FILE_HEADER_SIZE + localNameLength + localExtraLength;
    const available = view.byteLength - dataStart;
    const dataLength = entry.compressedSize >= 0 ? entry.compressedSize : available;

    if (dataStart > view.byteLength || dataLength > available) {
      throw new ZipFormatError(`Entry "${entry.path}" has a truncated payload.`);
    }
    const payload = bytes.subarray(dataStart, dataStart + dataLength);

    switch (entry.compression) {
      case CompressionMethod.Stored:
        return payload.slice();
      case CompressionMethod.Deflated:
        return inflateRaw(payload);
      default:
        throw new ZipFormatError(
          `Entry "${entry.path}" uses unsupported compression method ${entry.compression}.`,
        );
    }
  }

  return {
    entries,
    readEntry,
    async readText(entry) {
      return decoder.decode(await readEntry(entry));
    },
    async readBlob(entry, mimeType = 'application/octet-stream') {
      // Copy so the Blob never aliases a larger backing buffer.
      const data = await readEntry(entry);
      return new Blob([data.slice()], { type: mimeType });
    },
  };
}

/** Decompress a raw DEFLATE stream using the platform codec. */
async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const codec = globalThis as typeof globalThis & {
    DecompressionStream?: new (format: string) => TransformStream<Uint8Array, Uint8Array>;
  };
  if (typeof codec.DecompressionStream !== 'function') {
    throw new ZipFormatError(
      'This environment cannot decompress DEFLATE data (DecompressionStream is unavailable).',
    );
  }

  const stream = new Blob([data.slice()])
    .stream()
    .pipeThrough(new codec.DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Parse an archive straight from a `File`, `Blob` or URL response body. */
export async function parseZipArchiveFromBlob(
  source: Blob | ArrayBuffer | Uint8Array,
): Promise<ZipArchive> {
  if (source instanceof Uint8Array || source instanceof ArrayBuffer) {
    return parseZipArchive(source);
  }
  return parseZipArchive(await source.arrayBuffer());
}

/** `true` when the bytes start with a ZIP local file header. */
export function looksLikeZip(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 4) return false;
  const signature =
    bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24);
  return (
    signature === LOCAL_FILE_HEADER_SIGNATURE ||
    signature === EOCD_SIGNATURE ||
    signature === 0x08074b50 // spanned/split marker
  );
}
