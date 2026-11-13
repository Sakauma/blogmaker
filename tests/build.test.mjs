import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readPosts, parseSource, renderBody, routePath } from '../scripts/content.mjs';
import { createTerminalContent, generateTerminalContent } from '../scripts/terminal-content.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (r, p) => fs.readFile(path.join(r, 'dist', p), 'utf8');
const hash = data => createHash('sha256').update(data).digest('hex');
function run(cwd, ...args) {
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return result.stdout;
}
async function allFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await allFiles(path.join(directory, entry.name), relative + '/'));
    else if (entry.isFile()) files.push(relative);
  }
  return files.sort();
}

test('front matter, Markdown, literal HTML and non-ASCII route validation', () => {
  assert.equal(parseSource('---\ntitle: 测试\n---<p>Привет</p>', 'test').body, '<p>Привет</p>');
  assert.equal(renderBody({ body: '<p>Привет</p>' }), '<p>Привет</p>');
  assert.match(renderBody({ body: '# 标题\n\n**加粗** и Русский', format: 'markdown' }), /<h1>标题<\/h1>/);
  for (const route of ['/../outside/', '/2026/01/01/a\\b/', '//host/', '/a?b/', '/a%2f..%2fb/', '/CON/', '/%43ON/', '/a./', '/a%20/']) assert.throws(() => routePath(route));
});

