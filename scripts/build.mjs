import { promises as fs } from "node:fs";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "dist");
const site = {
  title: "Sakauma",
  author: "Egor Izmaylov",
  email: "ajax_mao@163.com",
  category: "列托夫、苏联和地下朋克的一切"
};

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function mkdir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function write(p, text) {
  await mkdir(path.dirname(p));
  await fs.writeFile(p, text, "utf8");
}

async function copyDir(src, dest) {
  if (!(await exists(src))) return;
  await mkdir(dest);
  for (const ent of await fs.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) await copyDir(s, d);
    else await fs.copyFile(s, d);
  }
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"]/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;"
  }[ch]));
}

function slugify(value = "") {
  return encodeURIComponent(String(value).trim()).replace(/%2F/g, "-");
}

function parseFrontmatter(text) {
  if (!text.startsWith("---")) return { data: {}, body: text };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { data: {}, body: text };
  const yaml = text.slice(3, end).trim().split(/\r?\n/);
  const bodyStart = text.indexOf("\n", end + 4);
  const body = bodyStart === -1 ? "" : text.slice(bodyStart + 1);
  const data = {};
  let listKey = null;
  for (const line of yaml) {
    const list = line.match(/^\s*-\s*["']?(.+?)["']?\s*$/);
    if (list && listKey) {
      data[listKey].push(list[1]);
      continue;
    }
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    listKey = null;
    let value = m[2].trim();
    if (!value) {
      data[m[1]] = [];
      listKey = m[1];
      continue;
    }
    value = value.replace(/^["']|["']$/g, "");
    data[m[1]] = value;
  }
  return { data, body };
}

function renderInline(value) {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

function renderMarkdown(markdown) {
  if (/<[a-z][\s\S]*>/i.test(markdown)) return markdown;
  const lines = markdown.replace(/\r/g, "").split("\n");
  let html = "";
  let para = [];
  let list = [];
  const flushPara = () => {
    if (!para.length) return;
    html += `<p>${renderInline(para.join(" "))}</p>\n`;
    para = [];
  };
  const flushList = () => {
    if (!list.length) return;
    html += `<ul>${list.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ul>\n`;
    list = [];
  };
  for (const line of lines) {
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.+)$/);
    if (h) {
      flushPara();
      flushList();
      html += `<h${h[1].length}>${renderInline(h[2])}</h${h[1].length}>\n`;
      continue;
    }
    const li = line.match(/^[-*]\s+(.+)$/);
    if (li) {
      flushPara();
      list.push(li[1]);
      continue;
    }
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return html;
}

async function readPosts() {
  const dir = path.join(root, "content", "posts");
  const files = (await fs.readdir(dir)).filter((name) => name.endsWith(".md")).sort();
  const posts = [];
  for (const file of files) {
    const raw = await fs.readFile(path.join(dir, file), "utf8");
    const { data, body } = parseFrontmatter(raw);
    const date = data.date || "2026-01-01";
    const fallbackPath = `/${date.replaceAll("-", "/")}/${slugify(data.title || file)}/`;
    posts.push({
      ...data,
      file,
      title: data.title || file.replace(/\.md$/, ""),
      date,
      path: data.path || fallbackPath,
      category: data.category || site.category,
      tags: Array.isArray(data.tags) ? data.tags : [],
      body: renderMarkdown(body.trim())
    });
  }
  return posts.sort((a, b) => b.date.localeCompare(a.date) || b.title.localeCompare(a.title));
}

function nav(current = "") {
  const links = [["/", "Home"], ["/list/", "Posts"], ["/archives/", "Archive"], ["/tags/", "Tags"], ["/categories/", "Categories"], ["/about/", "About"]];
  return `
<header class="nav" aria-label="Main navigation">
  <a class="brand" href="/" aria-label="Sakauma home"><span class="brand-mark">S</span><span>Sakauma</span></a>
  <nav class="nav-links" aria-label="Primary">${links.map(([href, label]) => `<a href="${href}"${current === label ? ' aria-current="page"' : ""}>${label}</a>`).join("")}</nav>
  <a class="nav-action" href="/#contact">Contact</a>
  <button class="command-button" type="button" aria-label="Open site search" aria-expanded="false" aria-controls="command-panel">Search</button>
  <button class="menu-button" type="button" aria-label="Open menu" aria-expanded="false"><span></span><span></span></button>
</header>
<nav class="mobile-menu" aria-label="Mobile navigation">${links.concat([["/#contact", "Contact"]]).map(([href, label]) => `<a href="${href}"${current === label ? ' aria-current="page"' : ""}>${label}</a>`).join("")}</nav>`;
}

function shell({ title, description = "Sakauma", current = "", body, home = false }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="description" content="${escapeHtml(description)}" />
<title>${escapeHtml(title)} | Sakauma</title>
<link rel="icon" href="/assets/img/avatar.png" />
<script>document.documentElement.classList.add("js");</script>
<link rel="stylesheet" href="/assets/site.css" />${home ? '\n<link rel="stylesheet" href="/css/home-premium.css" />' : ""}
</head>
<body class="site-page loading">
<div class="preloader" aria-hidden="true"><div class="loader-stack"><div class="loader-mark">S</div><div class="loader-bar"><span></span></div></div></div>
<div class="scroll-progress" aria-hidden="true"><span></span></div>
<div class="cursor-dot" aria-hidden="true"></div><div class="cursor-ring" aria-hidden="true"></div>
${nav(current)}
${body}
<footer class="footer"><div class="site-footer-inner"><div><strong>САКСОФОН ИГРАЕТ.</strong><p>Sakauma / Egor Izmaylov. UESTC PhD.</p></div><div>© 2024-2026 IDIPLab</div></div></footer>
<script src="/assets/site.js" defer></script>
</body>
</html>
`;
}

function pageHero(kind, title, desc = "") {
  return `<section class="page-hero"><div class="page-hero-media" aria-hidden="true"><img src="/assets/img/Tlaloc_cropped_1920x1080.webp" alt="" /></div><div class="page-hero-inner"><p class="eyebrow reveal">${escapeHtml(kind)}</p><h1 class="reveal">${escapeHtml(title)}</h1>${desc ? `<p class="reveal">${escapeHtml(desc)}</p>` : ""}</div></section>`;
}

function postList(posts) {
  return `<div class="post-list">${posts.map((post) => `<article class="post-card reveal"><div><span class="post-date">${escapeHtml(post.date.slice(5))}</span><a class="post-title" href="${post.path}">${escapeHtml(post.title)}</a></div><span class="post-category">${escapeHtml(post.category)}</span></article>`).join("\n")}</div>`;
}

function taxonomyPage(title, posts, current) {
  return shell({
    title,
    current,
    body: `<main class="site-main">${pageHero(current, title, `Posts filed under ${title}.`)}<section class="content-panel">${postList(posts)}</section></main>`
  });
}

await fs.rm(dist, { recursive: true, force: true });
await copyDir(path.join(root, "static"), dist);
await write(path.join(dist, ".nojekyll"), "");

const posts = await readPosts();
const tags = [...new Set(posts.flatMap((post) => post.tags))].sort();
const categories = [...new Set(posts.map((post) => post.category))].sort();

let home = await fs.readFile(path.join(root, "src", "templates", "home.html"), "utf8");
home = home.replace(/<link rel="stylesheet" href="\/assets\/site\.css[^"]*" \/>/, '<link rel="stylesheet" href="/assets/site.css" />');
home = home.replace(/<link rel="stylesheet" href="\/css\/home-premium\.css[^"]*" \/>/, '<link rel="stylesheet" href="/css/home-premium.css" />');
home = home.replace(/<script src="\/assets\/site\.js[^"]*" defer><\/script>/, '<script src="/assets/site.js" defer></script>');
home = home.replace(/70 Posts/g, `${posts.length} Posts`).replace(/70 POSTS/g, `${posts.length} POSTS`).replace(/70 texts/g, `${posts.length} texts`);
home = home.replace(/25 Tags/g, `${tags.length} Tags`).replace(/25 TAGS/g, `${tags.length} TAGS`);
home = home.replace(/01 Category/g, `${String(categories.length).padStart(2, "0")} Category`).replace(/01 CATEGORY/g, `${String(categories.length).padStart(2, "0")} CATEGORY`);
await write(path.join(dist, "index.html"), home);

const aboutMd = parseFrontmatter(await fs.readFile(path.join(root, "content", "pages", "about.md"), "utf8"));
await write(path.join(dist, "about", "index.html"), shell({
  title: "About",
  current: "About",
  body: `<main class="site-main">${pageHero("Profile", "About", "Sakauma / Egor Izmaylov / UESTC PhD.")}<section class="content-panel"><article class="post-body reveal"><div class="article-gallery">${renderMarkdown(aboutMd.body.trim())}</div></article></section></main>`
}));

await write(path.join(dist, "list", "index.html"), shell({
  title: "Posts",
  current: "Posts",
  body: `<main class="site-main">${pageHero("Posts", "Posts", `${posts.length} posts.`)}<section class="content-panel">${postList(posts)}</section></main>`
}));
await write(path.join(dist, "archives", "index.html"), shell({
  title: "Archive",
  current: "Archive",
  body: `<main class="site-main">${pageHero("Archive", "Archive", "2026")}<section class="content-panel">${postList(posts)}</section></main>`
}));
await write(path.join(dist, "tags", "index.html"), shell({
  title: "Tags",
  current: "Tags",
  body: `<main class="site-main">${pageHero("Tags", "Tags", `${tags.length} tags.`)}<section class="content-panel"><div class="topic-list">${tags.map((tag) => `<a class="topic-card reveal" href="/tags/${slugify(tag)}/"><span>${escapeHtml(tag)}</span><strong>${posts.filter((post) => post.tags.includes(tag)).length}</strong></a>`).join("")}</div></section></main>`
}));
await write(path.join(dist, "categories", "index.html"), shell({
  title: "Categories",
  current: "Categories",
  body: `<main class="site-main">${pageHero("Categories", "Categories", `${categories.length} category.`)}<section class="content-panel"><div class="topic-list">${categories.map((category) => `<a class="topic-card reveal" href="/categories/${slugify(category)}/"><span>${escapeHtml(category)}</span><strong>${posts.filter((post) => post.category === category).length}</strong></a>`).join("")}</div></section></main>`
}));

for (const tag of tags) {
  await write(path.join(dist, "tags", slugify(tag), "index.html"), taxonomyPage(tag, posts.filter((post) => post.tags.includes(tag)), "Tags"));
}
for (const category of categories) {
  await write(path.join(dist, "categories", slugify(category), "index.html"), taxonomyPage(category, posts.filter((post) => post.category === category), "Categories"));
}

for (let i = 0; i < posts.length; i += 1) {
  const post = posts[i];
  const prev = posts[i + 1];
  const next = posts[i - 1];
  const tagsHtml = `<div class="article-tags"><a href="/categories/${slugify(post.category)}/">${escapeHtml(post.category)}</a>${post.tags.map((tag) => `<a href="/tags/${slugify(tag)}/">${escapeHtml(tag)}</a>`).join("")}</div>`;
  const pager = `<nav class="pager" aria-label="Post navigation">${prev ? `<a href="${prev.path}">Previous: ${escapeHtml(prev.title)}</a>` : ""}${next ? `<a href="${next.path}">Next: ${escapeHtml(next.title)}</a>` : ""}</nav>`;
  const body = `<main class="site-main">${pageHero("Article", post.title, `最近更新：${post.date}`)}<section class="article-shell"><aside class="article-side reveal"><span class="article-meta">${escapeHtml(post.date)}</span>${tagsHtml}<a class="pill-link" href="/list/">Back to posts</a></aside><article class="post-body reveal"><div class="article-gallery">${post.body}</div>${pager}</article></section></main>`;
  await write(path.join(dist, post.path.replace(/^\//, ""), "index.html"), shell({ title: post.title, description: post.title, current: "Posts", body }));
}

await write(path.join(dist, "404.html"), shell({
  title: "404",
  body: `<main class="site-main">${pageHero("404", "404", "Page not found.")}<section class="content-panel"><a class="arrow-link" href="/">Home</a></section></main>`
}));

console.log(`Built ${posts.length} posts, ${tags.length} tags, ${categories.length} categories into dist/`);
