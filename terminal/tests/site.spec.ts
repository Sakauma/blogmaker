import { resolve } from 'node:path';
import { test as base, expect, type Locator, type Page } from '@playwright/test';
import { manifest, posts, profile, projectFiles, routes } from '../src/content';
import { basename, chinesePost, directoryNames, fileLines, fileText, legacySourceFilenames, longestPost, originalTextRuns, poemPost, preformattedPoems, quote, russianPost, sortedPostNames, sourceForFile, sourcePosts, visibleContentLine, visibleFileLines } from './content-fixtures';
import { PRIVATE_ATTACHMENT, PRIVATE_BYTES, PRIVATE_DOCUMENT, PRIVATE_FILES, PRIVATE_MARKER, PRIVATE_PDF, PRIVATE_PDF_BYTES, PRIVATE_PROJECT, PRIVATE_README, TAMPERED_ENVELOPE, VAULT_ENVELOPE, VAULT_PASSWORD, delayVaultDecrypt, installVaultFixture, privateLines, privateRootNames, releaseVaultDecrypt, type CapturedRequest } from './vault-fixtures';

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

type PagerMode = 'less' | 'more';
interface PagerPosition { start: number; end: number; total: number; atEnd: boolean }
const pager = (page: Page): Locator => page.locator('.pager[role="region"]');
const pagerContent = (page: Page): Locator => pager(page).locator('.pager-content');
// The pager retains one original DOM row per source line. It translates the
// complete text and hides rows outside the viewport; a wrapped source line can
// remain visible across consecutive pages without being split or rewritten.
const pagerRows = (page: Page): Locator => pagerContent(page).locator(':scope > .output-line:visible');
const pagerPrevious = (page: Page): Locator => pager(page).getByRole('button', { name: '上一页', exact: true });
const pagerNext = (page: Page): Locator => pager(page).getByRole('button', { name: '下一页', exact: true });
const pagerClose = (page: Page): Locator => pager(page).getByRole('button', { name: '退出分页', exact: true });

async function pagerPosition(page: Page): Promise<PagerPosition> {
  const text = await pager(page).locator('.pager-status').innerText();
  const match = text.match(/(\d+)\s*–\s*(\d+)\s*\/\s*(\d+)\s*行/);
  expect(match, `分页状态应报告原文行号：${text}`).not.toBeNull();
  return { start: Number(match![1]), end: Number(match![2]), total: Number(match![3]), atEnd: /\bEND\b/.test(text) };
}

async function startPager(page: Page, command: string, mode: PagerMode): Promise<void> {
  await input(page).fill(command);
  await input(page).press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-pager-active', 'true');
  await expect(pager(page)).toHaveCount(1);
  await expect(pager(page)).toHaveAccessibleName(`${mode} 分页阅读`);
  await expect(form(page)).toHaveAttribute('hidden', '');
  await expect(form(page)).toBeHidden();
  await expect(page.locator('#command-input')).toHaveValue('');
  await expect(page.locator('#terminal-log > :visible')).toHaveCount(1);
  await expect(page.locator('#terminal-log > :visible .pager')).toHaveCount(1);
  await expect(page.locator('canvas, img, dialog')).toHaveCount(0);
  for (const [control, className] of [
    [pagerPrevious(page), 'pager-previous'], [pagerNext(page), 'pager-next'], [pagerClose(page), 'pager-close'],
  ] as const) {
    await expect(control).toHaveJSProperty('tagName', 'BUTTON');
    await expect(control).toHaveAttribute('type', 'button');
    await expect(control).toHaveClass(new RegExp(`\\b${className}\\b`));
    await expectInsideViewport(page, control);
  }
}

async function expectPagerSlice(page: Page, expected: string[]): Promise<PagerPosition> {
  const position = await pagerPosition(page);
  expect(await pagerContent(page).locator(':scope > .output-line').allTextContents(), '分页保留全部原文 DOM').toEqual(expected);
  expect(position.total, '总行数来自原始内容，不能用当前页或固定文章数量代替').toBe(expected.length);
  expect(position.start).toBeGreaterThanOrEqual(1);
  expect(position.end).toBeGreaterThanOrEqual(position.start);
  expect(position.end).toBeLessThanOrEqual(position.total);
  await expect(pagerRows(page)).toHaveCount(position.end - position.start + 1);
  expect(await pagerRows(page).allTextContents(), `可见原文 ${position.start}–${position.end}`).toEqual(
    expected.slice(position.start - 1, position.end),
  );
  // The final source line may wrap over more than one screen. END means its
  // final visual row has been reached, not merely that its DOM row is visible.
  if (position.atEnd) {
    expect(position.end).toBe(expected.length);
    await expect(pagerNext(page)).toBeDisabled();
  } else await expect(pagerNext(page)).toBeEnabled();
  return position;
}

async function resizePager(page: Page, viewport: { width: number; height: number }): Promise<void> {
  await page.setViewportSize(viewport);
  // ResizeObserver schedules the pager's measurement in requestAnimationFrame.
  // Read status and visibility only after that frame has committed, rather than
  // retaining a pre-resize status while later DOM assertions see the new page.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function expectPagerWidth(page: Page): Promise<void> {
  await expectNoHorizontalOverflow(page);
  for (const element of [pager(page), pagerContent(page)]) {
    const size = await element.evaluate((node) => ({ width: node.clientWidth, scroll: node.scrollWidth }));
    expect(size.width).toBeGreaterThan(0);
    expect(size.scroll, '分页正文应换行而不是横向截断或滚动').toBeLessThanOrEqual(size.width + 1);
  }
  await expectInsideViewport(page, pager(page).locator('.pager-status'));
  await expectInsideViewport(page, pagerPrevious(page));
  await expectInsideViewport(page, pagerNext(page));
  await expectInsideViewport(page, pagerClose(page));
}

async function expectPagerClosed(page: Page): Promise<void> {
  await expect(pager(page)).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveAttribute('data-pager-active', 'true');
  await expect(form(page)).toBeVisible();
  await expect(log(page)).toBeVisible();
  await expect(input(page)).toBeFocused();
  await expectInputUsable(page);
}

async function setEditor(page: Page, value: string, start: number, end = start): Promise<void> {
  await input(page).fill(value);
  await input(page).evaluate((node, selection) => {
    (node as HTMLTextAreaElement).setSelectionRange(selection.start, selection.end);
  }, { start, end });
}

async function expectEditor(page: Page, value: string, start: number, end = start): Promise<void> {
  await expect(input(page)).toHaveValue(value);
  await expect.poll(() => input(page).evaluate((node) => {
    const editor = node as HTMLTextAreaElement;
    return [editor.selectionStart, editor.selectionEnd];
  }), { message: '编辑操作应保留正确的 UTF-16 光标/选区，且不拆开 Unicode 字符' }).toEqual([start, end]);
  await expect(input(page)).toBeFocused();
}

const unlockForm = (page: Page): Locator => page.locator('form#unlock-form');
const unlockPassword = (page: Page): Locator => unlockForm(page).locator('#unlock-password');
const unlockStatus = (page: Page): Locator => unlockForm(page).locator('#unlock-status');
const unlockSubmit = (page: Page): Locator => unlockForm(page).locator('#unlock-submit');
const unlockCancel = (page: Page): Locator => unlockForm(page).locator('#unlock-cancel');
const vaultCommand = (page: Page): Locator => page.locator('#vault-command');

async function expectUnlockForm(page: Page): Promise<void> {
  await expect(unlockForm(page)).toBeVisible();
  await expect(form(page)).toBeHidden();
  await expect(form(page).locator('#unlock-form')).toHaveCount(0);
  await expect(unlockPassword(page)).toHaveAttribute('type', 'password');
  await expect(unlockPassword(page)).toHaveAccessibleName('访问密码');
  await expect(unlockStatus(page)).toHaveAttribute('role', 'status');
  await expect(unlockSubmit(page)).toHaveAccessibleName('解锁');
  await expect(unlockCancel(page)).toHaveAccessibleName('取消');
  await expect(unlockCancel(page)).toBeEnabled();
  await expect(page.locator('html')).toHaveAttribute('data-vault', 'locked');
  await expect(page.locator('#command-input')).toHaveValue('');
}

async function beginUnlock(page: Page, command = 'unlock'): Promise<void> {
  await input(page).fill(command);
  await input(page).press('Enter');
  await expectUnlockForm(page);
}

async function submitPassword(page: Page, password = VAULT_PASSWORD): Promise<void> {
  await unlockPassword(page).fill(password);
  await unlockSubmit(page).click();
}

async function unlockFixture(page: Page, command = 'unlock'): Promise<void> {
  await beginUnlock(page, command);
  await submitPassword(page);
  await expect(page.locator('html')).toHaveAttribute('data-vault', 'unlocked');
  await expect(unlockForm(page)).toBeHidden();
  await expect(unlockPassword(page)).toHaveValue('');
  await expect(vaultCommand(page)).toHaveText('lock');
}

async function expectLocked(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-vault', 'locked');
  await expect(vaultCommand(page)).toHaveText('unlock');
  expect((await page.locator('#terminal-log .output').allTextContents()).join('\n'), '包括隐藏输出在内都不应残留解密内容').not.toContain(PRIVATE_MARKER);
}

