# 仓库协作指南

## 项目结构

- 这个仓库是 Sakauma 静态站点的源码与构建仓库，发布仓库是 `Sakauma/Sakauma.github.io`。
- `content/posts/*.md` 是文章原文，`content/pages/about.md` 是关于页面原文；历史中文、俄文、路径和正文必须原样保留。
- `terminal/` 保存 TypeScript/Vite 终端源码、配置及浏览器测试。终端通过虚拟文件系统阅读文章、标签、分类、归档、联系信息和真实仓库介绍。
- `scripts/terminal-content.mjs` 从原文生成 `terminal/src/generated/content.json`。该文件是共享数据契约，已被 Git 忽略；修改生成器或原文后重新生成。
- `scripts/build.mjs` 编译终端，并为全部历史文章/索引/分页/别名生成独立 HTML 入口。每个入口有自己的标题、canonical、原文 HTML 回退和相同的终端程序。
- `src/publish-snapshot/` 是历史路由、原文更新时间和静态资源的证据。`src/templates/home.html` 保存原首页内容，供静态回退使用。
- `static/` 的文件按原路径覆盖复制到输出；Vite 使用 `terminal-assets/`，避免与历史 `assets/` 冲突。

## 常用命令

- `npm ci`：按 npm lock 安装依赖，需要 Node 22.12 或更新版本。
- `npm run content`：只生成终端数据。
- `npm run build`：生成数据、检查 TypeScript、编译全部站点到 `dist/`。
- `npm run dev`：在 `http://127.0.0.1:4173/` 静态预览 `dist/`，先运行 build。
- `npm run dev:terminal`：生成数据后启动终端 Vite 开发服务。
- `npm test`：生成器、内容转换、原文与资源保留、路由和部署脚本测试。
- `npm run test:terminal` / `npm run test:e2e`：终端命令与浏览器测试。
- `npm run verify:deploy-parity`：重建后与相邻 `../Sakauma.github.io` 发布工作区逐文件比对。
- `npm run deploy:local`：构建、镜像、提交并推送发布仓库。仅在用户明确要求发布时运行。

## 编辑规则

- 不直接编辑 `dist/` 和 `terminal/src/generated/content.json`；它们都是生成产物。
- 保持原文源码和历史快照不变。迁移显示格式时改生成器，保留所有原始 URL、元数据、诗歌换行、PRE 缩进及链接。
- Markdown 使用 marked，YAML 使用 yaml，HTML 转终端文字使用 parse5。避免用去标签正则代替 HTML 解析。
- `updated` 优先读取作者显式值；旧文章没有该字段时读取对应历史快照中的“最近更新”；没有历史证据的新文章回退到 `date`。
- 保留 `/list/index-1.html`、`/index/`、根分页、各年月归档、标签/分类分页、最近更新分页及 `404.html`。
- JavaScript 成功初始化后移除 `#site-fallback`；初始化失败或禁用时显示原文与导航。历史脚本不放入回退内容执行。
- Node/npm lock 是本仓库的依赖基线；依赖变更同时更新 `package.json` 与 `package-lock.json`。
- 普通命令保持整页滚动；仅 `more` / `less` 启用分页。`pager.ts` 使用真实换行高度与 `overflow: clip`，保留原始文档行、链接和 Unicode，不引入第二条滚动条；退出和浏览器导航时恢复普通输入状态。
- `shell.ts` 同步解释并先验证整条管道；末端分页器可以产生 `pager` 效果，其他状态命令独立运行。文档直接执行产生 `document` 效果，进入管道时只输出正文。
- `editor.ts` 的 Ctrl 编辑键仅在命令输入框生效，按 Unicode 字素移动/删除；IME 与选区复制保留原行为。
- 团队并行编辑时分开 terminal、生成器、测试与发布范围；提交前审阅完整差异并跑相应检查。

## 部署说明

- `.github/workflows/deploy.yml` 仅由手动 `workflow_dispatch` 触发。推送源码 `main` 不会自动发布。
- Actions 使用 Node 22、`npm ci`、构建与测试，通过 `DEPLOY_KEY` 推送发布仓库。
- 本地部署脚本检查远程地址、main 分支、干净工作区和与 origin/main 一致，然后完整镜像 dist，保留目标 `.git`。它会提交并推送。
- GitHub Pages 使用生成的 `.nojekyll`，旧中文/俄文目录保持实际文件路径，所有嵌套入口均引用根路径的终端资源。
- 只在用户明确要求时提交或推送。构建、预览和测试不发布。
