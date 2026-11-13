import { files, isVaultUnlocked, onFilesChanged, posts, projectFiles, routeFor } from './content';
import type { ContentFile } from './content';

export type Theme = 'dark' | 'light' | 'amber';
export interface ShellState { cwd: string; theme: Theme; motion: boolean }
export type Tone = 'plain' | 'muted' | 'accent' | 'warning' | 'error' | 'directory';
export interface ShellLine { text: string; tone?: Tone; command?: string; markup?: boolean; sourceFile?: string }
export type Effect =
  | { type: 'clear' }
  | { type: 'banner' }
  | { type: 'history' }
  | { type: 'home' }
  | { type: 'document' }
  | { type: 'unlock'; command?: string }
  | { type: 'lock' }
  | { type: 'download'; file: string }
  | { type: 'pager'; mode: 'more' | 'less'; label: string }
  | { type: 'ascii'; mode: 'donut' | 'matrix' | 'off' };
export interface ShellResult { lines: ShellLine[]; state: ShellState; effect?: Effect; file?: string }

const INPUT_LIMIT = 4096;
const HEAD_LIMIT = 1000;
const COMMANDS = [
  'about', 'ascii', 'banner', 'cat', 'cd', 'clear', 'coffee', 'contact', 'date', 'echo', 'exit',
  'find', 'grep', 'head', 'help', 'history', 'home', 'less', 'ls', 'matrix', 'more', 'motion', 'neofetch',
  'notes', 'open', 'posts', 'projects', 'pwd', 'readme', 'search', 'sudo', 'tags', 'tail', 'categories', 'archives', 'theme', 'tree', 'wc', 'whoami',
  'unlock', 'lock', 'private', 'download',
] as const;
const COMMAND_SET = new Set<string>(COMMANDS);
const OWNER_COMMANDS = new Set<string>(['projects', 'readme', 'download', 'lock']);
const THEMES: Theme[] = ['dark', 'light', 'amber'];
const ASCII_MODES = ['donut', 'matrix', 'off'] as const;

type Entry = { path: string; kind: 'directory' } | (ContentFile & { kind: 'file' });
type FileSystem = Map<string, Entry>;
interface Token { value: string; start: number; end: number }
interface Source { path?: string; lines: ShellLine[]; text: string }
interface Plan { kind: 'text' | 'standalone' | 'pager'; run: (stdin?: ShellLine[]) => ShellResult }
class ShellError extends Error {}
export class LockedError extends ShellError {
  constructor() { super('private: locked. Run unlock to read private files.'); this.name = 'LockedError'; }
}

function fail(message: string): never { throw new ShellError(message); }
function privatePath(path: string): boolean { return path === '/private' || path.startsWith('/private/'); }
function requireUnlocked(): void { if (!isVaultUnlocked()) throw new LockedError(); }
function guardPath(path: string): void { if (privatePath(path)) requireUnlocked(); }
function textLines(text: string): ShellLine[] {
  if (!text) return [];
  return text.replace(/\n$/, '').split('\n').map((line) => ({ text: line }));
}
function buildFileSystem(): FileSystem {
  const fs: FileSystem = new Map([
    ['/', { path: '/', kind: 'directory' }],
    ['/private', { path: '/private', kind: 'directory' }],
  ]);
  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean);
    for (let depth = 1; depth < parts.length; depth++) {
      const path = '/' + parts.slice(0, depth).join('/');
      fs.set(path, { path, kind: 'directory' });
    }
    fs.set(file.path, { ...file, kind: 'file' });
  }
  return fs;
}
let cachedFiles: typeof files | undefined;
let cachedFileSystem: FileSystem | undefined;
onFilesChanged(() => {
  // Clear synchronously so locking drops even the previous Map's attachment/text references.
  cachedFileSystem?.clear();
  cachedFileSystem = undefined;
  cachedFiles = undefined;
});
function fileSystem(): FileSystem {
  if (cachedFiles !== files || !cachedFileSystem) {
    cachedFileSystem = buildFileSystem();
    cachedFiles = files;
  }
  return cachedFileSystem;
}

