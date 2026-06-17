# 仓库协作指南

## 项目结构

- 这个仓库是 Sakauma 静态站点的源码/构建仓库。
- 当前生产基线是 `src/publish-snapshot/`，它保存了已部署 `Sakauma.github.io` 站点的完整快照。
- `npm run build` 会删除 `dist/`，再把 `src/publish-snapshot/` 复制进去。现阶段，构建输出应与现有发布站保持部署级一致。
- `content/posts/*.md` 和 `content/pages/*.md` 保存了已抽取的博客/页面源文件，供后续生成器使用；但它们目前还没有接入构建流程。
- `src/templates/` 保存早期模板工作，目前也还没有接入 `scripts/build.mjs`。

## 常用命令

- `npm run build` - 从 `src/publish-snapshot/` 构建 `dist/`。
- `npm run dev` - 在 `http://127.0.0.1:4173/` 提供 `dist/` 的本地预览；如果 `dist/` 不存在或已过期，请先运行 `npm run build`。
- `npm run verify:deploy-parity` - 将 `dist/` 与 `../Sakauma.github.io` 对比；需要相邻的部署仓库已经存在。
- `npm run deploy:local` - 构建站点，把 `dist/` 复制到 `../Sakauma.github.io`，然后提交并推送。只有在用户明确要求时才运行。

## 编辑规则

- 不要编辑 `dist/`；它是生成产物，并且已被 git 忽略。
- 除非任务明确要求修改，否则应原样保留非 ASCII 路径和内容。站点中包含中文和俄文标题、slug 以及正文。
- 修改 `src/publish-snapshot/` 时要谨慎：它目前是部署一致性的权威来源。任何会影响站点输出的变更，都必须更新这个快照，或者先扩展生成器，让变更可以被稳定复现。
- 除非有明确理由添加包，否则保持项目无额外依赖。`package.json` 目前没有依赖项。
- 避免对生成快照中的 HTML/CSS 做大范围格式化；很小的字节级变化也可能破坏一致性预期。

## 部署说明

- GitHub Actions 会在推送到 `main` 时运行，使用 Node 22 构建，并通过 `DEPLOY_KEY` secret 将 `dist/` 推送到 `Sakauma/Sakauma.github.io`。
- 本地部署脚本会拒绝未知的部署远程仓库，但仍然会推送到 `main`；请把它们当作发布命令对待。
