// Minimal zip reader for Kane evidence packs (.evidence files are standard zips).
// Supports stored and deflated entries, and the zip64 end-of-central-directory record.
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

export function openZip(fileOrBuffer) {
  const buf = Buffer.isBuffer(fileOrBuffer) ? fileOrBuffer : readFileSync(fileOrBuffer);
  const eocd = findEocd(buf);
  let count = buf.readUInt16LE(eocd + 10);
  let cdSize = buf.readUInt32LE(eocd + 12);
  let cdOffset = buf.readUInt32LE(eocd + 16);

  if (cdOffset === 0xffffffff || count === 0xffff) {
    const locator = eocd - 20;
    if (locator >= 0 && buf.readUInt32LE(locator) === 0x07064b50) {
      const z64 = Number(buf.readBigUInt64LE(locator + 8));
      if (buf.readUInt32LE(z64) === 0x06064b50) {
        count = Number(buf.readBigUInt64LE(z64 + 32));
        cdSize = Number(buf.readBigUInt64LE(z64 + 40));
        cdOffset = Number(buf.readBigUInt64LE(z64 + 48));
      }
    }
  }

  const entries = new Map();
  let p = cdOffset;
  for (let i = 0; i < count && p < cdOffset + cdSize; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    let compSize = buf.readUInt32LE(p + 20);
    let size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    let localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    // zip64 extra field
    let e = p + 46 + nameLen;
    const eEnd = e + extraLen;
    while (e + 4 <= eEnd) {
      const id = buf.readUInt16LE(e);
      const len = buf.readUInt16LE(e + 2);
      if (id === 0x0001) {
        let q = e + 4;
        if (size === 0xffffffff) { size = Number(buf.readBigUInt64LE(q)); q += 8; }
        if (compSize === 0xffffffff) { compSize = Number(buf.readBigUInt64LE(q)); q += 8; }
        if (localOffset === 0xffffffff) { localOffset = Number(buf.readBigUInt64LE(q)); q += 8; }
      }
      e += 4 + len;
    }
    entries.set(name, { name, method, compSize, size, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }

  function read(name) {
    const ent = entries.get(name);
    if (!ent) return null;
    const lh = ent.localOffset;
    if (buf.readUInt32LE(lh) !== 0x04034b50) throw new Error(`bad local header for ${name}`);
    const nameLen = buf.readUInt16LE(lh + 26);
    const extraLen = buf.readUInt16LE(lh + 28);
    const start = lh + 30 + nameLen + extraLen;
    const data = buf.subarray(start, start + ent.compSize);
    if (ent.method === 0) return Buffer.from(data);
    if (ent.method === 8) return inflateRawSync(data);
    throw new Error(`unsupported zip method ${ent.method} for ${name}`);
  }

  return {
    names: () => [...entries.keys()],
    has: (n) => entries.has(n),
    read,
    text: (n) => {
      const b = read(n);
      return b ? b.toString('utf8') : null;
    },
  };
}

function findEocd(buf) {
  const min = Math.max(0, buf.length - 0xffff - 22);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new Error('not a zip file (no end of central directory)');
}
