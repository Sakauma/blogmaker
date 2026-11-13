import { resolve } from 'node:path';
import { test as base, expect, type Locator, type Page } from '@playwright/test';
import { manifest, posts, profile, projectFiles, routes } from '../src/content';
import { basename, chinesePost, directoryNames, fileText, legacySourceFilenames, longestPost, originalTextRuns, poemPost, preformattedPoems, quote, russianPost, sortedPostNames, sourceForFile, sourcePosts, visibleFileLines } from './content-fixtures';

const DESKTOP = { width: 1440, height: 1000 };
const MOBILE = { width: 390, height: 844 };
type Theme = 'dark' | 'light' | 'amber';
type AsciiMode = 'donut' | 'matrix';

// Install before navigation so delayed failures and interaction errors also fail
// the test. Each case receives Playwright's fresh context and preference storage.
const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await use(errors);
    expect(errors, '终端全程不应产生未捕获的脚本错误').toEqual([]);
  }, { auto: true }],
});

const screen = (page: Page): Locator => page.locator('main#terminal-screen');
const scrollback = (page: Page): Locator => screen(page).locator('#scrollback');
const log = (page: Page): Locator => scrollback(page).getByRole('log', { name: '终端输出', exact: true });
const form = (page: Page): Locator => screen(page).locator('form#command-form');
const input = (page: Page): Locator => form(page).getByRole('textbox', { name: '终端命令', exact: true });
const submit = (page: Page): Locator => form(page).getByRole('button', { name: '执行命令', exact: true });
// Isolate command results from the echoed input, especially for grep, history,
// and error assertions: a command mentioning a word is not proof of its output.
const output = (page: Page): Locator => log(page).locator('.entry > .output').last();
const animation = (page: Page): Locator => log(page).locator('.ascii-animation').last();
const asciiPre = (page: Page): Locator => animation(page).locator(':scope > pre');

async function waitForPage(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveClass(/\bapp-ready\b/);
  await expect(screen(page)).toBeVisible();
  await expect(input(page)).toBeVisible();
  await page.evaluate(async () => { await document.fonts.ready; });
}

async function visit(page: Page): Promise<void> {
  const response = await page.goto('/');
  expect(response?.ok(), '主代理提供的本地服务应成功返回首页').toBe(true);
  await waitForPage(page);
}

async function runCommand(page: Page, command: string): Promise<void> {
  await input(page).fill(command);
  await expect(submit(page)).toBeEnabled();
  await input(page).press('Enter');
  await expect(input(page)).toHaveValue('');
}

async function expectPureTerminal(page: Page): Promise<void> {
  await expect(screen(page)).toHaveCount(1);
  await expect(page.locator('canvas, img, dialog, nav, .project-card')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(form(page)).toBeVisible();
  await expect(input(page)).toHaveAttribute('id', 'command-input');
  await expect(input(page)).toHaveJSProperty('tagName', 'TEXTAREA');
  await expect(submit(page)).toHaveAttribute('type', 'submit');
  await expect(scrollback(page)).toHaveAttribute('role', 'region');
  await expect(log(page)).toHaveAttribute('id', 'terminal-log');
  const shortcutTags = await screen(page).locator('[data-command]').evaluateAll(
    (nodes) => nodes.map((node) => node.tagName),
  );
  expect(shortcutTags.length, '终端应提供可触摸的命令快捷入口').toBeGreaterThan(0);
  expect(shortcutTags.every((tag) => tag === 'BUTTON'), '命令快捷入口必须是实际按钮').toBe(true);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const sizes = await page.evaluate(() => {
    const terminal = document.querySelector<HTMLElement>('#terminal-screen')!;
    const history = document.querySelector<HTMLElement>('#scrollback')!;
    return {
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      terminal: [terminal.scrollWidth, terminal.clientWidth],
      scrollback: [history.scrollWidth, history.clientWidth],
    };
  });
  expect(sizes.document, '文档不应产生横向滚动').toBeLessThanOrEqual(sizes.viewport + 1);
  expect(sizes.body, '正文不应撑宽视口').toBeLessThanOrEqual(sizes.viewport + 1);
  expect(sizes.terminal[0], '终端外壳不应横向溢出').toBeLessThanOrEqual(sizes.terminal[1]! + 1);
  expect(sizes.scrollback[0], '长行与 ASCII 不应撑宽日志滚动区域').toBeLessThanOrEqual(sizes.scrollback[1]! + 1);
}

async function expectInsideViewport(page: Page, element: Locator): Promise<void> {
  await expect(element).toBeVisible();
  await expect(element).toBeInViewport();
  const box = await element.boundingBox();
  const viewport = page.viewportSize();
  expect(box, '可操作控件必须具有布局尺寸').not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.y).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1);
}

async function expectInputUsable(page: Page): Promise<void> {
  await expect(input(page)).toBeEditable();
  await expectInsideViewport(page, input(page));
  await expectInsideViewport(page, submit(page));
  expect(await submit(page).evaluate((button) => {
    const rect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return hit === button || (hit !== null && button.contains(hit));
  }), '执行箭头应真实可点击，且没有被其他元素覆盖').toBe(true);
}

async function expectFile(result: Locator, path: string): Promise<void> {
  const expected = visibleFileLines(path);
  expect(expected.length, '真实 manifest 文件应有完整正文').toBeGreaterThan(0);
  const rows = result.locator(':scope > .output-line');
  await expect(rows).toHaveCount(expected.length);
  // Keep every line, repeated stanza, blank line and leading space. The source
  // preservation unit tests independently compare these files with author HTML.
  expect(await rows.allTextContents(), `逐行全文：${path}`).toEqual(expected);
}