test('build keeps every historic entry, original body and asset; content changes remove stale output', async () => {
  const sandbox = await fs.mkdtemp(path.join(root, '.test-build-'));
  try {
    for (const directory of ['scripts', 'src', 'static', 'content', 'terminal', 'tests']) {
      await fs.cp(path.join(root, directory), path.join(sandbox, directory), {
        recursive: true,
        filter: source => !/(?:^|[\\/])(?:node_modules|test-results|playwright-report)(?:[\\/]|$)/.test(source),
      });
    }
    await fs.copyFile(path.join(root, '.nojekyll'), path.join(sandbox, '.nojekyll'));
    const sourceFiles = (await allFiles(path.join(sandbox, 'content'))).map(file => 'content/' + file);
    const sourceHashes = new Map(await Promise.all(sourceFiles.map(async file => [file, hash(await fs.readFile(path.join(sandbox, file)))])));
    const build = () => run(sandbox, 'scripts/build.mjs');
    build();
    const original = await readPosts(sandbox);
    const originalCount = original.length;
    const manifest = JSON.parse(await fs.readFile(path.join(sandbox, 'terminal/src/generated/content.json'), 'utf8'));
    assert.equal(manifest.posts.length, originalCount);
    assert.ok(Object.keys(manifest.routes).length >= 175, 'legacy route coverage is a minimum, not a limit on new content');
    for (const post of original) {
      const html = await read(sandbox, post.path.slice(1) + 'index.html');
      const withoutLazyLoading = value => value.replace(/(<img\b[^>]*?)\sloading=["']lazy["']/gi, '$1');
      assert.ok(withoutLazyLoading(html).includes(withoutLazyLoading(renderBody(post))), `${post.filename}: original HTML body changed`);
      assert.match(html, /id="site-fallback"/);
      assert.match(html, /<script[^>]+type="module"[^>]+src="\/terminal-assets\//);
      const entry = manifest.posts.find(item => item.path === post.path);
      assert.ok(entry, post.path);
      assert.equal(manifest.routes[post.path].command, `cat ${entry.file}`);
      assert.ok(manifest.files.some(file => file.path === entry.file));
    }
    const snapshotFiles = await allFiles(path.join(sandbox, 'src/publish-snapshot'));
    for (const file of snapshotFiles) {
      if (file.endsWith('.html')) {
        const html = await read(sandbox, file);
        assert.match(html, /id="site-fallback"/, `${file}: old route has no terminal fallback`);
        assert.match(html, /\/terminal-assets\//, `${file}: old route has no terminal application`);
      } else {
        const staticFile = path.join(sandbox, 'static', file);
        const expected = await fs.access(staticFile).then(() => staticFile, () => path.join(sandbox, 'src/publish-snapshot', file));
        assert.equal(hash(await fs.readFile(path.join(sandbox, 'dist', file))), hash(await fs.readFile(expected)), `${file}: resource bytes changed`);
      }
    }
    for (let page = 2; page <= 7; page++) assert.match(await read(sandbox, `recent-updates/page/${page}/index.html`), /id="site-fallback"/);
    assert.match(await read(sandbox, 'list/index-1.html'), /rel="canonical" href="https:\/\/sakauma.github.io\/list\/"/);
    const home = await read(sandbox, 'index.html');
    assert.ok(!home.includes('{{'));
    assert.match(home, /Sakauma/);
    assert.match(home, new RegExp(`${originalCount} 篇`));
    assert.ok(!home.includes('/src/main.ts'));
    assert.deepEqual(await fs.readFile(path.join(sandbox, 'dist/FONT-LICENSE.txt')), await fs.readFile(path.join(sandbox, 'terminal/public/FONT-LICENSE.txt')));
    const fixture = path.join(sandbox, 'content/posts/2099-fixture.md');
    const body = '## 新段落\n\n**新增** Привет\n\n- 第一项\n- second\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n[外部链接](https://example.org/a?b=c&d=e)\n\n![原首页插画](/assets/img/home-tlaloc.webp)\n';
    const source = (draft = false, category = '新分类') => `---\ntitle: '新文章（Привет & <世界>）'\ndate: '2099-12-31'\npath: '/2099/12/31/测试-Привет/'\ncategory: '${category}'\ntags: ['新增标签', '翻译']\nformat: markdown\ndraft: ${draft}\n---\n${body}`;
    await fs.writeFile(fixture, source());
    build();
    const added = JSON.parse(await fs.readFile(path.join(sandbox, 'terminal/src/generated/content.json'), 'utf8'));
    assert.equal(added.posts.length, originalCount + 1);
    assert.match(await read(sandbox, 'index.html'), new RegExp(`${originalCount + 1} 篇`));
    assert.ok(added.files.find(file => file.path === '/posts/2099-fixture.md').text.includes('[外部链接](https://example.org/a?b=c&d=e)'));
    // Exercise the actual command tests against newly published Markdown without a historic snapshot.
    run(sandbox, '--test', 'tests/terminal-content.test.mjs');
    run(sandbox, '--import', 'tsx', '--test', 'terminal/src/shell.test.ts');
    for (const page of ['index.html', 'list/index.html', 'archives/index.html', 'archives/2099/index.html', 'archives/2099/12/index.html', 'tags/新增标签/index.html', 'tags/翻译/index.html', 'categories/新分类/index.html', 'recent-updates/index.html']) assert.ok((await read(sandbox, page)).includes('2099/12/31/'), page);
    const article = await read(sandbox, '2099/12/31/测试-Привет/index.html');
    assert.match(article, /<h2>新段落<\/h2>/);
    assert.match(article, /<table>/);
    assert.match(article, /&lt;世界&gt;/);
    assert.equal(JSON.parse(await read(sandbox, 'posts.json')).find(post => post.path === '/2099/12/31/测试-Привет/').date, '2099-12-31');
    await fs.writeFile(fixture, source(false, '改名分类').replace("date: '2099-12-31'", "date: '2099-12-31'\nupdated: '2100-01-01'"));
    const renamed = await createTerminalContent(sandbox);
    assert.ok(!renamed.manifest.routes['/categories/新分类/']);
    assert.ok(renamed.manifest.routes['/categories/改名分类/']);
    assert.equal(renamed.manifest.posts.find(post => post.id === '2099-fixture').updated, '2100-01-01');
    run(sandbox, '--test', 'tests/terminal-content.test.mjs');
    await fs.writeFile(fixture, source(true));
    const draft = await generateTerminalContent(sandbox);
    assert.equal(draft.manifest.posts.length, originalCount);
    assert.ok(!draft.manifest.files.some(file => file.path === '/posts/2099-fixture.md'));
    // A source can remain on disk as a draft without appearing in the shell's published corpus.
    run(sandbox, '--test', 'tests/terminal-content.test.mjs');
    run(sandbox, '--import', 'tsx', '--test', 'terminal/src/shell.test.ts');
    await fs.unlink(fixture);
    build();
    for (const stale of ['2099', 'categories/新分类', 'tags/新增标签']) await assert.rejects(fs.access(path.join(sandbox, 'dist', stale)), stale);
    assert.equal(await read(sandbox, 'index.html'), home, 'repeated build must be deterministic');
    for (const [file, before] of sourceHashes) assert.equal(hash(await fs.readFile(path.join(sandbox, file))), before, `${file}: source bytes changed`);
    run(sandbox, 'scripts/new-post.mjs', '命令行新文章', 'cli-fixture', '2026-10-09');
    assert.match(await fs.readFile(path.join(sandbox, 'content/posts/2026-10-09-cli-fixture.md'), 'utf8'), /draft: true/);
    for (const relative of (await allFiles(path.join(sandbox, 'dist'))).filter(file => file.endsWith('.html'))) {
      const html = await read(sandbox, relative);
      for (const match of html.matchAll(/(?:href|src)="(\/[^"?#]*)/g)) {
        const url = match[1].replace(/&amp;/g, '&');
        let target = path.join(sandbox, 'dist', decodeURIComponent(url));
        if (url.endsWith('/')) target = path.join(target, 'index.html');
        await assert.doesNotReject(fs.access(target), `${relative}: missing ${url}`);
      }
    }
  } finally { await fs.rm(sandbox, { recursive: true, force: true }); }
});
