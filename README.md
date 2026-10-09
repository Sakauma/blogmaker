# Sakauma blogmaker

源码仓库：<https://github.com/Sakauma/blogmaker>
发布仓库：<https://github.com/Sakauma/Sakauma.github.io>

这是可在本地持续写作、编译和发布的 Node.js 静态博客生成器。首页沿用已确认的浅纸色 / 深绿设计、个人介绍与原插画；近作、数量、日期、文章列表、归档、标签、分类、分页和相邻文章由 `content/posts/*.md` 自动生成。既有中文 / 俄文 URL 保留，旧文章 HTML 正文保留。

## 1. 安装与预览（Windows / macOS / Linux）

安装 Node.js 22 或更新的 LTS 和 Git。在终端或 PowerShell 中：

```sh
git clone https://github.com/Sakauma/blogmaker.git
cd blogmaker
npm ci
npm run build
npm run dev
```

如果使用修改版源码覆盖包 ZIP：先克隆原仓库，再把 ZIP 中 `blogmaker/` 里面的全部文件（包括隐藏的 `.github`、`.gitignore`）覆盖到克隆的仓库根目录。覆盖包只含变更文件，不含未改动的大型历史资源，不能独立构建。不要删除原仓库目录，也不要覆盖或删除 `content/posts/` 中自己的文章；合并完成后从 `npm ci` 开始。包内的“先读我-覆盖安装.txt”提供详细步骤。

浏览器打开 <http://127.0.0.1:4173/>。`dev` 是本地静态服务器，不自动编译；每次修改后重新执行 `npm run build` 并刷新。构建 / 预览 / 测试均不会发布。请不要双击 `dist/index.html` 预览，站点链接以 `/` 开头，需通过 HTTP 访问。

## 2. 新建文章

```sh
npm run new -- "文章标题（Русское название）" "article-slug"
```

可指定日期：

```sh
npm run new -- "文章标题" "article-slug" "2026-10-09"
```

命令在 `content/posts/` 建立 UTF-8 Markdown 草稿；同名文件不会被覆盖。默认日期使用运行电脑的本地日期。打开文件，填写正文和标签，准备公开时改成 `draft: false`。示例：

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

- `title`、有效的 `date`（YYYY-MM-DD）、`path` 必填；`category` 和 `tags` 可省略。
- `path` 是永久链接，格式 `/YYYY/MM/DD/slug/`，结尾保留 `/`。已发布文章尽量不改链接，否则旧链接会失效。推荐 slug 使用 ASCII 小写和短横线，也支持现有中文 / 俄文路径；避免 Windows 禁用字符。
- `updated` 可省略，默认等于 `date`。修改旧文章时填写新的 `updated`，它会排到“最近更新”前面。
- 首页“近作”按发布日期倒序，显示 5 篇；新文章同日时排在旧快照文章前面。文章总数只计算非草稿。
- `draft: true` 的文章不会输出。未来日期不会自动隐藏；未准备公开的文章请保留草稿状态。
- 旧源文件由 HTML 抽取而来，保留原样即可。新的 Markdown 建议明确写 `format: markdown`；`format: html` 会原样输出正文。没有 `format` 且正文以 HTML 开头时按旧版 HTML 处理。
- 内容为可信作者源码，HTML 会原样输出，不要把未经审查的外来 HTML / script 直接放入文章。
- 图片放进 `static/uploads/article-slug/`，用 `/uploads/article-slug/文件名` 引用；构建会把 `static/` 覆盖复制到站点根目录。

## 3. 编译与检查

```sh
npm run build
npm test
npm run dev
```

产物在 `dist/`。新文章会自动进入首页近作、完整文章页、年份 / 月份归档、标签 / 分类、最近更新及分页。修改分类、删除源文件或改成草稿后，下一次构建会清理旧的生成路径，不会留下过期条目。构建不会改写源文章。

