import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPosts, parseSource, renderBody, escapeHTML as e, href, routePath } from './content.mjs';
import { titleParts } from './homepage.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root,'dist');
const snapshot = path.join(root,'src/publish-snapshot');
const posts = await readPosts(root); // Validate before touching previous output.
const site = JSON.parse(await fs.readFile(path.join(root,'content/site.json'),'utf8'));
const homeTemplate = await fs.readFile(path.join(root,'src/templates/home.html'),'utf8');
const pageTemplate = await fs.readFile(path.join(root,'src/templates/page.html'),'utf8');
const fill = (template, values) => template.replace(/\{\{(\w+)\}\}/g, (_, key) => { if (!(key in values)) throw new Error(`Unknown template token ${key}`); return values[key]; });
await fs.rm(out,{recursive:true,force:true});
await fs.cp(snapshot,out,{recursive:true});
// Generated content has one source of truth. Never leave stale tags, pagination, or deleted posts.
for (const entry of await fs.readdir(out,{withFileTypes:true})) {
  if (entry.isDirectory() && (/^\d{4}$/.test(entry.name) || ['list','archives','tags','categories','recent-updates','page','index'].includes(entry.name))) await fs.rm(path.join(out,entry.name),{recursive:true,force:true});
}
await fs.cp(path.join(root,'static'),out,{recursive:true});
await fs.copyFile(path.join(root,'.nojekyll'),path.join(out,'.nojekyll'));
const emitted = new Set();
async function write(route, html) {
  route = routePath(route);
  if (emitted.has(route)) throw new Error(`Duplicate output route ${route}`);
  emitted.add(route);
  const target = path.join(out,route.slice(1),'index.html');
  await fs.mkdir(path.dirname(target),{recursive:true});
  await fs.writeFile(target,html);
}
const page = (title,main) => fill(pageTemplate,{title:e(title),main});
const hero = (title,subtitle='') => `<section class="page-hero"><div class="page-hero-media" aria-hidden="true"><img src="/assets/img/Tlaloc_cropped_1920x1080.webp" alt=""></div><div class="page-hero-inner"><p class="eyebrow reveal">Sakauma</p><h1 class="reveal">${e(title)}</h1><p class="reveal">${e(subtitle)}</p></div></section>`;
const link = (route,label) => `<a href="${e(href(route))}">${e(label)}</a>`;
function rows(items) { return items.map((p,i)=>`<article class="post-card reveal" style="--i: ${i}"><span class="post-date">${e(p.date)}</span><h3>${link(p.path,p.title)}</h3><span class="post-category">${p.category ? link(`/categories/${p.category}/`,p.category):''}</span></article>`).join('\n'); }
function pager(base,number,total) {
 const url = n => n===1 ? base : `${base}page/${n}/`;
 return total > 1 ? `<nav class="pager" aria-label="分页">${number>1 ? link(url(number-1),'上一页') : ''}<span>${number} / ${total}</span>${number<total ? link(url(number+1),'下一页'):''}</nav>` : '';
}
async function listing(base,title,items,paginate=true) {
 const size=paginate?10:Math.max(items.length,1), total=Math.max(1,Math.ceil(items.length/size));
 for(let n=1;n<=total;n++) await write(n===1?base:`${base}page/${n}/`,page(title,hero(title,`${items.length} 篇文章`)+`<section class="content-panel"><div class="post-list">${rows(items.slice((n-1)*size,n*size)) || '<p>暂时没有文章。</p>'}</div>${pager(base,n,total)}</section>`));
}
const groups = field => { const map = new Map(); for(const p of posts) for(const key of field==='tags'?p.tags:(p.category?[p.category]:[])) { if(!map.has(key))map.set(key,[]); map.get(key).push(p); } return map; };
const tags=groups('tags'),categories=groups('category');
const latest=posts[0]?.date;
await write('/',fill(homeTemplate,{
 latestDate:latest?`<time datetime="${latest}">${Number(latest.slice(0,4))} 年 ${Number(latest.slice(5,7))} 月 ${Number(latest.slice(8,10))} 日</time>`:'',
 recentPosts:posts.slice(0,5).map(p=>`<li><a class="entry" href="${e(href(p.path))}">${titleParts(p.title)}</a></li>`).join('\n'),
 postCount:posts.length,
 topicLinks:[...new Set([...(site.homeTopics || []).filter(t=>tags.has(t)), ...[...tags.keys()].sort((a,b)=>tags.get(b).length-tags.get(a).length || a.localeCompare(b,'zh-CN'))])].slice(0,site.homeTopicLimit || 4).map(t=>link(`/tags/${t}/`,t)).join('\n')
}));
await listing('/list/','文章',posts,false);
await listing('/archives/','归档',posts);
await listing('/recent-updates/','最近更新',[...posts].sort((a,b)=>b.updated.localeCompare(a.updated)));
// Retain historic root pagination and /index/ aliases.
for(let n=2;n<=Math.ceil(posts.length/10);n++) await write(`/page/${n}/`,page('文章',hero('文章',`${posts.length} 篇文章`)+`<section class="content-panel"><div class="post-list">${rows(posts.slice((n-1)*10,n*10))}</div>${pager('/',n,Math.ceil(posts.length/10))}</section>`));
await listing('/index/','文章',posts,false);
for(const year of new Set(posts.map(p=>p.date.slice(0,4)))) await listing(`/archives/${year}/`,`${year} 年归档`,posts.filter(p=>p.date.startsWith(year)));
for(const month of new Set(posts.map(p=>p.date.slice(0,7)))) await listing(`/archives/${month.replace('-','/')}/`,`${month} 归档`,posts.filter(p=>p.date.startsWith(month)));
for(const [kind,map] of [['tags',tags],['categories',categories]]) {
 await write(`/${kind}/`,page(kind==='tags'?'标签':'分类',hero(kind==='tags'?'标签':'分类')+`<section class="content-panel"><div class="tag-cloud">${[...map].map(([key,items])=>link(`/${kind}/${key}/`,`${key} (${items.length})`)).join(' ')}</div></section>`));
 for(const [key,items] of map) await listing(`/${kind}/${key}/`,key,items);
}
for(let i=0;i<posts.length;i++) {
 const p=posts[i];
 const metadata=[...(p.category?[link(`/categories/${p.category}/`,p.category)]:[]),...p.tags.map(t=>link(`/tags/${t}/`,t))].join('\n');
 const nav=`<nav class="pager" aria-label="Post navigation">${i>0?link(posts[i-1].path,`Previous: ${posts[i-1].title}`):''}${i+1<posts.length?link(posts[i+1].path,`Next: ${posts[i+1].title}`):''}</nav>`;
 const main=hero(p.title,p.description || `发布于 ${p.date}`)+`<section class="article-shell"><aside class="article-side reveal"><span class="article-meta">${p.date}</span><div class="article-tags">${metadata}</div><a class="pill-link" href="/list/">Back to posts</a></aside><article class="post-body reveal"><div class="article-gallery">${renderBody(p)}</div>${nav}</article></section>`;
 await write(p.path,page(p.title,main));
}
// Preserve about's existing layout while allowing its extracted source to be edited.
const about=parseSource(await fs.readFile(path.join(root,'content/pages/about.md'),'utf8'),'about.md');
const aboutSnapshot=await fs.readFile(path.join(snapshot,'about/index.html'),'utf8');
const aboutMatch=aboutSnapshot.match(/(<article class="post-body[^\"]*">)([\s\S]*?)(<\/article>)/);
if(aboutMatch) await write('/about/',aboutSnapshot.replace(aboutMatch[0],()=>aboutMatch[1]+renderBody(about)+aboutMatch[3]));
await fs.writeFile(path.join(out,'posts.json'),JSON.stringify(posts.map(({title,date,updated,path,tags,category})=>({title,date,updated,path,tags,category})),null,2));
console.log(`Built ${posts.length} posts, ${tags.size} tags, ${categories.size} categories and ${emitted.size} routes into dist/. No deployment performed.`);
