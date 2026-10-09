import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readPosts, parseSource, renderBody, routePath } from '../scripts/content.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function run(cwd,...args) { const r=spawnSync(process.execPath,args,{cwd,encoding:'utf8'}); assert.equal(r.status,0,r.stderr+r.stdout); return r.stdout; }
const read=(r,p)=>fs.readFile(path.join(r,'dist',p),'utf8');
test('front matter, Markdown, literal HTML, path and date validation', async()=>{
 assert.equal(parseSource('---\ntitle: 测试\n---<p>Привет</p>','test').body,'<p>Привет</p>');
 assert.equal(renderBody({body:'<p>Привет</p>'}),'<p>Привет</p>');
 assert.match(renderBody({body:'# 标题\n\n**加粗** и Русский',format:'markdown'}),/<h1>标题<\/h1>/);
 for(const route of ['/../outside/','/2026/01/01/a\\b/','//host/','/a?b/','/a%2f..%2fb/','/CON/','/%43ON/','/a./','/a%20/']) assert.throws(()=>routePath(route));
});
test('fresh build, all legacy bodies, fixture add/edit/draft/delete, Unicode and dynamic indexes',async()=>{
 const sandbox=await fs.mkdtemp(path.join(root,'.test-build-'));
 try {
  for(const dir of ['scripts','src','static','content']) await fs.cp(path.join(root,dir),path.join(sandbox,dir),{recursive:true});
  await fs.copyFile(path.join(root,'.nojekyll'),path.join(sandbox,'.nojekyll'));
  const build=()=>run(sandbox,'scripts/build.mjs');
  build();
  const original=await readPosts(sandbox);
  const originalCount=original.length;
  for(const p of original) {
   const html=await read(sandbox,p.path.slice(1)+'index.html');
   assert.ok(html.includes(renderBody(p)),`${p.filename}: original HTML body changed`);
  }
  for(const file of ['assets/site.css','assets/site.js']) assert.deepEqual(await fs.readFile(path.join(sandbox,'dist',file)),await fs.readFile(path.join(sandbox,'src/publish-snapshot',file)));
  const home=await read(sandbox,'index.html');
  assert.match(home,/home-editorial\.css/); assert.match(home,new RegExp(`${originalCount} 篇`)); assert.ok(!home.includes('{{'));
  assert.match(home, /<span class="entry-title">雷鬼<\/span><span class="entry-original">Reggae<\/span>/);
  const previewPath=path.join(sandbox,'review/preview.html');
  run(sandbox,'scripts/preview.mjs',previewPath);
  const preview=await fs.readFile(previewPath,'utf8');
  assert.ok(!/<base\b/i.test(preview));
  assert.match(preview, /class="skip-link" href="#main"/);
  assert.match(preview, /<main id="main" tabindex="-1">/);
  assert.ok(preview.indexOf('<script>')>preview.indexOf('</footer>'));
  assert.match(preview, /href="https:\/\/sakauma.github.io\/list\/"/);
  assert.match(preview, /data:font\/woff2;base64,/);
  assert.match(preview, /data:image\/webp;base64,/);
  const fixture=path.join(sandbox,'content/posts/2099-fixture.md');
  const body='## 新段落\n\n**新增** Привет\n\n- 第一项\n- second\n\n| A | B |\n|---|---|\n| 1 | 2 |\n';
  const source=(draft=false,category='新分类')=>`---\ntitle: '新文章（Привет & <世界>）'\ndate: '2099-12-31'\npath: '/2099/12/31/测试-Привет/'\ncategory: '${category}'\ntags: ['新增标签', '翻译']\nformat: markdown\ndraft: ${draft}\n---\n${body}`;
  await fs.writeFile(fixture,source());build();
  for(const page of ['index.html','list/index.html','archives/index.html','archives/2099/index.html','archives/2099/12/index.html','tags/新增标签/index.html','tags/翻译/index.html','categories/新分类/index.html','recent-updates/index.html']) assert.ok((await read(sandbox,page)).includes('2099/12/31/'),page);
  assert.match(await read(sandbox,'index.html'),new RegExp(`${originalCount+1} 篇`));
  const article=await read(sandbox,'2099/12/31/测试-Привет/index.html');
  assert.match(article,/<h2>新段落<\/h2>/);assert.match(article,/<table>/);assert.match(article,/&lt;世界&gt;/);
  assert.equal(JSON.parse(await read(sandbox,'posts.json'))[0].date,'2099-12-31');
  await fs.writeFile(fixture,source(false,'改名分类'));build();
  await assert.rejects(fs.access(path.join(sandbox,'dist/categories/新分类')));
  await fs.writeFile(fixture,source(true));build();
  assert.match(await read(sandbox,'index.html'),new RegExp(`${originalCount} 篇`));
  await assert.rejects(fs.access(path.join(sandbox,'dist/2099')));
  await fs.unlink(fixture);build();
  assert.equal(await read(sandbox,'index.html'),home);
  run(sandbox,'scripts/new-post.mjs','命令行新文章','cli-fixture','2026-10-09');
  assert.match(await fs.readFile(path.join(sandbox,'content/posts/2026-10-09-cli-fixture.md'),'utf8'),/draft: true/);
  // All generated local HTML links resolve, including encoded Chinese/Russian routes.
  const all=async d=>{let files=[];for(const x of await fs.readdir(d,{withFileTypes:true})){const p=path.join(d,x.name);if(x.isDirectory())files.push(...await all(p));else if(p.endsWith('.html'))files.push(p);}return files;};
  for(const file of await all(path.join(sandbox,'dist'))) {
   if(!file.endsWith('index.html'))continue;
   const html=await fs.readFile(file,'utf8');
   for(const m of html.matchAll(/(?:href|src)="(\/[^"?#]*)/g)) {
    let p=path.join(sandbox,'dist',decodeURIComponent(m[1]));
    if(m[1].endsWith('/'))p=path.join(p,'index.html');
    await assert.doesNotReject(fs.access(p),`${file}: missing ${m[1]}`);
   }
  }
 } finally { await fs.rm(sandbox,{recursive:true,force:true}); }
});
