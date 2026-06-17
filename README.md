# Sakauma site source

这是 Sakauma 个人站的源码仓库。现有 `Sakauma.github.io` 继续作为部署产物仓库；这个仓库用于写作、维护模板和运行 npm build。

## 常用命令

```bash
npm run build
npm run dev
npm run deploy:local
```

## 新增博客

在 `content/posts/` 新建 Markdown 文件：

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

然后运行 `npm run build`。生成结果在 `dist/`。

## 部署结构

- 源码仓库：本仓库，保存 Markdown、模板、构建脚本。
- 发布仓库：`git@github.com:Sakauma/Sakauma.github.io.git`，只保存 npm build 后的静态文件。

本地部署可运行：

```bash
npm run deploy:local
```

它会把 `dist/` 同步到相邻的 `../Sakauma.github.io` 发布仓库并提交。

GitHub Actions 自动部署需要在源码仓库配置一个可写入 `Sakauma/Sakauma.github.io` 的 secret：`DEPLOY_KEY`。
