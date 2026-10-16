import { deflateRawSync } from 'node:zlib';

/**
 * Test-only ZIP writer. Building archives ourselves (instead of committing
 * binary fixtures) lets the reader be exercised against stored *and* deflated
 * entries, explicit directory records, data descriptors and non-ASCII names.
 */

export interface TestZipEntry {
  name: string;
  content?: string | Uint8Array;
  /** Store the entry instead of deflating it. */
  stored?: boolean;
  /** Emit an explicit directory record for `name`. */
  directory?: boolean;
  /**
   * Mark the entry as streamed (general purpose flag bit 3): the local header
   * carries no sizes, they follow the payload in a data descriptor.
   */
  dataDescriptor?: boolean;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function payloadOf(entry: TestZipEntry): Uint8Array {
  if (typeof entry.content === 'string') return new TextEncoder().encode(entry.content);
  return entry.content ?? new Uint8Array(0);
}

interface LocalRecord {
  nameBytes: Uint8Array;
  localHeader: Uint8Array;
  payload: Uint8Array;
  method: number;
  crc: number;
  uncompressedSize: number;
  flags: number;
  offset: number;
}

/** Build a ZIP archive and return its bytes. */
export function createZip(entries: readonly TestZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const locals: LocalRecord[] = [];
  const buffer: number[] = [];

  const push = (bytes: Uint8Array): void => {
    for (const byte of bytes) buffer.push(byte);
  };

  for (const entry of entries) {
    const isDirectory = entry.directory === true || entry.name.endsWith('/');
    const raw = isDirectory ? new Uint8Array(0) : payloadOf(entry);
    const method = entry.stored || isDirectory ? 0 : 8;
    const payload =
      method === 0 ? raw : new Uint8Array(deflateRawSync(Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength)));
    const crc = crc32(raw);
    const nameBytes = encoder.encode(entry.name);
    const flags = (entry.dataDescriptor ? 0x08 : 0) | 0x800;
    const offset = buffer.length;

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, flags, true);
    localView.setUint16(8, method, true);
    localView.setUint16(10, 0, true); // time
    localView.setUint16(12, 0x2821, true); // 2000-01-01
    localView.setUint32(14, entry.dataDescriptor ? 0 : crc, true);
    localView.setUint32(18, entry.dataDescriptor ? 0 : payload.length, true);
    localView.setUint32(22, entry.dataDescriptor ? 0 : raw.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    locals.push({
      nameBytes,
      localHeader,
      payload,
      method,
      crc,
      uncompressedSize: raw.length,
      flags,
      offset,
    });

    push(localHeader);
    push(payload);
    if (entry.dataDescriptor) {
      const descriptor = new Uint8Array(16);
      const view = new DataView(descriptor.buffer);
      view.setUint32(0, 0x08074b50, true);
      view.setUint32(4, crc, true);
      view.setUint32(8, payload.length, true);
      view.setUint32(12, raw.length, true);
      push(descriptor);
    }
  }

  const centralStart = buffer.length;
  for (const local of locals) {
    const record = new Uint8Array(46 + local.nameBytes.length);
    const view = new DataView(record.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, local.flags, true);
    view.setUint16(10, local.method, true);
    view.setUint16(12, 0, true);
    view.setUint16(14, 0x2821, true);
    view.setUint32(16, local.crc, true);
    view.setUint32(20, local.payload.length, true);
    view.setUint32(24, local.uncompressedSize, true);
    view.setUint16(28, local.nameBytes.length, true);
    view.setUint16(30, 0, true);
    view.setUint16(32, 0, true);
    view.setUint16(34, 0, true);
    view.setUint16(36, 0, true);
    view.setUint32(38, 0, true);
    view.setUint32(42, local.offset, true);
    record.set(local.nameBytes, 46);
    push(record);
  }
  const centralSize = buffer.length - centralStart;

  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, locals.length, true);
  eocdView.setUint16(10, locals.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, centralStart, true);
  push(eocd);

  return new Uint8Array(buffer);
}

/** Small helper: build a `File` the SkillEditor can consume. */
export function createZipFile(
  entries: readonly TestZipEntry[],
  fileName = 'sample.zip',
): File {
  const bytes = createZip(entries);
  return new File([bytes as BlobPart], fileName, { type: 'application/zip' });
}
