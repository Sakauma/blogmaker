import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';
import { routePath } from './content.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const [title,slug,dateArg]=process.argv.slice(2);
if(!title || !slug) { console.error('Usage: npm run new -- "文章标题" "article-slug" [YYYY-MM-DD]'); process.exit(1); }
const date=dateArg || new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
if(!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0,10)!==date) throw new Error('Invalid date; use YYYY-MM-DD');
if(slug.includes('/') || !slug.trim() || /[. ]$/.test(slug) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(slug)) throw new Error('Use a single Windows-compatible slug');
const route=routePath(`/${date.replaceAll('-','/')}/${slug}/`);
const target=path.join(root,'content/posts',`${date}-${slug}.md`);
const metadata={title,date,path:route,category:'列托夫、苏联和地下朋克的一切',tags:[],format:'markdown',draft:true};
await fs.writeFile(target,`---\n${stringify(metadata)}---\n\n在这里开始写作。\n`,{flag:'wx'});
console.log(`Created ${path.relative(root,target)} as draft. Set draft: false when ready, then npm run build.`);
