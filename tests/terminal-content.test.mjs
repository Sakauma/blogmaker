import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { htmlToTerminalText, createTerminalContent } from '../scripts/terminal-content.mjs';
import { parseSource, renderBody, routePath } from '../scripts/content.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('HTML conversion retains verse line breaks, exact PRE spaces, Unicode, entities, links and image sources', () => {
  const html = '<p>第一行<br>Вторая строка<br><br>第三行 &amp; &lt;实体&gt; &#169;</p><pre><code>   沉默地祈祷\n    怜悯你那锡做的基督\n</code></pre><p><a href="https://example.org/a?b=1&amp;c=2">参考</a> · <a href="../other/#verse">邻文</a></p><img alt="原插画" src="picture.webp"><input type="email" value="a@example.org"><script>throw new Error()</script>';
  const text = htmlToTerminalText(html, '/2026/01/22/article/');
  assert.ok(text.includes('第一行\nВторая строка\n\n第三行 & <实体> ©'));
  assert.ok(text.includes('   沉默地祈祷\n    怜悯你那锡做的基督\n'));
  assert.ok(text.includes('[参考](https://example.org/a?b=1&c=2)'));
  assert.ok(text.includes('[邻文](/2026/01/22/other/#verse)'));
  assert.ok(text.includes('![原插画](/2026/01/22/article/picture.webp)'));
  assert.ok(text.includes('a@example.org'));
  assert.ok(!text.includes('throw new Error'));
  assert.equal(htmlToTerminalText('<pre>  leading\n trailing  \n</pre>'), '  leading\n trailing  \n');
});

test('new Markdown uses the same block conversion and keeps meaningful list/table text', () => {
  const html = renderBody({ format: 'markdown', body: '# 新诗\n\n第一行  \n第二行\n\n- 第一项\n- 第二项\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n![插画](/images/flower.png)\n' });
  const text = htmlToTerminalText(html);
  for (const expected of ['# 新诗', '第一行\n第二行', '- 第一项', '- 第二项', 'A | B', '1 | 2', '![插画](/images/flower.png)']) assert.ok(text.includes(expected), expected);
});