`npm test` 在隔离目录验证新文章新增 / 修改 / 草稿 / 删除、Markdown 和中俄文、旧正文、动态数量、各类索引、本地链接及资源；不会向远程发布。部署防护测试使用模拟 Git（Windows 上跳过这一项）；生成器测试可在 Windows 运行。`verify:deploy-parity` 仅用于比较本地 `dist/` 与相邻发布工作区，不再意味着必须匹配旧快照。

## 4. 手动上传 `dist/`

确认预览后，把 `dist/` **里面的文件及文件夹**同步到 `Sakauma.github.io` 仓库根目录，不要把 `dist` 文件夹本身上传。保留发布仓库 `.git`，包含 `.nojekyll`；生成器不使用 Jekyll。若使用网页上传请特别确认 `.nojekyll` 也上传了。

这是完整镜像同步：已删除或改名文章对应的旧文件也应从发布仓库删除；只追加上传会保留失效页面。先查看 Git 差异，再提交并推送到该仓库 `main`。GitHub Pages 的发布来源仍使用已有配置。

## 5. 可选：本地一键发布（此命令会真的推送）

首次在与 `blogmaker` 同级的位置克隆发布仓库：

```sh
cd ..
git clone https://github.com/Sakauma/Sakauma.github.io.git
cd blogmaker
```

确保发布仓库处于 `main`，本地与远程同步且没有未提交、未跟踪或被忽略的本地文件。Git 身份和 GitHub 推送认证使用你电脑已有配置，不要把密钥或 token 写入源码。

确认可以正式发布后：

```sh
npm run deploy:local
```

该命令会重新构建，检查目标确实是 `Sakauma/Sakauma.github.io`，从远程获取最新状态，然后完整替换发布工作区文件（保留 `.git`）、提交并推送 `main`。目标中不在 `dist/` 的已跟踪文件会删除；有未保存文件、分支不对或本地 / 远程不同步时拒绝继续。没有内容变化时不产生提交、不推送。

发布需要网络。若推送失败，脚本会报错并保留本地提交；检查发布仓库的 `git status` / `git log`，自行确认后完成推送或协调分支，再重试，不要盲目删除本地提交。

## 6. 可选：GitHub Actions 发布

`.github/workflows/deploy.yml` 现在仅允许 **手动 workflow_dispatch**，推送 `blogmaker/main` 不会自动上线。需要你自行配置可写入发布仓库的 `DEPLOY_KEY` secret 后，在 Actions 页面手动运行。依赖安装使用 `npm ci`。这与本地发布是两种选择，不必同时使用。

## 源码结构

- `content/posts/*.md`：文章唯一来源。
- `content/pages/about.md`：关于页面正文。
- `content/site.json`：首页优先展示的主题（只显示确实存在的标签）；不足时由实际标签补齐。
- `src/templates/home.html`：已确认的首页模板；替换标记由生成器填充，个人介绍可在此编辑。
- `src/templates/page.html`：现有文章 / 索引页的共享外壳。
- `static/`：静态资源，包括首页专用样式、脚本、插画和字体；文章共享样式不变。
- `src/publish-snapshot/`：保留的历史基础资源 / 非生成页；构建时会覆盖内容相关输出，不再只是复制快照。
- `scripts/`：构建、草稿、预览、部署脚本。
- `dist/`：可部署产物，不直接编辑，不纳入源码提交。

Markdown 使用 `marked`，YAML 元数据使用 `yaml`；这两个依赖用于可靠支持中文 / 俄文、YAML 和常用 Markdown，不使用不完整的自制解析器。安装版本记录在 `package-lock.json`。

## 独立首页预览

运行 `npm run preview` 会先重建网站，再生成 `review/Sakauma-blogmaker-preview.html`。可直接打开该文件：CSS、字体、插画和 JavaScript 已内嵌，普通页面链接指向正式站点，“跳至正文”保留为当前文档的 `#main`。脚本在正文之后执行，无 JavaScript 时正文和导航仍可使用。此命令不会部署。

自定义输出路径：先运行 `npm run build`，再运行 `node scripts/preview.mjs /absolute/path/preview.html`。
