import {readdir, readFile, writeFile} from 'node:fs/promises';
import {injectGoogleAnalytics} from '../tools-admin-worker/src/analytics-policy.js';
async function visit(dir = '.') {
  for (const entry of await readdir(dir, {withFileTypes:true})) {
    if (entry.name.startsWith('.') || ['node_modules','tests'].includes(entry.name)) continue;
    const path = (dir === '.' ? '' : dir + '/') + entry.name;
    if (entry.isDirectory()) { await visit(path); continue; }
    if (!path.endsWith('.html')) continue;
    const source = await readFile(path, 'utf8');
    if (!source.includes('G-1MDBG3TN2X')) continue;
    const updated = injectGoogleAnalytics(source, 'G-1MDBG3TN2X', path);
    if (updated !== source) {await writeFile(path, updated); console.log(path);}
  }
}
await visit();