async function expectPasswordAbsent(page: Page, requests: CapturedRequest[], password = VAULT_PASSWORD): Promise<void> {
  const stored = await page.evaluate(() => ({
    html: document.documentElement.outerHTML,
    text: document.body.textContent,
    inputs: [...document.querySelectorAll('input, textarea')].map(node => (node as HTMLInputElement).value),
    local: Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])),
    session: Object.fromEntries(Object.keys(sessionStorage).map(key => [key, sessionStorage.getItem(key)])),
  }));
  for (const encoded of [password, encodeURIComponent(password), Buffer.from(password, 'utf8').toString('base64')]) {
    expect(JSON.stringify(stored), '口令不应留在DOM、输入草稿或浏览器存储').not.toContain(encoded);
    expect(JSON.stringify(requests), '口令不应通过URL、请求头或请求体发送').not.toContain(encoded);
  }
}

async function expectClearedVault(page: Page): Promise<void> {
  await expectLocked(page);
  await expect(page).toHaveTitle('Sakauma | Egor Izmaylov');
  expect(new URL(page.url()).pathname).toBe('/');
  await expect(page.locator('#prompt-path')).toHaveText('~');
  await expect(pager(page)).toHaveCount(0);
  await expect(unlockForm(page)).toBeHidden();
  await expect(unlockPassword(page)).toHaveValue('');
  await expect(input(page)).toHaveValue('');
  await expect(page.locator('#history-panel')).toBeHidden();
  await expect(page.locator('#history-search')).toHaveValue('');
  await expect(page.locator('#history-match')).toHaveText('');
  await expect(page.locator('#completion-hints')).toBeHidden();
  await expect(page.locator('#completion-hints')).toHaveText('');
  const html = await page.locator('html').evaluate(node => node.outerHTML);
  for (const file of PRIVATE_FILES) expect(html).not.toContain(file.path);
}

async function expectPrivateOutput(page: Page, path = PRIVATE_DOCUMENT): Promise<void> {
  expect(await output(page).locator(':scope > .output-line').allTextContents()).toEqual(privateLines(path));
}

test('桌面首屏为深色纯终端，常驻命令行、滚动日志与按钮语义完整', async ({ page, pageErrors }) => {
  await page.setViewportSize(DESKTOP);
  await visit(page);
  await expectTheme(page, 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-style', 'retro');
  await expect(page.locator('#style-status')).toHaveText('style:retro');
  await expectPureTerminal(page);
  await expect(page.locator('#prompt-path')).toHaveText('~');
  await expect(input(page)).toBeFocused();
  await expectInputUsable(page);
  await expectNoHorizontalOverflow(page);
  expect(pageErrors).toEqual([]);
});

test('首页仅展示 fetch 信息与单个输入行，目录和用法通过命令获取', async ({ page }) => {
  await visit(page);
  await expect(form(page)).toHaveCount(1);
  await expect(log(page).locator('.echo-line, .entry')).toHaveCount(0);
  await expect(log(page).locator('.ascii-logo')).toHaveCount(1);
  await expect(log(page).locator('.ascii-logo')).toHaveText(/[_/\\|]/);
  const daily = log(page).locator('[data-fetch-field="today"]');
  await expect(daily).toHaveText(/today\d{4}-\d{2}-\d{2} · 星期[日一二三四五六]/);
  await expect(log(page).locator('[data-fetch-field="year"]')).toContainText(/第 \d+ \/ 36[56] 天/);
  await expect(log(page).locator('[data-fetch-field="progress"]')).toContainText(/\[[#-]{12}\] \d+\.\d%/);
  await expect(log(page).locator('.home-view button, .home-directory, .starter-commands, .style-hint')).toHaveCount(0);
  await expect(log(page)).not.toContainText('点击目录，或输入命令');
  await expect(log(page)).not.toContainText('风格：输入');
  await expect(screen(page)).toContainText('visitor@sakauma');
  for (const value of [profile.name, profile.role, profile.interests, profile.motto.join(''), `${manifest.posts.length} 篇文章`]) {
    await expect(log(page)).toContainText(value);
  }
  await expect(screen(page)).not.toContainText(/mindspace|motion-design|visitor@orbit|orbit\.sh|a corner of the internet/i);
  await runCommand(page, 'clear');
  await runCommand(page, 'ls');
  await expect(log(page).locator('.echo-line')).toHaveCount(1);
  expect(await output(page).locator('button').allTextContents()).toEqual(['文章/', '关于', '联系']);
  await runCommand(page, 'help');
  await expect(output(page)).toContainText('style modern|retro');
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

test('cat 读取公开主页介绍全文，默认锁定时没有私密项目数据', async ({ page }) => {
  await visit(page);
  const originalURL = page.url();
  expect(projectFiles).toEqual([]);
  await runCommand(page, 'clear');
  await runCommand(page, 'cat /home.txt');
  await expectFile(output(page), '/home.txt');
  await expect(page).toHaveURL(originalURL);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-vault', 'locked');
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
  await runCommand(page, 'cd posts');
  await expect(page.locator('#prompt-path')).toHaveText('~/posts');
  await runCommand(page, 'pwd');
  await expect(output(page)).toHaveText('/posts');
  await runCommand(page, `cat ${quote(basename(chinesePost.file))}`);
  await expectFile(output(page), chinesePost.file);
  await runCommand(page, 'cd ..');
  await expect(page.locator('#prompt-path')).toHaveText('~');
  await runCommand(page, 'pwd');
  await expect(output(page)).toHaveText('/');
});

test('ls -a posts 管道过滤文件名，默认 ls posts 显示完整标题列表', async ({ page }) => {
  await visit(page);
  await runCommand(page, 'clear');
  const name = sortedPostNames()[0];
  const command = `ls -a posts | grep ${quote(name)}`;
  await runCommand(page, command);
  await expect(output(page)).toHaveText(name);
  expect(await output(page).locator('.output-line').count()).toBe(1);
  await expect(log(page)).toContainText(command);
  await runCommand(page, 'ls posts');
  expect(await output(page).locator('button').allTextContents()).toEqual(posts.map(post => `${post.date}  ${post.title}`));
  await output(page).getByRole('button', { name: `${posts[0].date}  ${posts[0].title}`, exact: true }).click();
  await expectFile(output(page), posts[0].file);
  expect(decodeURIComponent(new URL(page.url()).pathname)).toBe(posts[0].path);
  await runCommand(page, 'posts | wc -l');
  await expect(output(page)).toHaveText(String(posts.length));
  await runCommand(page, 'notes | wc -l');
  await expect(output(page)).toHaveText(String(posts.length));
});

test('tree 在日志展示目录树，短文件可直接 cat 而不导航或弹窗', async ({ page }) => {
  await visit(page);
  const originalURL = page.url();
  await runCommand(page, 'tree');
  for (const path of ['private', 'home.txt', 'posts', basename(chinesePost.file), 'contact.txt']) {
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
  await input(page).fill('cd po');
  await input(page).press('Tab');
  await expect(input(page)).toHaveValue('cd posts/');
  await input(page).fill('cat ho');
  await input(page).press('Tab');
  await expect(input(page)).toHaveValue('cat home.txt ');
  await input(page).press('Shift+Tab');
  await expect(input(page)).not.toBeFocused();
  await input(page).focus();
  await input(page).press('Enter');
  await expectFile(output(page), '/home.txt');
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

test('风格仅通过命令切换，保留正文、配色和刷新偏好', async ({ page }) => {
  await visit(page);
  await expect(page.locator('[data-style-choice], .style-switch')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '复古', exact: true })).toHaveCount(0);
  await expect(page.locator('.style-hint')).toHaveCount(0);
  await runCommand(page, 'theme light');
  await runCommand(page, 'clear');
  await runCommand(page, 'cat ' + quote(russianPost.file));
  const content = await output(page).textContent();
  const url = page.url();
  await runCommand(page, 'style retro');
  await expect(page.locator('html')).toHaveAttribute('data-style', 'retro');
  await expect(page.locator('#style-status')).toHaveText('style:retro');
  await expectTheme(page, 'light');
  expect(await log(page).locator('.entry > .output').first().textContent()).toBe(content);
  expect(page.url()).toBe(url);
  expect(await page.evaluate(() => localStorage.getItem('sakauma:cli:style'))).toBe('retro');
  await page.reload();
  await waitForPage(page);
  await expect(page.locator('html')).toHaveAttribute('data-style', 'retro');
  await expectTheme(page, 'light');
  await expectFile(output(page), russianPost.file);
  await runCommand(page, 'style modern');
  await page.reload();
  await waitForPage(page);
  await expect(page.locator('html')).toHaveAttribute('data-style', 'modern');
  await expectTheme(page, 'light');
});

test('两种风格在320px使用命令切换后仍可阅读和输入', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await visit(page);
  for (const style of ['retro', 'modern'] as const) {
    await runCommand(page, 'style ' + style);
    await runCommand(page, 'home');
    await expect(page.locator('html')).toHaveAttribute('data-style', style);
    await expectNoHorizontalOverflow(page);
    await expect(input(page)).toBeEditable();
    await runCommand(page, 'today');
    await expect(output(page).locator('.output-line')).toHaveCount(5);
  }
});

test('fetch与neofetch输出当天快照，today支持文本筛选', async ({ page }) => {
  await visit(page);
  await runCommand(page, 'clear');
  for (const command of ['fetch', 'neofetch']) {
    await runCommand(page, command);
    await expect(output(page).locator('.ascii-logo')).toHaveCount(1);
    await expect(output(page).locator('[data-fetch-field="time"]')).toContainText(/\d{2}:\d{2}:\d{2}/);
    await expect(output(page).locator('[data-fetch-field="zone"]')).toContainText('UTC');
  }
  await runCommand(page, 'today | wc -l');
  await expect(output(page)).toHaveText('5');
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
  await expect(output(page)).toContainText('home.txt');
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

for (const mode of ['less', 'more'] as const) {
  test(`${mode} 文件分页逐行保留真实诗文、缩进与链接，退出恢复会话且 cat 仍展开全文`, async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 620 });
    await visit(page);
    await runCommand(page, 'echo retained-before-reading');
    const expected = visibleFileLines(poemPost.file);
    await startPager(page, `${mode} ${quote(poemPost.file)}`, mode);
    const first = await expectPagerSlice(page, expected);
    expect(first.start).toBe(1);
    expect(first.end).toBeLessThan(expected.length);
    await expect(pagerPrevious(page)).toBeDisabled();
    const originalRoutes = await pagerContent(page).locator('a[data-route]').evaluateAll(nodes =>
      nodes.map(node => decodeURIComponent(node.getAttribute('href') ?? '')));
    expect(originalRoutes, '原文路由链接保留在分页正文').toContain(poemPost.path);
    const rendered = await pagerContent(page).locator(':scope > .output-line').allTextContents();
    const indented = rendered.findIndex(line => /^ {2,}\S/.test(line));
    expect(indented, '沿用包含 PRE 缩进的原诗 fixture').toBeGreaterThanOrEqual(0);
    expect(await pagerContent(page).locator(':scope > .output-line').nth(indented).evaluate(node => getComputedStyle(node).whiteSpace))
      .toMatch(/^(pre|pre-wrap|break-spaces)$/);
    const seen = new Map<number, string>();
    let position = first;
    for (let step = 0; step < expected.length; step += 1) {
      const visible = await pagerRows(page).allTextContents();
      visible.forEach((text, index) => seen.set(position.start - 1 + index, text));
      await expectPagerWidth(page);
      if (position.atEnd) break;
      const previous = position;
      await pagerNext(page).click();
      await expect.poll(async () => (await pagerPosition(page)).start).toBeGreaterThan(previous.start);
      position = await expectPagerSlice(page, expected);
      expect(position.start, '相邻页可以重叠，原文行不能跳过').toBeLessThanOrEqual(previous.end + 1);
    }
    expect(position.atEnd, '有限次翻页应抵达真实全文末尾').toBe(true);
    expect([...seen.entries()].sort(([a], [b]) => a - b).map(([, text]) => text)).toEqual(expected);
    await page.keyboard.press('q');
    await expectPagerClosed(page);
    await expect(log(page)).toContainText('retained-before-reading');
    await expect(output(page)).toHaveText(/\S/);
    await expect(output(page)).toContainText(/less|more|阅读|分页/);
    expect(await output(page).locator(':scope > .output-line').count(), '退出只保留简短阅读状态').toBeLessThan(8);
    await runCommand(page, `cat ${quote(poemPost.file)}`);
    await expectFile(output(page), poemPost.file);
    await expect(pager(page)).toHaveCount(0);
    await expectInputUsable(page);
  });

  test(`${mode} 位于管道末端时分页显示实际目录结果，最终一页保持满页`, async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 520 });
    await visit(page);
    const originalURL = page.url();
    const expected = ['.', '..', ...directoryNames('/posts')];
    await startPager(page, `ls -a /posts | ${mode}`, mode);
    const first = await expectPagerSlice(page, expected);
    expect(first.start).toBe(1);
    expect(first.end).toBeLessThan(expected.length);
    await page.keyboard.press('G');
    await expect(pager(page).locator('.pager-status')).toContainText('END');
    const last = await expectPagerSlice(page, expected);
    expect(last.end).toBe(expected.length);
    expect(last.end - last.start + 1, '等高目录行的尾页应向前补齐，可与上一页重叠').toBe(first.end - first.start + 1);
    await expect(pagerRows(page).last()).toHaveText(expected.at(-1)!);
    await expect(page).toHaveURL(originalURL);
    await pagerClose(page).click();
    await expectPagerClosed(page);
  });
}

test('分页键 Space/PageDown/f 与 b/PageUp 按实际可视页前后移动，g/G 回首尾', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 520 });
  await visit(page);
  const expected = ['.', '..', ...directoryNames('/posts')];
  await startPager(page, 'ls -a /posts | less', 'less');
  const first = await expectPagerSlice(page, expected);
  for (const [forward, backward] of [['Space', 'b'], ['PageDown', 'PageUp'], ['f', 'b']] as const) {
    await page.keyboard.press(forward);
    await expect.poll(async () => (await pagerPosition(page)).start).toBeGreaterThan(first.start);
    const next = await expectPagerSlice(page, expected);
    expect(next.start).toBeGreaterThanOrEqual(first.end - 1);
    expect(next.start).toBeLessThanOrEqual(first.end + 1);
    await page.keyboard.press(backward);
    await expect.poll(async () => (await pagerPosition(page)).start).toBe(1);
    expect(await expectPagerSlice(page, expected)).toEqual(first);
  }
  await page.keyboard.press('G');
  await expect(pager(page).locator('.pager-status')).toContainText('END');
  await expectPagerSlice(page, expected);
  await page.keyboard.press('g');
  await expect.poll(async () => (await pagerPosition(page)).start).toBe(1);
  expect(await expectPagerSlice(page, expected)).toEqual(first);
  await expect(pagerPrevious(page)).toBeDisabled();
  for (const key of ['b', 'PageUp', 'k', 'ArrowUp', 'Control+u']) {
    await page.keyboard.press(key);
    expect(await expectPagerSlice(page, expected)).toEqual(first);
  }
});

