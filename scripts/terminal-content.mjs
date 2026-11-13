import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFragment } from 'parse5';
import { readPosts, parseSource, renderBody, escapeHTML as e, href } from './content.mjs';
import { titleParts } from './homepage.mjs';

export const profile = {
  brand: 'Sakauma',
  name: 'Egor Izmaylov',
  role: 'UESTC PhD 在读',
  email: 'ajax_mao@163.com',
  github: 'https://github.com/Sakauma',
  bilibili: 'https://space.bilibili.com/9348725',
  motto: ['我爱一切', '不该爱的东西。'],
  interests: '翻译、诗歌、民防与未来主义。',
  welcome: 'Добро пожаловать в этот грёбаный мир.',
  footer: 'Саксофон играет.',
};
const origin = 'https://sakauma.github.io';
const label = value => String(value).replace(/[\\[\]]/g, '\\$&');
const markdownURL = value => String(value).replace(/[\s()<>]/g, c => encodeURIComponent(c));
const markdownLink = (title, url) => `[${label(title)}](${markdownURL(url)})`;
const routeLink = (title, route) => markdownLink(title, href(route));
const htmlLink = (title, route) => `<a href="${e(href(route))}">${e(title)}</a>`;
const quote = value => /^[\w./~-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;
const blockTags = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'figure', 'figcaption', 'address', 'dl', 'dt', 'dd', 'form']);
const textOf = node => node.nodeName === '#text' ? node.value : (node.childNodes || []).map(textOf).join('');

/** Convert rendered HTML, not the source file. PRE and explicit BRs survive normalization. */
export function htmlToTerminalText(html, pageRoute = '/') {
  const protectedText = [];
  const protect = value => `\u0000${protectedText.push(value) - 1}\u0000`;
  const absolute = value => {
    if (!value) return '';
    try {
      const resolved = new URL(value, origin + pageRoute);
      return resolved.origin === origin ? resolved.pathname + resolved.search + resolved.hash : resolved.href;
    } catch { return value; }
  };
  const render = node => {
    if (node.nodeName === '#text') return node.value.replace(/[\t\r\n ]+/g, ' ');
    const tag = node.tagName;
    if (['script', 'style', 'template'].includes(tag)) return '';
    const attr = name => node.attrs?.find(a => a.name === name)?.value || '';
    if (tag === 'br') return protect('\n');
    if (tag === 'pre') return `\n\n${protect(textOf(node).replace(/\r\n?/g, '\n'))}\n\n`;
    if (tag === 'img') return `![${label(attr('alt') || '图片')}](${markdownURL(absolute(attr('src')))})`;
    if (tag === 'input') return attr('value');
    if (tag === 'button') return '';
    const children = () => (node.childNodes || []).map(render).join('');
    if (tag === 'a') {
      const text = children().trim();
      return attr('href') ? markdownLink(text || attr('href'), absolute(attr('href'))) : text;
    }
    if (tag === 'hr') return '\n\n---\n\n';
    if (tag === 'li') {
      const items = node.parentNode?.childNodes?.filter(n => n.tagName === 'li') || [];
      const prefix = node.parentNode?.tagName === 'ol' ? `${items.indexOf(node) + 1}. ` : '- ';
      return `\n${prefix}${children().trim()}\n`;
    }
    if (tag === 'tr') return '\n' + (node.childNodes || []).filter(n => ['td', 'th'].includes(n.tagName)).map(n => render(n).trim()).join(' | ') + '\n';
    if (tag === 'blockquote') return `\n\n${children().trim().split('\n').map(line => `> ${line}`).join('\n')}\n\n`;
    if (/^h[1-6]$/.test(tag || '')) return `\n\n${'#'.repeat(Number(tag[1]))} ${children().trim()}\n\n`;
    if (blockTags.has(tag) || ['ul', 'ol', 'table'].includes(tag)) return `\n\n${children().trim()}\n\n`;
    return children();
  };
  return render(parseFragment(html))
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .replace(/\u0000(\d+)\u0000/g, (_, index) => protectedText[Number(index)]);
}

