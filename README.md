# Sakauma blogmaker

`blogmaker` 是 Sakauma 站点的源码/构建仓库。`Sakauma.github.io` 继续作为部署仓库，只保存编译后的静态文件。

当前目标是先建立一个和现有发布仓库字节级一致的构建基线：

- `src/publish-snapshot/` 保存当前 `Sakauma.github.io` 的完整发布快照。
- `npm run build` 会把该快照复制到 `dist/`。
- 这样现有首页、文章页、分页、归档、标签、分类、`recent-updates`、中文目录路径都会原样生成。

## 常用命令

```bash
npm run build
npm run dev
npm run deploy:local
```

## 新增博客源文件

现有 70 篇文章已经抽取到 `content/posts/*.md`，方便后续编辑和继续演进生成器。

新增博客时，可以先按这个格式添加 Markdown：

```markdown
---
title: "文章标题"
date: "2026-06-17"
path: "/2026/06/17/article-slug/"
category: "列托夫、苏联和地下朋克的一切"
tags:
  - "翻译"
  - "诗歌"
---

正文内容。
```

注意：当前版本优先保证“现有发布站完全一致生成”。新增文章的自动索引更新会在这个基线稳定后继续接入。

## 部署结构

- 源码仓库：`git@github.com:Sakauma/blogmaker.git`
- 发布仓库：`git@github.com:Sakauma/Sakauma.github.io.git`

本地部署命令：

```bash
npm run deploy:local
```

它会先执行 `npm run build`，再把 `dist/` 同步到相邻的 `../Sakauma.github.io` 发布仓库并推送。

GitHub Actions 自动部署需要在源码仓库配置一个可写入 `Sakauma/Sakauma.github.io` 的 secret：`DEPLOY_KEY`。
