import { createHash } from 'node:crypto';
// Hash the original bytes, never a re-encoded dictionary.
export function torrentMagnet(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 16 * 1024 * 1024 || bytes[0] !== 100) throw new Error('Invalid torrent');
  let pos = 0, info;
  function value(depth = 0) {
    if (depth > 64 || pos >= bytes.length) throw new Error('Invalid bencode');
    const start = pos, kind = bytes[pos++];
    if (kind === 105) {
      const end = bytes.indexOf(101, pos);
      if (end < 0 || !/^(0|-?[1-9]\d*)$/.test(bytes.subarray(pos, end).toString('ascii'))) throw new Error('Invalid integer');
      pos = end + 1;
    } else if (kind === 100 || kind === 108) {
      const keys = new Set();
      while (bytes[pos] !== 101) {
        if (kind === 100) {
          const key = value(depth + 1);
          if (!key) throw new Error('Invalid dictionary key');
          const id = key.toString('hex');
          if (keys.has(id)) throw new Error('Duplicate dictionary key');
          keys.add(id);
          const begin = pos;
          value(depth + 1);
          if (depth === 0 && key.toString() === 'info') {
            if (bytes[begin] !== 100) throw new Error('Invalid info dictionary');
            info = bytes.subarray(begin, pos);
          }
        } else value(depth + 1);
      }
      pos++;
    } else {
      pos--;
      const colon = bytes.indexOf(58, pos);
      const lengthText = bytes.subarray(pos, colon).toString('ascii');
      if (colon < 0 || !/^(0|[1-9]\d*)$/.test(lengthText)) throw new Error('Invalid byte string');
      const size = Number(lengthText);
      if (!Number.isSafeInteger(size) || colon + 1 + size > bytes.length) throw new Error('Truncated byte string');
      pos = colon + 1 + size;
      return bytes.subarray(colon + 1, pos);
    }
    if (pos <= start) throw new Error('Invalid bencode');
  }
  value();
  if (pos !== bytes.length || !info) throw new Error('Missing info or trailing data');
  return `magnet:?xt=urn:btih:${createHash('sha1').update(info).digest('hex')}`;
}

