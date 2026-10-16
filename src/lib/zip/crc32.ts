/**
 * CRC-32 (IEEE 802.3, the variant ZIP uses).
 *
 * Shared by the read path's tests, the ZIP writer and the test-only archive
 * builder, so there is exactly one implementation to trust.
 */

const TABLE = (() => {
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

/** CRC-32 of a complete buffer. */
export function crc32(data: Uint8Array): number {
  const state = crc32Update(0xffffffff, data);
  return (state ^ 0xffffffff) >>> 0;
}

/**
 * Incremental CRC-32, used while a stream is compressed so the writer never
 * has to keep a second copy of the payload.
 */
export class Crc32 {
  #state = 0xffffffff;

  update(chunk: Uint8Array): this {
    this.#state = crc32Update(this.#state, chunk);
    return this;
  }

  /** Final checksum; the instance stays usable for further updates. */
  digest(): number {
    return (this.#state ^ 0xffffffff) >>> 0;
  }

  reset(): void {
    this.#state = 0xffffffff;
  }
}

/** Fold `data` into a running CRC state (start from `0xffffffff`). */
function crc32Update(state: number, data: Uint8Array): number {
  let crc = state >>> 0;
  for (let i = 0; i < data.length; i += 1) {
    crc = TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return crc >>> 0;
}
