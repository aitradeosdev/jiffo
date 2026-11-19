/**
 * Just enough CBOR (RFC 8949) to read Apple App Attest's attestations and assertions: unsigned and negative
 * integers, byte and text strings, arrays, maps, and true, false and null, all of definite length. Anything
 * else is refused, as is data past the end.
 */
export type Cbor = number | Buffer | string | Cbor[] | Map<Cbor, Cbor> | boolean | null;

export class CborError extends Error {}

export function decodeCbor(data: Buffer): Cbor {
  const reader = { data, at: 0 };
  const value = read(reader, 0);
  if (reader.at !== data.length) throw new CborError('Data past the end');
  return value;
}

interface Reader {
  data: Buffer;
  at: number;
}

function take(r: Reader, n: number) {
  if (n < 0 || r.at + n > r.data.length) throw new CborError('Data ends early');
  const out = r.data.subarray(r.at, r.at + n);
  r.at += n;
  return out;
}

function argument(r: Reader, info: number): number {
  if (info < 24) return info;
  if (info === 24) return take(r, 1).readUInt8(0);
  if (info === 25) return take(r, 2).readUInt16BE(0);
  if (info === 26) return take(r, 4).readUInt32BE(0);
  if (info === 27) {
    const big = take(r, 8).readBigUInt64BE(0);
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new CborError('Number too large');
    return Number(big);
  }
  throw new CborError('Indefinite or reserved length');
}

function read(r: Reader, depth: number): Cbor {
  if (depth > 16) throw new CborError('Nested too deep');
  const head = take(r, 1).readUInt8(0);
  const major = head >> 5;
  const info = head & 0x1f;
  if (major === 7) {
    if (info === 20) return false;
    if (info === 21) return true;
    if (info === 22) return null;
    throw new CborError('Unsupported simple value');
  }
  const n = argument(r, info);
  switch (major) {
    case 0:
      return n;
    case 1:
      return -1 - n;
    case 2:
      return Buffer.from(take(r, n));
    case 3:
      return take(r, n).toString('utf8');
    case 4: {
      const items: Cbor[] = [];
      for (let i = 0; i < n; i += 1) items.push(read(r, depth + 1));
      return items;
    }
    case 5: {
      const map = new Map<Cbor, Cbor>();
      for (let i = 0; i < n; i += 1) {
        const key = read(r, depth + 1);
        map.set(key, read(r, depth + 1));
      }
      return map;
    }
    default:
      throw new CborError('Unsupported type');
  }
}