test('分页键 j/k、方向键与 Enter 移一行，Ctrl+D/U 移半页', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 620 });
  await visit(page);
  const expected = ['.', '..', ...directoryNames('/posts')];
  await startPager(page, 'ls -a /posts | less', 'less');
  const first = await expectPagerSlice(page, expected);
  let start = 1;
  for (const key of ['j', 'ArrowDown', 'Enter']) {
    await page.keyboard.press(key);
    start += 1;
    await expect.poll(async () => (await pagerPosition(page)).start).toBe(start);
    await expectPagerSlice(page, expected);
  }
  for (const key of ['k', 'ArrowUp']) {
    await page.keyboard.press(key);
    start -= 1;
    await expect.poll(async () => (await pagerPosition(page)).start).toBe(start);
    await expectPagerSlice(page, expected);
  }
  await page.keyboard.press('g');
  await expect.poll(async () => (await pagerPosition(page)).start).toBe(1);
  await page.keyboard.press('Control+d');
  await expect.poll(async () => (await pagerPosition(page)).start).toBeGreaterThan(1);
  const half = await expectPagerSlice(page, expected);
  const visibleLines = first.end - first.start + 1;
  expect(half.start - first.start).toBeGreaterThanOrEqual(Math.floor(visibleLines / 2) - 1);
  expect(half.start - first.start).toBeLessThanOrEqual(Math.ceil(visibleLines / 2) + 1);
  await page.keyboard.press('Control+u');
  await expect.poll(async () => (await pagerPosition(page)).start).toBe(1);
  expect(await expectPagerSlice(page, expected)).toEqual(first);
  await expect(form(page)).toBeHidden();
});

for (const key of ['Space', 'PageDown', 'f'] as const) {
  test(`分页已到 END 时 ${key} 退出并恢复可用提示符`, async ({ page }) => {
    await visit(page);
    await startPager(page, `less ${quote(poemPost.file)}`, 'less');
    await page.keyboard.press('G');
    await expect(pager(page).locator('.pager-status')).toContainText('END');
    await expect(pagerNext(page)).toBeDisabled();
    await page.keyboard.press(key);
    await expectPagerClosed(page);
    await runCommand(page, 'echo eof-prompt-restored');
    await expect(output(page)).toHaveText('eof-prompt-restored');
  });
}

for (const key of ['q', 'Escape', 'Control+c'] as const) {
  test(`分页中的 ${key} 立即退出，之前的会话和主题保持`, async ({ page }) => {
    await visit(page);
    await runCommand(page, 'theme amber');
    await runCommand(page, 'echo before-pager-interrupt');
    await startPager(page, `more ${quote(poemPost.file)}`, 'more');
    await page.keyboard.press(key);
    await expectPagerClosed(page);
    await expectTheme(page, 'amber');
    await expect(log(page)).toContainText('before-pager-interrupt');
    await runCommand(page, 'echo after-pager-interrupt');
    await expect(output(page)).toHaveText('after-pager-interrupt');
  });
}

