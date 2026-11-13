import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as viteBuild } from 'vite';
import { escapeHTML as e, href, routePath } from './content.mjs';
import { generateTerminalContent } from './terminal-content.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist');
const terminal = path.join(root, 'terminal');
// Validate content and create the shared data before Vite replaces the previous build.
const { manifest, documents } = await generateTerminalContent(root);
await fs.access(path.join(terminal, 'index.html'));
// The private namespace contains one generated ciphertext, never loose public assets.
for (const directory of ['src/publish-snapshot', 'static', 'terminal/public']) {
  for (const reserved of ['.private', ...(directory === 'terminal/public' ? [] : ['private'])]) {
    try { await fs.access(path.join(root, directory, reserved)); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    throw new Error(`Reserved private directory found in public inputs: ${directory}/${reserved}`);
  }
}
const privateAssets = await fs.readdir(path.join(terminal, 'public/private')).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
if (privateAssets.some(name => name !== 'vault.json')) throw new Error('Only the generated encrypted vault belongs in terminal/public/private.');
const config = path.join(terminal, 'vite.config.ts');
await viteBuild({
  root: terminal,
  configFile: await fs.access(config).then(() => config, () => false),
  base: '/',
  publicDir: path.join(terminal, 'public'),
  logLevel: 'warn',
  build: { target: 'es2022', outDir: out, emptyOutDir: true, assetsDir: 'terminal-assets' },
});
const shell = (await fs.readFile(path.join(out, 'index.html'), 'utf8'))
  .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
  .replace(/<meta\b[^>]*(?:name=["']description["']|property=["']og:[^"']+["'])[^>]*>/gi, '')
  .replace(/<link\b[^>]*rel=["']canonical["'][^>]*>/gi, '');
// Legacy assets keep their original paths and bytes. Vite uses terminal-assets/ to avoid collisions.
for (const directory of ['src/publish-snapshot', 'static']) {
  await fs.cp(path.join(root, directory), out, { recursive: true, filter: source => !/\.html$/i.test(source) });
}
await fs.copyFile(path.join(root, '.nojekyll'), path.join(out, '.nojekyll'));

const fallbackStyle = `<style>
html:not(.app-ready) #app{display:none}
#site-fallback{max-width:76ch;margin:2rem auto;padding:1.5rem;color:#d9e0d6;background:#111314;font:15px/1.8 ui-monospace,monospace;overflow-wrap:anywhere}
#site-fallback a{color:#afd8ae}#site-fallback img{max-width:100%;height:auto}#site-fallback pre{white-space:pre-wrap}#site-fallback nav{margin:1rem 0}#site-fallback input{color:inherit;background:transparent;border:1px solid #68766a;padding:.25rem}.app-ready #site-fallback{display:none}
</style>`;
for (const [route, document] of documents) {
  const target = route.endsWith('/')
    ? path.join(out, routePath(route).slice(1), 'index.html')
    : path.join(out, route.slice(1));
  if (!route.endsWith('/') && !['/404.html', '/list/index-1.html'].includes(route)) throw new Error(`Unexpected file route: ${route}`);
  const title = `${document.title}${route === '/' ? '' : ' | Sakauma'}`;
  const description = `${document.title} — ${manifest.profile.interests}`;
  const canonical = 'https://sakauma.github.io' + href(document.canonical);
  const metadata = `<meta name="description" content="${e(description)}">\n<meta property="og:title" content="${e(title)}">\n<meta property="og:description" content="${e(description)}">\n<meta property="og:type" content="${route.startsWith('/20') ? 'article' : 'website'}">\n<link rel="canonical" href="${e(canonical)}">${route === '/404.html' || route === '/private/' ? '\n<meta name="robots" content="noindex">' : ''}`;
  // Only the new terminal entry executes. Historical body markup remains readable if JS fails.
  const originalHTML = document.html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<img\b(?![^>]*\bloading=)/gi, '<img loading="lazy"');
  const fallback = `<section id="site-fallback" aria-label="文章原文与静态导航"><nav><a href="/">Sakauma</a> · <a href="/list/">全部文章</a> · <a href="/archives/">归档</a> · <a href="/tags/">标签</a> · <a href="/categories/">分类</a> · <a href="/about/">关于</a></nav>${originalHTML}</section><noscript><style>#app{display:none}</style></noscript>`;
  const html = shell.replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${e(title)}</title>`)
    .replace('</head>', `${metadata}\n${fallbackStyle}\n</head>`)
    .replace('</body>', `${fallback}\n</body>`);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, html);
}
await fs.writeFile(path.join(out, 'posts.json'), JSON.stringify(manifest.posts.map(({ id, file, ...post }) => post), null, 2) + '\n');
console.log(`Built ${manifest.posts.length} posts, ${manifest.files.length} terminal files and ${documents.size} routes into dist/. No deployment performed.`);
