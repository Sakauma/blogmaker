import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { marked } from 'marked';

export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const href = route => route.split('/').map(encodeURIComponent).join('/');
export function routePath(route) {
  if (typeof route !== 'string' || !route.startsWith('/') || !route.endsWith('/')) throw new Error('path must start and end with /');
  const decoded = decodeURIComponent(route);
  if (decoded.includes('\\') || /[?#\x00-\x1f]/.test(decoded) || decoded.split('/').some(s => s === '.' || s === '..' || (s && /[<>:"|*]/.test(s)))) throw new Error(`Unsafe or Windows-incompatible path: ${route}`);
  if (decoded.split('/').some(s => s && (/[. ]$/.test(s) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s)))) throw new Error(`Windows-reserved path segment: ${route}`);
  if (decoded.includes('//')) throw new Error(`Empty path segment: ${route}`);
  return decoded;
}
export function parseSource(text, filename) {
  // Historic extracted files have ---<p> on the closing delimiter line.
  const match = text.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?([\s\S]*)$/);
  if (!match) throw new Error(`${filename}: missing YAML front matter`);
  const data = parse(match[1]);
  if (!data || typeof data.title !== 'string' || !data.title.trim()) throw new Error(`${filename}: title is required`);
  return {...data, body: match[2], filename};
}
export function renderBody(post) {
  if (post.format === 'html' || (!post.format && /^\s*</.test(post.body))) return post.body;
  return marked.parse(post.body, {gfm:true});
}
function validDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value; }
export async function readPosts(root) {
  const files = (await fs.readdir(path.join(root,'content/posts'))).filter(f=>f.endsWith('.md')).sort();
  const posts = [], paths = new Set();
  for (const file of files) {
    const p = parseSource(await fs.readFile(path.join(root,'content/posts',file),'utf8'), file);
    if (!validDate(p.date)) throw new Error(`${file}: date must be a valid quoted YYYY-MM-DD`);
    if (p.updated != null && !validDate(p.updated)) throw new Error(`${file}: updated must be YYYY-MM-DD`);
    p.path = routePath(p.path);
    if (!/^\/\d{4}\/\d{2}\/\d{2}\/[^/]+\/$/.test(p.path)) throw new Error(`${file}: use /YYYY/MM/DD/slug/ to avoid reserved site routes`);
    if (paths.has(p.path.toLowerCase())) throw new Error(`${file}: duplicate path ${p.path}`);
    paths.add(p.path.toLowerCase());
    if (p.tags != null && (!Array.isArray(p.tags) || p.tags.some(t=>typeof t !== 'string' || !t.trim() || t.includes('/')))) throw new Error(`${file}: tags must be a list of nonempty names without /`);
    p.tags = [...new Set(p.tags || [])];
    if (p.category != null && (typeof p.category !== 'string' || !p.category.trim() || p.category.includes('/'))) throw new Error(`${file}: category must be one nonempty name without /`);
    for (const name of [...p.tags,...(p.category ? [p.category] : [])]) routePath(`/tags/${name}/`);
    if (p.draft !== undefined && typeof p.draft !== 'boolean') throw new Error(`${file}: draft must be true or false`);
    if (p.format && !['html','markdown'].includes(p.format)) throw new Error(`${file}: format must be html or markdown`);
    p.updated = p.updated || p.date;
    if (!p.draft) posts.push(p);
  }
  // Preserve the established order of same-day legacy articles; new additions lead ties.
  const oldList = await fs.readFile(path.join(root,'src/publish-snapshot/list/index.html'),'utf8');
  const order = new Map([...oldList.matchAll(/<h3><a href="([^"]+)"/g)].map((m,i)=>[decodeURIComponent(m[1]),i]));
  posts.sort((a,b)=>b.date.localeCompare(a.date) || ((order.get(a.path) ?? -1)-(order.get(b.path) ?? -1)) || b.filename.localeCompare(a.filename));
  return posts;
}
