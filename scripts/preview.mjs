import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The compiled terminal uses ES modules and root-relative legacy URLs. Preview it over HTTP.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = process.argv[2] || '4173';
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('Usage: node scripts/preview.mjs [port]');
process.argv = [process.execPath, fileURLToPath(new URL('./serve.mjs', import.meta.url)), path.join(root, 'dist'), port];
await import('./serve.mjs');