function normalizePath(path: string, cwd: string): string {
  let expanded = path;
  if (expanded === '~') expanded = '/';
  else if (expanded.startsWith('~/')) expanded = expanded.slice(1);
  const parts = (expanded.startsWith('/') ? expanded : `${cwd}/${expanded}`).split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') resolved.pop();
    else resolved.push(part);
  }
  return `/${resolved.join('/')}`;
}
function basename(path: string): string { return path.split('/').pop() || '/'; }
function parent(path: string): string { return path.slice(0, path.lastIndexOf('/')) || '/'; }
function children(fs: FileSystem, path: string): Entry[] {
  return [...fs.values()].filter((entry) => entry.path !== path && parent(entry.path) === path)
    .sort((a, b) => basename(a.path) < basename(b.path) ? -1 : basename(a.path) > basename(b.path) ? 1 : 0);
}
function getEntry(fs: FileSystem, path: string, cwd: string, command: string): Entry {
  const resolved = normalizePath(path, cwd);
  guardPath(resolved);
  const entry = fs.get(resolved);
  if (!entry) fail(`${command}: ${path}: no such file or directory`);
  return entry;
}
function getFile(fs: FileSystem, path: string, cwd: string, command: string): Extract<Entry, { kind: 'file' }> {
  const entry = getEntry(fs, path, cwd, command);
  if (entry.kind !== 'file') fail(`${command}: ${path}: is a directory`);
  // A trailing slash explicitly asks for a directory, even when its basename is a file.
  if (path.endsWith('/')) fail(`${command}: ${path}: not a directory`);
  return entry;
}
function quoteArgument(value: string): string {
  return /^[\w./~-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;
}
function entryLine(entry: Entry, label: string): ShellLine {
  return {
    text: label,
    tone: entry.kind === 'directory' ? 'directory' : 'plain',
    command: entry.path === '/private' ? 'private' : `${entry.kind === 'directory' ? 'cd' : 'cat'} ${quoteArgument(entry.path)}`,
  };
}

/** The only operator is an unquoted pipe; text is never passed to JS or an OS shell. */
function tokenize(input: string, partial = false): Token[][] {
  const stages: Token[][] = [[]];
  let value = '';
  let start = -1;
  let quote: '"' | "'" | undefined;
  const finish = (end: number) => {
    if (start !== -1) stages[stages.length - 1].push({ value, start, end });
    value = '';
    start = -1;
  };
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '\\' && quote !== "'") {
      if (start === -1) start = i;
      if (i + 1 === input.length) {
        if (!partial) fail('syntax: unfinished escape');
        value += '\\';
      } else value += input[++i];
    } else if (quote) {
      if (char === quote) quote = undefined;
      else value += char;
    } else if (char === '"' || char === "'") {
      if (start === -1) start = i;
      quote = char;
    } else if (char === '|') {
      finish(i);
      if (!stages[stages.length - 1].length && !partial) fail('syntax: empty pipeline command');
      stages.push([]);
    } else if (/\s/.test(char)) finish(i);
    else {
      if (start === -1) start = i;
      value += char;
    }
  }
  if (quote && !partial) fail(`syntax: unclosed ${quote === '"' ? 'double' : 'single'} quote`);
  finish(input.length);
  if (stages.length > 1 && !stages[stages.length - 1].length && !partial) fail('syntax: empty pipeline command');
  return stages;
}
/** Identify password-bearing command input for UI redaction without executing or exposing its arguments. */
export function passwordCommandInput(raw: string, standaloneOnly = false): boolean {
  try {
    const stages = tokenize(raw);
    return (!standaloneOnly || stages.length === 1) && stages.some(stage => stage[0]?.value === 'unlock');
  } catch (error) {
    if (!(error instanceof ShellError)) throw error;
    // A partial opening quote may combine unlock and its arguments into one unfinished token.
    const stages = tokenize(raw, true);
    return (!standaloneOnly || stages.length === 1) && stages.some(stage => /^unlock(?:\s|$)/.test(stage[0]?.value ?? ''));
  }
}

function expectArgs(args: string[], min: number, max: number, usage: string): void {
  if (args.length < min || args.length > max) fail(`usage: ${usage}`);
}
function noArgs(args: string[], command: string): void { expectArgs(args, 0, 0, command); }
function positional(args: string[], flags: readonly string[], command: string): { flags: Set<string>; rest: string[] } {
  const found = new Set<string>();
  const rest: string[] = [];
  let options = true;
  for (const arg of args) {
    if (options && arg === '--') options = false;
    else if (options && arg.startsWith('-') && arg !== '-') {
      for (const flag of arg.slice(1)) {
        if (!flags.includes(flag)) fail(`${command}: unknown option ${arg}`);
        found.add(flag);
      }
    } else rest.push(arg);
  }
  return { flags: found, rest };
}

function globPattern(pattern: string): RegExp {
  let expression = '^';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '*') expression += '.*';
    else if (char === '?') expression += '.';
    else if (char === '[') {
      let start = i + 1;
      const negative = pattern[start] === '!' || pattern[start] === '^';
      if (negative) start++;
      // A closing bracket at the start of a character class denotes a literal ].
      const end = pattern.indexOf(']', pattern[start] === ']' ? start + 1 : start);
      if (end === -1) expression += '\\[';
      else {
        const body = pattern.slice(start, end).replace(/[\\\]]/g, '\\$&');
        expression += `[${negative ? '^' : ''}${body}]`;
        i = end;
      }
    } else expression += char.replace(/[\\^$+?.(){}|\]]/g, '\\$&');
  }
  try { return new RegExp(expression + '$', 'u'); }
  catch { return fail(`find: invalid glob ${pattern}`); }
}