async function expectTheme(page: Page, theme: Theme): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

async function themePaint(page: Page): Promise<string[]> {
  return page.evaluate(() => [document.documentElement, document.body, document.querySelector('#terminal-screen')!]
    .flatMap((element) => {
      const style = getComputedStyle(element);
      return [style.color, style.backgroundColor];
    }));
}

async function expectMotion(page: Page, enabled: boolean): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-motion', enabled ? 'on' : 'off');
}

async function expectStaticFrame(frame: Locator): Promise<void> {
  await expect(frame).toHaveText(/\S/);
  const samples = await frame.evaluate(async (pre) => {
    const frames = [pre.textContent ?? ''];
    // Sample across several real animation intervals, not just successive reads
    // in one task. data-running=false alone does not prove the frame has stopped.
    for (let sample = 0; sample < 5; sample += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      frames.push(pre.textContent ?? '');
    }
    return frames;
  });
  expect(new Set(samples).size, '停止后应保留同一个非空字符帧').toBe(1);
  expect(await frame.evaluate((pre) => (pre as HTMLElement).isContentEditable),
    '保留的字符帧是只读日志').toBe(false);
}

async function startAnimation(page: Page, mode: AsciiMode): Promise<Locator> {
  await runCommand(page, `ascii ${mode}`);
  const surface = animation(page);
  const frame = asciiPre(page);
  await expect(surface).toHaveAttribute('data-running', 'true');
  await expect(frame).toHaveCount(1);
  await expect(frame).toHaveText(/\S/);
  const first = await frame.textContent();
  expect(first!.split('\n').length, 'ASCII 应绘制多行字符帧').toBeGreaterThan(3);
  await expect.poll(() => frame.textContent(), {
    message: `${mode} 应真正改变字符，而不是只更新运行标记`,
    timeout: 4_000,
    intervals: [80, 120, 200],
  }).not.toBe(first);
  await expect(page.locator('canvas, img')).toHaveCount(0);
  return surface;
}

async function prepareScreenshot(page: Page, theme: Theme = 'dark'): Promise<void> {
  // Seed only visual-test contexts. Behavior tests retain fresh storage and use
  // actual commands to exercise persistence and system reduced-motion settings.
  await page.addInitScript((selectedTheme: Theme) => {
    localStorage.setItem('sakauma:cli:theme', selectedTheme);
    localStorage.setItem('sakauma:cli:motion', 'off');
  }, theme);
  await visit(page);
  await expectMotion(page, false);
  await expectTheme(page, theme);
}

async function screenshot(page: Page, name: 'desktop' | 'mobile' | 'session' | 'ascii' | 'light'): Promise<void> {
  await expectMotion(page, false);
  await expect(log(page).locator('.ascii-animation[data-running="true"]')).toHaveCount(0);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: resolve(__dirname, `../../artifacts/terminal-${name}.png`),
    fullPage: false,
    animations: 'disabled',
    caret: 'hide',
    scale: 'css',
  });
}

test('桌面首屏为深色纯终端，常驻命令行、滚动日志与按钮语义完整', async ({ page, pageErrors }) => {
  await page.setViewportSize(DESKTOP);
  await visit(page);
  await expectTheme(page, 'dark');
  await expectPureTerminal(page);
  await expect(page.locator('#prompt-path')).toHaveText('~');
  await expect(input(page)).toBeFocused();
  await expectInputUsable(page);
  await expectNoHorizontalOverflow(page);
  expect(pageErrors).toEqual([]);
});

test('欢迎内容是 ASCII 文字，首屏根目录与随后执行的真实 ls 一致', async ({ page }) => {
  await visit(page);
  const welcome = log(page).locator('pre').first();
  await expect(welcome).toHaveText(/[_/\\|]/);
  expect((await welcome.innerText()).split('\n').length).toBeGreaterThanOrEqual(3);
  const initialListing = log(page).locator('.entry[data-command-line="ls"] > .output');
  await expect(initialListing).toHaveCount(1);
  const initialText = await initialListing.innerText();
  for (const path of directoryNames('/')) expect(initialText).toContain(path);
  await expect(screen(page)).toContainText('visitor@sakauma');
  for (const value of [profile.name, profile.role, profile.interests, profile.motto.join(''), `${manifest.posts.length} 篇文章`]) {
    await expect(log(page)).toContainText(value);
  }
  await expect(screen(page)).not.toContainText(/mindspace|motion-design|visitor@orbit|orbit\.sh|a corner of the internet/i);
  await runCommand(page, 'clear');
  await runCommand(page, 'ls');
  await expect(output(page)).toHaveText(initialText, { useInnerText: true });
});

test('键入 Enter 与执行箭头均能运行命令，输出留在当前日志和当前页面', async ({ page }) => {
  await visit(page);
  const originalURL = page.url();
  await runCommand(page, 'echo typed-terminal-output');
  await expect(output(page)).toHaveText('typed-terminal-output');
  await expect(log(page)).toContainText('echo typed-terminal-output');
  await expect(input(page)).toBeFocused();
  await input(page).fill('pwd');
  await submit(page).click();
  await expect(output(page)).toHaveText('/');
  await expect(input(page)).toHaveValue('');
  await expect(input(page)).toBeFocused();
  await expect(page).toHaveURL(originalURL);
  expect(page.context().pages()).toHaveLength(1);
  await expectPureTerminal(page);
});