test('shared manifest preserves the migration baseline and every currently published source', async () => {
  const { manifest, documents } = await createTerminalContent(root);
  const sourceFiles = (await fs.readdir(path.join(root, 'content/posts'))).filter(file => file.endsWith('.md')).sort();
  const sources = new Map(await Promise.all(sourceFiles.map(async filename => [
    filename.replace(/\.md$/, ''),
    parseSource(await fs.readFile(path.join(root, 'content/posts', filename), 'utf8'), filename),
  ])));
  const publishedSources = [...sources.values()].filter(source => !source.draft);
  assert.equal(manifest.version, 1);
  assert.equal(manifest.posts.length, publishedSources.length, 'every non-draft source is represented');
  async function snapshotFiles(directory, prefix = '') {
    const result = [];
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (entry.isDirectory()) result.push(...await snapshotFiles(path.join(directory, entry.name), relative + '/'));
      else if (entry.isFile()) result.push(relative);
    }
    return result;
  }
  const historicFiles = await snapshotFiles(path.join(root, 'src/publish-snapshot'));
  const legacyRoutes = new Set(historicFiles.filter(file => file.endsWith('.html')).map(file => '/' + file.replace(/index\.html$/, '')));
  for (let page = 2; page <= 7; page++) legacyRoutes.add(`/recent-updates/page/${page}/`);
  assert.ok(legacyRoutes.size >= 175, 'the complete historical route baseline is present');
  const legacyPosts = [...legacyRoutes].filter(route => /^\/\d{4}\/\d{2}\/\d{2}\//.test(route));
  assert.ok(legacyPosts.length >= 70, 'the snapshot retains the original article baseline');
  for (const route of legacyRoutes) {
    assert.ok(manifest.routes[route], `historic route retained: ${route}`);
    assert.ok(documents.has(route), `historic HTML retained: ${route}`);
  }
  for (const route of legacyPosts) assert.ok(manifest.posts.some(post => post.path === route), `original article retained: ${route}`);
  assert.ok(Object.keys(manifest.routes).length >= legacyRoutes.size);
  assert.equal(manifest.profile.brand, 'Sakauma');
  assert.equal(manifest.profile.email, 'ajax_mao@163.com');
  assert.deepEqual(manifest.profile.motto, ['我爱一切', '不该爱的东西。']);
  const files = new Map(manifest.files.map(file => [file.path, file.text]));
  assert.equal(files.size, manifest.files.length, 'VFS paths are unique');
  assert.ok(files.get('/about.txt').includes('ajax_mao@163.com'));
  assert.ok(files.get('/about.txt').includes('在精神上感染了艾滋病'));
  assert.ok(files.has('/home.txt'));
  assert.match(files.get('/home.txt'), new RegExp(`${manifest.posts.length} 篇文章`));
  assert.doesNotMatch(files.get('/home.txt'), /浏览日志|命令与快捷键|分页阅读|公开文章/);
  assert.equal(files.get('/404.txt'), '404 — 页面未找到');
  for (const privatePath of ['/README.md', '/assets.md', '/projects/blogmaker.md', '/projects/homepage.md', '/lab/README.txt']) {
    assert.ok(!files.has(privatePath), `old owner document removed from public manifest: ${privatePath}`);
  }
  assert.ok(!manifest.files.some(file => file.path.startsWith('/private/')));
  assert.match(manifest.vault.url, /^\/private\/vault\.json\?v=[0-9a-f]{64}$/);
  assert.equal(manifest.routes['/private/'].command, 'private');
  assert.equal(documents.get('/private/').html, '<h1>私密资料</h1><p>已上锁。</p>');
  const expectedUpdates = new Map();
  for (const post of manifest.posts) {
    const source = sources.get(post.id);
    assert.ok(source && !source.draft, `${post.id}: only published source is represented`);
    assert.equal(post.file, '/posts/' + post.id + '.md');
    assert.equal(post.date, source.date);
    assert.equal(post.path, routePath(source.path));
    assert.deepEqual(post.tags, [...new Set(source.tags || [])]);
    assert.equal(post.category, source.category || '');
    assert.ok(files.get(post.file).startsWith('# ' + post.title));
    assert.ok(documents.get(post.path).html.includes(renderBody(source)));
    let historicalUpdate;
    try {
      const snapshot = await fs.readFile(path.join(root, 'src/publish-snapshot', post.path.slice(1), 'index.html'), 'utf8');
      historicalUpdate = snapshot.match(/最近更新[：:]\s*(\d{4}-\d{2}-\d{2})/)?.[1];
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const expectedUpdate = source.updated ?? historicalUpdate ?? source.date;
    expectedUpdates.set(post.path, expectedUpdate);
    assert.equal(post.updated, expectedUpdate, `${post.id}: explicit, historic and default update precedence`);
  }
  const gospel = files.get('/posts/018-2026-01-21.md');
  for (const phrase of ['   沉默地祈祷', '   饥饿的双手', '   牢靠的锁链', '  冰冷的双唇', '   顺从的双手']) assert.ok(gospel.includes('\n' + phrase), phrase);
  assert.ok(files.get('/posts/028-2026-01-22.md').includes('https://www.douban.com/group/topic/40109626/'));
  const expectedRecent = [...manifest.posts].sort((a, b) => expectedUpdates.get(b.path).localeCompare(expectedUpdates.get(a.path))).map(post => post.path);
  const actualRecent = [];
  for (let page = 1; page <= Math.max(1, Math.ceil(manifest.posts.length / 10)); page++) {
    const file = page === 1 ? '/recent-updates/index.md' : `/recent-updates/page/${page}.md`;
    assert.ok(files.has(file), `recent updates page exists: ${file}`);
    for (const line of files.get(file).split('\n')) {
      const match = line.match(/^\d{4}-\d{2}-\d{2}  .*\]\(([^)]+)\)$/);
      if (match) actualRecent.push(decodeURIComponent(match[1]));
    }
  }
  assert.deepEqual(actualRecent, expectedRecent, 'all recent-update pages follow the effective update order');
  for (const route of ['/list/index-1.html', '/index/', '/archives/2026/01/page/7/', '/tags/翻译/page/7/', '/categories/列托夫、苏联和地下朋克的一切/page/7/']) {
    assert.ok(manifest.routes[route], route);
    assert.ok(documents.has(route), route);
  }
  for (const [route, entry] of Object.entries(manifest.routes)) {
    assert.equal(typeof entry.title, 'string', route);
    if (route === '/private/') assert.equal(entry.command, 'private');
    else assert.match(entry.command, /^cat /, route);
  }
});