const HELP = [
  'Commands · / is the website root (~)',
  'help                         show this guide',
  'ls [-a/-l] [path]             list files; click a name to open it',
  'cd [path] · pwd               move through directories / print your path',
  'home · exit                  return to the homepage; keep theme and motion',
  'cat file [file ...]           read complete text (or piped input)',
  './file.md · contact          open a document from the beginning',
  'more [file] · less [file]     page a complete file or piped text',
  'tree [path]                  explore the virtual filesystem',
  'find [paths...] [-name GLOB] [-type f|d]  match names (* ? []) and kinds',
  'grep [-iF] pattern [files...] match a JS regex; -i ignores case, -F is literal',
  'head [-n N|-N] [files...]     first lines (default: 10; N: 0..1000)',
  'tail [-n N|-N|+N] [files...]  last lines (default: 10); +N starts at line N',
  'wc [-lwc] [files...]          line / word / UTF-8 byte counts and totals',
  'echo text                    print text literally',
  'theme dark|light|amber        choose terminal colors',
  'motion on|off                choose animation preference',
  'ascii [donut|matrix|off]      ASCII experiments; matrix is an alias',
  'clear · history              clear the screen / show command history',
  'neofetch · banner             show the welcome banner',
  'whoami · date · coffee       visitor / current time / a small break',
  'posts · notes                list all articles with titles',
  'search text                  search article titles and full text',
  'about                        personal introduction',
  'unlock · private             unlock private documents / browse private files',
  'tags · categories · archives browse the article indexes',
  'open id|path|url             read an article by id or published URL',
  '',
  'Tab completes commands, options, values and paths. Quotes and escapes preserve spaces.',
  'Text filters accept piped input: posts | grep 雷鬼 | wc -l',
  'A pager must finish a pipeline: cat about.txt | less',
];

const OWNER_HELP = [
  '',
  'Private documents · unlocked',
  'readme · projects            owner notes / private source projects',
  'download file                download text or an attached binary file',
  'lock                         clear private documents and lock the vault',
];

