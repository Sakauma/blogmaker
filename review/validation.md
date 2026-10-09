# 构建验证

基于 `Sakauma/blogmaker` 提交 `f4f8cbdde39de69aebb04d5a90f7c64a5fee284d` 的本地修改。

- `npm ci` 通过，锁定 Markdown / YAML 依赖。
- `npm test`：5 个测试组全部通过。覆盖原始正文、新文章新增/修改/草稿/删除、Markdown 表格、中文/俄文、Windows 路径验证、文章索引与资源链接、13 个隔离的部署安全情境（模拟 Git，无远程写入）。
- 新文章测试使用临时隔离副本，未保留测试文章。最终构建 70 篇文章、25 个标签、1 个分类、173 条页面路径。
- 首页 CSS、JavaScript、插画、字体均与已确认设计逐字节一致；当前 5 条近作的 URL 顺序与已确认首页一致。文章数量、最近日期、列表和主题由真实内容生成。
- 原有 70 篇源文件未改动，旧 HTML 正文保留；共享文章 CSS / JS 逐字节不变。
- JavaScript 语法检查与 `git diff --check` 通过。
- 本轮云端 Chromium 因运行环境禁止 socket() 启动失败，未完成新的桌面/手机截图检查。不将结构测试视为视觉测试。
- 未执行真实部署、GitHub 推送或 Actions；实际 GitHub 凭据/Pages 发布未测试。
- Windows 未实际启动测试；源码命令为跨平台 Node.js，部署模拟测试在 Windows 跳过。Linux 构建验证通过。

## 使用补丁

源码覆盖包 ZIP 需合并到原始仓库后使用，不是独立工程。若已有匹配基线的克隆，可先备份工作区，再在仓库根目录：

```sh
git apply --check /path/to/blogmaker-editorial.patch
git apply /path/to/blogmaker-editorial.patch
npm ci
npm test
npm run build
```

如果补丁检查失败，不要强制覆盖；对照 ZIP 中的文件合并现有修改。完整本地写作与发布说明见 README.md。

## 首页等价性修复（2026-10-09）

- 首页末尾的中英文半角/全角配对括号均可提取副标题，修剪周围空白；不截断非末尾括号、错配括号、空副标题或嵌套括号。原始文章标题不改动。
- 第五篇恢复“雷鬼”主标题和独立小号灰色“Reggae”副标题，沿用原 CSS。
- 独立预览移除 base，显式解析普通页面/资源链接，保留 #main 的同文档行为。新增可重复生成命令 npm run preview。
- 与已确认首页比对，可见 DOM/文字与 CSS、JS、字体、主插图一致。仅保留合理语义差异：Reggae 不标为俄语；预览内嵌脚本移到正文之后以保证复制邮箱功能能找到元素。HTML 序列化空白与中文 URL 编码不影响目标地址。
- 本轮未重试已知被阻断的 Chromium；未取得截图，不声称像素一致。