test('cat 读取真实 blogmaker 与 homepage 项目全文', async ({ page }) => {
  await visit(page);
  const originalURL = page.url();
  expect(projectFiles.map((file) => file.path).sort()).toEqual(['/projects/blogmaker.md', '/projects/homepage.md']);
  for (const project of projectFiles) {
    await test.step(project.path, async () => {
      await runCommand(page, 'clear');
      await runCommand(page, `cat ${quote(project.path)}`);
      await expectFile(output(page), project.path);
      await expect(page).toHaveURL(originalURL);
      await expect(page.getByRole('dialog')).toHaveCount(0);
    });
  }
  expect(page.context().pages()).toHaveLength(1);
});

test('cat 读取 manifest 全部已发布文章，包含原70篇中俄文并逐行保留原路由', async ({ page }) => {
  test.setTimeout(120_000);
  await visit(page);
  const documentMarker = await page.evaluate(() => {
    const marker = crypto.randomUUID();
    Reflect.set(window, '__terminalDocumentMarker', marker);
    return marker;
  });
  expect(sourcePosts.length).toBeGreaterThanOrEqual(legacySourceFilenames.length);
  expect(sourcePosts.map((post) => post.filename)).toEqual(expect.arrayContaining(legacySourceFilenames));
  expect(posts).toHaveLength(sourcePosts.length);
  for (const post of posts) {
    await test.step(post.title, async () => {
      expect(post.path).toBe(sourceForFile(post.file).path);
      expect(routes[post.path]).toBeDefined();
      await runCommand(page, 'clear');
      await runCommand(page, `cat ${quote(post.file)}`);
      await expectFile(output(page), post.file);
      await expect(output(page)).toContainText(post.title);
      await expect(output(page)).toContainText(post.date);
      await expect(output(page)).toContainText(post.updated);
      const anchors = await output(page).locator('a[href]').evaluateAll((nodes) => nodes.map((node) => ({
        href: node.getAttribute('href')!, route: node.getAttribute('data-route'),
      })));
      const originals = anchors.filter((anchor) => decodeURIComponent(anchor.href) === post.path);
      expect(originals).toHaveLength(1);
      expect(decodeURIComponent(originals[0].route ?? '')).toBe(post.path);
      expect(decodeURIComponent(new URL(page.url()).pathname)).toBe(post.path);
      expect(await page.evaluate(() => Reflect.get(window, '__terminalDocumentMarker'))).toBe(documentMarker);
      await expect(page.getByRole('dialog')).toHaveCount(0);
    });
  }
  expect(page.context().pages()).toHaveLength(1);
});

for (const entry of [
  { label: '中文原URL', post: chinesePost, path: chinesePost.path },
  { label: '俄文百分号编码URL与index.html别名', post: russianPost, path: encodeURI(`${russianPost.path}index.html`) },
]) {
  test(`${entry.label}直达后展示对应原文，页首保留文章而非欢迎横幅`, async ({ page }) => {
    const response = await page.goto(entry.path);
    expect(response?.status()).toBe(200);
    await waitForPage(page);
    await expectFile(output(page), entry.post.file);
    await expect(page).toHaveTitle(`${entry.post.title} | Sakauma`);
    await expect(log(page).locator('.ascii-logo')).toHaveCount(0);
    await expectPureTerminal(page);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(decodeURIComponent(new URL(page.url()).pathname)).toBe(decodeURIComponent(entry.path));
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(canonical).not.toBeNull();
    expect(decodeURIComponent(new URL(canonical!).pathname)).toBe(entry.post.path);
  });
}

test('posts标题快捷按钮打开长文章后，将文章标题而非末尾输入行带入视口', async ({ page }) => {
  await visit(page);
  await runCommand(page, 'posts');
  const articleButton = output(page).getByRole('button').filter({ hasText: longestPost.title });
  await expect(articleButton).toHaveCount(1);
  await articleButton.click();
  await expectFile(output(page), longestPost.file);
  const title = output(page).locator(':scope > .output-line').first();
  await expect(title).toContainText(longestPost.title);
  await expectInsideViewport(page, title);
  await expect(input(page)).not.toBeInViewport();
  expect(decodeURIComponent(new URL(page.url()).pathname)).toBe(longestPost.path);
});

test('相对cat、根目录别名与open id同页更新原URL，过滤输出保留当前URL', async ({ page }) => {
  await visit(page);
  const marker = await page.evaluate(() => {
    const value = crypto.randomUUID();
    Reflect.set(window, '__terminalDocumentMarker', value);
    return value;
  });
  await runCommand(page, 'cd posts');
  for (const [command, post] of [
    [`cat ${quote(basename(chinesePost.file))}`, chinesePost],
    [`cat ${quote(`~${russianPost.file}`)}`, russianPost],
    [`open ${quote(chinesePost.id)}`, chinesePost],
  ] as const) {
    await runCommand(page, command);
    await expectFile(output(page), post.file);
    expect(decodeURIComponent(new URL(page.url()).pathname)).toBe(post.path);
    expect(await page.evaluate(() => Reflect.get(window, '__terminalDocumentMarker'))).toBe(marker);
  }
  const articleURL = page.url();
  await runCommand(page, `cat ${quote(russianPost.file)} | head -n 2`);
  await expect(output(page)).toContainText(russianPost.title);
  await expect(page).toHaveURL(articleURL);
  expect(await page.evaluate(() => Reflect.get(window, '__terminalDocumentMarker'))).toBe(marker);
  expect(page.context().pages()).toHaveLength(1);
});