function prepare(words: string[], state: ShellState, fs: FileSystem, receivesInput: boolean, inPipeline: boolean): Plan {
  const [command, ...args] = words;
  const result = (lines: ShellLine[], next = state, effect?: Effect): ShellResult =>
    effect ? { lines, state: { ...next }, effect } : { lines, state: { ...next } };
  const pure = (run: (stdin?: ShellLine[]) => ShellLine[]): Plan => ({ kind: 'text', run: (stdin) => result(run(stdin)) });
  const source = (paths: string[], name: string): ((stdin?: ShellLine[]) => Source[]) => {
    if (!paths.length && !receivesInput) fail(`${name}: expected a file or piped input`);
    // Resolve every source now: no command in the pipeline executes until all plans are valid.
    const inputs = paths.map((path) => {
      const file = getFile(fs, path, state.cwd, name);
      return { path, text: file.text, lines: textLines(file.text).map(line => ({ ...line, markup: true, ...(privatePath(file.path) ? { sourceFile: file.path } : {}) })) };
    });
    return (stdin = []) => inputs.length ? inputs : [{
      lines: stdin,
      text: stdin.map(line => line.text).join('\n') + (stdin.length ? '\n' : ''),
    }];
  };
  const effectPlan = (effect: Effect): Plan => ({ kind: 'standalone', run: () => result([], state, effect) });
  const documentPlan = (path: string): Plan => {
    const readSource = source([path], command);
    const file = normalizePath(path, state.cwd);
    return { kind: 'text', run: () => {
      const output = result(readSource()[0].lines, state, inPipeline ? undefined : { type: 'document' });
      if (!inPipeline) output.file = file;
      return output;
    } };
  };
  if (!COMMAND_SET.has(command)) {
    const path = normalizePath(command, state.cwd);
    guardPath(path);
    const entry = fs.get(path);
    if (!entry) fail(`${command}: command not found. Type help.`);
    if (entry.kind === 'directory') fail(`${command}: is a directory`);
    noArgs(args, command);
    return documentPlan(command);
  }
  switch (command) {
    case 'help':
      noArgs(args, command);
      return pure(() => [...HELP, ...(isVaultUnlocked() ? OWNER_HELP : [])].map((text) => ({ text })));
    case 'unlock':
      noArgs(args, command);
      return effectPlan({ type: 'unlock' });
    case 'lock':
      noArgs(args, command);
      return { kind: 'standalone', run: () => result([], privatePath(state.cwd) ? { ...state, cwd: '/' } : state, { type: 'lock' }) };
    case 'private':
      noArgs(args, command);
      requireUnlocked();
      return prepare(['ls', '/private'], state, fs, receivesInput, inPipeline);
    case 'download': {
      const parsed = positional(args, [], command);
      expectArgs(parsed.rest, 1, 1, 'download file');
      requireUnlocked();
      const file = getFile(fs, parsed.rest[0], state.cwd, command);
      return effectPlan({ type: 'download', file: file.path });
    }
    case 'pwd':
      noArgs(args, command);
      guardPath(state.cwd);
      return pure(() => [{ text: state.cwd }]);
    case 'cd': {
      expectArgs(args, 0, 1, 'cd [path]');
      const entry = getEntry(fs, args[0] ?? '~', state.cwd, command);
      if (entry.kind !== 'directory') fail(`cd: ${args[0]}: not a directory`);
      return { kind: 'standalone', run: () => result([], { ...state, cwd: entry.path }) };
    }
    case 'home':
    case 'exit':
      noArgs(args, command);
      return { kind: 'standalone', run: () => result([], { ...state, cwd: '/' }, { type: 'home' }) };
    case 'ls': {
      const parsed = positional(args, ['a', 'l'], command);
      expectArgs(parsed.rest, 0, 1, 'ls [-a/-l] [path]');
      const entry = getEntry(fs, parsed.rest[0] ?? '.', state.cwd, command);
      if (parsed.rest[0]?.endsWith('/') && entry.kind !== 'directory') fail(`ls: ${parsed.rest[0]}: not a directory`);
      const listing: { entry: Entry; label: string }[] = entry.kind === 'directory'
        ? children(fs, entry.path).map((child) => ({ entry: child, label: basename(child.path) + (child.kind === 'directory' ? '/' : '') }))
        : [{ entry, label: basename(entry.path) }];
      if (entry.kind === 'directory' && parsed.flags.has('a')) {
        listing.unshift({ entry, label: '.' }, { entry: fs.get(parent(entry.path))!, label: '..' });
      }
      return pure(() => listing.map(({ entry: child, label }) => entryLine(child,
        parsed.flags.has('l') ? `${child.kind === 'directory' ? 'dr-xr-xr-x' : '-r--r--r--'}  ${label}` : label)));
    }
    case 'cat': {
      const parsed = positional(args, [], command);
      const readSource = source(parsed.rest, command);
      return { kind: 'text', run: stdin => {
        const output = result(readSource(stdin).flatMap(input => input.lines));
        if (parsed.rest.length === 1 && !receivesInput) output.file = normalizePath(parsed.rest[0], state.cwd);
        return output;
      } };
    }
    case 'more':
    case 'less': {
      const parsed = positional(args, [], command);
      expectArgs(parsed.rest, 0, 1, `${command} [file]`);
      const readSource = source(parsed.rest, command);
      const file = parsed.rest.length ? normalizePath(parsed.rest[0], state.cwd) : undefined;
      return { kind: 'pager', run: stdin => {
        const output = result(readSource(stdin)[0].lines, state, { type: 'pager', mode: command, label: file ?? 'stdin' });
        if (file && !receivesInput) output.file = file;
        return output;
      } };
    }
    case 'contact':
    case 'readme':
      noArgs(args, command);
      return documentPlan(command === 'contact' ? '/contact.txt' : '/private/README.md');
    case 'about':
      noArgs(args, command);
      return prepare(['cat', '/about.txt'], state, fs, receivesInput, inPipeline);
    case 'projects':
      noArgs(args, command);
      return prepare(['ls', '/private/projects'], state, fs, receivesInput, inPipeline);
    case 'tags':
    case 'categories':
    case 'archives':
      noArgs(args, command);
      return prepare(['ls', `/${command}`], state, fs, receivesInput, inPipeline);
    case 'posts':
    case 'notes':
      noArgs(args, command);
      return pure(() => posts.map(post => ({ text: `${post.date}  ${post.title}`, command: `cat ${quoteArgument(post.file)}` })));
    case 'search': {
      expectArgs(args, 1, 100, 'search text');
      const query = args.join(' ').toLocaleLowerCase();
      return pure(() => posts.filter(post => {
        const file = fs.get(post.file);
        return file?.kind === 'file' && file.text.toLocaleLowerCase().includes(query);
      }).map(post => ({ text: `${post.date}  ${post.title}`, command: `cat ${quoteArgument(post.file)}` })));
    }
    case 'open': {
      expectArgs(args, 1, 1, 'open id|path|url');
      const id = args[0];
      const post = posts.find(post => post.id === id || post.path === id);
      const project = projectFiles.find(file => basename(file.path).replace(/\.md$/, '') === id);
      let urlPath = id;
      if (/^https?:\/\//i.test(id)) {
        try {
          const url = new URL(id);
          if (url.hostname.toLowerCase() !== 'sakauma.github.io') fail('open: use an article URL from sakauma.github.io');
          urlPath = url.pathname;
        } catch (error) { if (error instanceof ShellError) throw error; fail('open: invalid article URL'); }
      }
      let decodedPath = urlPath;
      try { decodedPath = decodeURIComponent(urlPath); } catch { /* Keep invalid URI text as a literal VFS path. */ }
      const resolved = normalizePath(decodedPath, state.cwd);
      const route = routeFor(urlPath);
      if (!post && !project && privatePath(resolved)) {
        guardPath(resolved);
        const file = resolved + (decodedPath.endsWith('/') ? '/' : '');
        return prepare(resolved === '/private' || route?.command === 'private' ? ['private'] : ['cat', '--', file], state, fs, receivesInput, inPipeline);
      }
      if (!post && !project && route) {
        const routeTokens = tokenize(route.command);
        return prepare(routeTokens[0].map(token => token.value), state, fs, receivesInput, inPipeline);
      }
      return prepare(['cat', '--', post?.file ?? project?.path ?? id], state, fs, receivesInput, inPipeline);
    }
    case 'tree': {
      expectArgs(args, 0, 1, 'tree [path]');
      if (args[0]?.startsWith('-')) fail(`tree: unknown option ${args[0]}`);
      const root = getEntry(fs, args[0] ?? '.', state.cwd, command);
      if (args[0]?.endsWith('/') && root.kind !== 'directory') fail(`tree: ${args[0]}: not a directory`);
      return pure(() => {
        const lines: ShellLine[] = [entryLine(root, root.path === '/' ? '/' : basename(root.path))];
        const walk = (entry: Entry, prefix: string) => {
          if (entry.kind !== 'directory') return;
          const items = children(fs, entry.path);
          items.forEach((child, index) => {
            const last = index === items.length - 1;
            lines.push(entryLine(child, `${prefix}${last ? '└── ' : '├── '}${basename(child.path)}${child.kind === 'directory' ? '/' : ''}`));
            walk(child, `${prefix}${last ? '    ' : '│   '}`);
          });
        };
        walk(root, '');
        return lines;
      });
    }
    case 'find': {
      const paths: string[] = [];
      const predicates: Array<(entry: Entry) => boolean> = [];
      let expression = false;
      let options = true;
      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (options && arg === '--' && !expression) options = false;
        else if (arg === '-name') {
          expression = true;
          if (args[i + 1] === undefined) fail('find: -name expects a glob pattern');
          const pattern = globPattern(args[++i]);
          predicates.push(entry => pattern.test(basename(entry.path)));
        } else if (arg === '-type') {
          expression = true;
          const value = args[++i];
          if (value !== 'f' && value !== 'd') fail('find: -type expects f or d');
          predicates.push(entry => entry.kind === (value === 'f' ? 'file' : 'directory'));
        } else if (options && arg.startsWith('-')) fail(`find: unknown option ${arg}`);
        else if (expression) fail(`find: unexpected argument ${arg}; paths must precede filters`);
        else paths.push(arg);
      }
      const roots = (paths.length ? paths : ['.']).map(path => {
        const entry = getEntry(fs, path, state.cwd, command);
        if (path.endsWith('/') && entry.kind !== 'directory') fail(`find: ${path}: not a directory`);
        return entry;
      });
      return pure(() => {
        const lines: ShellLine[] = [];
        const walk = (entry: Entry) => {
          if (predicates.every(predicate => predicate(entry))) lines.push(entryLine(entry, entry.path));
          if (entry.kind === 'directory') children(fs, entry.path).forEach(walk);
        };
        roots.forEach(walk);
        return lines;
      });
    }
    case 'grep': {
      // Options belong before the pattern; subsequent arguments are always source paths.
      let cursor = 0;
      let insensitive = false;
      let literal = false;
      while (cursor < args.length && args[cursor].startsWith('-') && args[cursor] !== '-') {
        const option = args[cursor++];
        if (option === '--') break;
        if (!/^-[iF]+$/.test(option)) fail(`grep: unknown option ${option}`);
        insensitive ||= option.includes('i');
        literal ||= option.includes('F');
      }
      const rest = args.slice(cursor);
      if (!rest.length) fail('usage: grep [-iF] pattern [files...]');
      let matches: (text: string) => boolean;
      if (literal) {
        const pattern = insensitive ? rest[0].toLocaleLowerCase() : rest[0];
        matches = text => (insensitive ? text.toLocaleLowerCase() : text).includes(pattern);
      } else {
        let pattern: RegExp;
        try { pattern = new RegExp(rest[0], insensitive ? 'i' : ''); }
        catch (error) { return fail(`grep: invalid regular expression: ${(error as Error).message}`); }
        matches = text => pattern.test(text);
      }
      const readSource = source(rest.slice(1), command);
      return pure((stdin) => readSource(stdin).flatMap(input => input.lines
        .filter(line => matches(line.text))
        .map(line => rest.length > 2 ? { ...line, text: `${input.path}:${line.text}` } : line)));
    }
    case 'head':
    case 'tail': {
      let count = 10;
      let fromStart = false;
      const paths: string[] = [];
      let options = true;
      const setCount = (value: string | undefined) => {
        const valid = value !== undefined && (command === 'tail' ? /^\+?\d+$/ : /^\d+$/).test(value);
        const number = Number(value);
        if (!valid || !Number.isSafeInteger(number) || (command === 'head' && number > HEAD_LIMIT)) {
          fail(command === 'head' ? `head: -n expects an integer from 0 to ${HEAD_LIMIT}`
            : 'tail: line count expects a nonnegative safe integer (or +N)');
        }
        count = number;
        fromStart = value!.startsWith('+');
      };
      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (options && arg === '--') options = false;
        else if (options && arg === '-n') setCount(args[++i]);
        else if (options && /^-\d+$/.test(arg)) setCount(arg.slice(1));
        else if (options && command === 'tail' && arg.startsWith('+')) setCount(arg);
        else if (options && arg.startsWith('-')) fail(`${command}: unknown option ${arg}`);
        else paths.push(arg);
      }
      const readSource = source(paths, command);
      return pure((stdin) => readSource(stdin).flatMap((input, index) => {
        const lines = command === 'head' ? input.lines.slice(0, count)
          : fromStart ? input.lines.slice(Math.max(0, count - 1))
            : count === 0 ? [] : input.lines.slice(-count);
        return paths.length > 1 ? [
          ...(index ? [{ text: '' }] : []), { text: `==> ${input.path} <==`, tone: 'muted' as const }, ...lines,
        ] : lines;
      }));
    }
    case 'wc': {
      const parsed = positional(args, ['l', 'w', 'c'], command);
      const readSource = source(parsed.rest, command);
      return pure((stdin) => {
        const flags = ['l', 'w', 'c'].filter(flag => !parsed.flags.size || parsed.flags.has(flag));
        const counts = (input: Source) => ({
          l: input.lines.length, w: input.text.match(/\S+/g)?.length ?? 0, c: new TextEncoder().encode(input.text).length,
        });
        type Counts = ReturnType<typeof counts>;
        const render = (count: Counts, label?: string): ShellLine => ({
          text: flags.map(flag => count[flag as keyof Counts]).join(' ') + (label === undefined ? '' : ` ${label}`),
        });
        const total: Counts = { l: 0, w: 0, c: 0 };
        const lines = readSource(stdin).map(input => {
          const count = counts(input);
          total.l += count.l;
          total.w += count.w;
          total.c += count.c;
          return render(count, input.path);
        });
        if (parsed.rest.length > 1) lines.push(render(total, 'total'));
        return lines;
      });
    }
    case 'echo':
      return pure(() => [{ text: args.join(' ') }]);
    case 'theme': {
      expectArgs(args, 0, 1, 'theme dark|light|amber');
      if (args.length && !THEMES.includes(args[0] as Theme)) fail('theme: expected dark, light, or amber');
      const theme = (args[0] ?? state.theme) as Theme;
      return { kind: 'standalone', run: () => result([{ text: `theme: ${theme}`, tone: 'accent' }], { ...state, theme }) };
    }
    case 'motion': {
      expectArgs(args, 0, 1, 'motion on|off');
      if (args.length && args[0] !== 'on' && args[0] !== 'off') fail('motion: expected on or off');
      const motion = args.length ? args[0] === 'on' : state.motion;
      return { kind: 'standalone', run: () => result([{ text: `motion: ${motion ? 'on' : 'off'}`, tone: 'accent' }], { ...state, motion }) };
    }
    case 'ascii':
      expectArgs(args, 0, 1, 'ascii [donut|matrix|off]');
      if (args.length && !ASCII_MODES.includes(args[0] as typeof ASCII_MODES[number])) fail('ascii: expected donut, matrix, or off');
      return effectPlan({ type: 'ascii', mode: (args[0] ?? 'donut') as typeof ASCII_MODES[number] });
    case 'matrix':
      noArgs(args, command);
      return effectPlan({ type: 'ascii', mode: 'matrix' });
    case 'clear':
    case 'history':
      noArgs(args, command);
      return effectPlan({ type: command });
    case 'neofetch':
    case 'banner':
      noArgs(args, command);
      return effectPlan({ type: 'banner' });
    case 'whoami':
      noArgs(args, command);
      return pure(() => [{ text: 'visitor' }]);
    case 'date':
      noArgs(args, command);
      return pure(() => [{ text: new Date().toISOString() }]);
    case 'sudo':
      if (args.length !== 2 || args[0] !== 'make' || args[1] !== 'coffee') fail('sudo: available command: sudo make coffee');
      return pure(() => [{ text: '[coffee] A fresh cup. Take a breath.', tone: 'accent' }]);
    case 'coffee':
      noArgs(args, command);
      return pure(() => [{ text: '[coffee] A fresh cup. Take a breath.', tone: 'accent' }]);
    default:
      return fail(`${command}: command not found. Type help.`);
  }
}

