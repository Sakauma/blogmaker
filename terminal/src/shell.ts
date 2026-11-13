import { files, posts, projectFiles, routeFor } from './content';

export type Theme = 'dark' | 'light' | 'amber';
export interface ShellState { cwd: string; theme: Theme; motion: boolean }
export type Tone = 'plain' | 'muted' | 'accent' | 'warning' | 'error' | 'directory';
export interface ShellLine { text: string; tone?: Tone; command?: string; markup?: boolean }
export type Effect =
  | { type: 'clear' }
  | { type: 'banner' }
  | { type: 'history' }
  | { type: 'ascii'; mode: 'donut' | 'matrix' | 'off' };
export interface ShellResult { lines: ShellLine[]; state: ShellState; effect?: Effect; file?: string }

const INPUT_LIMIT = 4096;
const HEAD_LIMIT = 1000;
const COMMANDS = [
  'about', 'ascii', 'banner', 'cat', 'cd', 'clear', 'coffee', 'date', 'echo',
  'find', 'grep', 'head', 'help', 'history', 'ls', 'matrix', 'motion', 'neofetch',
  'notes', 'open', 'posts', 'projects', 'pwd', 'search', 'sudo', 'tags', 'categories', 'archives', 'theme', 'tree', 'wc', 'whoami',
] as const;
const COMMAND_SET = new Set<string>(COMMANDS);
const THEMES: Theme[] = ['dark', 'light', 'amber'];
const ASCII_MODES = ['donut', 'matrix', 'off'] as const;

type Entry = { path: string; kind: 'directory' } | { path: string; kind: 'file'; text: string };
type FileSystem = Map<string, Entry>;
interface Token { value: string; start: number; end: number }
interface Plan { pure: boolean; run: (stdin?: ShellLine[]) => ShellResult }
class ShellError extends Error {}