test('分页正文已选中文本时 Ctrl+C 保持原生复制，清除选区后可退出', async ({ page }) => {
  await visit(page);
  await startPager(page, `less ${quote(poemPost.file)}`, 'less');
  const selection = await pagerRows(page).first().evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const selected = window.getSelection()!;
    selected.removeAllRanges();
    selected.addRange(range);
    const copyProbe = (event: KeyboardEvent): void => {
      if (event.ctrlKey && event.key.toLowerCase() === 'c') {
        Reflect.set(window, '__pagerCopyPrevented', event.defaultPrevented);
        document.removeEventListener('keydown', copyProbe);
      }
    };
    document.addEventListener('keydown', copyProbe);
    return selected.toString();
  });
  expect(selection).not.toBe('');
  await page.keyboard.press('Control+c');
  await expect(page.locator('html')).toHaveAttribute('data-pager-active', 'true');
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(selection);
  expect(await page.evaluate(() => Reflect.get(window, '__pagerCopyPrevented'))).toBe(false);
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.keyboard.press('Control+c');
  await expectPagerClosed(page);
});

test('分页会随高度与320px宽度重新计算，换行正文和操作按钮保持可读', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await visit(page);
  const expected = visibleFileLines(poemPost.file);
  await startPager(page, `less ${quote(poemPost.file)}`, 'less');
  const tall = await expectPagerSlice(page, expected);
  await page.screenshot({ path: resolve(__dirname, '../../artifacts/desktop-pager.png'), fullPage: false, animations: 'disabled', caret: 'hide', scale: 'css' });
  await resizePager(page, { width: 1100, height: 460 });
  await expect.poll(async () => (await pagerPosition(page)).end).toBeLessThan(tall.end);
  const short = await expectPagerSlice(page, expected);
  expect(short.start).toBe(1);
  await expectPagerWidth(page);
  await resizePager(page, { width: 320, height: 740 });
  await expect.poll(() => pager(page).evaluate(node => node.getBoundingClientRect().width)).toBeLessThanOrEqual(320);
  await expectPagerSlice(page, expected);
  await expectPagerWidth(page);
  await page.keyboard.press('G');
  await expect(pager(page).locator('.pager-status')).toContainText('END');
  await expectPagerSlice(page, expected);
  await expectPagerWidth(page);
  await resizePager(page, { width: 1100, height: 860 });
  await expectPagerSlice(page, expected);
  await expectPagerWidth(page);
  await pagerClose(page).click();
  await expectPagerClosed(page);
});

test('320px长段落跨页连续平移，完整原文不截短且无水平溢出', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 600 });
  await visit(page);
  const expected = visibleFileLines(longestPost.file);
  const longestIndex = expected.reduce((best, line, index) => line.length > expected[best].length ? index : best, 0);
  await startPager(page, `less ${quote(longestPost.file)}`, 'less');
  const longRow = pagerContent(page).locator(':scope > .output-line').nth(longestIndex);
  expect(await longRow.textContent()).toBe(expected[longestIndex]);
  let found = false;
  for (let step = 0; step < expected.length * 2; step += 1) {
    const position = await expectPagerSlice(page, expected);
    if (position.start <= longestIndex + 1 && position.end >= longestIndex + 1) {
      found = true;
      break;
    }
    expect(position.atEnd, '长段落必须在 END 之前出现').toBe(false);
    await pagerNext(page).click();
  }
  expect(found, '分页应实际到达 fixture 中的长段落').toBe(true);
  await expect(longRow).toBeVisible();
  const before = await longRow.boundingBox();
  expect(before!.height, '所选真实长段落必须产生跨屏换行').toBeGreaterThan(page.viewportSize()!.height);
  await pagerNext(page).click();
  await expect(longRow).toBeVisible();
  await expect.poll(async () => (await longRow.boundingBox())!.y).toBeLessThan(before!.y);
  expect(await longRow.textContent()).toBe(expected[longestIndex]);
  await expectPagerSlice(page, expected);
  await expectPagerWidth(page);
  await resizePager(page, { width: 768, height: 900 });
  await expectPagerSlice(page, expected);
  await expectPagerWidth(page);
  await page.keyboard.press('G');
  await expect(pager(page).locator('.pager-status')).toContainText('END');
  await expectPagerSlice(page, expected);
});

test('分页中的真实站内链接退出阅读并同页展开原文，前进后退保留旧路由', async ({ page }) => {
  const response = await page.goto('/list/');
  expect(response?.ok()).toBe(true);
  await waitForPage(page);
  const marker = await page.evaluate(() => {
    const value = crypto.randomUUID();
    Reflect.set(window, '__pagerDocumentMarker', value);
    return value;
  });
  await startPager(page, 'less /posts/index.md', 'less');
  await expectPagerSlice(page, visibleFileLines('/posts/index.md'));
  const links = await pagerContent(page).locator('a[data-route]:visible').evaluateAll(nodes => nodes.map(node => ({
    title: node.textContent, path: decodeURIComponent((node as HTMLAnchorElement).pathname),
  })));
  const linkedPost = posts.find(post => links.some(link => link.path === post.path));
  expect(linkedPost, '索引第一页必须包含真实文章链接').toBeDefined();
  await pagerContent(page).getByRole('link', { name: linkedPost!.title, exact: true }).click();
  await expect(pager(page)).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveAttribute('data-pager-active', 'true');
  await expect(form(page)).toBeVisible();
  await expectFile(output(page), linkedPost!.file);
  expect(decodeURIComponent(new URL(page.url()).pathname)).toBe(linkedPost!.path);
  expect(await page.evaluate(() => Reflect.get(window, '__pagerDocumentMarker'))).toBe(marker);
  await page.goBack();
  await expectFile(output(page), '/posts/index.md');
  expect(new URL(page.url()).pathname).toBe('/list/');
  await expect(pager(page)).toHaveCount(0);
  await page.goForward();
  await expectFile(output(page), linkedPost!.file);
  expect(decodeURIComponent(new URL(page.url()).pathname)).toBe(linkedPost!.path);
  expect(await page.evaluate(() => Reflect.get(window, '__pagerDocumentMarker'))).toBe(marker);
});

for (const action of ['home', 'exit', 'Control+d'] as const) {
  test(`${action} 回首页同步URL和根目录，保留主题、真实历史与浏览器后退`, async ({ page }) => {
    await page.goto(encodeURI(`${russianPost.path}index.html`));
    await waitForPage(page);
    await runCommand(page, 'theme amber');
    await runCommand(page, 'cd /posts');
    await runCommand(page, 'echo history-survives-home');
    await expect(output(page)).toHaveText('history-survives-home');
    await expect(page.locator('#prompt-path')).toHaveText('~/posts');
    const previousURL = page.url();
    const marker = await page.evaluate(() => {
      const value = crypto.randomUUID();
      Reflect.set(window, '__homeDocumentMarker', value);
      return value;
    });
    if (action === 'Control+d') {
      await input(page).fill('');
      await input(page).press(action);
    } else await runCommand(page, action);
    await expect.poll(() => new URL(page.url()).pathname).toBe('/');
    await expect(page.locator('#prompt-path')).toHaveText('~');
    await expect(log(page).locator('.ascii-logo')).toHaveCount(1);
    await expect(log(page).locator('.echo-line, .entry')).toHaveCount(0);
    await expect(log(page).locator('.home-view button, .home-directory, .starter-commands, .style-hint')).toHaveCount(0);
    await expectTheme(page, 'amber');
    await expectInputUsable(page);
    expect(await page.evaluate(() => Reflect.get(window, '__homeDocumentMarker'))).toBe(marker);
    await runCommand(page, 'pwd');
    await expect(output(page)).toHaveText('/');
    await runCommand(page, 'history');
    for (const command of ['theme amber', 'cd /posts', 'echo history-survives-home']) {
      await expect(output(page).getByRole('button', { name: new RegExp(`${command}$`) })).toHaveCount(1);
    }
    await output(page).getByRole('button', { name: /echo history-survives-home$/ }).click();
    await expect(output(page)).toHaveText('history-survives-home');
    await page.goBack();
    await expect(page).toHaveURL(previousURL);
    await expectFile(output(page), russianPost.file);
    await page.goForward();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/');
    await expect(page.locator('#prompt-path')).toHaveText('~');
    await expectTheme(page, 'amber');
    expect(await page.evaluate(() => Reflect.get(window, '__homeDocumentMarker'))).toBe(marker);
  });
}

test('Ctrl+A/E 定位当前逻辑行首尾，Ctrl+K/U 删除行内文字并保留其他行', async ({ page }) => {
  await visit(page);
  const prefix = 'first line\n';
  const middle = 'ab😀中文 tail';
  const value = `${prefix}${middle}\nlast line`;
  const caret = prefix.length + 'ab😀'.length;
  await setEditor(page, value, caret);
  await input(page).press('Control+a');
  await expectEditor(page, value, prefix.length);
  await input(page).press('Control+e');
  await expectEditor(page, value, prefix.length + middle.length);
  await setEditor(page, value, caret);
  await input(page).press('Control+k');
  await expectEditor(page, `${prefix}ab😀\nlast line`, caret);
  await setEditor(page, value, caret);
  await input(page).press('Control+u');
  await expectEditor(page, `${prefix}中文 tail\nlast line`, prefix.length);
});