export function runCommand(input: string, state: ShellState): ShellResult {
  const original: ShellState = { ...state, cwd: normalizePath(state.cwd, '/') };
  let inPipeline = false;
  try {
    if (input.length > INPUT_LIMIT) fail(`input: maximum length is ${INPUT_LIMIT} characters`);
    const stages = tokenize(input);
    inPipeline = stages.length > 1;
    if (stages.length === 1 && !stages[0].length) return { lines: [], state: original };
    const fs = fileSystem();
    const plans = stages.map((tokens, index) => prepare(tokens.map((token) => token.value), original, fs, index > 0, stages.length > 1));
    if (plans.length > 1) {
      if (plans.some((plan, index) => plan.kind === 'pager' && index !== plans.length - 1)) {
        fail('pipeline: more/less must be the final command');
      }
      if (plans.some(plan => plan.kind === 'standalone')) {
        fail('pipeline: only text-producing commands are allowed before an optional final pager; state and display commands must run on their own');
      }
    }
    let output: ShellResult = { lines: [], state: original };
    plans.forEach((plan, index) => { output = plan.run(index ? output.lines : undefined); });
    // A pipeline is derived output, even when its final stage happens to read a whole file.
    if (plans.length > 1) delete output.file;
    return output;
  } catch (error) {
    if (!(error instanceof ShellError)) throw error;
    if (error instanceof LockedError && !inPipeline) return { lines: [], state: original, effect: { type: 'unlock', command: input } };
    return { lines: [{ text: error.message, tone: 'error' }], state: original };
  }
}