for (const mode of ['JavaScript禁用', '终端模块请求中断'] as const) {
  test.describe(mode, () => {
    if (mode === 'JavaScript禁用') test.use({ javaScriptEnabled: false });
    test('文章原文标题与首段直接位于首屏，空app没有占据一整屏', async ({ page }) => {
      let abortedModules = 0;
      if (mode === '终端模块请求中断') {
        await page.route('**/terminal-assets/*.js', async (request) => {
          abortedModules += 1;
          await request.abort('failed');
        });
      }
      const response = await page.goto(encodeURI(poemPost.path));
      expect(response?.status()).toBe(200);
      if (mode === '终端模块请求中断') expect(abortedModules).toBeGreaterThan(0);
      await expect(page.locator('html')).not.toHaveClass(/\bapp-ready\b/);
      await expect(page.locator('#app')).toBeHidden();
      const fallback = page.locator('#site-fallback');
      await expect(fallback).toBeVisible();
      const heading = fallback.getByRole('heading', { name: poemPost.title, exact: true });
      const firstParagraph = fallback.locator('article > p').first();
      const firstText = originalTextRuns(sourceForFile(poemPost.file))[0];
      expect(firstText).toBeTruthy();
      await expect(firstParagraph).toContainText(firstText);
      // Visibility assertions do not scroll; the original prose must already
      // sit within the initial viewport before any interaction occurs.
      await expectInsideViewport(page, heading);
      await expectInsideViewport(page, firstParagraph);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      await expect(fallback.getByRole('link', { name: '全部文章', exact: true })).toHaveAttribute('href', '/list/');
    });
  });
}

test('所有原文章URL均有独立成功入口，并自动展开其关联的完整VFS文件', async ({ page }) => {
  test.setTimeout(120_000);
  expect(posts).toHaveLength(sourcePosts.length);
  expect(posts.length).toBeGreaterThan(0);
  for (const post of posts) {
    await test.step(post.path, async () => {
      const response = await page.goto(encodeURI(post.path));
      expect(response?.status(), post.path).toBe(200);
      await waitForPage(page);
      await expectFile(output(page), post.file);
      await expect(page).toHaveTitle(`${post.title} | Sakauma`);
      await expect(page.locator('canvas, img, dialog, nav')).toHaveCount(0);
    });
  }
});

test('站内真实链接在当前终端展开，pushState与浏览器前进后退恢复对应路由', async ({ page }) => {
  const response = await page.goto('/list/');
  expect(response?.ok()).toBe(true);
  await waitForPage(page);
  await expectFile(output(page), '/posts/index.md');
  const marker = await page.evaluate(() => {
    const value = crypto.randomUUID();
    Reflect.set(window, '__terminalDocumentMarker', value);
    return value;
  });
  const article = output(page).getByRole('link', { name: chinesePost.title, exact: true });
  await expect(article).toHaveAttribute('data-route', /\S/);
  expect(decodeURIComponent(await article.getAttribute('href') ?? '')).toBe(chinesePost.path);
  await article.click();
  expect(decodeURIComponent(new URL(page.url()).pathname)).toBe(chinesePost.path);
  await expectFile(output(page), chinesePost.file);
  expect(await page.evaluate(() => Reflect.get(window, '__terminalDocumentMarker'))).toBe(marker);

  const tag = chinesePost.tags[0];
  expect(tag).toBeTruthy();
  const tagLink = output(page).getByRole('link', { name: tag, exact: true });
  await expect(tagLink).toHaveAttribute('data-route', /\S/);
  const tagPath = decodeURIComponent(await tagLink.getAttribute('href') ?? '');
  await tagLink.click();
  expect(decodeURIComponent(new URL(page.url()).pathname)).toBe(tagPath);
  const firstTaggedPost = posts.find(post => post.tags.includes(tag))!;
  await expect(output(page)).toContainText(`# ${tag}`);
  await expect(output(page).getByRole('link', { name: firstTaggedPost.title, exact: true })).toHaveCount(1);
  expect(await page.evaluate(() => Reflect.get(window, '__terminalDocumentMarker'))).toBe(marker);

  await page.goBack();
  await expectFile(output(page), chinesePost.file);
  expect(decodeURIComponent(new URL(page.url()).pathname)).toBe(chinesePost.path);
  await expect(log(page).locator('.entry')).toHaveCount(1);
  await page.goBack();
  await expectFile(output(page), '/posts/index.md');
  expect(new URL(page.url()).pathname).toBe('/list/');
  await page.goForward();
  await expectFile(output(page), chinesePost.file);
  expect(decodeURIComponent(new URL(page.url()).pathname)).toBe(chinesePost.path);
  expect(await page.evaluate(() => Reflect.get(window, '__terminalDocumentMarker'))).toBe(marker);
  expect(page.context().pages()).toHaveLength(1);
  await expectPureTerminal(page);
});

test('联系资料和原文引用保留真实外链href及完整查询参数', async ({ page }) => {
  await visit(page);
  await runCommand(page, 'cat contact.txt');
  const hrefs = await output(page).locator('a').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href')));
  for (const href of [profile.github, profile.bilibili, `mailto:${profile.email}`]) expect(hrefs).toContain(href);
  const source = sourcePosts.find((post) => post.body.includes('https://www.douban.com/group/topic/40109626/'))!;
  expect(source).toBeDefined();
  const originalHref = source.body.match(/href="([^"]+)"/)?.[1];
  expect(originalHref).toBeTruthy();
  const post = posts.find((entry) => entry.path === source.path)!;
  await runCommand(page, `cat ${quote(post.file)}`);
  const link = output(page).getByRole('link', { name: originalHref!, exact: true });
  await expect(link).toHaveAttribute('href', originalHref!);
  expect(new URL(await link.getAttribute('href') ?? '').search).toBe('?_i=5585957W7JaMyk');
  expect(await link.getAttribute('data-route')).toBeNull();
});

