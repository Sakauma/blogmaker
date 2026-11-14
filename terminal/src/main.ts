import './style.css';
import { runCommand, completeCommand, passwordCommandInput, type ShellState, type ShellLine, type Theme, type Appearance } from './shell';
import { AsciiAnimation } from './ascii';
import { Pager } from './pager';
import { editCommandInput } from './editor';
import { manifest, files, profile, posts, routeFor, hrefForCommand, hrefForFile, setPrivateFiles, clearPrivateFiles, isVaultUnlocked } from './content';
import { decryptPrivateVault, privateDownload } from './vault';
import { appendContentText } from './links';
import { dailyInfo } from './daily';

const root = document.documentElement;
const app = document.querySelector<HTMLDivElement>('#app')!;
const load = (key: string): string | null => { try { return localStorage.getItem(`sakauma:cli:${key}`); } catch { return null; } };
const save = (key: string, value: string): void => { try { localStorage.setItem(`sakauma:cli:${key}`, value); } catch { /* A terminal session does not require storage. */ } };
const media = matchMedia('(prefers-reduced-motion: reduce)');
let state: ShellState = {
  cwd: '/',
  theme: (['dark', 'light', 'amber'].includes(root.dataset.theme ?? '') ? root.dataset.theme : 'dark') as Theme,
  style: (root.dataset.style === 'modern' ? 'modern' : 'retro') as Appearance,
  motion: root.dataset.motion !== 'off',
};
const commands: string[] = [];
let historyIndex = 0;
let draft = '';
let searchDraft = '';
let searchIndex = 0;
let searchMatches: string[] = [];
let animation: AsciiAnimation | null = null;
let pager: Pager | null = null;

app.innerHTML = `
  <main id="terminal-screen" aria-label="Sakauma 交互终端">
    <header class="terminal-title">
      <span class="title-identity"><span class="title-mark">&gt;_</span> sakauma<span class="title-separator"> / </span><span class="title-context muted">${state.style === 'retro' ? 'dev/tty1' : 'journal'}</span></span>
      <span id="style-status" class="muted" title="输入 style modern 或 style retro 切换">style:${state.style}</span>
    </header>
    <div id="scrollback" role="region" aria-label="终端会话内容">
      <div id="terminal-log" role="log" aria-label="终端输出" aria-live="polite" aria-relevant="additions"></div>
      <form id="command-form" autocomplete="off">
        <label class="input-label" for="command-input"><span class="prompt-user">visitor@sakauma</span><span class="muted">:</span><span id="prompt-path" class="prompt-path">~</span><span class="prompt-symbol">$</span></label>
        <div class="input-editor"><textarea id="command-input" rows="1" maxlength="4096" aria-label="终端命令" aria-describedby="keyboard-help" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="send"></textarea><span class="empty-cursor" aria-hidden="true"></span></div>
        <button type="submit" class="enter-key" aria-label="执行命令" title="Enter">↵</button>
      </form>
      <form id="unlock-form" hidden>
        <div class="unlock-heading">private — 输入访问密码</div>
        <div class="unlock-row"><label for="unlock-password">password:</label><input id="unlock-password" name="password" type="password" aria-label="访问密码" autocomplete="current-password" autocapitalize="off" spellcheck="false" maxlength="4096" required /><button id="unlock-submit" type="submit">解锁</button><button id="unlock-cancel" type="button">取消</button></div>
        <div id="unlock-status" role="status" aria-live="polite"></div>
      </form>
      <div id="completion-hints" class="completion-hints" role="status" hidden></div>
      <div id="history-panel" hidden>
        <label for="history-search">(reverse-i-search):</label>
        <input id="history-search" aria-label="搜索命令历史" autocomplete="off" autocapitalize="off" spellcheck="false" />
        <div id="history-match"></div><span class="muted">Enter 选取 · Ctrl+R 上一条 · Esc 返回</span>
      </div>
      <div id="keyboard-help" class="keyboard-help"><span>Tab 补全</span><span>↑↓ 历史</span><span>Ctrl+L 清屏</span><span class="desktop-help">Ctrl+R 搜索</span></div>
      <button id="jump-latest" type="button" hidden>↓ 回到输入行</button>
    </div>
    <footer class="status-line"><span class="session-label">0:shell<span aria-hidden="true">*</span></span><span class="status-directory">~</span><span class="status-right"><button type="button" id="vault-command" data-command="unlock" aria-label="解锁私密资料">unlock</button><span class="status-divider">│</span><button type="button" id="theme-command" data-command="theme light" aria-label="切换终端主题">dark</button><span class="status-divider">│</span><button type="button" id="motion-command" data-command="motion off" aria-label="切换字符动效">motion:on</button><span class="encoding">UTF-8</span></span></footer>
  </main>`;