function commonPrefix(values: string[]): string {
  let prefix = values[0] ?? '';
  for (const value of values.slice(1)) {
    while (prefix && !value.startsWith(prefix)) prefix = prefix.slice(0, -1);
  }
  return prefix;
}
function completeToken(value: string, raw: string, finished: boolean): string {
  const style = raw.startsWith('"') ? '"' : raw.startsWith("'") ? "'" : '';
  if (style === '"') return `"${value.replace(/[\\"]/g, '\\$&')}${finished || raw.endsWith('"') && raw.length > 1 ? '"' : ''}`;
  if (style === "'") return `'${value.replace(/'/g, "'\\''")}${finished || raw.endsWith("'") && raw.length > 1 ? "'" : ''}`;
  return value.replace(/[\s\\'"|]/g, '\\$&');
}
function pathCandidates(prefix: string, cwd: string, fs: FileSystem, directoriesOnly: boolean): string[] {
  if (prefix === '~') return ['~/'];
  if (prefix === '.' || prefix === '..') return [prefix + '/'];
  const slash = prefix.lastIndexOf('/');
  const directoryPart = slash === -1 ? '' : prefix.slice(0, slash + 1);
  const namePart = prefix.slice(slash + 1);
  const directoryPath = normalizePath(directoryPart || '.', cwd);
  if (!isVaultUnlocked() && privatePath(directoryPath)) return [];
  const directory = fs.get(directoryPath);
  if (!directory || directory.kind !== 'directory') return [];
  return children(fs, directory.path)
    .filter((entry) => (!directoriesOnly || entry.kind === 'directory') && basename(entry.path).startsWith(namePart))
    .map((entry) => directoryPart + basename(entry.path) + (entry.kind === 'directory' ? '/' : ''));
}

/** Completion replaces only the final token; earlier spacing, quoting and pipeline text survive. */
export function completeCommand(input: string, state: ShellState): { value: string; candidates: string[] } {
  const unchanged = { value: input, candidates: [] as string[] };
  if (input.length > INPUT_LIMIT) return unchanged;
  const stages = tokenize(input, true);
  const tokens = stages[stages.length - 1];
  const last = tokens[tokens.length - 1];
  const current = last?.end === input.length ? last : { value: '', start: input.length, end: input.length };
  const before = tokens.filter((token) => token.start < current.start);
  const prefix = current.value;
  const raw = input.slice(current.start);
  let candidates: string[] = [];
  if (!before.length) candidates = [
    ...COMMANDS.filter(command => command.startsWith(prefix) && (isVaultUnlocked() || !OWNER_COMMANDS.has(command))),
    ...pathCandidates(prefix, normalizePath(state.cwd, '/'), fileSystem(), false),
  ];
  else {
    const command = before[0].value;
    const args = before.slice(1).map((token) => token.value);
    if (!COMMAND_SET.has(command) || !isVaultUnlocked() && OWNER_COMMANDS.has(command)) return unchanged;
    if (command === 'theme' && !args.length) candidates = THEMES.filter((value) => value.startsWith(prefix));
    else if (command === 'motion' && !args.length) candidates = ['off', 'on'].filter((value) => value.startsWith(prefix));
    else if (command === 'ascii' && !args.length) candidates = ASCII_MODES.filter((value) => value.startsWith(prefix));
    else if (command === 'sudo' && args.length < 2) candidates = (args.length ? args[0] === 'make' ? ['coffee'] : [] : ['make']).filter((value) => value.startsWith(prefix));
    else if (['head', 'tail'].includes(command) && !args.includes('--') && args[args.length - 1] === '-n') {
      candidates = ['0', '5', '10', '20', ...(command === 'tail' ? ['+1', '+10', '+20'] : [])].filter(value => value.startsWith(prefix));
    } else if (command === 'find' && args[args.length - 1] === '-type') {
      candidates = ['f', 'd'].filter(value => value.startsWith(prefix));
    } else if (command === 'find' && args[args.length - 1] === '-name') {
      candidates = ['*', '*.md', '*.txt', 'README.*'].filter(value => value.startsWith(prefix));
    } else if (command === 'grep') {
      // Stop at the first pattern, including patterns such as '-i' following --.
      let cursor = 0;
      let options = true;
      while (cursor < args.length && args[cursor].startsWith('-') && args[cursor] !== '-') {
        const arg = args[cursor++];
        if (arg === '--') { options = false; break; }
        if (!/^-[iF]+$/.test(arg)) return unchanged;
      }
      if (cursor < args.length) candidates = pathCandidates(prefix, normalizePath(state.cwd, '/'), fileSystem(), false);
      else if (options && prefix.startsWith('-')) candidates = ['-F', '-i', '-iF'].filter(value => value.startsWith(prefix));
    } else if (prefix.startsWith('-') && (command === 'find' || !args.includes('--'))) {
      const options: Record<string, string[]> = {
        ls: ['-a', '-l', '-al'], find: ['-name', '-type'], head: ['-n', '-0', '-5', '-10', '-20'],
        tail: ['-n', '-0', '-5', '-10', '-20'], wc: ['-l', '-w', '-c', '-lw', '-lc', '-wc', '-lwc'],
      };
      candidates = (Object.hasOwn(options, command) ? options[command] : []).filter(value => value.startsWith(prefix));
    } else if (command === 'tail' && !args.includes('--') && prefix.startsWith('+')) {
      candidates = ['+1', '+10', '+20'].filter(value => value.startsWith(prefix));
    } else if (['ls', 'cd', 'cat', 'tree', 'find', 'head', 'tail', 'wc', 'more', 'less', 'open', 'download'].includes(command)) {
      if (command === 'find' && args.some(arg => arg === '-name' || arg === '-type')) return unchanged;
      if (['more', 'less', 'download'].includes(command) && args.filter(arg => arg !== '--').length) return unchanged;
      candidates = pathCandidates(prefix, normalizePath(state.cwd, '/'), fileSystem(), command === 'cd');
      if (command === 'open' && !args.length && !prefix.includes('/')) {
        candidates.push(...[...posts.map(post => post.id), ...projectFiles.map(file => basename(file.path).replace(/\.md$/, ''))].filter(id => id.startsWith(prefix)));
      }
    }
  }
  candidates = [...new Set(candidates)].sort();
  if (!candidates.length) return unchanged;
  const replacement = candidates.length === 1 ? candidates[0] : commonPrefix(candidates);
  if (candidates.length > 1 && replacement.length <= prefix.length) return { value: input, candidates };
  const finished = candidates.length === 1 && !replacement.endsWith('/');
  const value = input.slice(0, current.start) + completeToken(replacement, raw, finished) + (finished ? ' ' : '');
  return value.length <= INPUT_LIMIT ? { value, candidates } : unchanged;
}