test('Ctrl+B/F 按 Unicode 字素移动光标，组合重音和emoji序列保持完整', async ({ page }) => {
  await visit(page);
  const value = '甲😀𠮷е́👩‍💻Z';
  const boundaries = [0, 1, 3, 5, 7, 12, 13];
  await setEditor(page, value, value.length);
  for (const position of [...boundaries].reverse().slice(1)) {
    await input(page).press('Control+b');
    await expectEditor(page, value, position);
  }
  await input(page).press('Control+b');
  await expectEditor(page, value, 0);
  for (const position of boundaries.slice(1)) {
    await input(page).press('Control+f');
    await expectEditor(page, value, position);
  }
  await input(page).press('Control+f');
  await expectEditor(page, value, value.length);
  await setEditor(page, value, 1, 5);
  await input(page).press('Control+b');
  await expectEditor(page, value, 1);
  await setEditor(page, value, 1, 5);
  await input(page).press('Control+f');
  await expectEditor(page, value, 5);
});

test('非空输入的 Ctrl+D 删除选区或下一个 Unicode 字符，行尾不跳回首页', async ({ page }) => {
  await page.goto(encodeURI(chinesePost.path));
  await waitForPage(page);
  await runCommand(page, 'cd /posts');
  const articleURL = page.url();
  await setEditor(page, 'A😀𠮷中Z', 1);
  await input(page).press('Control+d');
  await expectEditor(page, 'A𠮷中Z', 1);
  await input(page).press('Control+d');
  await expectEditor(page, 'A中Z', 1);
  await setEditor(page, 'A😀中𠮷Z', 1, 'A😀中𠮷'.length);
  await input(page).press('Control+d');
  await expectEditor(page, 'AZ', 1);
  await setEditor(page, 'AZ', 2);
  await input(page).press('Control+d');
  await expectEditor(page, 'AZ', 2);
  await expect(page).toHaveURL(articleURL);
  await expect(page.locator('#prompt-path')).toHaveText('~/posts');
});

test('Ctrl+W 删除光标前一词和分隔空白，保留后面的未选中草稿', async ({ page }) => {
  await visit(page);
  const value = 'echo 中😀  tail';
  await setEditor(page, value, 'echo 中😀  '.length);
  await input(page).press('Control+w');
  await expectEditor(page, 'echo tail', 'echo '.length);
  await input(page).press('Control+w');
  await expectEditor(page, 'tail', 0);
  await input(page).press('Control+w');
  await expectEditor(page, 'tail', 0);
});

test('Ctrl+P/N 浏览真实历史并恢复 Unicode 与多行草稿，末端不丢失输入', async ({ page }) => {
  await visit(page);
  await runCommand(page, 'echo shortcut-history-first');
  await runCommand(page, 'echo shortcut-history-second');
  const draft = 'echo 未完成😀\n第二行';
  await input(page).fill(draft);
  for (const [key, value] of [
    ['Control+p', 'echo shortcut-history-second'],
    ['Control+p', 'echo shortcut-history-first'],
    ['Control+n', 'echo shortcut-history-second'],
    ['Control+n', draft],
    ['Control+n', draft],
  ] as const) {
    await input(page).press(key);
    await expectEditor(page, value, value.length);
  }
  await expect(output(page)).toHaveText('shortcut-history-second');
  await input(page).fill('echo recovered-history-draft');
  await input(page).press('Control+p');
  await input(page).press('Control+n');
  await input(page).press('Enter');
  await expect(output(page)).toHaveText('recovered-history-draft');
});

test('输入框选区 Ctrl+C 保持原生复制，编辑快捷键不劫持历史搜索输入框', async ({ page }) => {
  await visit(page);
  const draft = 'echo keep😀selection';
  await setEditor(page, draft, 5, 11);
  await page.evaluate(() => {
    const copyProbe = (event: KeyboardEvent): void => {
      if (event.ctrlKey && event.key.toLowerCase() === 'c') {
        Reflect.set(window, '__editorCopyPrevented', event.defaultPrevented);
        document.removeEventListener('keydown', copyProbe);
      }
    };
    document.addEventListener('keydown', copyProbe);
  });
  await input(page).press('Control+c');
  await expectEditor(page, draft, 5, 11);
  expect(await page.evaluate(() => Reflect.get(window, '__editorCopyPrevented'))).toBe(false);
  await input(page).press('Control+r');
  const search = page.locator('#history-search');
  const value = 'search 😀 draft';
  await search.fill(value);
  await search.press('Control+a');
  expect(await search.evaluate(node => {
    const field = node as HTMLInputElement;
    return [field.selectionStart, field.selectionEnd];
  })).toEqual([0, value.length]);
  await page.evaluate(() => {
    const copyProbe = (event: KeyboardEvent): void => {
      if (event.ctrlKey && event.key.toLowerCase() === 'c') {
        Reflect.set(window, '__historyCopyPrevented', event.defaultPrevented);
        document.removeEventListener('keydown', copyProbe);
      }
    };
    document.addEventListener('keydown', copyProbe);
  });
  await search.press('Control+c');
  await expect(page.locator('#history-panel')).toBeVisible();
  await expect(search).toBeFocused();
  await expect(search).toHaveValue(value);
  expect(await page.evaluate(() => Reflect.get(window, '__historyCopyPrevented'))).toBe(false);
  expect(await search.evaluate(node => {
    const field = node as HTMLInputElement;
    return [field.selectionStart, field.selectionEnd];
  })).toEqual([0, value.length]);
  const results = await search.evaluate(node => {
    const field = node as HTMLInputElement;
    field.setSelectionRange(3, 3);
    return ['a', 'e', 'k', 'u', 'w', 'b', 'f', 'p', 'n', 'd'].map(key => {
      const event = new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true });
      field.dispatchEvent(event);
      return { key, prevented: event.defaultPrevented, value: field.value, selection: [field.selectionStart, field.selectionEnd] };
    });
  });
  for (const result of results) expect(result).toEqual({ key: result.key, prevented: false, value, selection: [3, 3] });
  await expect(search).toBeFocused();
  await expect(input(page)).toHaveValue(draft);
  await search.press('Escape');
  await expect(input(page)).toHaveValue(draft);
});

test('IME组合输入及229键码期间，终端编辑键和Enter都保留草稿与当前页面', async ({ page }) => {
  await visit(page);
  await runCommand(page, 'echo before-ime');
  const draft = 'echo 输入中😀';
  const caret = 'echo 输入'.length;
  await setEditor(page, draft, caret);
  const entries = await log(page).locator('.entry').count();
  const results = await input(page).evaluate(node => {
    const editor = node as HTMLTextAreaElement;
    return [true, false].flatMap(composing => ['a', 'e', 'k', 'u', 'w', 'b', 'f', 'p', 'n', 'd', 'r', 'Enter'].map(key => {
      const event = new KeyboardEvent('keydown', {
        key, ctrlKey: key !== 'Enter', bubbles: true, cancelable: true,
        isComposing: composing, keyCode: composing ? 0 : 229,
      });
      editor.dispatchEvent(event);
      return { prevented: event.defaultPrevented, value: editor.value, start: editor.selectionStart, end: editor.selectionEnd };
    }));
  });
  for (const result of results) expect(result).toEqual({ prevented: false, value: draft, start: caret, end: caret });
  await expectEditor(page, draft, caret);
  await expect(log(page).locator('.entry')).toHaveCount(entries);
  await expect(output(page)).toHaveText('before-ime');
  await expect(page.locator('#history-panel')).toBeHidden();
});

test('直接执行绝对或相对文档路径从开头阅读，管道输入保留会话和当前URL', async ({ page }) => {
  await visit(page);
  for (const command of [quote(poemPost.file), quote(basename(poemPost.file))]) {
    if (command === quote(basename(poemPost.file))) await runCommand(page, 'cd /posts');
    await runCommand(page, 'echo cleared-before-direct-document');
    await expect(output(page)).toHaveText('cleared-before-direct-document');
    await runCommand(page, command);
    await expectFile(output(page), poemPost.file);
    await expect(log(page).locator('.entry')).toHaveCount(1);
    await expect(log(page)).not.toContainText('cleared-before-direct-document');
    await expectInsideViewport(page, output(page).locator(':scope > .output-line').first());
    expect(decodeURIComponent(new URL(page.url()).pathname)).toBe(poemPost.path);
  }
  await runCommand(page, 'echo retained-before-document-pipe');
  const originalURL = page.url();
  await runCommand(page, `${quote(russianPost.file)} | head -n 3`);
  expect(await output(page).locator(':scope > .output-line').allTextContents()).toEqual(visibleFileLines(russianPost.file).slice(0, 3));
  await expect(log(page)).toContainText('retained-before-document-pipe');
  expect(await log(page).locator('.entry').count()).toBeGreaterThan(1);
  await expect(page).toHaveURL(originalURL);
});