const log = document.querySelector<HTMLElement>('#terminal-log')!;
const scrollback = document.querySelector<HTMLElement>('#scrollback')!;
const form = document.querySelector<HTMLFormElement>('#command-form')!;
const input = document.querySelector<HTMLTextAreaElement>('#command-input')!;
const hints = document.querySelector<HTMLElement>('#completion-hints')!;
const historyPanel = document.querySelector<HTMLElement>('#history-panel')!;
const historySearch = document.querySelector<HTMLInputElement>('#history-search')!;
const historyMatch = document.querySelector<HTMLElement>('#history-match')!;
const jump = document.querySelector<HTMLButtonElement>('#jump-latest')!;
const unlockForm = document.querySelector<HTMLFormElement>('#unlock-form')!;
const unlockPassword = document.querySelector<HTMLInputElement>('#unlock-password')!;
const unlockStatus = document.querySelector<HTMLElement>('#unlock-status')!;
const unlockSubmit = document.querySelector<HTMLButtonElement>('#unlock-submit')!;
let unlockGeneration = 0;
let unlockController: AbortController | null = null;
let pendingUnlock: string | undefined;
const downloads = new Set<string>();
const pathLabel = (): string => state.cwd === '/' ? '~' : `~${state.cwd}`;
function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  result.className = className;
  result.textContent = text;
  return result;
}
function prompt(command: string): HTMLElement {
  const row = node('div', 'echo-line');
  row.append(node('span', 'prompt-user', 'visitor@sakauma'), node('span', 'muted', ':'), node('span', 'prompt-path', pathLabel()), node('span', 'prompt-symbol', '$'), node('span', 'echo-command', command));
  return row;
}
function entry(command: string): HTMLElement {
  const group = node('section', 'entry');
  group.dataset.commandLine = command;
  group.append(prompt(command));
  const output = node('div', 'output');
  group.append(output);
  log.append(group);
  while (log.children.length > 90) log.firstElementChild?.remove();
  return output;
}
function linesInto(container: HTMLElement, lines: ShellLine[]): void {
  for (const line of lines) {
    const row = node('div', `output-line tone-${line.tone ?? 'plain'}`);
    if (line.command) {
      const command = node('button', 'text-command', line.text);
      command.type = 'button';
      command.dataset.command = line.command;
      command.title = line.command;
      row.append(command);
    } else if (line.markup) appendContentText(row, line.text, line.sourceFile);
    else row.textContent = line.text || '\u00a0';
    container.append(row);
  }
}
function commandLink(text: string, command: string): HTMLButtonElement {
  const button = node('button', 'text-command', text);
  button.type = 'button';
  button.dataset.command = command;
  return button;
}
function banner(container: HTMLElement): void {
  const fetch = node('div', 'fetch-output');
  const logo = node('pre', 'ascii-logo', String.raw` ____   _   _  __   _   _   _ __  __    _
/ ___| /_\ | |/ /  /_\ | | | |  \/  |  /_\
\___ \/ _ \| ' <  / _ \| |_| | |\/| | / _ \
|____/_/ \_\_|\_\/_/ \_\\___/|_|  |_|/_/ \_\
`.trimEnd());
  logo.setAttribute('aria-label', 'Sakauma');
  const info = node('div', 'fetch-info');
  info.append(node('div', 'fetch-user', 'visitor@sakauma'), node('div', 'muted', '─────────────'));
  for (const [label, value] of [['name', profile.name], ['work', profile.role], ['posts', `${posts.length} 篇文章`],
    ...dailyInfo().map(field => [field.label, field.value])]) {
    const row = node('div', 'fetch-row');
    row.dataset.fetchField = label;
    row.append(node('span', 'fetch-key', label), node('span', '', value));
    info.append(row);
  }
  const colors = node('div', 'ansi-colors');
  colors.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 8; i++) colors.append(node('span', `ansi-${i}`, '██'));
  info.append(colors);
  fetch.append(logo, info);
  container.append(fetch);
  linesInto(container, [
    { text: profile.motto.join(''), tone: 'accent' },
    { text: profile.interests, tone: 'muted' },
  ]);
}
function updateUI(): void {
  root.dataset.theme = state.theme;
  root.dataset.style = state.style;
  root.dataset.motion = state.motion ? 'on' : 'off';
  document.querySelector('.title-context')!.textContent = state.style === 'retro' ? 'dev/tty1' : 'journal';
  document.querySelector('#style-status')!.textContent = `style:${state.style}`;
  document.querySelector('#prompt-path')!.textContent = pathLabel();
  document.querySelector('.status-directory')!.textContent = pathLabel();
  root.dataset.vault = isVaultUnlocked() ? 'unlocked' : 'locked';
  const vaultButton = document.querySelector<HTMLButtonElement>('#vault-command')!;
  vaultButton.hidden = !manifest.vault;
  vaultButton.textContent = isVaultUnlocked() ? 'lock' : 'unlock';
  vaultButton.dataset.command = isVaultUnlocked() ? 'lock' : 'unlock';
  vaultButton.setAttribute('aria-label', isVaultUnlocked() ? '锁定私密资料' : '解锁私密资料');
  const theme = document.querySelector<HTMLButtonElement>('#theme-command')!;
  theme.textContent = state.theme;
  theme.dataset.command = `theme ${state.theme === 'dark' ? 'light' : state.theme === 'light' ? 'amber' : 'dark'}`;
  const motion = document.querySelector<HTMLButtonElement>('#motion-command')!;
  motion.textContent = `motion:${state.motion ? 'on' : 'off'}`;
  motion.dataset.command = `motion ${state.motion ? 'off' : 'on'}`;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content = state.theme === 'light' ? '#f5f3ee' : state.theme === 'amber' ? '#17130e' : '#111314';
}
function resizeInput(): void {
  input.style.height = 'auto';
  input.style.height = `${Math.min(140, input.scrollHeight)}px`;
  form.classList.toggle('has-text', input.value.length > 0);
}
function updateJump(): void {
  if (pager || !unlockForm.hidden) { jump.hidden = true; return; }
  const bounds = form.getBoundingClientRect();
  const viewportTop = window.visualViewport?.offsetTop ?? 0;
  const viewportBottom = viewportTop + (window.visualViewport?.height ?? window.innerHeight);
  jump.hidden = bounds.top >= viewportTop && bounds.bottom <= viewportBottom;
}
function scrollToPrompt(): void {
  requestAnimationFrame(() => {
    if (pager) return;
    // Keep a visible prompt still. Only reveal it when an explicit command needs it.
    const target = !unlockForm.hidden ? unlockForm : historyPanel.hidden ? form : historyPanel;
    target.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    updateJump();
  });
}
function focusInput(): void {
  if (!unlockForm.hidden) { if (!unlockPassword.disabled) unlockPassword.focus({ preventScroll: true }); return; }
  if (!pager) { input.focus({ preventScroll: true }); resizeInput(); }
}
function stopAnimation(): void { animation?.stop(); animation = null; }
function stopPager(resume = false): void {
  if (!pager) return;
  const current = pager;
  pager = null;
  const output = current.output;
  const summary = current.summary;
  current.dispose();
  delete root.dataset.pagerActive;
  output.parentElement?.classList.remove('pager-entry');
  output.replaceChildren();
  linesInto(output, [{ text: summary, tone: 'muted' }]);
  form.hidden = false;
  if (resume) { focusInput(); scrollToPrompt(); }
  updateJump();
}
function closeUnlock(resume = false): void {
  unlockGeneration++;
  unlockController?.abort();
  unlockController = null;
  pendingUnlock = undefined;
  unlockPassword.value = '';
  unlockPassword.disabled = false;
  unlockSubmit.disabled = false;
  unlockStatus.textContent = '';
  unlockForm.hidden = true;
  form.hidden = Boolean(pager);
  if (resume) { focusInput(); scrollToPrompt(); }
}
function requestUnlock(command?: string): void {
  closeUnlock();
  if (!manifest.vault) return;
  pendingUnlock = command;
  historyPanel.hidden = true;
  hints.hidden = true;
  form.hidden = true;
  unlockForm.hidden = false;
  jump.hidden = true;
  unlockPassword.focus({ preventScroll: true });
  scrollToPrompt();
}
function lockVault(address = true): void {
  closeUnlock();
  clearPrivateFiles();
  for (const url of downloads) URL.revokeObjectURL(url);
  downloads.clear();
  commands.length = 0;
  historyIndex = searchIndex = 0;
  draft = searchDraft = '';
  searchMatches = [];
  historySearch.value = input.value = '';
  historyMatch.textContent = hints.textContent = '';
  historyPanel.hidden = true;
  window.getSelection()?.removeAllRanges();
  state = { ...state, cwd: '/' };
  clear();
  showHome();
  if (address) history.replaceState(null, '', '/');
  document.title = 'Sakauma | Egor Izmaylov';
  updateUI();
  focusInput();
  window.scrollTo(0, 0);
}
function downloadFile(path: string): void {
  const file = files.find(file => file.path === path);
  if (!file || !isVaultUnlocked()) return;
  const download = privateDownload(file);
  downloads.add(download.url);
  const link = document.createElement('a');
  link.href = download.url;
  link.download = download.name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => { URL.revokeObjectURL(download.url); downloads.delete(download.url); }, 60000);
}
unlockForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (unlockController || !manifest.vault || unlockForm.hidden || !unlockPassword.value) return;
  const password = unlockPassword.value;
  unlockPassword.value = '';
  unlockPassword.disabled = unlockSubmit.disabled = true;
  unlockStatus.textContent = '正在解锁…';
  const generation = unlockGeneration;
  const controller = new AbortController();
  unlockController = controller;
  const pending = pendingUnlock;
  try {
    const privateFiles = await decryptPrivateVault(manifest.vault.url, password, controller.signal);
    if (controller.signal.aborted || generation !== unlockGeneration) return;
    setPrivateFiles(privateFiles);
    closeUnlock();
    updateUI();
    if (pending) execute(pending);
    else { state = { ...state, cwd: '/private' }; execute('ls'); }
    if (state.cwd !== '/private' && !state.cwd.startsWith('/private/')) { state = { ...state, cwd: '/private' }; updateUI(); }
    if (state.cwd.startsWith('/private') && location.pathname !== '/private/') history.pushState(null, '', '/private/');
    if (location.pathname === '/private/') document.title = '私密资料 | Sakauma';
  } catch (error) {
    if (controller.signal.aborted || generation !== unlockGeneration) return;
    unlockController = null;
    unlockPassword.disabled = unlockSubmit.disabled = false;
    unlockStatus.textContent = error instanceof Error ? error.message : '解锁失败，请重试。';
    unlockPassword.focus({ preventScroll: true });
  }
});
document.querySelector('#unlock-cancel')!.addEventListener('click', () => closeUnlock(true));
function clear(): void { closeUnlock(); stopPager(); stopAnimation(); log.replaceChildren(); hints.hidden = true; }
function execute(raw: string, options: { reveal?: 'prompt' | 'start' | 'none'; address?: boolean } = {}): void {
  const sensitive = passwordCommandInput(raw);
  const command = sensitive ? 'unlock' : raw.trim();
  if (!command) { focusInput(); return; }
  closeUnlock();
  stopPager();
  const isSetting = /^(motion|theme|style)(\s|$)/.test(command);
  if (!isSetting) stopAnimation();
  if (commands.at(-1) !== command) commands.push(command);
  if (commands.length > 100) commands.shift();
  historyIndex = commands.length;
  draft = '';
  input.value = '';
  hints.hidden = true;
  historyPanel.hidden = true;
  const result = runCommand(sensitive && !passwordCommandInput(raw, true) ? raw : command, state);
  if (result.effect?.type === 'document') clear();
  const output = entry(command);
  if (result.state.theme !== state.theme) save('theme', result.state.theme);
  if (result.state.style !== state.style) save('style', result.state.style);
  // Persist an explicit choice even if it equals the system's current setting.
  if (/^motion\s+(on|off)\s*$/.test(command) && !result.lines.some(line => line.tone === 'error')) save('motion', result.state.motion ? 'on' : 'off');
  state = result.state;
  animation?.setMotion(state.motion);
  updateUI();
  if (result.effect?.type !== 'pager') linesInto(output, result.lines);
  switch (result.effect?.type) {
    case 'clear': clear(); break;
    case 'home': clear(); showHome(); break;
    case 'unlock': requestUnlock(result.effect.command); break;
    case 'lock': lockVault(options.address !== false); return;
    case 'download': downloadFile(result.effect.file); break;
    case 'pager':
      root.dataset.pagerActive = 'true';
      output.parentElement?.classList.add('pager-entry');
      form.hidden = true;
      input.blur();
      jump.hidden = true;
      pager = new Pager({ mode: result.effect.mode, label: result.effect.label, lines: result.lines,
        output, renderLines: linesInto, onExit: () => stopPager(true) });
      break;
    case 'banner': banner(output); break;
    case 'history': linesInto(output, commands.map((text, index) => ({ text: `${String(index + 1).padStart(3)}  ${text}`, command: text }))); break;
    case 'ascii':
      if (result.effect.mode !== 'off') {
        const surface = node('div', 'ascii-animation');
        output.append(surface);
        animation = new AsciiAnimation(surface, result.effect.mode, state.motion);
      }
      break;
  }
  if (options.address !== false && !result.lines.some(line => line.tone === 'error')) {
    const href = result.effect?.type === 'home' ? '/' : result.effect?.type === 'unlock' || result.file?.startsWith('/private/') ? '/private/' : result.file ? hrefForFile(result.file) : undefined;
    if (href) {
      const route = routeFor(href);
      if (location.pathname !== new URL(href, location.origin).pathname) history.pushState(null, '', href);
      document.title = href === '/' ? 'Sakauma | Egor Izmaylov' : `${route?.title ?? profile.brand} | Sakauma`;
    }
  }
  if (pager || !unlockForm.hidden) return;
  focusInput();
  if (result.effect?.type === 'home') { window.scrollTo(0, 0); updateJump(); return; }
  if (options.reveal === 'start' || result.effect?.type === 'document') requestAnimationFrame(() => {
    output.parentElement?.scrollIntoView({ block: 'start', behavior: 'instant' });
    updateJump();
  });
  else if (options.reveal !== 'none') scrollToPrompt();
}