test('原诗每一行与PRE前导空格原样显示，CSS保留换行和缩进', async ({ page }) => {
  expect(poemPost).toBeDefined();
  await page.goto(encodeURI(poemPost.path));
  await waitForPage(page);
  await expectFile(output(page), poemPost.file);
  const poems = preformattedPoems(sourceForFile(poemPost.file));
  expect(poems.length).toBeGreaterThan(0);
  const rows = output(page).locator(':scope > .output-line');
  const rendered = await rows.allTextContents();
  for (const poem of poems) {
    const lines = poem.replace(/\n$/, '').split('\n');
    const start = rendered.indexOf(lines[0]);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(rendered.slice(start, start + lines.length)).toEqual(lines);
    expect(await rows.nth(start).evaluate((node) => getComputedStyle(node).whiteSpace)).toMatch(/^(pre|pre-wrap|break-spaces)$/);
  }
  expect(rendered.some((line) => /^ {2,}\S/.test(line))).toBe(true);
});

test('全文search找到不在标题中的原诗短句，结果快捷按钮可读完整文章', async ({ page }) => {
  await visit(page);
  const needle = '沉默地祈祷';
  expect(fileText(poemPost.file)).toContain(needle);
  expect(poemPost.title).not.toContain(needle);
  await runCommand(page, `search ${quote(needle)}`);
  await expect(output(page)).toContainText(poemPost.title);
  const result = output(page).getByRole('button').filter({ hasText: poemPost.title });
  await expect(result).toHaveCount(1);
  await result.click();
  await expectFile(output(page), poemPost.file);
  expect(decodeURIComponent(new URL(page.url()).pathname)).toBe(poemPost.path);
});

test('echo与命令错误中的Markdown标记保持纯文字，不生成内容链接', async ({ page }) => {
  await visit(page);
  const literal = `[原文](${chinesePost.path}) [Github](${profile.github})`;
  await runCommand(page, `echo ${quote(literal)}`);
  await expect(output(page)).toHaveText(literal);
  await expect(output(page).locator('a')).toHaveCount(0);
  await expect(log(page).locator('.echo-command a')).toHaveCount(0);
  await runCommand(page, quote(literal));
  await expect(output(page)).toContainText('command not found');
  await expect(output(page)).toContainText(literal);
  await expect(output(page).locator('a')).toHaveCount(0);
});

test('cd 改变提示路径，pwd 与相对文件读取使用同一个当前目录', async ({ page }) => {
  await visit(page);
  await expect(page.locator('#prompt-path')).toHaveText('~');
  await runCommand(page, 'cd projects');
  await expect(page.locator('#prompt-path')).toHaveText('~/projects');
  await runCommand(page, 'pwd');
  await expect(output(page)).toHaveText('/projects');
  await runCommand(page, 'cat blogmaker.md');
  await expectFile(output(page), '/projects/blogmaker.md');
  await runCommand(page, 'cd ..');
  await expect(page.locator('#prompt-path')).toHaveText('~');
  await runCommand(page, 'pwd');
  await expect(output(page)).toHaveText('/');
});

test('ls posts 管道真实过滤文件列表，再按 manifest 动态计数', async ({ page }) => {
  await visit(page);
  await runCommand(page, 'clear');
  const name = sortedPostNames()[0];
  const command = `ls posts | grep ${quote(name)}`;
  await runCommand(page, command);
  await expect(output(page)).toHaveText(name);
  expect(await output(page).locator('.output-line').count()).toBe(1);
  await expect(log(page)).toContainText(command);
  await runCommand(page, 'posts | wc -l');
  await expect(output(page)).toHaveText(String(posts.length));
  await runCommand(page, 'notes | wc -l');
  await expect(output(page)).toHaveText(String(posts.length));
});

test('tree 在日志展示目录树，短文件可直接 cat 而不导航或弹窗', async ({ page }) => {
  await visit(page);
  const originalURL = page.url();
  await runCommand(page, 'tree');
  for (const path of ['projects', 'blogmaker.md', 'posts', basename(chinesePost.file), 'contact.txt']) {
    await expect(output(page)).toContainText(path);
  }
  await runCommand(page, 'cat contact.txt');
  await expectFile(output(page), '/contact.txt');
  for (const value of [profile.email, profile.github, profile.bilibili]) await expect(output(page)).toContainText(value);
  await expect(page).toHaveURL(originalURL);
  expect(page.context().pages()).toHaveLength(1);
  await expectPureTerminal(page);
});

test('Tab 补全命令、目录与文件，Shift+Tab 可以离开输入行', async ({ page }) => {
  await visit(page);
  await input(page).fill('hel');
  await input(page).press('Tab');
  await expect(input(page)).toHaveValue('help ');
  await expect(input(page)).toBeFocused();
  await input(page).fill('cd pro');
  await input(page).press('Tab');
  await expect(input(page)).toHaveValue('cd projects/');
  await input(page).fill('cat projects/bl');
  await input(page).press('Tab');
  await expect(input(page)).toHaveValue('cat projects/blogmaker.md ');
  await input(page).press('Shift+Tab');
  await expect(input(page)).not.toBeFocused();
  await input(page).focus();
  await input(page).press('Enter');
  await expectFile(output(page), '/projects/blogmaker.md');
});

