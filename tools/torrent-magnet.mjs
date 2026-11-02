import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { torrentMagnet } from '../src/server/assets/torrentMagnet.js';
export { torrentMagnet };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(torrentMagnet(await readFile(process.argv[2]))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
