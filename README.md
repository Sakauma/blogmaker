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
cat /home.txt
ascii donut
```

`posts` 按日期显示全部文章标题，`search 关键词` 搜索公开标题和正文。文件名和文章标题可点击，文章从开头展开；Tab 补全命令、文档路径、参数和选项值，方向键选择历史命令。首页、介绍、联系方式、70 篇既有日志及其标签/分类/归档保持公开。项目、实验、资源索引及内部说明已移入加密私密区。文章链接仍使用原永久 URL，直接打开会启动对应的 `cat` 命令。

默认 `ls` 只显示“文章 / 关于 / 联系”。`ls posts`（或 `cd posts` 后的 `ls`）按日期显示文章标题，不再暴露编号和 `.md` 后缀；点击标题仍打开原文章。`ls -a` 显示完整根目录，`ls -a posts` 显示原始文件名和索引。隐藏仅影响默认列表，`cat`、Tab 补全、`tree`、`find`、旧链接及标签 / 归档等命令仍可访问原文件。按文件名过滤时使用 `ls -a posts | grep ...`；按标题过滤使用 `ls posts | grep ...`。

### 外观与字体

右上角“现代 / 复古”切换界面：现代是留白更充分的文字主页；复古是终端窗口、静态扫描线与荧光标题。切换按钮保留输入草稿、阅读内容、分页位置与私密区状态。外观与配色、动效相互独立，刷新后记住选择：

```text
style modern
style retro
theme dark
theme light
theme amber
motion off
```

默认使用现代布局；本地偏好键为 `sakauma:cli:style`。禁用浏览器存储时仍能在本次会话中切换。字体改为自托管 **Maple Mono**（英文和俄文），中文使用系统中文字体，避免强制下载大型字库。字体随站点发布，无第三方字体 CDN 请求；许可见 `/FONT-LICENSE.txt`，来源与校验值见 `terminal/src/fonts/README.md`。

文档本身也可以作为命令：直接输入 `/posts/001-2026-01-21.md`、`./about.txt`、`contact` 或 `about`，会清屏并从开头打开。`cat` 保留此前会话，继续使用整页自然滚动；`home`、`exit` 和空输入时的 Ctrl+D 返回首页与根目录，保留历史命令和主题偏好。

### 分页阅读

```text
less /posts/index.md
more /posts/001-2026-01-21.md
tree /posts | less
cat /about.txt | less
```

只有 `less` / `more` 会进入分页模式，普通阅读方式保持整页滚动。分页器按当前视口与实际文字换行显示一屏，长行可以跨页；原文、缩进和可点击链接保持完整。手机可使用“上一页 / 下一页 / 退出分页”按钮。退出后恢复会话和输入行。

| 操作 | 按键 |
| --- | --- |
| 下一页 / 上一页 | Space、PageDown、f / b、PageUp |
| 下一行 / 上一行 | j、↓、Enter / k、↑ |
| 首屏 / 尾屏 | g / G |
| 下半页 / 上半页 | Ctrl+D / Ctrl+U |
| 退出分页 | q、Esc、Ctrl+C；到 END 后再按 Space、PageDown 或 f |

选中文本时 Ctrl+C 仍用于复制。翻页控件保留原生 Tab 和 Enter / Space 激活行为。窗口尺寸变化后保留正在阅读的原文位置。

### 文本筛选与统计

```text
head -5 /about.txt
tail -n 8 /about.txt
tail +3 /about.txt
grep -i 'sakauma|github' /about.txt /contact.txt
grep -F '[诗歌]' /tags/index.md
find /posts -name '0[12]*.md' -type f
find /tags /archives -type d
cat /about.txt | wc -wc
wc -l /about.txt /contact.txt
/posts/001-2026-01-21.md | head -5
```

- `head` 默认前 10 行，支持 `-n N` / `-N`（0..1000）；`tail` 默认后 10 行，也支持 `+N` / `-n +N` 从第 N 行开始。两者支持多个文件与管道。
- `grep` 默认使用 JavaScript 正则表达式，`-i` 忽略大小写，`-F` 按字面匹配；多文件结果标注来源。错误正则会报告错误。
- `find` 支持多个起点、`-name` 的 `* ? []` 通配模式及 `-type f|d`。
- `wc -l/-w/-c` 可组合；`-c` 与默认第三列均按 UTF-8 **字节**计数，多文件显示合计。
- 管道先完成整条命令的参数与路径验证。文档作为管道输入时只输出文本；分页器可以放在末端，`home`、主题切换等状态命令独立执行。

### 编辑与历史

以下编辑键仅作用于命令输入框，中文输入法组合输入保持原行为。移动、删除以 Unicode 字素为边界，保留俄文组合重音及 emoji 的完整性。

| 操作 | 按键 |
| --- | --- |
| 当前行首 / 行尾 | Ctrl+A / Ctrl+E |
| 前移 / 后移一个字素 | Ctrl+B / Ctrl+F |
| 删除到行尾 / 行首 | Ctrl+K / Ctrl+U |
| 删除前一个词 | Ctrl+W |
| 删除选区或光标后的字素 | Ctrl+D；空输入时返回首页 |
| 上一条 / 下一条历史 | ↑ / ↓、Ctrl+P / Ctrl+N；返回末端恢复草稿 |
| 搜索历史 | Ctrl+R；再次按查找上一条，Enter 选取，Esc 恢复草稿 |
| 清屏 / 取消输入或字符动画 | Ctrl+L / Ctrl+C、Esc |

## 私密资料

网页输入 `unlock` 或点击底部 `unlock`，在独立密码框输入访问密码。解锁后用 `ls`、`cd`、`cat`、`less` 阅读 `/private/`，用 `download /private/路径` 下载原文件。直接访问 <https://sakauma.github.io/private/> 也会先显示密码框。`Esc` 或“取消”终止解锁，迟到的网络/解密结果会被丢弃。

输入 `lock` 或点击底部 `lock` 会删除当前标签页的私密数据、正文、分页内容、补全、命令历史与搜索草稿，并返回公开首页；刷新、新标签页以及离开页面后均重新锁定。主题与动效偏好保留。密码只在独立输入框中处理，误输到 `unlock` 参数里的文字会被丢弃，页面不会将它写入命令历史、URL 或网络请求。

网站发布的是 **AES-256-GCM 密文**，用 PBKDF2-SHA256（600000 次）从密码派生密钥；盐与 IV 每次随机生成，GCM 验证完整性。解密通过 HTTPS 下的 Web Crypto 在当前浏览器标签页完成。私密正文、附件数据与密钥不写入应用的 localStorage/sessionStorage，公开 JS、HTML 回退与索引只含公开内容和密文地址。私密入口禁用 JavaScript 时只显示已上锁提示。

### 本地编辑与加密

- `.private/password.txt`：本机访问密码，默认首次生成 24 字节随机值并编码为 32 字符。请单独备份或存入密码管理器。
- `.private/files/`：本机可编辑的私密文件，与网站的 `/private/` 对应。放置 UTF-8 文本、Markdown 或附件；子目录保持原结构。
- `private/vault.enc.json`：唯一提交到源码仓库的私密资料包，只含加密数据。构建将其复制为公开下载的密文；构建和部署都无需密码。

`.private/` 整个目录已被 Git 忽略。私密资料放在这里；`content/`、`static/`、`src/` 和 `terminal/public/` 是公开源码或公开资源。公开 `content/` 中的 `draft: true` 仅控制页面发布，原文件仍会进入源码仓库。

```sh
# 查看本机状态，不输出密码或资料内容
npm run vault -- status