function moveHistory(direction: -1 | 1): void {
  if (historyIndex === commands.length) draft = input.value;
  historyIndex = Math.max(0, Math.min(commands.length, historyIndex + direction));
  input.value = historyIndex === commands.length ? draft : commands[historyIndex] ?? '';
  input.setSelectionRange(input.value.length, input.value.length);
  hints.hidden = true;
  resizeInput();
}
form.addEventListener('submit', (event) => { event.preventDefault(); execute(input.value); });
input.addEventListener('input', () => { hints.hidden = true; resizeInput(); });
input.addEventListener('keydown', (event) => {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.ctrlKey && !event.altKey && !event.metaKey) {
    const key = event.key.toLowerCase();
    if (key === 'p' || key === 'n') {
      event.preventDefault(); moveHistory(key === 'p' ? -1 : 1); return;
    }
    if (key === 'd' && !input.value) { event.preventDefault(); execute('home'); return; }
    if (editCommandInput(input, key)) {
      event.preventDefault(); hints.hidden = true; resizeInput(); return;
    }
  }
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); execute(input.value); }
  else if (event.key === 'Tab' && !event.shiftKey) {
    event.preventDefault();
    const completion = completeCommand(input.value, state);
    input.value = completion.value;
    input.setSelectionRange(input.value.length, input.value.length);
    hints.textContent = completion.candidates.join('    ');
    hints.hidden = completion.candidates.length <= 1;
    resizeInput();
    scrollToPrompt();
  } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    if (input.value.includes('\n')) return;
    event.preventDefault();
    moveHistory(event.key === 'ArrowUp' ? -1 : 1);
  }
});
function updateSearch(reset = true): void {
  if (reset) searchIndex = 0;
  searchMatches = [...commands].reverse().filter((command, index, list) => command.toLowerCase().includes(historySearch.value.toLowerCase()) && list.indexOf(command) === index);
  searchIndex = Math.min(searchIndex, Math.max(0, searchMatches.length - 1));
  historyMatch.textContent = searchMatches[searchIndex] ?? '没有匹配的历史命令';
}
function startSearch(): void {
  if (historyPanel.hidden) {
    searchDraft = input.value;
    historySearch.value = '';
    historyPanel.hidden = false;
    updateSearch();
  } else { searchIndex += 1; updateSearch(false); }
  historySearch.focus();
  scrollToPrompt();
}
function closeSearch(accept: boolean): void {
  input.value = accept ? searchMatches[searchIndex] ?? searchDraft : searchDraft;
  historyPanel.hidden = true;
  historyIndex = commands.length;
  focusInput();
  input.setSelectionRange(input.value.length, input.value.length);
}
historySearch.addEventListener('input', () => updateSearch());
historySearch.addEventListener('keydown', (event) => {
  if (event.isComposing) return;
  if (event.key === 'Enter') { event.preventDefault(); closeSearch(true); }
});
document.addEventListener('keydown', (event) => {
  if (event.isComposing || event.keyCode === 229 || event.defaultPrevented) return;
  const control = (event.ctrlKey || event.metaKey) && !event.altKey;
  if (!unlockForm.hidden) {
    const selection = unlockPassword.selectionStart !== unlockPassword.selectionEnd || Boolean(window.getSelection()?.toString());
    if (event.key === 'Escape' || (control && event.key.toLowerCase() === 'c' && !selection)) { event.preventDefault(); closeUnlock(true); }
    return;
  }
  if (pager) { pager.handleKey(event); return; }
  if (control && event.key.toLowerCase() === 'l') { event.preventDefault(); clear(); focusInput(); scrollToPrompt(); }
  else if (control && event.key.toLowerCase() === 'r') { event.preventDefault(); startSearch(); }
  else if ((control && event.key.toLowerCase() === 'c') || event.key === 'Escape') {
    // Preserve ordinary copy when text is selected.
    const selectedInput = document.activeElement;
    const hasInputSelection = (selectedInput instanceof HTMLInputElement || selectedInput instanceof HTMLTextAreaElement)
      && selectedInput.selectionStart !== selectedInput.selectionEnd;
    if (event.key !== 'Escape' && (window.getSelection()?.toString() || hasInputSelection)) return;
    event.preventDefault();
    if (!historyPanel.hidden) { closeSearch(false); return; }
    stopAnimation();
    if (input.value) { const output = entry(`${passwordCommandInput(input.value) ? 'unlock' : input.value} ^C`); output.remove(); }
    input.value = '';
    hints.hidden = true;
    historyIndex = commands.length;
    focusInput();
    scrollToPrompt();
  }
});
document.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  const link = event.target.closest<HTMLAnchorElement>('a[data-route]');
  if (link && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
    const path = link.dataset.route!;
    const route = routeFor(path);
    if (route) {
      event.preventDefault();
      history.pushState(null, '', link.href);
      document.title = `${route.title} | Sakauma`;
      if (path === '/') { clear(); showHome(); window.scrollTo(0, 0); }
      else execute(route.command, { reveal: 'start', address: false });
    }
    return;
  }
  const command = event.target.closest<HTMLElement>('[data-command]')?.dataset.command;
  if (command) execute(command, command === 'posts' || hrefForCommand(command) || /^cat\s+(?:--\s+)?['"]?\/private\//.test(command) ? { reveal: 'start' } : {});
});
window.addEventListener('popstate', () => {
  clear();
  const route = routeFor(location.pathname) ?? routeFor('/404.html');
  if (location.pathname === '/' || location.pathname === '/index.html') {
    showHome();
    document.title = 'Sakauma | Egor Izmaylov';
  } else if (route) {
    execute(route.command, { reveal: 'none', address: false });
    document.title = `${route.title} | Sakauma`;
  } else showHome();
  window.scrollTo(0, 0);
  updateJump();
});
scrollback.addEventListener('click', (event) => {
  if (event.target === scrollback && !window.getSelection()?.toString()) focusInput();
});
window.addEventListener('scroll', updateJump, { passive: true });
function viewportChanged(): void { if (!unlockForm.hidden) scrollToPrompt(); else updateJump(); }
window.addEventListener('resize', viewportChanged, { passive: true });
window.visualViewport?.addEventListener('resize', viewportChanged, { passive: true });
window.visualViewport?.addEventListener('scroll', updateJump, { passive: true });
jump.addEventListener('click', () => { focusInput(); scrollToPrompt(); });
media.addEventListener('change', (event) => {
  if (load('motion') !== null) return;
  state = { ...state, motion: !event.matches };
  animation?.setMotion(state.motion);
  updateUI();
});
window.addEventListener('pagehide', () => {
  if (isVaultUnlocked() || !unlockForm.hidden) lockVault();
  else stopAnimation();
});

