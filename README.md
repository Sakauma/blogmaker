# Sakauma blogmaker

源码仓库：<https://github.com/Sakauma/blogmaker>

发布仓库：<https://github.com/Sakauma/Sakauma.github.io>

在线主页：<https://sakauma.github.io/>

Sakauma / Egor Izmaylov 的纯命令行主页与静态博客生成器。终端用 `ls`、`cd`、`cat`、`grep` 和 `find` 阅读全部文章，保留中文与俄文原文、诗歌换行、缩进、来源链接，以及原始图片资源。70 篇迁移文章、标签、分类、归档和旧分页入口都有独立静态页面；JavaScript 关闭或加载失败时，页面仍显示原文与导航。

## 安装与预览

安装 Node.js 22.12 或更新的 LTS 和 Git，然后运行：

```sh
git clone https://github.com/Sakauma/blogmaker.git
cd blogmaker
npm ci
npm run build
npm run dev
```

打开 <http://127.0.0.1:4173/>。`dev` 只提供已生成的 `dist/`，每次修改文章后重新 build 并刷新。`npm run preview` 会先构建再启动同一个静态预览服务。站点使用 ES 模块及 `/` 开头的链接，通过 HTTP 预览；不要双击 HTML 文件。

开发终端界面时运行 `npm run dev:terminal`，默认 <http://127.0.0.1:4317/>，支持 Vite 热更新。文章内容变化后另行运行 `npm run content` 更新生成数据；真实旧 URL 的最终效果以完整构建的静态预览为准。

## 阅读命令

```text
help
posts
search 雷鬼
ls posts
cat /posts/index.md
cat /posts/001-2026-01-21.md
cat /archives/index.md
cat /tags/index.md
cat /categories/index.md
cat /recent-updates/index.md
cat /about.txt
cat /contact.txt
cat /assets.md
ls projects
ascii donut
```

`posts` 按日期显示全部文章标题，`search 关键词` 搜索标题和正文。文件名和文章标题可点击，文章从开头展开；Tab 补全命令与路径，方向键选择历史命令。`/assets.md` 保留原首页 Tlaloc 插画和全部旧图片的资源链接；`projects/` 介绍真实源码与发布仓库。文章链接仍使用原永久 URL，直接打开会启动对应的 `cat` 命令。

## 新建文章

```sh
npm run new -- "文章标题（Русское название）" "article-slug"
npm run new -- "文章标题" "article-slug" "2026-10-09"
```

命令创建 UTF-8 草稿，同名文件不会覆盖。日期缺省时使用运行电脑的本地日期。填写正文和标签，准备公开时设置 `draft: false`：

```markdown
---
title: "文章标题（Русское название）"
date: "2026-10-09"
updated: "2026-10-09"
path: "/2026/10/09/article-slug/"
category: "列托夫、苏联和地下朋克的一切"
tags:
  - "翻译"
  - "诗歌"
format: markdown
draft: false
---

## 小标题

正文支持 **加粗**、列表、引用、代码块、表格和普通 HTML。

![图片说明](/uploads/article-slug/example.webp)
```

- `title`、有效的 `date`（YYYY-MM-DD）与 `path` 必填；分类和标签可省略。
- `path` 是永久链接，格式为 `/YYYY/MM/DD/slug/`，保留结尾 `/`。中文与俄文路径受支持，避免 Windows 禁用字符。
- `updated` 优先使用显式值。迁移旧文章缺省时读取历史快照的“最近更新”，新文章缺省时等于 `date`。正文落款中的年份保持正文含义。
- `draft: true` 不输出；未来日期不会自动隐藏。文章按发布日期排序，相同日期沿用原站顺序；新稿排在同日旧文之前。
- 旧源文件虽然扩展名为 `.md`，正文是抽取的 HTML，保留原样即可。新 Markdown 明确写 `format: markdown`；`format: html` 或未指定格式且正文以 HTML 开头时按 HTML 渲染。
- Markdown 诗歌的显式换行使用行末两个空格或 `<br>`。HTML 的 `<br>`、`<pre>` 内缩进和空行均转换为终端文本；图片以 alt 与原 URL 表示。
- 图片放在 `static/uploads/article-slug/`，用 `/uploads/article-slug/文件名` 引用。构建会保持文件路径和原字节。
- 内容为可信作者源码；静态回退保留原文 HTML。迁移程序不改写原文件。