test('新增 head/tail、grep 正则与字面匹配、find 类型过滤返回真实原文结果', async ({ page }) => {
  await visit(page);
  const expected = visibleFileLines(poemPost.file);
  await runCommand(page, `head -3 ${quote(poemPost.file)}`);
  expect(await output(page).locator(':scope > .output-line').allTextContents()).toEqual(expected.slice(0, 3));
  await runCommand(page, `cat ${quote(poemPost.file)} | tail -n 7`);
  expect(await output(page).locator(':scope > .output-line').allTextContents()).toEqual(expected.slice(-7));
  for (const [options, pattern, matching] of [
    ['', '^# ', (line: string) => /^# /.test(line)],
    ['-F ', '[', (line: string) => line.includes('[')],
  ] as const) {
    const matches = fileLines(poemPost.file).filter(matching).map(visibleContentLine);
    expect(matches.length).toBeGreaterThan(0);
    await runCommand(page, `grep ${options}${quote(pattern)} ${quote(poemPost.file)}`);
    expect(await output(page).locator(':scope > .output-line').allTextContents()).toEqual(matches);
  }
  const paths = manifest.files.filter(file => file.path.startsWith('/posts/') && file.path.endsWith('.md')).map(file => file.path).sort();
  await runCommand(page, "find /posts -type f -name '*.md' | tail -n 3");
  expect(await output(page).locator(':scope > .output-line').allTextContents()).toEqual(paths.slice(-3));
});

test.describe('私密保险库', () => {
  test('默认只公开主页和文章，目录树、find、搜索与补全不暴露私密文件', async ({ page }) => {
    const requests = await installVaultFixture(page);
    await visit(page);
    await expectLocked(page);
    await expect(unlockForm(page)).toHaveAttribute('hidden', '');
    expect(manifest.vault?.url).toMatch(/^\/private\/vault\.json\?v=/);
    expect(projectFiles).toEqual([]);
    expect(manifest.files.some(file => file.path.startsWith('/private/') || file.path.startsWith('/projects/'))).toBe(false);
    for (const path of ['/README.md', '/assets.md', '/lab/README.txt']) {
      expect(manifest.files.some(file => file.path === path)).toBe(false);
    }
    for (const command of ['ls -a /', 'tree /', 'find /']) {
      await runCommand(page, command);
      await expect(output(page)).toContainText('private');
      for (const path of PRIVATE_FILES.map(file => basename(file.path))) await expect(output(page)).not.toContainText(path);
      await expect(output(page)).not.toContainText(PRIVATE_MARKER);
    }
    await runCommand(page, `search ${PRIVATE_MARKER}`);
    await expect(output(page)).toHaveText('');
    await input(page).fill('cat /private/notes/sec');
    await input(page).press('Tab');
    await expect(input(page)).toHaveValue('cat /private/notes/sec');
    await expect(page.locator('#completion-hints')).not.toContainText('secret.txt');
    await expect(page.locator('#completion-hints')).not.toContainText('secrets-two.txt');
    await input(page).fill('');
    await expectPasswordAbsent(page, requests);
  });

  test('私密目录和命令访问均要求独立密码表单，取消保留公开会话', async ({ page }) => {
    await installVaultFixture(page);
    await visit(page);
    await runCommand(page, 'echo public-before-vault');
    for (const command of [
      'private', 'cd /private', 'ls /private', 'tree /private', 'find /private', 'projects',
      `cat ${quote(PRIVATE_DOCUMENT)}`, `less ${quote(PRIVATE_DOCUMENT)}`, `download ${quote(PRIVATE_ATTACHMENT)}`,
    ]) {
      await test.step(command, async () => {
        await beginUnlock(page, command);
        await expect(unlockPassword(page)).toHaveValue('');
        await unlockCancel(page).click();
        await expect(unlockForm(page)).toBeHidden();
        await expectLocked(page);
        await expect(input(page)).toBeFocused();
        await expect(log(page)).toContainText('public-before-vault');
      });
    }
  });

  test('显式unlock正确解密后进入private并列目录，项目和相对文件正文可读取', async ({ page }) => {
    const requests = await installVaultFixture(page);
    await visit(page);
    await unlockFixture(page);
    await expect(page.locator('#prompt-path')).toHaveText('~/private');
    for (const name of privateRootNames()) await expect(output(page)).toContainText(name);
    await runCommand(page, 'pwd');
    await expect(output(page)).toHaveText('/private');
    await runCommand(page, 'cat notes/secret.txt');
    await expectPrivateOutput(page);
    await runCommand(page, 'projects');
    await expect(output(page)).toContainText(basename(PRIVATE_PROJECT));
    await runCommand(page, `cat ${quote(PRIVATE_PROJECT)}`);
    await expectPrivateOutput(page, PRIVATE_PROJECT);
    await expectPasswordAbsent(page, requests);
    const vaultRequests = requests.filter(request => /\/private\/vault\.json\?/.test(request.url));
    expect(vaultRequests.length).toBeGreaterThan(0);
    expect(vaultRequests.every(request => request.method === 'GET' && request.body === null)).toBe(true);
  });

  test('待处理私密命令按原cwd解析相对路径，解锁后进入private并保留正文、链接与缩进', async ({ page }) => {
    await installVaultFixture(page);
    await visit(page);
    for (const { cwd, path } of [
      { cwd: '/', path: PRIVATE_DOCUMENT },
      { cwd: '/', path: PRIVATE_DOCUMENT.slice(1) },
      { cwd: '/posts', path: `..${PRIVATE_DOCUMENT}` },
    ]) {
      await runCommand(page, `cd ${quote(cwd)}`);
      await unlockFixture(page, `cat ${quote(path)}`);
      await expect(page.locator('#prompt-path')).toHaveText('~/private');
      await expectPrivateOutput(page);
      await expect(output(page).getByRole('link', { name: '公开文章索引', exact: true })).toHaveAttribute('href', '/list/');
      const indented = output(page).locator(':scope > .output-line').filter({ hasText: '保留两个前导空格' });
      expect(await indented.textContent()).toMatch(/^ {2}保留/);
      await runCommand(page, 'lock');
    }
    await unlockFixture(page, 'cd /private/notes');
    await expect(page.locator('#prompt-path')).toHaveText('~/private/notes');
    await runCommand(page, 'cat secret.txt');
    await expectPrivateOutput(page);
  });

  for (const corrupted of [false, true]) {
    test(`${corrupted ? '认证标签不匹配的篡改密文' : '错误密码'}保持锁定并显示可重试的失败状态`, async ({ page }) => {
      const requests = await installVaultFixture(page, corrupted ? TAMPERED_ENVELOPE : VAULT_ENVELOPE);
      await visit(page);
      await beginUnlock(page, `cat ${quote(PRIVATE_DOCUMENT)}`);
      await submitPassword(page, corrupted ? VAULT_PASSWORD : 'synthetic-wrong-credential');
      await expect(unlockStatus(page)).toHaveText(/失败|错误|无效|不正确|不匹配|损坏|认证/);
      await expect(unlockSubmit(page)).toBeEnabled();
      await expectUnlockForm(page);
      await expectLocked(page);
      await expect(page.locator('body')).not.toContainText(PRIVATE_MARKER);
      await unlockCancel(page).click();
      await expectPasswordAbsent(page, requests);
      await runCommand(page, 'echo still-public-after-failure');
      await expect(output(page)).toHaveText('still-public-after-failure');
    });
  }

  test('私密文档直接执行和管道分页使用解密内容，公开链接仍可同页导航', async ({ page }) => {
    await installVaultFixture(page);
    await visit(page);
    await runCommand(page, 'echo before-private-document');
    await unlockFixture(page, quote(PRIVATE_DOCUMENT));
    await expectPrivateOutput(page);
    await expect(log(page).locator('.entry')).toHaveCount(1);
    await expect(log(page)).not.toContainText('before-private-document');
    await expectInsideViewport(page, output(page).locator(':scope > .output-line').first());
    await startPager(page, `cat ${quote(PRIVATE_DOCUMENT)} | less`, 'less');
    await expectPagerSlice(page, privateLines(PRIVATE_DOCUMENT));
    await page.keyboard.press('G');
    await expect(pager(page).locator('.pager-status')).toContainText('END');
    await expectPagerSlice(page, privateLines(PRIVATE_DOCUMENT));
    await page.keyboard.press('g');
    await pagerContent(page).getByRole('link', { name: '公开文章索引', exact: true }).click();
    await expect(pager(page)).toHaveCount(0);
    await expectFile(output(page), '/posts/index.md');
    expect(new URL(page.url()).pathname).toBe('/list/');
    await expect(page.locator('html')).toHaveAttribute('data-vault', 'unlocked');
  });

  test('下载只使用解密后的附件字节，文件名和二进制内容完整', async ({ page }) => {
    const requests = await installVaultFixture(page);
    await visit(page);
    await unlockFixture(page);
    const pendingDownload = page.waitForEvent('download');
    await runCommand(page, `download ${quote(PRIVATE_ATTACHMENT)}`);
    const download = await pendingDownload;
    expect(download.suggestedFilename()).toBe('fixture.bin');
    expect(download.url()).toMatch(/^blob:/);
    const stream = await download.createReadStream();
    expect(stream).not.toBeNull();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(PRIVATE_BYTES);
    expect(await download.failure()).toBeNull();
    await expectPasswordAbsent(page, requests);
  });

  test('unlock的quoted或escaped竖线属于参数，真实管道整体报错且口令始终脱敏', async ({ page }) => {
    const requests = await installVaultFixture(page);
    const secret = 'fixture-pipe|口令-only';
    await visit(page);
    for (const argument of [`"${secret}"`, quote(secret), secret.replace('|', '\\|')]) {
      await beginUnlock(page, `unlock ${argument}`);
      await expect(unlockPassword(page)).toHaveValue('');
      await expect(log(page).locator('.entry').last()).toHaveAttribute('data-command-line', 'unlock');
      await expectPasswordAbsent(page, requests, secret);
      await unlockCancel(page).click();
      await runCommand(page, 'history');
      await expect(output(page)).toContainText('unlock');
      await expectPasswordAbsent(page, requests, secret);
    }
    for (const command of [
      `unlock ${quote(secret)} | echo PIPE_STAGE_MUST_NOT_EXECUTE`,
      `echo PIPE_STAGE_MUST_NOT_EXECUTE | unlock ${quote(secret)}`,
      'unlock | echo PIPE_STAGE_MUST_NOT_EXECUTE',
      `unlock ${quote(secret)} |`,
    ]) {
      await runCommand(page, command);
      await expect(unlockForm(page)).toBeHidden();
      await expect(output(page).locator('.tone-error')).toHaveCount(1);
      await expect(output(page)).not.toContainText('PIPE_STAGE_MUST_NOT_EXECUTE');
      await expect(log(page).locator('.entry').last()).toHaveAttribute('data-command-line', 'unlock');
      await expectLocked(page);
      await expectPasswordAbsent(page, requests, secret);
    }
    await runCommand(page, 'history');
    await expect(output(page)).not.toContainText('PIPE_STAGE_MUST_NOT_EXECUTE');
    await expectPasswordAbsent(page, requests, secret);
  });

  test('私密Markdown链接从公共cwd经grep和less仍按源文件解析，站内读取下载不请求明文路径', async ({ page }) => {
    const requests = await installVaultFixture(page);
    const popups: Page[] = [];
    page.context().on('page', popup => popups.push(popup));
    await visit(page);
    await unlockFixture(page);
    for (const pipeline of [false, true]) {
      for (const kind of ['text', 'attachment', 'directory'] as const) {
        await test.step(`${pipeline ? 'cat | grep | less' : 'cat'} / ${kind}`, async () => {
          await runCommand(page, 'cd /posts');
          await expect(page.locator('#prompt-path')).toHaveText('~/posts');
          if (pipeline) {
            await startPager(page, `cat ${quote(PRIVATE_README)} | grep -F ${quote('私密链接')} | less`, 'less');
            await expectPagerSlice(page, privateLines(PRIVATE_README).filter(line => line.includes('私密链接')));
          } else {
            await runCommand(page, `cat ${quote(PRIVATE_README)}`);
            await expectPrivateOutput(page, PRIVATE_README);
          }
          const surface = pipeline ? pagerContent(page) : output(page);
          await expect(surface.locator('a')).toHaveCount(0);
          const relative = surface.getByRole('button', { name: '私密链接：相对正文', exact: true });
          const attachment = surface.getByRole('button', { name: '私密链接：PDF 附件', exact: true });
          const directory = surface.getByRole('button', { name: '私密链接：目录', exact: true });
          await expect(relative).toHaveAttribute('data-command', /^cat\s/);
          expect(await relative.getAttribute('data-command')).toContain(PRIVATE_DOCUMENT);
          await expect(attachment).toHaveAttribute('data-command', /^download\s/);
          expect(await attachment.getAttribute('data-command')).toContain(PRIVATE_PDF);
          await expect(directory).toHaveAttribute('data-command', /^cd\s/);
          expect(await directory.getAttribute('data-command')).toContain('/private/notes');
          if (kind === 'text') {
            await relative.click();
            await expectPrivateOutput(page);
            await expectInsideViewport(page, output(page).locator(':scope > .output-line').first());
          } else if (kind === 'attachment') {
            const pendingDownload = page.waitForEvent('download');
            await attachment.click();
            const download = await pendingDownload;
            expect(download.suggestedFilename()).toBe(basename(PRIVATE_PDF));
            expect(download.url()).toMatch(/^blob:/);
            const stream = await download.createReadStream();
            expect(stream).not.toBeNull();
            const chunks: Buffer[] = [];
            for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
            expect(Buffer.concat(chunks)).toEqual(PRIVATE_PDF_BYTES);
            expect(await download.failure()).toBeNull();
          } else {
            await directory.click();
            await expect(page.locator('#prompt-path')).toHaveText('~/private/notes');
            await runCommand(page, 'pwd');
            await expect(output(page)).toHaveText('/private/notes');
          }
          await expect(pager(page)).toHaveCount(0);
          await expect(form(page)).toBeVisible();
          expect(new URL(page.url()).pathname).toBe('/private/');
          // Edge exposes its own downloads flyout as a Page, not a site popup.
          const contentUrls = (pages: Page[]): string[] => pages.map(openPage => openPage.url()).filter(url => url !== 'edge://downloads-hub/');
          expect(contentUrls(page.context().pages()), '私密链接不应打开额外内容页面').toEqual([page.url()]);
          expect(contentUrls(popups), '记录任何站点弹出的内容页面').toEqual([]);
        });
      }
    }
    const privateRequests = requests.filter(request => {
      const path = new URL(request.url).pathname;
      return path.startsWith('/private/') && path !== '/private/' && path !== '/private/vault.json';
    });
    expect(privateRequests, '私密链接只操作解密VFS，不请求文件明文URL').toEqual([]);
    for (const file of PRIVATE_FILES) {
      expect(JSON.stringify(requests)).not.toContain(file.path);
      expect(JSON.stringify(requests)).not.toContain(encodeURIComponent(file.path));
    }
    await expectPasswordAbsent(page, requests);
  });

  test('unlock附带参数只回显和记录unlock，口令不进入DOM、历史、存储或网络', async ({ page }) => {
    const requests = await installVaultFixture(page);
    await visit(page);
    await beginUnlock(page, `unlock ${quote(VAULT_PASSWORD)}`);
    await expect(unlockPassword(page)).toHaveValue('');
    await expectPasswordAbsent(page, requests);
    await unlockCancel(page).click();
    await runCommand(page, 'history');
    await expect(output(page).getByRole('button', { name: /\bunlock$/ })).toHaveCount(1);
    await expect(output(page)).not.toContainText(VAULT_PASSWORD);
    await unlockFixture(page);
    await runCommand(page, 'history');
    await expect(output(page)).not.toContainText(VAULT_PASSWORD);
    await expectPasswordAbsent(page, requests);
  });

  for (const action of ['Escape', '取消按钮'] as const) {
    test(`${action}可取消正在解密的请求，晚到的明文结果保持丢弃`, async ({ page }) => {
      const requests = await installVaultFixture(page);
      await delayVaultDecrypt(page);
      await visit(page);
      await beginUnlock(page, `cat ${quote(PRIVATE_DOCUMENT)}`);
      await submitPassword(page);
      await page.waitForFunction(() => Reflect.get(window, '__fixtureDecryptEntered') === true);
      await expect(unlockCancel(page)).toBeEnabled();
      if (action === 'Escape') await page.keyboard.press('Escape');
      else await unlockCancel(page).click();
      await expect(unlockForm(page)).toBeHidden();
      await expectLocked(page);
      await expect(input(page)).toBeFocused();
      await expect(unlockPassword(page)).toHaveValue('');
      await releaseVaultDecrypt(page);
      await expectLocked(page);
      await expect(page.locator('#prompt-path')).toHaveText('~');
      await expect(unlockForm(page)).toBeHidden();
      await expectPasswordAbsent(page, requests);
      await runCommand(page, 'echo after-cancelled-decrypt');
      await expect(output(page)).toHaveText('after-cancelled-decrypt');
    });
  }

  for (const surface of ['pager', 'history-search', 'completion', 'draft'] as const) {
    test(`lock从${surface}清除私密正文、历史、搜索、补全和草稿并重置公开状态`, async ({ page }) => {
      const requests = await installVaultFixture(page);
      await visit(page);
      await runCommand(page, 'theme amber');
      await unlockFixture(page, `cat ${quote(PRIVATE_DOCUMENT)}`);
      await expectPrivateOutput(page);
      if (surface === 'pager') {
        await startPager(page, `less ${quote(PRIVATE_DOCUMENT)}`, 'less');
        await expectPagerSlice(page, privateLines(PRIVATE_DOCUMENT));
      } else if (surface === 'history-search') {
        await input(page).press('Control+r');
        await page.locator('#history-search').fill('secret');
        await expect(page.locator('#history-match')).toContainText(PRIVATE_DOCUMENT);
      } else if (surface === 'completion') {
        await input(page).fill('cat /private/notes/sec');
        await input(page).press('Tab');
        await expect(page.locator('#completion-hints')).toBeVisible();
        await expect(page.locator('#completion-hints')).toContainText('secret.txt');
      } else await input(page).fill(`echo ${PRIVATE_MARKER} unsent-draft`);
      await vaultCommand(page).click();
      await expectClearedVault(page);
      await expectTheme(page, 'amber');
      await expectPasswordAbsent(page, requests);
      await runCommand(page, 'history');
      await expect(output(page)).not.toContainText('secret');
      await expect(output(page)).not.toContainText('unlock');
      await expect(output(page)).not.toContainText(PRIVATE_MARKER);
      await input(page).fill('cat /private/notes/sec');
      await input(page).press('Tab');
      await expect(input(page)).toHaveValue('cat /private/notes/sec');
      await expect(page.locator('#completion-hints')).not.toContainText('secret.txt');
      await input(page).fill('');
      await runCommand(page, 'find /');
      await expect(output(page)).not.toContainText(PRIVATE_DOCUMENT);
      await runCommand(page, `search ${PRIVATE_MARKER}`);
      await expect(output(page)).toHaveText('');
      await beginUnlock(page, `cat ${quote(PRIVATE_DOCUMENT)}`);
      await unlockCancel(page).click();
      await expectLocked(page);
    });
  }

  test('lock命令与刷新都重新锁定，浏览器存储中没有解密内容和口令', async ({ page }) => {
    const requests = await installVaultFixture(page);
    await visit(page);
    await unlockFixture(page, `cat ${quote(PRIVATE_DOCUMENT)}`);
    await runCommand(page, 'lock');
    await expectClearedVault(page);
    await unlockFixture(page, `cat ${quote(PRIVATE_DOCUMENT)}`);
    await expectPrivateOutput(page);
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/\bapp-ready\b/);
    await expectLocked(page);
    await expectPasswordAbsent(page, requests);
    const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
    expect(storage).not.toContain(PRIVATE_MARKER);
    expect(storage).not.toContain(PRIVATE_BYTES.toString('base64'));
    if (await unlockForm(page).isVisible()) await unlockCancel(page).click();
    await beginUnlock(page, `cat ${quote(PRIVATE_DOCUMENT)}`);
    await expectLocked(page);
  });

  test('pagehide清除已解密数据，返回页面后私密访问仍要求新口令', async ({ page }) => {
    await installVaultFixture(page);
    await visit(page);
    await unlockFixture(page, `cat ${quote(PRIVATE_DOCUMENT)}`);
    await expectPrivateOutput(page);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    await expectLocked(page);
    expect(await page.locator('html').evaluate(node => node.outerHTML)).not.toContain(PRIVATE_DOCUMENT);
    await expect(unlockPassword(page)).toHaveValue('');
    await beginUnlock(page, `cat ${quote(PRIVATE_DOCUMENT)}`);
    await expectUnlockForm(page);
  });

  test('private旧式直达入口初始保持锁定，成功解锁后才列出私密目录', async ({ page }) => {
    await installVaultFixture(page);
    const response = await page.goto('/private/');
    expect(response?.ok()).toBe(true);
    await expect(page.locator('html')).toHaveClass(/\bapp-ready\b/);
    await expectLocked(page);
    await expectUnlockForm(page);
    expect(new URL(page.url()).pathname).toBe('/private/');
    await submitPassword(page);
    await expect(page.locator('html')).toHaveAttribute('data-vault', 'unlocked');
    await expect(page.locator('#prompt-path')).toHaveText('~/private');
    for (const name of privateRootNames()) await expect(output(page)).toContainText(name);
    await runCommand(page, 'cat notes/secret.txt');
    await expectPrivateOutput(page);
    await vaultCommand(page).click();
    await expectClearedVault(page);
  });

  test('密码框保留原生选区复制和IME行为，终端快捷键不读取或修改口令', async ({ page }) => {
    const requests = await installVaultFixture(page);
    await visit(page);
    await runCommand(page, 'echo public-history-before-password');
    await beginUnlock(page);
    await unlockPassword(page).fill(VAULT_PASSWORD);
    await unlockPassword(page).press('Control+a');
    expect(await unlockPassword(page).evaluate(node => {
      const field = node as HTMLInputElement;
      return [field.selectionStart, field.selectionEnd];
    })).toEqual([0, VAULT_PASSWORD.length]);
    await page.evaluate(() => {
      const copyProbe = (event: KeyboardEvent): void => {
        if (event.ctrlKey && event.key.toLowerCase() === 'c') {
          Reflect.set(window, '__passwordCopyPrevented', event.defaultPrevented);
          document.removeEventListener('keydown', copyProbe);
        }
      };
      document.addEventListener('keydown', copyProbe);
    });
    await unlockPassword(page).press('Control+c');
    await expectUnlockForm(page);
    await expect(unlockPassword(page)).toHaveValue(VAULT_PASSWORD);
    await expect(unlockPassword(page)).toBeFocused();
    expect(await page.evaluate(() => Reflect.get(window, '__passwordCopyPrevented'))).toBe(false);
    const probes = await unlockPassword(page).evaluate(node => {
      const field = node as HTMLInputElement;
      field.setSelectionRange(2, 2);
      return [false, true].flatMap(composing => ['a', 'e', 'k', 'u', 'w', 'b', 'f', 'p', 'n', 'd', 'l', 'r', ...(composing ? ['Enter'] : [])].map(key => {
        const event = new KeyboardEvent('keydown', {
          key, ctrlKey: key !== 'Enter', bubbles: true, cancelable: true,
          isComposing: composing, keyCode: composing ? 229 : 0,
        });
        field.dispatchEvent(event);
        return { prevented: event.defaultPrevented, value: field.value, start: field.selectionStart, end: field.selectionEnd };
      }));
    });
    for (const probe of probes) expect(probe).toEqual({ prevented: false, value: VAULT_PASSWORD, start: 2, end: 2 });
    await expect(unlockForm(page)).toBeVisible();
    await expect(page.locator('#history-panel')).toBeHidden();
    await unlockCancel(page).click();
    await expectPasswordAbsent(page, requests);
    await runCommand(page, 'history');
    await expect(output(page)).toContainText('echo public-history-before-password');
    await expect(output(page)).not.toContainText(VAULT_PASSWORD);
  });
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

  test('手机密码表单、解锁与重新上锁均可触摸操作，320px下无横向溢出', async ({ page }) => {
    const requests = await installVaultFixture(page);
    await visit(page);
    await vaultCommand(page).tap();
    await expectUnlockForm(page);
    await page.setViewportSize({ width: 320, height: 640 });
    await expectNoHorizontalOverflow(page);
    for (const control of [unlockPassword(page), unlockSubmit(page), unlockCancel(page)]) await expectInsideViewport(page, control);
    await unlockPassword(page).fill(VAULT_PASSWORD);
    await unlockSubmit(page).tap();
    await expect(page.locator('html')).toHaveAttribute('data-vault', 'unlocked');
    await expect(unlockForm(page)).toBeHidden();
    await expect(unlockPassword(page)).toHaveValue('');
    await expect(page.locator('#prompt-path')).toHaveText('~/private');
    for (const name of privateRootNames()) await expect(output(page)).toContainText(name);
    await input(page).fill(`more ${quote(PRIVATE_DOCUMENT)}`);
    await submit(page).tap();
    await expect(page.locator('html')).toHaveAttribute('data-pager-active', 'true');
    await expectPagerSlice(page, privateLines(PRIVATE_DOCUMENT));
    await expectPagerWidth(page);
    await vaultCommand(page).tap();
    await expectClearedVault(page);
    await expectPasswordAbsent(page, requests);
    await expectNoHorizontalOverflow(page);
    await expectInputUsable(page);
  });

  test('手机使用原生按钮前后翻页和退出，320px下可到达末页且禁用下一页', async ({ page }) => {
    await visit(page);
    const expected = ['.', '..', ...directoryNames('/posts')];
    await input(page).fill('ls -a /posts | more');
    await submit(page).tap();
    await expect(page.locator('html')).toHaveAttribute('data-pager-active', 'true');
    await expect(pager(page)).toHaveAccessibleName('more 分页阅读');
    await expect(form(page)).toHaveAttribute('hidden', '');
    await expect(page.locator('#terminal-log > :visible')).toHaveCount(1);
    await expect(page.locator('#terminal-log > :visible .pager')).toHaveCount(1);
    const wide = await expectPagerSlice(page, expected);
    await page.screenshot({ path: resolve(__dirname, '../../artifacts/mobile-pager.png'), fullPage: false, animations: 'disabled', caret: 'hide', scale: 'css' });
    await resizePager(page, { width: 320, height: 740 });
    await expect.poll(async () => (await pagerPosition(page)).end).toBeLessThan(wide.end);
    for (const control of [pagerPrevious(page), pagerNext(page), pagerClose(page)]) {
      await expect(control).toHaveJSProperty('tagName', 'BUTTON');
      await expect(control).toHaveAttribute('type', 'button');
      await expectInsideViewport(page, control);
    }
    const first = await expectPagerSlice(page, expected);
    expect(first.start).toBe(1);
    await expect(pagerPrevious(page)).toBeDisabled();
    await pagerNext(page).tap();
    await expect.poll(async () => (await pagerPosition(page)).start).toBeGreaterThan(first.start);
    await expectPagerSlice(page, expected);
    await pagerPrevious(page).tap();
    await expect.poll(async () => (await pagerPosition(page)).start).toBe(1);
    expect(await expectPagerSlice(page, expected)).toEqual(first);
    let position = first;
    for (let step = 0; step < expected.length && !position.atEnd; step += 1) {
      await pagerNext(page).tap();
      position = await expectPagerSlice(page, expected);
      await expectPagerWidth(page);
    }
    expect(position.atEnd).toBe(true);
    expect(position.end).toBe(expected.length);
    await expect(pagerNext(page)).toBeDisabled();
    await pagerClose(page).tap();
    await expectPagerClosed(page);
    await input(page).fill('echo mobile-pager-returned');
    await submit(page).tap();
    await expect(output(page)).toHaveText('mobile-pager-returned');
    await expectInputUsable(page);
    await expectNoHorizontalOverflow(page);
  });

  test('手机截图：390×844 默认纯终端，字体就绪且动效关闭', async ({ page }) => {
    await prepareScreenshot(page);
    await screenshot(page, 'mobile');
  });
});