test('Tab 有多个候选时保留输入并在终端行内显示候选', async ({ page }) => {
  await visit(page);
  await input(page).fill('motion o');
  await input(page).press('Tab');
  await expect(input(page)).toHaveValue('motion o');
  await expect(input(page)).toBeFocused();
  const hints = screen(page).getByRole('status');
  await expect(hints).toBeVisible();
  await expect(hints).toContainText('on');
  await expect(hints).toContainText('off');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('Up/Down 按顺序回看历史，并在末端恢复未执行的草稿', async ({ page }) => {
  await visit(page);
  await runCommand(page, 'echo first-entry');
  await expect(output(page)).toHaveText('first-entry');
  await runCommand(page, 'echo second-entry');
  await expect(output(page)).toHaveText('second-entry');
  const draft = 'echo unfinished draft';
  await input(page).fill(draft);
  for (const [key, value] of [
    ['ArrowUp', 'echo second-entry'],
    ['ArrowUp', 'echo first-entry'],
    ['ArrowDown', 'echo second-entry'],
    ['ArrowDown', draft],
    ['ArrowDown', draft],
  ] as const) {
    await input(page).press(key);
    await expect(input(page)).toHaveValue(value);
  }
  await input(page).press('Enter');
  await expect(output(page)).toHaveText('unfinished draft');
});

test('history 在清屏后仍给出真实历史，结果按钮可以再次执行命令', async ({ page }) => {
  await visit(page);
  await runCommand(page, 'echo indexed-history-result');
  await runCommand(page, 'pwd');
  await runCommand(page, 'clear');
  await runCommand(page, 'history');
  await expect(output(page)).toContainText('echo indexed-history-result');
  await expect(output(page)).toContainText('pwd');
  const rerun = output(page).getByRole('button', { name: /echo indexed-history-result$/ });
  await expect(rerun).toHaveAttribute('data-command', 'echo indexed-history-result');
  await rerun.click();
  await expect(output(page)).toHaveText('indexed-history-result');
  await expect(input(page)).toBeFocused();
});

test('Ctrl+R 在行内搜索历史，Enter 载入匹配项后可执行', async ({ page }) => {
  await visit(page);
  const search = page.locator('input#history-search');
  const searchPanel = page.locator('#history-panel');
  await expect(search).toHaveCount(1);
  await expect(searchPanel).toHaveAttribute('hidden', '');
  await runCommand(page, 'echo search-history-alpha');
  await runCommand(page, 'echo search-history-beta');
  await input(page).press('Control+r');
  await expect(searchPanel).toBeVisible();
  await expect(search).toHaveAccessibleName('搜索命令历史');
  await expect(search).toBeFocused();
  await search.fill('search-history-alpha');
  await expect(page.locator('#history-match')).toHaveText('echo search-history-alpha');
  await search.press('Enter');
  await expect(searchPanel).toHaveAttribute('hidden', '');
  await expect(search).toBeHidden();
  await expect(input(page)).toHaveValue('echo search-history-alpha');
  await expect(input(page)).toBeFocused();
  await expect(output(page), '选取历史应先载入输入行').toHaveText('search-history-beta');
  await input(page).press('Enter');
  await expect(output(page)).toHaveText('search-history-alpha');
});

test('历史搜索可继续找上一条，无匹配时 Esc 恢复原草稿', async ({ page }) => {
  await visit(page);
  await runCommand(page, 'echo searchable-first');
  await runCommand(page, 'echo searchable-second');
  const draft = 'echo keep-this-draft';
  await input(page).fill(draft);
  await input(page).press('Control+r');
  const search = page.locator('#history-search');
  await search.fill('searchable-');
  await expect(page.locator('#history-match')).toHaveText('echo searchable-second');
  await search.press('Control+r');
  await expect(page.locator('#history-match')).toHaveText('echo searchable-first');
  await search.fill('no-match-acceptance-908');
  await expect(page.locator('#history-match')).toHaveText('没有匹配的历史命令');
  await search.press('Escape');
  await expect(search).toBeHidden();
  await expect(input(page)).toHaveValue(draft);
  await expect(input(page)).toBeFocused();
  await input(page).press('Enter');
  await expect(output(page)).toHaveText('keep-this-draft');
});

test('Ctrl+L 清空滚动日志而保留可继续执行的输入行', async ({ page }) => {
  await visit(page);
  await runCommand(page, 'echo clear-this-transcript');
  await input(page).fill('echo clear-keeps-draft');
  await input(page).press('Control+l');
  await expect(log(page)).toHaveText('');
  await expect(input(page)).toBeFocused();
  await expect(input(page)).toHaveValue('echo clear-keeps-draft');
  await input(page).press('Enter');
  await expect(output(page)).toHaveText('clear-keeps-draft');
  await expectInputUsable(page);
});

const invalidCommands = [
  { name: '未知命令', command: 'ghost-command', error: /command not found/ },
  { name: '缺失文件', command: 'cat posts/missing-post.md', error: /no such file or directory/ },
  { name: '未闭合引号', command: 'echo "unfinished', error: /quote|引号|unterminated/i },
  { name: '无效主题', command: 'theme neon', error: /theme: expected dark, light, or amber/ },
] as const;

for (const entry of invalidCommands) {
  test(`${entry.name}的错误留在日志，下一条有效命令仍然可用`, async ({ page }) => {
    await visit(page);
    await runCommand(page, entry.command);
    await expect(output(page)).toContainText(entry.error);
    await expect(output(page).locator('.tone-error')).not.toHaveCount(0);
    await expect(input(page)).toHaveValue('');
    await expect(input(page)).toBeFocused();
    await runCommand(page, 'echo recovered-after-error');
    await expect(output(page)).toHaveText('recovered-after-error');
    await expectTheme(page, 'dark');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
}

test('HTML 注入在命令回显、echo 输出与错误里始终只是纯文字', async ({ page }) => {
  await visit(page);
  const payload = '<img src="invalid:" onerror="window.__terminalInjectionExecuted=true"><svg onload="window.__terminalInjectionExecuted=true"></svg><script>window.__terminalInjectionExecuted=true</script>';
  const command = `echo '${payload}'`;
  await runCommand(page, command);
  await expect(log(page)).toContainText(command);
  await expect(output(page)).toHaveText(payload);
  await expect(log(page).locator('img, svg, script, iframe, object, embed, style')).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, '__terminalInjectionExecuted'))).toBeUndefined();
  await runCommand(page, `'${payload}'`);
  await expect(output(page)).toContainText(payload);
  await expect(output(page)).toContainText('command not found');
  await expect(log(page).locator('img, svg, script, iframe, object, embed, style')).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, '__terminalInjectionExecuted'))).toBeUndefined();
  await runCommand(page, 'echo text-only-recovered');
  await expect(output(page)).toHaveText('text-only-recovered');
});

