import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import './style.css';
import { runCommand, completeCommand, type ShellState, type ShellLine, type Theme } from './shell';
import { AsciiAnimation } from './ascii';
import { profile, posts, routeFor, hrefForCommand, hrefForFile } from './content';
import { appendContentText } from './links';

const root = document.documentElement;
const app = document.querySelector<HTMLDivElement>('#app')!;
const load = (key: string): string | null => { try { return localStorage.getItem(`sakauma:cli:${key}`); } catch { return null; } };
const save = (key: string, value: string): void => { try { localStorage.setItem(`sakauma:cli:${key}`, value); } catch { /* A terminal session does not require storage. */ } };
const media = matchMedia('(prefers-reduced-motion: reduce)');
let state: ShellState = {
  cwd: '/',
  theme: (['dark', 'light', 'amber'].includes(root.dataset.theme ?? '') ? root.dataset.theme : 'dark') as Theme,
  motion: root.dataset.motion !== 'off',
};
const commands: string[] = [];
let historyIndex = 0;
let draft = '';
let searchDraft = '';
let searchIndex = 0;
let searchMatches: string[] = [];
let animation: AsciiAnimation | null = null;

app.innerHTML = `
  <main id="terminal-screen" aria-label="Sakauma 交互终端">
    <header class="terminal-title"><span><span class="title-mark">&gt;_</span> sakauma<span class="title-separator"> / </span><span class="muted">dev/tty1</span></span></header>
    <div id="scrollback" role="region" aria-label="终端会话内容">
      <div id="terminal-log" role="log" aria-label="终端输出" aria-live="polite" aria-relevant="additions"></div>
      <form id="command-form" autocomplete="off">
        <label class="input-label" for="command-input"><span class="prompt-user">visitor@sakauma</span><span class="muted">:</span><span id="prompt-path" class="prompt-path">~</span><span class="prompt-symbol">$</span></label>
        <div class="input-editor"><textarea id="command-input" rows="1" maxlength="4096" aria-label="终端命令" aria-describedby="keyboard-help" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="send"></textarea><span class="empty-cursor" aria-hidden="true"></span></div>
        <button type="submit" class="enter-key" aria-label="执行命令" title="Enter">↵</button>
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
    <footer class="status-line"><span class="session-label">0:shell<span aria-hidden="true">*</span></span><span class="status-directory">~</span><span class="status-right"><button type="button" id="theme-command" data-command="theme light" aria-label="切换终端主题">dark</button><span class="status-divider">│</span><button type="button" id="motion-command" data-command="motion off" aria-label="切换字符动效">motion:on</button><span class="encoding">UTF-8</span></span></footer>
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
      row.append(command);
    } else if (line.markup) appendContentText(row, line.text);
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
  for (const [label, value] of [['name', profile.name], ['work', profile.role], ['posts', `${posts.length} 篇文章`]]) {
    const row = node('div', 'fetch-row');
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
  root.dataset.motion = state.motion ? 'on' : 'off';
  document.querySelector('#prompt-path')!.textContent = pathLabel();
  document.querySelector('.status-directory')!.textContent = pathLabel();
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
  const bounds = form.getBoundingClientRect();
  const viewportTop = window.visualViewport?.offsetTop ?? 0;
  const viewportBottom = viewportTop + (window.visualViewport?.height ?? window.innerHeight);
  jump.hidden = bounds.top >= viewportTop && bounds.bottom <= viewportBottom;
}
function scrollToPrompt(): void {
  requestAnimationFrame(() => {
    // Keep a visible prompt still. Only reveal it when an explicit command needs it.
    const target = historyPanel.hidden ? form : historyPanel;
    target.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    updateJump();
  });
}
function focusInput(): void { input.focus({ preventScroll: true }); resizeInput(); }
function stopAnimation(): void { animation?.stop(); animation = null; }
function clear(): void { stopAnimation(); log.replaceChildren(); hints.hidden = true; }
function execute(raw: string, options: { reveal?: 'prompt' | 'start' | 'none'; address?: boolean } = {}): void {
  const command = raw.trim();
  if (!command) { focusInput(); return; }
  const isSetting = /^(motion|theme)(\s|$)/.test(command);
  if (!isSetting) stopAnimation();
  if (commands.at(-1) !== command) commands.push(command);
  if (commands.length > 100) commands.shift();
  historyIndex = commands.length;
  draft = '';
  input.value = '';
  hints.hidden = true;
  historyPanel.hidden = true;
  const output = entry(command);
  const result = runCommand(command, state);
  if (result.state.theme !== state.theme) save('theme', result.state.theme);
  // Persist an explicit choice even if it equals the system's current setting.
  if (/^motion\s+(on|off)\s*$/.test(command) && !result.lines.some(line => line.tone === 'error')) save('motion', result.state.motion ? 'on' : 'off');
  state = result.state;
  animation?.setMotion(state.motion);
  updateUI();
  linesInto(output, result.lines);
  switch (result.effect?.type) {
    case 'clear': clear(); break;
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
    const href = result.file ? hrefForFile(result.file) : undefined;
    if (href) {
      const route = routeFor(href);
      if (location.pathname !== new URL(href, location.origin).pathname) history.pushState(null, '', href);
      document.title = `${route?.title ?? profile.brand} | Sakauma`;
    }
  }
  focusInput();
  if (options.reveal === 'start') requestAnimationFrame(() => {
    output.parentElement?.scrollIntoView({ block: 'start', behavior: 'instant' });
    updateJump();
  });
  else if (options.reveal !== 'none') scrollToPrompt();
}

form.addEventListener('submit', (event) => { event.preventDefault(); execute(input.value); });
input.addEventListener('input', () => { hints.hidden = true; resizeInput(); });
input.addEventListener('keydown', (event) => {
  if (event.isComposing || event.keyCode === 229) return;
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
    if (historyIndex === commands.length) draft = input.value;
    historyIndex = Math.max(0, Math.min(commands.length, historyIndex + (event.key === 'ArrowUp' ? -1 : 1)));
    input.value = historyIndex === commands.length ? draft : commands[historyIndex] ?? '';
    input.setSelectionRange(input.value.length, input.value.length);
    resizeInput();
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
  if (event.isComposing || event.keyCode === 229) return;
  const control = (event.ctrlKey || event.metaKey) && !event.altKey;
  if (control && event.key.toLowerCase() === 'l') { event.preventDefault(); clear(); focusInput(); scrollToPrompt(); }
  else if (control && event.key.toLowerCase() === 'r') { event.preventDefault(); startSearch(); }
  else if ((control && event.key.toLowerCase() === 'c') || event.key === 'Escape') {
    // Preserve ordinary copy when text is selected.
    if (event.key !== 'Escape' && (window.getSelection()?.toString() || (input === document.activeElement && input.selectionStart !== input.selectionEnd))) return;
    event.preventDefault();
    if (!historyPanel.hidden) { closeSearch(false); return; }
    stopAnimation();
    if (input.value) { const output = entry(`${input.value} ^C`); output.remove(); }
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
  if (command) execute(command, hrefForCommand(command) ? { reveal: 'start' } : {});
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
window.addEventListener('resize', updateJump, { passive: true });
window.visualViewport?.addEventListener('resize', updateJump, { passive: true });
window.visualViewport?.addEventListener('scroll', updateJump, { passive: true });
jump.addEventListener('click', () => { focusInput(); scrollToPrompt(); });
media.addEventListener('change', (event) => {
  if (load('motion') !== null) return;
  state = { ...state, motion: !event.matches };
  animation?.setMotion(state.motion);
  updateUI();
});
window.addEventListener('pagehide', () => stopAnimation());

function showHome(): void {
  state = { ...state, cwd: '/' };
  banner(entry('neofetch'));
  const listing = entry('ls');
  listing.classList.add('directory-grid');
  linesInto(listing, runCommand('ls', state).lines);
  const starters = node('div', 'starter-commands');
  starters.append(node('span', 'muted', '试试 '));
  for (const [index, command] of ['posts', 'tags', 'cat about.txt', 'help', 'ascii donut'].entries()) {
    if (index) starters.append(node('span', 'muted', '  /  '));
    starters.append(commandLink(command, command));
  }
  log.append(starters);
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
if (import.meta.hot) import.meta.hot.dispose(() => stopAnimation());