## 构建与测试

```sh
npm run content
npm run typecheck
npm run build
npm test
npm run test:terminal
npm run test:e2e
```

`content` 生成被忽略的 `terminal/src/generated/content.json`。`build` 先生成数据、检查 TypeScript，再由 Vite 编译终端并生成每个旧 URL 的页面；字体输出到 `terminal-assets/`，旧站资源保留在原位置。每个页面有独立 title、description、canonical 和 `#site-fallback` 原文回退。终端成功初始化后移除回退内容；关闭 JavaScript 时可直接阅读 HTML。

共享契约包含 `version`、真实 `profile`、虚拟文本 `files`、文章元数据 `posts` 和 URL 到启动命令的 `routes`。文章文件路径稳定为 `/posts/<源文件名>.md`；目录由前端从文件路径递归推导。正文链接和索引链接使用 `[标题](URL)`，由终端显示为可点击文字。

`npm test` 在隔离目录验证全部历史入口、70 篇正文、静态资源字节、Markdown / HTML 转换、Unicode、新增 / 改分类 / 草稿 / 删除、原文哈希、历史更新时间和动态索引。部署测试使用模拟 Git，不连接远程；其中 POSIX shim 在 Windows 跳过。`test:terminal` 检查命令解释器，`test:e2e` 检查真实浏览器交互。浏览器测试使用已运行的服务器，默认 URL 为 `http://127.0.0.1:4317`，可通过 `BASE_URL` 指定完整构建的预览地址；浏览器通过 `BROWSER_CHANNEL` 选择。

全部构建与测试均不发布。`npm run verify:deploy-parity` 用于发布后逐文件确认本地 `dist/` 与相邻发布工作区一致，不要求新站与旧快照的 HTML 一致。

## 发布

完整上传 `dist/` **里面的文件和目录**到 `Sakauma.github.io` 仓库根目录，保留发布仓库 `.git`，包含 `.nojekyll`。已删除的生成文件也应从发布仓库移除，避免过期文章残留。GitHub Pages 使用仓库既有配置。

可选的一键发布需要相邻的发布工作区：

```sh
cd ..
git clone https://github.com/Sakauma/Sakauma.github.io.git
cd blogmaker
npm run deploy:local
```

`deploy:local` 会构建、检查目标远程地址与 main 分支、确认工作区干净且与 origin/main 一致，然后镜像 dist、提交并推送。该命令是真正的发布操作。源仓库的提交推送另行进行。推送失败时保留本地提交，检查 Git 状态与历史后再协调，不删除已有提交。

`.github/workflows/deploy.yml` 仅接受手动 `workflow_dispatch`；推送源码 main 不会自动上线。Actions 使用 Node 22、npm lock、构建与测试，再通过 `DEPLOY_KEY` secret 发布。与本地发布二选一即可。

## 源码结构

- `content/posts/`、`content/pages/`：原文唯一来源，迁移时保持字节不变。
- `terminal/`：TypeScript 终端、样式、配置与命令 / 浏览器测试。
- `terminal/src/generated/content.json`：自动生成的数据，Git 忽略。
- `scripts/terminal-content.mjs`：profile、HTML 到文本、虚拟文件、索引和路由契约。
- `scripts/build.mjs`：Vite 编译、静态回退、逐 URL 页面和历史资源复制。
- `src/publish-snapshot/`：保留的历史路由、更新时间和资源证据。
- `src/templates/home.html`：原首页内容，仍用于 JavaScript 关闭时的回退。
- `static/`：原静态资源与后续文章图片，按原路径发布。
- `dist/`：完整发布产物，Git 忽略，直接修改会在下次构建时被覆盖。

YAML 使用 `yaml`，Markdown 使用 `marked`，HTML 转文本使用 `parse5`，以正确处理实体、DOM 层级、诗歌换行和缩进。TypeScript/Vite 编译交互终端，IBM Plex Mono 字体随站点本地发布。依赖版本记录在 `package-lock.json`。