test('theme light / amber / dark 改变实际颜色，并通过 CLI 存储键跨刷新保留', async ({ page }) => {
  await visit(page);
  await expectTheme(page, 'dark');
  const initialDark = await themePaint(page);
  const paints: string[][] = [];
  for (const theme of ['light', 'amber', 'dark'] as const) {
    await runCommand(page, `theme ${theme}`);
    await expectTheme(page, theme);
    expect(await page.evaluate(() => localStorage.getItem('sakauma:cli:theme'))).toBe(theme);
    await page.reload();
    await waitForPage(page);
    await expectTheme(page, theme);
    const colors = await themePaint(page);
    if (theme === 'dark') expect(colors).toEqual(initialDark);
    else expect(colors, `${theme} 应实际改变终端配色`).not.toEqual(initialDark);
    for (const previous of paints) expect(colors).not.toEqual(previous);
    paints.push(colors);
  }
});

test('motion off / on 更新根状态与 CLI 存储，刷新后保留选择', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await visit(page);
  await expectMotion(page, true);
  for (const mode of ['off', 'on'] as const) {
    await runCommand(page, `motion ${mode}`);
    await expectMotion(page, mode === 'on');
    expect(await page.evaluate(() => localStorage.getItem('sakauma:cli:motion'))).toBe(mode);
    await page.reload();
    await waitForPage(page);
    await expectMotion(page, mode === 'on');
  }
});

test('默认遵从 reduced-motion，两种 ASCII 请求都产生不运行的静态帧', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await visit(page);
  await expectMotion(page, false);
  for (const mode of ['donut', 'matrix'] as const) {
    await runCommand(page, `ascii ${mode}`);
    await expect(animation(page)).toHaveAttribute('data-running', 'false');
    await expectStaticFrame(asciiPre(page));
    await expect(input(page)).toBeEditable();
  }
  await expect(log(page).locator('.ascii-animation')).toHaveCount(2);
  await expect(page.locator('canvas, img')).toHaveCount(0);
});

test('没有手动偏好时跟随系统动效变化，显式 motion off 后保留选择', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await visit(page);
  await expectMotion(page, false);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expectMotion(page, true);
  await runCommand(page, 'motion off');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expectMotion(page, false);
  await page.reload();
  await waitForPage(page);
  await expectMotion(page, false);
});

for (const mode of ['donut', 'matrix'] as const) {
  test(`ascii ${mode} 的字符真正运动，ascii off 停止且保留最后一帧`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await visit(page);
    await expectMotion(page, true);
    const surface = await startAnimation(page, mode);
    const frame = surface.locator(':scope > pre');
    await runCommand(page, 'ascii off');
    await expect(surface).toHaveAttribute('data-running', 'false');
    await expectStaticFrame(frame);
    await expect(log(page).locator('.ascii-animation')).toHaveCount(1);
    await expect(input(page)).toBeFocused();
    await runCommand(page, `echo ${mode}-stopped`);
    await expect(output(page)).toHaveText(`${mode}-stopped`);
  });
}

for (const key of ['Control+c', 'Escape'] as const) {
  test(`${key} 终止字符动画，保留只读帧并恢复输入`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await visit(page);
    const surface = await startAnimation(page, 'donut');
    const frame = surface.locator(':scope > pre');
    await input(page).fill('unfinished-command');
    await input(page).press(key);
    await expect(surface).toHaveAttribute('data-running', 'false');
    await expectStaticFrame(frame);
    await expect(input(page)).toHaveValue('');
    await expect(input(page)).toBeFocused();
    await expectInputUsable(page);
    await runCommand(page, 'echo keyboard-stop-recovered');
    await expect(output(page)).toHaveText('keyboard-stop-recovered');
  });
}

test('motion off 可停止正在变化的字符动画，之后的 ASCII 也保持静态', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await visit(page);
  const surface = await startAnimation(page, 'matrix');
  const frame = surface.locator(':scope > pre');
  await runCommand(page, 'motion off');
  await expectMotion(page, false);
  await expect(surface).toHaveAttribute('data-running', 'false');
  await expectStaticFrame(frame);
  await runCommand(page, 'ascii donut');
  await expect(animation(page)).toHaveAttribute('data-running', 'false');
  await expectStaticFrame(asciiPre(page));
});

for (const width of [320, 768]) {
  test(`${width}px 下长文字、全文和 ASCII 均无水平溢出，输入行可见`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await visit(page);
    await expectNoHorizontalOverflow(page);
    await runCommand(page, `echo narrow-${'x'.repeat(360)}`);
    await expectNoHorizontalOverflow(page);
    await runCommand(page, `cat ${quote(longestPost.file)}`);
    await expectFile(output(page), longestPost.file);
    await expectNoHorizontalOverflow(page);
    await expectInputUsable(page);
    await runCommand(page, 'ascii donut');
    await expect(animation(page)).toHaveAttribute('data-running', 'false');
    await expectNoHorizontalOverflow(page);
    await expectInputUsable(page);
  });
}