# 克隆现有仓库后：先恢复 .private/password.txt，再解密本地编辑副本
npm run vault -- open

# 编辑 .private/files/ 后，重新加密，再构建和发布
npm run vault -- seal
npm run build

# 轮换为新随机密码：更新密文和本地密码文件
npm run vault -- password
npm run build
```

首次创建全新资料包才使用 `npm run vault -- init`；已存在的密文保持原样。指定自己的密码时，将至少 12 个字符的单行 UTF-8 文本放入 `.private/` 内的另一个文件，用 `npm run vault -- password --new-password-file .private/new-password.txt` 轮换。`--password-file PATH` 指定当前密码输入；`--new-password-file PATH` 指定新密码输入，外部输入文件不会被覆盖。实际生效密码始终同步保存到 `.private/password.txt`，不要把密码写成命令参数。

`seal` 先认证旧包，再采集本地文件；本地编辑目录缺失时先 `open`。`open` 在写入前检查全部冲突，已有同字节文件保持不动，内容不同则停止。二进制附件保留原字节；文本保留 BOM、CRLF 和 Unicode。密文 JSON 上限 32 MiB，明文 JSON 上限略低于 24 MiB，附件还需计入 base64 开销，单个资料包最多 10000 个文件。

轮换前的密文与旧密码备份到 `.private/backups/`。轮换针对上一次已保存的资料包，未 `seal` 的本地编辑不会自动发布。密码遗失且没有本地副本/备份时，没有找回接口。上锁保护新发布的密文；曾经公开的文章、图片、文件及 Git 历史副本仍可能被访问。改密码后，旧密码仍能打开对应的旧版本密文，因此请保管旧密码和备份。

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

共享契约包含 `version`、真实 `profile`、虚拟文本 `files`、文章元数据 `posts` 和 URL 到启动命令的 `routes`。文章文件路径稳定为 `/posts/<源文件名>.md`；目录由前端从文件路径递归推导。正文链接和索引链接使用 `[标题](URL)`，由终端显示为可点击文字。配置私密区后，`vault.url` 只引用带密文哈希版本的资料包。私密文件的绝对/相对链接通过终端命令浏览或解密下载，管道和分页保留原文档的路径上下文，私密文件名不作为 HTTP 请求路径发送。

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

YAML 使用 `yaml`，Markdown 使用 `marked`，HTML 转文本使用 `parse5`，以正确处理实体、DOM 层级、诗歌换行和缩进。TypeScript/Vite 编译交互终端，Maple Mono 字体随站点本地发布。依赖版本记录在 `package-lock.json`。