async function filesUnder(directory, prefix = '') {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) result.push(...await filesUnder(path.join(directory, entry.name), relative + '/'));
    else if (entry.isFile()) result.push(relative);
  }
  return result.sort();
}

async function restoreHistoricalUpdates(root, posts) {
  for (const post of posts) {
    const source = parseSource(await fs.readFile(path.join(root, 'content/posts', post.filename), 'utf8'), post.filename);
    if (source.updated != null) continue;
    try {
      const oldHTML = await fs.readFile(path.join(root, 'src/publish-snapshot', post.path.slice(1), 'index.html'), 'utf8');
      const oldText = textOf(parseFragment(oldHTML));
      const match = oldText.match(/最近更新[：:]\s*(\d{4}-\d{2}-\d{2})/);
      if (match && new Date(match[1]).toISOString().slice(0, 10) === match[1]) post.updated = match[1];
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

/** Shared data contract; documents are build-only HTML, never sent to the shell. */
export async function createTerminalContent(root) {
  const posts = await readPosts(root);
  await restoreHistoricalUpdates(root, posts);
  const files = [], routes = {}, documents = new Map(), fileNames = new Set();
  function addFile(file, text) {
    if (fileNames.has(file)) throw new Error(`Duplicate terminal file: ${file}`);
    fileNames.add(file);
    files.push({ path: file, text });
    return file;
  }
  function document(route, title, file, html, canonical = route) {
    if (documents.has(route)) throw new Error(`Duplicate terminal route: ${route}`);
    if (!fileNames.has(file)) throw new Error(`Missing terminal route file: ${file}`);
    routes[route] = { title, command: `cat ${quote(file)}` };
    documents.set(route, { title, file, html, canonical });
  }
  const metadata = posts.map(post => ({
    id: post.filename.replace(/\.md$/, ''), title: post.title, date: post.date,
    updated: post.updated, path: post.path, file: `/posts/${post.filename}`,
    tags: post.tags, category: post.category || '',
  }));
  for (const [index, post] of posts.entries()) {
    const rendered = renderBody(post);
    const text = [
      `# ${post.title}`, '', `发布：${post.date}`, `更新：${post.updated}`,
      ...(post.category ? [`分类：${routeLink(post.category, `/categories/${post.category}/`)}`] : []),
      ...(post.tags.length ? [`标签：${post.tags.map(tag => routeLink(tag, `/tags/${tag}/`)).join(' · ')}`] : []),
      `原文：${routeLink('永久链接', post.path)}`, '', htmlToTerminalText(rendered, post.path),
    ].join('\n');
    const file = addFile(metadata[index].file, text);
    const adjacent = [posts[index - 1], posts[index + 1]].filter(Boolean).map(p => htmlLink(p.title, p.path)).join(' · ');
    document(post.path, post.title, file, `<h1>${e(post.title)}</h1><p>发布：${e(post.date)} · 更新：${e(post.updated)}</p><article>${rendered}</article><nav>${adjacent}</nav>`);
  }

  const about = parseSource(await fs.readFile(path.join(root, 'content/pages/about.md'), 'utf8'), 'about.md');
  const aboutHTML = renderBody(about);
  addFile('/about.txt', [profile.brand, `${profile.name} / ${profile.role}`, '', ...profile.motto, '', profile.interests, profile.welcome, '', htmlToTerminalText(aboutHTML, '/about/'), '', profile.footer].join('\n'));
  document('/about/', about.title, '/about.txt', `<h1>${e(about.title)}</h1>${aboutHTML}`);
  addFile('/contact.txt', [
    `Email: ${markdownLink(profile.email, `mailto:${profile.email}`)}`,
    `GitHub: ${markdownLink(profile.github, profile.github)}`,
    `Bilibili: ${markdownLink(profile.bilibili, profile.bilibili)}`,
  ].join('\n'));
  addFile('/README.md', [
    `# ${profile.brand}`, '', `${profile.name} / ${profile.role}`, '', ...profile.motto, '', profile.interests, profile.welcome, '',
    `${posts.length} 篇文章。中文、俄文原文及所有既有链接保留。`, '',
    'help                    查看命令', 'ls posts                浏览文章', 'cat /posts/index.md     阅读全部文章索引',
    'cat /archives/index.md  按日期阅读', 'cat /tags/index.md      标签', 'cat /categories/index.md 分类',
    'cat /about.txt          关于', 'cat /contact.txt        联系', 'cat /assets.md          原始插画与图片资源',
    'ls projects             两个站点仓库', 'ascii donut             字符实验', '',
    'less /posts/index.md     分页阅读；Space/b 翻页，j/k 移动，g/G 首尾，q 退出',
    'tree /posts | less      管道也可以分页；手机可点翻页按钮',
    './about.txt             文档路径可直接执行，从开头打开',
    'home / exit             返回首页，保留主题与命令历史', '',
    'head -5 /about.txt      前 5 行；tail -5 查看后 5 行',
    "grep -i 'sakauma|github' /about.txt /contact.txt    正则筛选；-F 按字面匹配",
    "find /posts -name '*.md' -type f                  按名称和类型查找",
    'cat /about.txt | wc -wc  词数与 UTF-8 字节数', '',
    'Tab 补全命令、文档路径与参数；Ctrl+R 搜索历史。',
    'Ctrl+A/E 行首尾，Ctrl+B/F 前后移动，Ctrl+K/U 删至行尾首，Ctrl+W 删前词。',
    'Ctrl+P/N 上下条历史；Ctrl+D 删光标后字素，空输入时返回首页。',
    '普通 cat 整页滚动；less / more 才进入分页。选中文本后 Ctrl+C 复制。', '', profile.footer,
  ].join('\n'));
  addFile('/lab/README.txt', 'ASCII lab\n\nascii donut    旋转字符圆环\nascii matrix   字符雨\nascii off      停止实验\nmotion off     静态画面\n\nEsc / Ctrl+C 停止并保留最后一帧。');
  addFile('/projects/blogmaker.md', '# blogmaker\n\nSakauma 站点的源码和静态生成器。保存文章原文、终端前端、内容转换、测试与发布脚本。\n\n[源码仓库](https://github.com/Sakauma/blogmaker)');
  addFile('/projects/homepage.md', '# Sakauma.github.io\n\nSakauma 的 GitHub Pages 发布仓库。内容由 blogmaker 构建生成，保留文章永久链接、归档、标签、分类及原始资源。\n\n[发布仓库](https://github.com/Sakauma/Sakauma.github.io)\n[在线主页](https://sakauma.github.io/)');
  const assets = [...new Set([
    ...await filesUnder(path.join(root, 'src/publish-snapshot')),
    ...await filesUnder(path.join(root, 'static')),
  ])].filter(file => /\.(?:png|jpe?g|gif|webp|svg|ico|avif)$/i.test(file)).sort();
  addFile('/assets.md', ['# 原始插画与图片资源', '', '[原首页插画：绣球花丛中的 Tlaloc](/assets/img/home-tlaloc.webp)', '', ...assets.map(asset => routeLink(asset, '/' + asset))].join('\n'));

  function rows(items) { return '<ul>' + items.map(p => `<li>${e(p.date)} — ${htmlLink(p.title, p.path)}</li>`).join('\n') + '</ul>'; }
  function listing(base, title, items, fileBase, paginate = true) {
    const size = paginate ? 10 : Math.max(items.length, 1), total = Math.max(1, Math.ceil(items.length / size));
    for (let number = 1; number <= total; number++) {
      const route = number === 1 ? base : `${base}page/${number}/`;
      const file = number === 1 ? `${fileBase}/index.md` : `${fileBase}/page/${number}.md`;
      const selected = items.slice((number - 1) * size, number * size);
      const pagination = [];
      if (number > 1) pagination.push({ title: '上一页', path: number === 2 ? base : `${base}page/${number - 1}/` });
      if (number < total) pagination.push({ title: '下一页', path: `${base}page/${number + 1}/` });
      addFile(file, [`# ${title}`, '', `${items.length} 篇文章 · ${number} / ${total}`, '', ...selected.map(p => `${p.date}  ${routeLink(p.title, p.path)}`), '', ...pagination.map(p => routeLink(p.title, p.path))].join('\n'));
      document(route, title, file, `<h1>${e(title)}</h1><p>${items.length} 篇文章 · ${number} / ${total}</p>${rows(selected)}<nav>${pagination.map(p => htmlLink(p.title, p.path)).join(' · ')}</nav>`);
    }
  }
  listing('/list/', '全部文章', posts, '/posts', false);
  listing('/archives/', '归档', posts, '/archives');
  listing('/recent-updates/', '最近更新', [...posts].sort((a, b) => b.updated.localeCompare(a.updated)), '/recent-updates');
  for (const year of new Set(posts.map(p => p.date.slice(0, 4)))) listing(`/archives/${year}/`, `${year} 年归档`, posts.filter(p => p.date.startsWith(year)), `/archives/${year}`);
  for (const month of new Set(posts.map(p => p.date.slice(0, 7)))) {
    const directory = month.replace('-', '/');
    listing(`/archives/${directory}/`, `${month} 归档`, posts.filter(p => p.date.startsWith(month)), `/archives/${directory}`);
  }
  for (const [kind, title] of [['tags', '标签'], ['categories', '分类']]) {
    const groups = new Map();
    for (const p of posts) for (const name of kind === 'tags' ? p.tags : p.category ? [p.category] : []) {
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(p);
    }
    const groupRows = [...groups].map(([name, items]) => ({ title: `${name} (${items.length})`, path: `/${kind}/${name}/` }));
    const file = addFile(`/${kind}/index.md`, [`# ${title}`, '', ...groupRows.map(g => routeLink(g.title, g.path))].join('\n'));
    document(`/${kind}/`, title, file, `<h1>${title}</h1><ul>${groupRows.map(g => `<li>${htmlLink(g.title, g.path)}</li>`).join('\n')}</ul>`);
    for (const [name, items] of groups) listing(`/${kind}/${name}/`, name, items, `/${kind}/${name}`);
  }
  const allPosts = documents.get('/list/');
  for (const alias of ['/index/', '/list/index-1.html']) document(alias, allPosts.title, allPosts.file, allPosts.html, '/list/');
  for (let number = 2; number <= Math.ceil(posts.length / 10); number++) {
    const archive = documents.get(`/archives/page/${number}/`);
    document(`/page/${number}/`, '文章', archive.file, archive.html, `/archives/page/${number}/`);
  }

  const homeTemplate = await fs.readFile(path.join(root, 'src/templates/home.html'), 'utf8');
  const homeValues = {
    latestDate: posts[0] ? `<time datetime="${posts[0].date}">${posts[0].date}</time>` : '',
    recentPosts: posts.slice(0, 5).map(p => `<li><a href="${e(href(p.path))}">${titleParts(p.title)}</a></li>`).join('\n'),
    postCount: posts.length,
    topicLinks: ['翻译', '诗歌', '民防', '未来主义'].filter(tag => routes[`/tags/${tag}/`]).map(tag => htmlLink(tag, `/tags/${tag}/`)).join('\n'),
  };
  const home = homeTemplate.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in homeValues)) throw new Error(`Unknown home template token: ${key}`);
    return homeValues[key];
  });
  document('/', `${profile.brand} | ${profile.name}`, '/README.md', home.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] || home);
  addFile('/404.txt', '404 — 页面未找到\n\n输入 ls、help 或 cat /posts/index.md 继续浏览。');
  document('/404.html', '404 — Sakauma', '/404.txt', '<h1>404</h1><p>页面未找到。</p><p><a href="/">返回首页</a> · <a href="/list/">全部文章</a></p>');
  return { manifest: { version: 1, profile, files, posts: metadata, routes }, documents };
}

export async function generateTerminalContent(root) {
  const result = await createTerminalContent(root);
  const target = path.join(root, 'terminal/src/generated/content.json');
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, JSON.stringify(result.manifest, null, 2) + '\n');
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { manifest } = await generateTerminalContent(root);
  console.log(`Generated ${manifest.posts.length} posts, ${manifest.files.length} terminal files and ${Object.keys(manifest.routes).length} routes.`);
}