test('桌面截图：1440×1000 默认终端、真实命令会话与静态 ASCII', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await prepareScreenshot(page);
  await screenshot(page, 'desktop');
  await runCommand(page, 'clear');
  await runCommand(page, 'tree');
  await expect(output(page)).toContainText('blogmaker.md');
  await runCommand(page, 'cat contact.txt');
  await expect(output(page)).toHaveText(/\S/);
  await expectInputUsable(page);
  await screenshot(page, 'session');
  await runCommand(page, 'clear');
  await runCommand(page, 'ascii donut');
  await expect(animation(page)).toHaveAttribute('data-running', 'false');
  await expectStaticFrame(asciiPre(page));
  await screenshot(page, 'ascii');
});

test('浅色终端截图：字体就绪、光标隐藏与字符动效关闭', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await prepareScreenshot(page, 'light');
  await screenshot(page, 'light');
});

test('正文与左右背景空白使用同一整页滚动，标题和内容同步移动', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await visit(page);
  await runCommand(page, 'tree');
  await runCommand(page, `cat ${quote(longestPost.file)}`);
  for (const x of [720, 24, 1416]) {
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document.querySelector('#scrollback')!.scrollTop = 0;
    });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    const before = await page.evaluate(() => ({
      title: document.querySelector('.terminal-title')!.getBoundingClientRect().top,
      content: document.querySelector('#terminal-log > .entry')!.getBoundingClientRect().top,
    }));
    await page.mouse.move(x, 400);
    await page.mouse.wheel(0, 320);
    await expect.poll(() => page.evaluate(() => window.scrollY), {
      message: `x=${x} 的滚轮应驱动整页，而不是局部日志或无响应的背景`,
    }).toBeGreaterThan(100);
    const after = await page.evaluate(() => ({
      scroll: window.scrollY,
      title: document.querySelector('.terminal-title')!.getBoundingClientRect().top,
      content: document.querySelector('#terminal-log > .entry')!.getBoundingClientRect().top,
      innerScroll: document.querySelector('#scrollback')!.scrollTop,
    }));
    expect(after.innerScroll).toBe(0);
    expect(Math.abs(before.title - after.title - after.scroll)).toBeLessThanOrEqual(1);
    expect(Math.abs(before.content - after.content - after.scroll)).toBeLessThanOrEqual(1);
  }
  await expectNoHorizontalOverflow(page);
});

test.describe('390×844 手机终端', () => {
  test.use({ viewport: MOBILE, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });

  test('触摸快捷命令与执行箭头可操作，长输出后输入行保持可见且无横向溢出', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await visit(page);
    await expectPureTerminal(page);
    await expectNoHorizontalOverflow(page);
    const shortcut = screen(page).locator('button[data-command="help"]').first();
    await shortcut.tap();
    await expect(output(page)).toContainText('cat');
    await expect(output(page)).toContainText('ascii');
    await expectInputUsable(page);
    await input(page).fill('echo mobile-touch-command');
    await submit(page).tap();
    await expect(output(page)).toHaveText('mobile-touch-command');
    await expect(input(page)).toHaveValue('');
    await expect(input(page)).toBeFocused();
    const longText = `mobile-${'x'.repeat(360)}`;
    await input(page).fill(`echo ${longText}`);
    await submit(page).tap();
    await expect(output(page)).toHaveText(longText);
    await expectNoHorizontalOverflow(page);
    await expectInputUsable(page);
    await expect(submit(page)).toHaveText(/\S/);
  });

  test('长会话随整张页面触摸滚动，回到输入行后继续执行', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await visit(page);
    await runCommand(page, 'tree');
    await runCommand(page, `cat ${quote(longestPost.file)}`);
    await expectFile(output(page), longestPost.file);
    await expectInputUsable(page);
    expect(await page.evaluate(() => window.scrollY), '长输出后整页应定位到输入行').toBeGreaterThan(0);
    expect(await scrollback(page).evaluate((node) => node.scrollTop)).toBe(0);
    expect(await form(page).evaluate((node) => {
      const history = document.querySelector('#terminal-log')!;
      return Boolean(history.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING);
    }), '输入行应处于日志之后').toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    // Dispatch a browser touch scroll, not an assignment to the old inner scrollTop.
    const touch = await page.context().newCDPSession(page);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 650 }] });
    for (const y of [610, 570, 530, 490, 450, 410]) {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 195, y }] });
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    }
    // Pause the finger before lifting so inertial scrolling does not hide the return control.
    await page.waitForTimeout(150);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 195, y: 410 }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await touch.detach();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    expect(await scrollback(page).evaluate((node) => node.scrollTop)).toBe(0);
    await expect(page.getByRole('button', { name: '↓ 回到输入行', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '↓ 回到输入行', exact: true }).tap();
    await expectInputUsable(page);
    await expect(input(page)).toBeFocused();
    await expect(page.locator('#jump-latest')).toBeHidden();
    await input(page).fill('echo scrollback-returned');
    await submit(page).tap();
    await expect(output(page)).toHaveText('scrollback-returned');
    await expectInputUsable(page);
    await expectNoHorizontalOverflow(page);
  });

  test('手机截图：390×844 默认纯终端，字体就绪且动效关闭', async ({ page }) => {
    await prepareScreenshot(page);
    await screenshot(page, 'mobile');
  });
});