function showHome(): void {
  state = { ...state, cwd: '/' };
  // Welcome content is not command history. Only real submissions get an echo.
  const home = node('section', 'home-view');
  const intro = node('div', 'home-profile');
  banner(intro);
  const listing = node('div', 'home-directory directory-grid');
  listing.setAttribute('role', 'group');
  listing.setAttribute('aria-label', '公开目录');
  linesInto(listing, runCommand('ls', state).lines);
  const starters = node('div', 'starter-commands');
  starters.append(node('span', 'muted', '点击目录，或输入命令。'), commandLink('help', 'help'),
    node('span', 'muted', ' 查看用法 · '), commandLink('ls -a', 'ls -a'), node('span', 'muted', ' 查看全部文件'));
  const appearanceHint = node('div', 'style-hint');
  appearanceHint.append(node('span', 'muted', '风格：输入 '), node('code', '', 'style modern'),
    node('span', 'muted', ' / '), node('code', '', 'style retro'));
  starters.append(appearanceHint);
  home.append(intro, listing, starters);
  log.append(home);
  updateUI();
}
const initialRoute = routeFor(location.pathname) ?? routeFor('/404.html');
if (initialRoute && location.pathname !== '/' && location.pathname !== '/index.html') {
  execute(initialRoute.command, { reveal: 'none', address: false });
  document.title = `${initialRoute.title} | Sakauma`;
} else showHome();
updateUI();
document.querySelector('#site-fallback')?.remove();
root.classList.add('app-ready');
resizeInput();
if (matchMedia('(pointer: fine)').matches) focusInput();
void document.fonts.ready.then(updateJump);
if (import.meta.hot) import.meta.hot.dispose(() => { lockVault(false); stopPager(); stopAnimation(); });