function fail(message: string): never { throw new ShellError(message); }
function textLines(text: string): ShellLine[] {
  if (!text) return [];
  return text.replace(/\n$/, '').split('\n').map((line) => ({ text: line }));
}
function buildFileSystem(): FileSystem {
  const fs: FileSystem = new Map([['/', { path: '/', kind: 'directory' }]]);
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
const contentFileSystem = buildFileSystem();
function fileSystem(): FileSystem { return contentFileSystem; }

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
  const entry = fs.get(resolved);
  if (!entry) fail(`${command}: ${path}: no such file or directory`);
  return entry;
}
function getFile(fs: FileSystem, path: string, cwd: string, command: string): ShellLine[] {
  const entry = getEntry(fs, path, cwd, command);
  if (entry.kind !== 'file') fail(`${command}: ${path}: is a directory`);
  // A trailing slash explicitly asks for a directory, even when its basename is a file.
  if (path.endsWith('/')) fail(`${command}: ${path}: not a directory`);
  return textLines(entry.text).map(line => ({ ...line, markup: true }));
}
function quoteArgument(value: string): string {
  return /^[\w./~-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;
}
function entryLine(entry: Entry, label: string): ShellLine {
  return {
    text: label,
    tone: entry.kind === 'directory' ? 'directory' : 'plain',
    command: `${entry.kind === 'directory' ? 'cd' : 'cat'} ${quoteArgument(entry.path)}`,
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

const HELP = [
  'Commands · / is the website root (~)',
  'help                         show this guide',
  'ls [-a/-l] [path]             list files; click a name to open it',
  'cd [path] · pwd               move through directories / print your path',
  'cat file [file ...]           read complete text',
  'tree [path] · find [path]     explore the virtual filesystem',
  'grep [-i] pattern [file]      find literal text (or filter a pipe)',
  'head [-n 0..1000] [file]      first lines (default: 10)',
  'wc [-l] [file]                line / word / character counts',
  'echo text                    print text literally',
  'theme dark|light|amber        choose terminal colors',
  'motion on|off                choose animation preference',
  'ascii [donut|matrix|off]      ASCII experiments; matrix is an alias',
  'clear · history              clear the screen / show command history',
  'neofetch · banner             show the welcome banner',
  'whoami · date · coffee       visitor / current time / a small break',
  'posts · notes                list all articles with titles',
  'search text                  search article titles and full text',
  'about · projects             personal introduction / source projects',
  'tags · categories · archives browse the article indexes',
  'open id|path|url             read an article by id or published URL',
  '',
  'Tab completes commands and paths. Quotes and backslash escapes preserve spaces.',
  'Connect commands with pipes: posts | grep 雷鬼 | wc -l',
];

function prepare(words: string[], state: ShellState, fs: FileSystem, receivesInput: boolean): Plan {
  const [command, ...args] = words;
  if (!COMMAND_SET.has(command)) fail(`${command}: command not found. Type help.`);
  const result = (lines: ShellLine[], next = state, effect?: Effect): ShellResult =>
    effect ? { lines, state: { ...next }, effect } : { lines, state: { ...next } };
  const pure = (run: (stdin?: ShellLine[]) => ShellLine[]): Plan => ({ pure: true, run: (stdin) => result(run(stdin)) });
  const source = (paths: string[], name: string): ((stdin?: ShellLine[]) => ShellLine[]) => {
    if (!paths.length && !receivesInput) fail(`${name}: expected a file or piped input`);
    // Resolve every source now: no command in the pipeline executes until all plans are valid.
    const files = paths.map((path) => getFile(fs, path, state.cwd, name));
    return (stdin) => files.length ? files.flat() : (stdin ?? []);
  };
  const effectPlan = (effect: Effect): Plan => ({ pure: false, run: () => result([], state, effect) });
  switch (command) {
    case 'help':
      noArgs(args, command);
      return pure(() => HELP.map((text) => ({ text })));
    case 'pwd':
      noArgs(args, command);
      return pure(() => [{ text: state.cwd }]);
    case 'cd': {
      expectArgs(args, 0, 1, 'cd [path]');
      const entry = getEntry(fs, args[0] ?? '~', state.cwd, command);
      if (entry.kind !== 'directory') fail(`cd: ${args[0]}: not a directory`);
      return { pure: false, run: () => result([], { ...state, cwd: entry.path }) };
    }
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
      return { pure: true, run: stdin => {
        const output = result(readSource(stdin));
        if (parsed.rest.length === 1) output.file = normalizePath(parsed.rest[0], state.cwd);
        return output;
      } };
    }
    case 'about':
      noArgs(args, command);
      return prepare(['cat', '/about.txt'], state, fs, receivesInput);
    case 'projects':
    case 'tags':
    case 'categories':
    case 'archives':
      noArgs(args, command);
      return prepare(['ls', `/${command}`], state, fs, receivesInput);
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
      const route = routeFor(urlPath);
      if (!post && !project && route) {
        const routeTokens = tokenize(route.command);
        return prepare(routeTokens[0].map(token => token.value), state, fs, receivesInput);
      }
      return prepare(['cat', '--', post?.file ?? project?.path ?? id], state, fs, receivesInput);
    }
    case 'tree':
    case 'find': {
      expectArgs(args, 0, 1, `${command} [path]`);
      if (args[0]?.startsWith('-')) fail(`${command}: unknown option ${args[0]}`);
      const root = getEntry(fs, args[0] ?? '.', state.cwd, command);
      if (args[0]?.endsWith('/') && root.kind !== 'directory') fail(`${command}: ${args[0]}: not a directory`);
      return pure(() => {
        const lines: ShellLine[] = [entryLine(root, command === 'find' ? root.path : root.path === '/' ? '/' : basename(root.path))];
        const walk = (entry: Entry, prefix: string) => {
          if (entry.kind !== 'directory') return;
          const items = children(fs, entry.path);
          items.forEach((child, index) => {
            const last = index === items.length - 1;
            lines.push(entryLine(child, command === 'find' ? child.path : `${prefix}${last ? '└── ' : '├── '}${basename(child.path)}${child.kind === 'directory' ? '/' : ''}`));
            walk(child, `${prefix}${last ? '    ' : '│   '}`);
          });
        };
        walk(root, '');
        return lines;
      });
    }
    case 'grep': {
      // Options belong before the pattern, so a literal pattern never changes later parsing.
      let cursor = 0;
      let insensitive = false;
      while (cursor < args.length && args[cursor].startsWith('-')) {
        const option = args[cursor++];
        if (option === '--') break;
        if (option !== '-i') fail(`grep: unknown option ${option}`);
        insensitive = true;
      }
      const rest = args.slice(cursor);
      expectArgs(rest, 1, 2, 'grep [-i] pattern [file]');
      const pattern = insensitive ? rest[0].toLocaleLowerCase() : rest[0];
      const readSource = source(rest.slice(1), command);
      return pure((stdin) => readSource(stdin).filter((line) =>
        (insensitive ? line.text.toLocaleLowerCase() : line.text).includes(pattern)));
    }
    case 'head': {
      let count = 10;
      const paths: string[] = [];
      let options = true;
      for (let i = 0; i < args.length; i++) {
        if (options && args[i] === '--') options = false;
        else if (options && args[i] === '-n') {
          const value = args[++i];
          if (!value || !/^\d+$/.test(value) || Number(value) > HEAD_LIMIT) fail(`head: -n expects an integer from 0 to ${HEAD_LIMIT}`);
          count = Number(value);
        } else if (options && args[i].startsWith('-')) fail(`head: unknown option ${args[i]}`);
        else paths.push(args[i]);
      }
      expectArgs(paths, 0, 1, 'head [-n N] [file]');
      const readSource = source(paths, command);
      return pure((stdin) => readSource(stdin).slice(0, count));
    }
    case 'wc': {
      const parsed = positional(args, ['l'], command);
      expectArgs(parsed.rest, 0, 1, 'wc [-l] [file]');
      const readSource = source(parsed.rest, command);
      return pure((stdin) => {
        const lines = readSource(stdin);
        const text = lines.map((line) => line.text).join('\n') + (lines.length ? '\n' : '');
        const counts = parsed.flags.has('l') ? `${lines.length}`
          : `${lines.length} ${text.match(/\S+/g)?.length ?? 0} ${Array.from(text).length}`;
        return [{ text: counts + (parsed.rest.length ? ` ${parsed.rest[0]}` : '') }];
      });
    }
    case 'echo':
      return pure(() => [{ text: args.join(' ') }]);
    case 'theme': {
      expectArgs(args, 0, 1, 'theme dark|light|amber');
      if (args.length && !THEMES.includes(args[0] as Theme)) fail('theme: expected dark, light, or amber');
      const theme = (args[0] ?? state.theme) as Theme;
      return { pure: false, run: () => result([{ text: `theme: ${theme}`, tone: 'accent' }], { ...state, theme }) };
    }
    case 'motion': {
      expectArgs(args, 0, 1, 'motion on|off');
      if (args.length && args[0] !== 'on' && args[0] !== 'off') fail('motion: expected on or off');
      const motion = args.length ? args[0] === 'on' : state.motion;
      return { pure: false, run: () => result([{ text: `motion: ${motion ? 'on' : 'off'}`, tone: 'accent' }], { ...state, motion }) };
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
  try {
    if (input.length > INPUT_LIMIT) fail(`input: maximum length is ${INPUT_LIMIT} characters`);
    const stages = tokenize(input);
    if (stages.length === 1 && !stages[0].length) return { lines: [], state: original };
    const fs = fileSystem();
    const plans = stages.map((tokens, index) => prepare(tokens.map((token) => token.value), original, fs, index > 0));
    if (plans.length > 1 && plans.some((plan) => !plan.pure)) fail('pipeline: only text-producing commands are allowed; state and display commands must run on their own');
    let output: ShellResult = { lines: [], state: original };
    plans.forEach((plan, index) => { output = plan.run(index ? output.lines : undefined); });
    return output;
  } catch (error) {
    if (!(error instanceof ShellError)) throw error;
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
  const directory = fs.get(normalizePath(directoryPart || '.', cwd));
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
  if (!before.length) candidates = COMMANDS.filter((command) => command.startsWith(prefix));
  else {
    const command = before[0].value;
    const args = before.slice(1).map((token) => token.value);
    if (!COMMAND_SET.has(command)) return unchanged;
    if (command === 'theme' && !args.length) candidates = THEMES.filter((value) => value.startsWith(prefix));
    else if (command === 'motion' && !args.length) candidates = ['off', 'on'].filter((value) => value.startsWith(prefix));
    else if (command === 'ascii' && !args.length) candidates = ASCII_MODES.filter((value) => value.startsWith(prefix));
    else if (command === 'sudo' && args.length < 2) candidates = (args.length ? args[0] === 'make' ? ['coffee'] : [] : ['make']).filter((value) => value.startsWith(prefix));
    else if (command === 'head' && args[args.length - 1] === '-n') candidates = ['5', '10', '20'].filter((value) => value.startsWith(prefix));
    else if (prefix.startsWith('-') && !args.includes('--')) {
      const options: Record<string, string[]> = { ls: ['-a', '-l', '-al'], grep: ['-i'], head: ['-n'], wc: ['-l'] };
      candidates = (Object.hasOwn(options, command) ? options[command] : []).filter((value) => value.startsWith(prefix));
    } else if (['ls', 'cd', 'cat', 'tree', 'find', 'grep', 'head', 'wc', 'open'].includes(command)) {
      // The first positional argument of grep is a text pattern, not a filename.
      const grepArgs = args.filter((arg) => arg !== '-i' && arg !== '--');
      if (command !== 'grep' || grepArgs.length > 0) {
        candidates = pathCandidates(prefix, normalizePath(state.cwd, '/'), fileSystem(), command === 'cd');
        if (command === 'open' && !args.length && !prefix.includes('/')) {
          candidates.push(...[...posts.map(post => post.id), ...projectFiles.map(file => basename(file.path).replace(/\.md$/, ''))].filter(id => id.startsWith(prefix)));
        }
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
