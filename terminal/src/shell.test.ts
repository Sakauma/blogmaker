import assert from 'node:assert/strict';
import test from 'node:test';
import { manifest, profile, files, posts, routes, projectFiles, routeFor, hrefForCommand, hrefForFile } from './content';
import { basename, directoryNames, fileLines, fileText, legacySourceFilenames, originalTextRuns, preformattedPoems, quote, sortedPostNames, sortedProjectNames, sourcePosts } from '../tests/content-fixtures';
import { completeCommand, runCommand } from './shell';
import type { ShellResult, ShellState } from './shell';

const initial: ShellState = { cwd: '/', theme: 'dark', motion: true };
const run = (input: string, state: ShellState = initial) => runCommand(input, state);
const texts = (result: ShellResult) => result.lines.map((line) => line.text);
const expectError = (input: string, pattern: RegExp, state = initial) => {
  const result = run(input, state);
  assert.equal(result.lines.length, 1, 'an error must replace any partial output');
  assert.equal(result.lines[0].tone, 'error');
  assert.match(result.lines[0].text, pattern);
  assert.deepEqual(result.state, state);
  assert.equal(result.effect, undefined);
  assert.equal(result.file, undefined);
  return result;
};

test('blank input is a no-op and never returns the caller state by reference', () => {
  const result = run('   \t ');
  assert.deepEqual(result, { lines: [], state: initial });
  assert.notEqual(result.state, initial);
});

test('pwd reports the absolute website root', () => {
  assert.deepEqual(texts(run('pwd')), ['/']);
});

test('root listing contains the actual manifest files and directories', () => {
  assert.deepEqual(texts(run('ls')), directoryNames('/'));
  for (const entry of ['README.md', 'about.txt', 'contact.txt', 'assets.md', 'archives/', 'categories/', 'lab/', 'posts/', 'projects/', 'tags/']) {
    assert.ok(texts(run('ls')).includes(entry), `missing root entry: ${entry}`);
  }
});

test('listing lines contain usable cd/cat commands and directory tones', () => {
  const result = run('ls');
  assert.deepEqual(result.lines.find((line) => line.text === 'projects/'), {
    text: 'projects/', tone: 'directory', command: 'cd /projects',
  });
  assert.deepEqual(result.lines.find((line) => line.text === 'about.txt'), {
    text: 'about.txt', tone: 'plain', command: 'cat /about.txt',
  });
});

test('ls -al includes dot entries and read-only permissions', () => {
  const result = run('ls -al posts');
  assert.deepEqual(texts(result).slice(0, 2), ['dr-xr-xr-x  .', 'dr-xr-xr-x  ..']);
  assert.equal(result.lines[0].command, 'cd /posts');
  assert.equal(result.lines[1].command, 'cd /');
  assert.deepEqual(texts(result).slice(2), directoryNames('/posts').map((name) => `-r--r--r--  ${name}`));
  expectError('ls -z', /unknown option/);
});

test('cd supports relative paths, parent segments, duplicate slashes and dot segments', () => {
  const state = run('cd projects').state;
  assert.equal(state.cwd, '/projects');
  const next = run('cd ../posts//./', state);
  assert.equal(next.state.cwd, '/posts');
  assert.deepEqual(texts(run('pwd', next.state)), ['/posts']);
  assert.equal(run('cd ../../../../', next.state).state.cwd, '/');
});

test('tilde and slash always resolve to the website root', () => {
  const state = { ...initial, cwd: '/projects' };
  for (const command of ['cd ~', 'cd /', 'cd']) assert.equal(run(command, state).state.cwd, '/');
  assert.equal(run('cd ~/posts', state).state.cwd, '/posts');
  assert.deepEqual(texts(run('ls ~/lab', state)), directoryNames('/lab'));
});

test('invalid cd paths and files leave state unchanged', () => {
  expectError('cd nowhere', /no such file or directory/);
  expectError('cd about.txt', /not a directory/);
  expectError('cd / notes', /usage/);
});

test('relative cat reads both real project files including every final line', () => {
  assert.deepEqual(sortedProjectNames(), ['blogmaker.md', 'homepage.md']);
  for (const project of projectFiles) {
    const result = run(`cat ${quote(basename(project.path))}`, { ...initial, cwd: '/projects' });
    assert.deepEqual(texts(result), fileLines(project.path));
    assert.ok(result.lines.length > 3, 'the article must not collapse to its summary');
  }
});

test('all published sources retain metadata, full prose and routes, including the 70 legacy posts', () => {
  assert.ok(sourcePosts.length >= legacySourceFilenames.length);
  for (const filename of legacySourceFilenames) {
    const legacy = sourcePosts.find((source) => source.filename === filename);
    assert.ok(legacy, `the migration baseline remains published: ${filename}`);
    assert.ok(legacy.historicalUpdated, `the original update evidence remains present: ${filename}`);
  }
  assert.equal(manifest.posts.length, sourcePosts.length);
  assert.equal(posts.length, sourcePosts.length);
  assert.equal(new Set(posts.map((post) => post.file)).size, posts.length);
  assert.equal(new Set(posts.map((post) => post.path)).size, posts.length);
  for (const source of sourcePosts) {
    const post = posts.find((entry) => entry.file === `/posts/${source.filename}`);
    assert.ok(post, `source is represented: ${source.filename}`);
    assert.equal(post.title, source.title);
    assert.equal(post.date, source.date);
    assert.equal(post.updated, source.updated ?? source.historicalUpdated ?? source.date);
    assert.equal(post.path, source.path);
    assert.deepEqual(post.tags, source.tags);
    assert.equal(post.category ?? '', source.category ?? '');
    const route = routes[source.path];
    assert.ok(route, `legacy route is present: ${source.path}`);
    assert.equal(route.title, source.title);
    const result = run(route.command);
    assert.deepEqual(texts(result), fileLines(post.file), `complete route output: ${source.filename}`);
    assert.deepEqual(texts(run(`cat ${quote(post.file)}`)), fileLines(post.file));
    const corpus = fileText(post.file).replace(/\s+/g, ' ');
    let cursor = 0;
    const runs = originalTextRuns(source);
    assert.ok(runs.length > 0, `source has prose: ${source.filename}`);
    for (const text of runs) {
      const normalized = text.replace(/\s+/g, ' ');
      const position = corpus.indexOf(normalized, cursor);
      assert.ok(position >= cursor, `missing/out-of-order original text in ${source.filename}: ${text}`);
      cursor = position + normalized.length;
    }
  }
});

test('published Unicode, encoded and index.html URL forms resolve to the same complete post', () => {
  for (const post of posts) {
    for (const path of [post.path, encodeURI(post.path), `${post.path}index.html`, post.path.slice(0, -1)]) {
      assert.deepEqual(routeFor(path), routes[post.path], path);
    }
    const href = hrefForCommand(routes[post.path].command);
    assert.ok(href);
    assert.deepEqual(routeFor(href), routes[post.path]);
  }
  assert.equal(routeFor('/%E0%A4%A/'), undefined);
  assert.equal(routeFor('/missing-legacy-post/'), undefined);
});

test('successful single-file cat and open return the canonical VFS file across relative and quoted paths', () => {
  const post = posts[0];
  const cases: Array<[string, ShellState]> = [
    [`cat ${quote(basename(post.file))}`, { ...initial, cwd: '/posts' }],
    [`cat ${quote(`..${post.file}`)}`, { ...initial, cwd: '/projects' }],
    [`cat ${quote(`~${post.file}`)}`, { ...initial, cwd: '/tags' }],
    [`cat -- "${post.file.replace('/posts/', '/posts/../posts/')}"`, initial],
    [`open ${quote(post.id)}`, { ...initial, cwd: '/projects' }],
    [`open ${quote(post.path)}`, initial],
  ];
  for (const [command, state] of cases) {
    const result = run(command, state);
    assert.equal(result.file, post.file, command);
    assert.deepEqual(texts(result), fileLines(post.file), command);
    assert.equal(hrefForFile(result.file!), post.path);
  }
  assert.equal(run('about').file, '/about.txt');
  assert.equal(run('open blogmaker').file, '/projects/blogmaker.md');
});

test('filters, multi-file reads and stdin cat do not label ordinary output as a whole file', () => {
  const post = posts[0];
  for (const command of [
    `cat ${quote(post.file)} | head -n 2`,
    `cat ${quote(post.file)} | grep ${quote(post.date)}`,
    'cat contact.txt about.txt', 'echo body | cat', 'head about.txt',
  ]) {
    const result = run(command);
    assert.ok(!result.lines.some((line) => line.tone === 'error'), command);
    assert.equal(result.file, undefined, command);
  }
});

test('original preformatted poems retain line breaks and leading indentation', () => {
  const poems = sourcePosts.flatMap((source) => preformattedPoems(source).map((poem) => ({ source, poem })));
  assert.ok(poems.length > 0, 'use real source poems, not an empty fixture loop');
  for (const { source, poem } of poems) {
    const body = texts(run(`cat ${quote(`/posts/${source.filename}`)}`)).join('\n');
    assert.ok(body.includes(poem.replace(/\n$/, '')), `original poem whitespace: ${source.filename}`);
  }
});

test('about and contact expose the original author and actual profile values', () => {
  assert.equal(profile.email, 'ajax_mao@163.com');
  assert.equal(profile.github, 'https://github.com/Sakauma');
  assert.equal(profile.bilibili, 'https://space.bilibili.com/9348725');
  assert.deepEqual(texts(run('cat about.txt')), fileLines('/about.txt'));
  assert.deepEqual(texts(run('cat contact.txt')), fileLines('/contact.txt'));
  for (const value of [profile.email, profile.github, profile.bilibili]) {
    assert.ok(fileText('/contact.txt').includes(value), value);
  }
  assert.ok(fileText('/about.txt').includes('在精神上感染了艾滋病'));
  const home = files.filter((file) => !file.path.startsWith('/posts/')).map((file) => file.text).join('\n');
  assert.doesNotMatch(home, /mindspace|motion-design|orbit\.sh|visitor@orbit|a corner of the internet/i);
});

test('cat accepts multiple files in input order', () => {
  assert.deepEqual(texts(run('cat contact.txt lab/README.txt')), [
    ...fileLines('/contact.txt'), ...fileLines('/lab/README.txt'),
  ]);
});

test('failed multi-file cat emits only the error, without the earlier file', () => {
  expectError('cat contact.txt missing.txt', /no such file or directory/);
  expectError('cat /projects', /is a directory/);
  expectError('cat /about.txt/', /not a directory/);
});

test('tree renders every real post with navigation metadata', () => {
  const names = directoryNames('/posts');
  const result = run('tree /posts');
  assert.deepEqual(texts(result), ['posts', ...names.map((name, index) => `${index === names.length - 1 ? '└──' : '├──'} ${name}`)]);
  assert.equal(result.lines[0].command, 'cd /posts');
  result.lines.slice(1).forEach((line, index) => {
    assert.ok(line.command);
    assert.deepEqual(texts(run(line.command)), fileLines(`/posts/${names[index]}`));
  });
});

test('find reports simple absolute paths from a relative directory', () => {
  assert.deepEqual(texts(run('find ../lab', { ...initial, cwd: '/posts' })), ['/lab', ...directoryNames('/lab').map((name) => `/lab/${name}`)]);
  assert.deepEqual(texts(run('find /contact.txt')), ['/contact.txt']);
});

test('multi-stage listing pipelines filter filenames and count the output', () => {
  const name = sortedPostNames()[0];
  assert.deepEqual(texts(run(`ls posts | grep -F ${quote(name)}`)), [name]);
  assert.deepEqual(texts(run(`ls posts | grep -F ${quote(name)} | wc -l`)), ['1']);
  assert.deepEqual(texts(run('ls posts | head -n 2 | wc -l')), ['2']);
  assert.deepEqual(texts(run('ls posts | wc -l')), [String(directoryNames('/posts').length)]);
  assert.deepEqual(texts(run('posts | wc -l')), [String(posts.length)]);
});

test('cat pipelines preserve full text then take the requested lines', () => {
  assert.deepEqual(texts(run('cat projects/blogmaker.md | head -n 3')), fileLines('/projects/blogmaker.md').slice(0, 3));
  assert.deepEqual(texts(run('cat contact.txt | cat | wc -l')), [String(fileLines('/contact.txt').length)]);
});

test('quoted and escaped pipes remain text instead of operators', () => {
  assert.deepEqual(texts(run('echo "alpha|beta" | grep -F "|"')), ['alpha|beta']);
  assert.deepEqual(texts(run("echo 'left | right'")), ['left | right']);
  assert.deepEqual(texts(run('echo a\\|b')), ['a|b']);
});

test('tokenizer preserves escaped spaces, quotes and adjacent quoted fragments', () => {
  assert.deepEqual(texts(run('echo hello\\ world "say \\"hi\\""')), ['hello world say "hi"']);
  assert.deepEqual(texts(run("echo pre'quoted value'post")), ['prequoted valuepost']);
  assert.deepEqual(texts(run("echo '' x")), [' x']);
  assert.deepEqual(texts(run("echo 'C:\\notes'")), ['C:\\notes']);
});

test('unfinished quotes and escapes are explicit errors with no effect', () => {
  expectError('theme "light', /unclosed double quote/);
  expectError("ascii 'matrix", /unclosed single quote/);
  expectError('clear \\', /unfinished escape/);
});

test('empty pipeline stages and double pipes are explicit syntax errors', () => {
  for (const input of ['| pwd', 'pwd |', 'pwd || wc', 'pwd | | head']) expectError(input, /empty pipeline command/);
});

test('state-changing commands are rejected anywhere in a pipeline atomically', () => {
  const state: ShellState = { cwd: '/posts', theme: 'dark', motion: true };
  const snapshot = { ...state };
  for (const input of ['theme light | wc', 'echo x | motion off', 'cd / | pwd', 'echo x | theme amber | wc']) {
    expectError(input, /only text-producing commands/, state);
    assert.deepEqual(state, snapshot);
  }
});

test('screen effects never execute when mixed into pipelines', () => {
  for (const input of ['clear | wc', 'pwd | history', 'ascii donut | wc', 'echo x | matrix', 'banner | head']) {
    expectError(input, /only text-producing commands/);
  }
});

test('a later invalid stage prevents partial output and effects', () => {
  expectError('echo visible | missing-command', /command not found/);
  expectError('clear | cat missing.txt', /no such file or directory/);
  expectError('theme light | head -n 9001 about.txt', /integer from 0 to 1000/);
});

test('grep -F is literal, optionally case-insensitive, and has a consistent empty result', () => {
  assert.deepEqual(texts(run('echo Aa.Bb | grep -iF aa.b')), ['Aa.Bb']);
  assert.deepEqual(texts(run('echo abc | grep -F a.c')), []);
  assert.deepEqual(texts(run('ls posts | grep nonexistent | wc -l')), ['0']);
  assert.deepEqual(texts(run('echo test | grep ""')), ['test']);
  assert.deepEqual(texts(run('echo -x | grep -- -x')), ['-x']);
});

test('grep can read a file and rejects missing patterns and sources', () => {
  assert.deepEqual(texts(run('grep ASCII /lab/README.txt')), fileLines('/lab/README.txt').filter((line) => line.includes('ASCII')));
  expectError('grep', /usage/);
  expectError('grep words', /expected a file or piped input/);
  expectError('grep -z words about.txt', /unknown option/);
});

test('head defaults to ten lines and accepts bounded nonnegative counts', () => {
  assert.deepEqual(texts(run('head /lab/README.txt')), fileLines('/lab/README.txt').slice(0, 10));
  assert.deepEqual(texts(run('head -n 1 lab/README.txt')), fileLines('/lab/README.txt').slice(0, 1));
  assert.deepEqual(texts(run('echo a | head -n 0')), []);
  assert.deepEqual(texts(run('echo a | head -n 1000')), ['a']);
  for (const count of ['-1', '1.5', 'NaN', 'Infinity', '1001', '999999999999999999999']) {
    expectError(`head -n ${count} about.txt`, /integer from 0 to 1000/);
  }
  expectError('head -n', /integer from 0 to 1000/);
});

test('wc returns understandable line, word and UTF-8 byte counts', () => {
  assert.deepEqual(texts(run('echo alpha beta | wc')), ['1 2 11']);
  assert.deepEqual(texts(run('echo "你好 ☕" | wc')), ['1 2 11']);
  assert.deepEqual(texts(run('wc -l /contact.txt')), [`${fileLines('/contact.txt').length} /contact.txt`]);
  assert.deepEqual(texts(run('echo one | grep absent | wc')), ['0 0 0']);
});

test('HTML, substitutions and command delimiters stay inert plain text', () => {
  const html = '<img src=x onerror=alert(1)>';
  const result = run(`echo '${html}'`);
  assert.deepEqual(result.lines, [{ text: html }]);
  assert.deepEqual(texts(run('echo $(whoami) ; theme light && clear')), ['$(whoami) ; theme light && clear']);
  assert.deepEqual(result.state, initial);
  assert.equal(result.effect, undefined);
  expectError('clear; pwd', /command not found/);
});

test('prototype property names are never treated as commands or files', () => {
  for (const name of ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
    expectError(name, /command not found/);
    expectError(`cat ${name}`, /no such file or directory/);
    assert.deepEqual(completeCommand(`${name} `, initial), { value: `${name} `, candidates: [] });
  }
});

test('theme changes return a new state and no UI effect', () => {
  for (const theme of ['dark', 'light', 'amber'] as const) {
    const result = run(`theme ${theme}`);
    assert.deepEqual(result.state, { cwd: '/', theme, motion: true });
    assert.deepEqual(texts(result), [`theme: ${theme}`]);
    assert.equal(result.effect, undefined);
  }
  assert.equal(initial.theme, 'dark');
  expectError('theme neon', /expected dark, light, or amber/);
  expectError('theme light extra', /usage/);
});

test('motion updates preserve cwd and theme, without mutating the input', () => {
  const state: ShellState = { cwd: '/lab', theme: 'amber', motion: true };
  const result = run('motion off', state);
  assert.deepEqual(result.state, { cwd: '/lab', theme: 'amber', motion: false });
  assert.deepEqual(texts(result), ['motion: off']);
  assert.equal(result.effect, undefined);
  assert.equal(state.motion, true);
  assert.equal(run('motion on', result.state).state.motion, true);
  expectError('motion maybe', /expected on or off/);
});

test('screen commands expose the exact effect contract', () => {
  const commands = [
    ['clear', { type: 'clear' }], ['history', { type: 'history' }],
    ['banner', { type: 'banner' }], ['neofetch', { type: 'banner' }],
    ['ascii', { type: 'ascii', mode: 'donut' }], ['ascii donut', { type: 'ascii', mode: 'donut' }],
    ['ascii matrix', { type: 'ascii', mode: 'matrix' }], ['matrix', { type: 'ascii', mode: 'matrix' }],
    ['ascii off', { type: 'ascii', mode: 'off' }],
  ] as const;
  for (const [command, effect] of commands) {
    const result = run(command);
    assert.deepEqual(result, { lines: [], state: initial, effect });
  }
  expectError('ascii unknown', /expected donut, matrix, or off/);
  expectError('clear later', /usage/);
  expectError('history 2', /usage/);
});

test('identity, ISO date, coffee aliases and content shortcuts are available', () => {
  assert.deepEqual(texts(run('whoami')), ['visitor']);
  assert.match(texts(run('date'))[0], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.deepEqual(texts(run('coffee')), ['[coffee] A fresh cup. Take a breath.']);
  assert.deepEqual(texts(run('sudo make coffee')), ['[coffee] A fresh cup. Take a breath.']);
  assert.deepEqual(texts(run('projects')), sortedProjectNames());
  const listing = run('posts');
  assert.equal(listing.lines.length, posts.length);
  posts.forEach((post, index) => {
    assert.ok(listing.lines[index].text.includes(post.title));
    assert.ok(listing.lines[index].text.includes(post.date));
    assert.ok(listing.lines[index].command);
    assert.deepEqual(texts(run(listing.lines[index].command!)), fileLines(post.file));
  });
  assert.deepEqual(run('notes'), listing);
  for (const command of ['tags', 'archives', 'categories']) {
    assert.deepEqual(texts(run(command)), directoryNames(`/${command}`));
  }
  assert.deepEqual(texts(run('about')), fileLines('/about.txt'));
  assert.deepEqual(texts(run('open blogmaker')), fileLines('/projects/blogmaker.md'));
  for (const post of posts) assert.deepEqual(texts(run(`open ${quote(post.id)}`)), fileLines(post.file));
  expectError('sudo rm -rf /', /available command/);
});

test('input length is capped at 4096 characters without side effects', () => {
  assert.equal(run('echo ' + 'x'.repeat(4091)).lines[0].text.length, 4091);
  expectError('echo ' + 'x'.repeat(4092), /maximum length is 4096/);
  const input = 'x'.repeat(4097);
  assert.deepEqual(completeCommand(input, initial), { value: input, candidates: [] });
});

test('completion expands a unique command and preserves leading spaces', () => {
  assert.deepEqual(completeCommand('hel', initial), { value: 'help ', candidates: ['help'] });
  assert.equal(completeCommand('   hel', initial).value, '   help ');
  assert.deepEqual(completeCommand('he', initial), { value: 'he', candidates: ['head', 'help'] });
  assert.equal(completeCommand('help', initial).value, 'help ');
});

test('file completion matches a real project and trailing space', () => {
  assert.deepEqual(completeCommand('cat projects/bl', initial), {
    value: 'cat projects/blogmaker.md ', candidates: ['projects/blogmaker.md'],
  });
});

test('directory completion appends slash, while cd excludes regular files', () => {
  assert.deepEqual(completeCommand('cd pro', initial), { value: 'cd projects/', candidates: ['projects/'] });
  assert.deepEqual(completeCommand('cd about', initial), { value: 'cd about', candidates: [] });
  assert.deepEqual(completeCommand('cat lab/', initial), { value: 'cat lab/README.txt ', candidates: ['lab/README.txt'] });
});

test('completion resolves the current cwd and parent-relative paths', () => {
  const state = { ...initial, cwd: '/posts' };
  const name = sortedPostNames()[0];
  assert.equal(completeCommand(`cat ${name.slice(0, -3)}`, state).value, `cat ${name} `);
  assert.equal(completeCommand('cat ../projects/bl', state).value, 'cat ../projects/blogmaker.md ');
  assert.equal(completeCommand('cd ../pro', state).value, 'cd ../projects/');
  assert.equal(completeCommand('cat ~/contact', state).value, 'cat ~/contact.txt ');
});

test('completion preserves quotes and whitespace around the token', () => {
  assert.equal(completeCommand('cat  "projects/bl', initial).value, 'cat  "projects/blogmaker.md" ');
  assert.equal(completeCommand("cat 'projects/bl", initial).value, "cat 'projects/blogmaker.md' ");
  assert.equal(completeCommand('cat "projects/bl"', initial).value, 'cat "projects/blogmaker.md" ');
  assert.equal(completeCommand('cat "pro', initial).value, 'cat "projects/');
});

test('completion expands parameter values and flags', () => {
  assert.equal(completeCommand('theme l', initial).value, 'theme light ');
  assert.equal(completeCommand('motion of', initial).value, 'motion off ');
  assert.equal(completeCommand('ascii d', initial).value, 'ascii donut ');
  assert.equal(completeCommand('ls -a', initial).value, 'ls -a');
  assert.deepEqual(completeCommand('ls -a', initial).candidates, ['-a', '-al']);
  assert.equal(completeCommand('head -n 1', initial).value, 'head -n 10 ');
  assert.equal(completeCommand('sudo make c', initial).value, 'sudo make coffee ');
});

test('completion works after a pipe without touching preceding tokens', () => {
  assert.equal(completeCommand('echo "a|b" | hel', initial).value, 'echo "a|b" | help ');
  assert.equal(completeCommand('ls posts | grep 2026 | w', initial).value, 'ls posts | grep 2026 | w');
  assert.deepEqual(completeCommand('ls posts | grep 2026 | w', initial).candidates, ['wc', 'whoami']);
  const name = sortedPostNames()[0];
  assert.equal(completeCommand(`grep -i 2026 posts/${name.slice(0, -3)}`, initial).value, `grep -i 2026 posts/${name} `);
});

test('ambiguous completion exposes candidates and preserves input until a common prefix exists', () => {
  const result = completeCommand('cat projects/', initial);
  assert.deepEqual(result, { value: 'cat projects/', candidates: sortedProjectNames().map((name) => `projects/${name}`) });
  assert.equal(completeCommand('cd ~', initial).value, 'cd ~/');
  assert.equal(completeCommand('cd ..', initial).value, 'cd ../');
  assert.deepEqual(completeCommand('cat missing/', initial), { value: 'cat missing/', candidates: [] });
});

test('search finds original body text, preserves Unicode and returns usable post commands', () => {
  const needles = ['Хорошенькие шуточки', '沉默地祈祷', 'Шарфóм'];
  for (const needle of needles) {
    const expected = posts.filter((post) => fileText(post.file).toLocaleLowerCase().includes(needle.toLocaleLowerCase()));
    assert.ok(expected.length > 0, `the search phrase exists in original prose: ${needle}`);
    const result = run(`search ${quote(needle)}`);
    assert.ok(!result.lines.some((line) => line.tone === 'error'));
    for (const post of expected) {
      assert.ok(result.lines.some((line) => line.text.includes(post.title)), `search finds ${post.title}`);
      assert.ok(result.lines.some((line) => line.command && texts(run(line.command)).join('\n') === fileLines(post.file).join('\n')), `search opens ${post.file}`);
    }
    assert.deepEqual(texts(run(`search ${quote(needle)} | wc -l`)), [String(result.lines.length)]);
  }
  expectError('search', /usage/);
});

test('only real file lines carry link markup permission; echo and errors remain plain text', () => {
  const content = run('cat /contact.txt');
  assert.ok(content.lines.length > 0);
  assert.ok(content.lines.every((line) => line.markup === true));
  const literal = '[Sakauma](https://github.com/Sakauma)';
  assert.deepEqual(run(`echo ${quote(literal)}`).lines, [{ text: literal }]);
  assert.ok(expectError(`ghost ${quote(literal)}`, /command not found/).lines.every((line) => !line.markup));
});

test('head short counts and tail defaults select real article lines without changing metadata', () => {
  const post = posts.find(post => fileLines(post.file).length > 20)!;
  assert.ok(post, 'exercise more than the default ten lines');
  const original = run(`cat ${quote(post.file)}`).lines;
  assert.deepEqual(run(`head -3 ${quote(post.file)}`).lines, original.slice(0, 3));
  assert.deepEqual(run(`tail ${quote(post.file)}`).lines, original.slice(-10));
  assert.deepEqual(run(`tail -n 3 ${quote(post.file)}`).lines, original.slice(-3));
  assert.deepEqual(run(`tail -3 ${quote(post.file)}`).lines, original.slice(-3));
  assert.deepEqual(run(`tail +3 ${quote(post.file)}`).lines, original.slice(2));
  assert.deepEqual(run(`tail -n +3 ${quote(post.file)}`).lines, original.slice(2));
  for (const count of ['+0', '+1', '-9007199254740991']) {
    assert.deepEqual(run(`tail ${count} ${quote(post.file)}`).lines, original);
  }
  assert.deepEqual(run(`tail +9007199254740991 ${quote(post.file)}`).lines, []);
});

test('head and tail handle zero, empty stdin and a single empty line', () => {
  for (const command of ['head', 'tail']) {
    for (const count of ['-0', '-n 0']) assert.deepEqual(run(`cat contact.txt | ${command} ${count}`).lines, []);
    assert.deepEqual(run(`echo value | grep absent | ${command}`).lines, []);
    assert.deepEqual(run(`echo '' | ${command} -1`).lines, [{ text: '' }]);
    assert.deepEqual(run(`echo value | ${command}`).lines, [{ text: 'value' }]);
    expectError(command, /expected a file or piped input/);
    expectError(`${command} -z contact.txt`, /unknown option/);
    expectError(`${command} /posts`, /is a directory/);
    expectError(`${command} contact.txt/`, /not a directory/);
  }
  expectError('head -1001 contact.txt', /integer from 0 to 1000/);
  for (const count of ['-1', '1.5', 'NaN', 'Infinity', '+1.5', '9007199254740992']) {
    expectError(`tail -n ${count} contact.txt`, /nonnegative safe integer/);
  }
  expectError('tail -n', /nonnegative safe integer/);
  expectError('tail +no contact.txt', /nonnegative safe integer/);
});

test('head and tail apply their count separately to multiple files with standard headers', () => {
  for (const command of ['head', 'tail']) {
    const select = (path: string) => command === 'head' ? fileLines(path).slice(0, 2) : fileLines(path).slice(-2);
    assert.deepEqual(texts(run(`${command} -2 contact.txt lab/README.txt`)), [
      '==> contact.txt <==', ...select('/contact.txt'), '', '==> lab/README.txt <==', ...select('/lab/README.txt'),
    ]);
    assert.deepEqual(texts(run(`${command} -0 contact.txt lab/README.txt`)), [
      '==> contact.txt <==', '', '==> lab/README.txt <==',
    ]);
    expectError(`${command} contact.txt missing.txt`, /no such file or directory/);
    assert.equal(run(`${command} -1 -- contact.txt`).file, undefined);
  }
});

test('grep defaults to JavaScript regular expressions with anchors, alternatives and case folding', () => {
  assert.deepEqual(texts(run('echo abc | grep a.c')), ['abc']);
  assert.deepEqual(texts(run("echo AbC | grep -i '^a.c$'")), ['AbC']);
  assert.deepEqual(texts(run("echo xyz | grep '^(abc|xyz)$'")), ['xyz']);
  assert.deepEqual(texts(run("echo abcabc | grep '^abc$'")), []);
  assert.deepEqual(texts(run("echo 123 | grep '\\d{3}'")), ['123']);
  assert.deepEqual(texts(run("echo 你好 | grep '^你.$'")), ['你好']);
  assert.deepEqual(texts(run("echo '[' | grep -F '['")), ['[']);
  assert.deepEqual(texts(run("echo - | grep -")), ['-']);
  assert.deepEqual(texts(run("echo AbC | grep -Fi abc")), ['AbC']);
});

test('grep labels multiple file matches and preserves each source line markup', () => {
  const expected = ['contact.txt', 'lab/README.txt'].flatMap(path => fileLines(`/${path}`)
    .filter(line => line.length > 0).map(text => ({ text: `${path}:${text}`, markup: true })));
  assert.deepEqual(run("grep '.+' contact.txt lab/README.txt").lines, expected);
  assert.deepEqual(run("grep '^' contact.txt").lines, run('cat contact.txt').lines);
  assert.deepEqual(texts(run("grep '.+' contact.txt lab/README.txt | wc -l")), [String(expected.length)]);
  assert.equal(run("grep '.' contact.txt lab/README.txt").file, undefined);
  expectError("grep '.' contact.txt missing.txt", /no such file or directory/);
  expectError("grep '.' /posts", /is a directory/);
  expectError("grep '.' contact.txt/", /not a directory/);
  expectError('grep -Fi', /usage/);
  expectError('grep -ix x contact.txt', /unknown option/);
});

test('invalid grep regular expressions are explicit atomic errors in files and pipelines', () => {
  const state: ShellState = { cwd: '/projects', theme: 'amber', motion: false };
  for (const pattern of ['[', '(', '*', '[z-a]']) {
    expectError(`grep ${quote(pattern)} /contact.txt`, /grep: invalid regular expression/, state);
    expectError(`cat /contact.txt | grep ${quote(pattern)} | less`, /grep: invalid regular expression/, state);
    expectError(`theme light | grep ${quote(pattern)}`, /grep: invalid regular expression/, state);
  }
  assert.deepEqual(state, { cwd: '/projects', theme: 'amber', motion: false });
});

test('find combines basename globs and file types across roots in input order', () => {
  const expected = ['/projects', '/lab'].flatMap(root => files.filter(file => file.path.startsWith(`${root}/`))
    .map(file => file.path).sort());
  assert.deepEqual(texts(run('find /projects /lab -type f')), expected);
  assert.deepEqual(texts(run("find /projects /lab -name '*.md' -type f")), expected.filter(path => path.endsWith('.md')));
  assert.deepEqual(texts(run('find /projects /lab -type d')), ['/projects', '/lab']);
  assert.deepEqual(texts(run("find -name '*.md' -type f", { ...initial, cwd: '/projects' })), expected.filter(path => path.startsWith('/projects/')));
  assert.deepEqual(texts(run("find /contact.txt -type f -name 'contact.*'")), ['/contact.txt']);
  assert.deepEqual(texts(run('find /contact.txt -type d')), []);
  assert.deepEqual(texts(run("find / -type d -name /")), ['/']);
  assert.deepEqual(texts(run("find -- ../lab -name 'README.*'", { ...initial, cwd: '/projects' })), ['/lab/README.txt']);
});

test('find globs support question marks and bracket classes while keeping regex punctuation literal', () => {
  for (const pattern of ['??????.txt', '[R]EADME.t?t', '[!a-z]*.txt', '[A-Z]*.txt']) {
    assert.deepEqual(texts(run(`find /lab -name ${quote(pattern)} -type f`)), ['/lab/README.txt']);
  }
  for (const pattern of ['README+txt', 'README(txt)', '*.txt[', '[]]*', '[[]*']) {
    assert.deepEqual(texts(run(`find /lab -name ${quote(pattern)}`)), [], pattern);
  }
  assert.deepEqual(texts(run("find /lab -type f -name '*.txt' -name 'R*'")), ['/lab/README.txt']);
  assert.deepEqual(texts(run('find /lab -type f -type d')), []);
});

test('find validates every path and expression before producing navigable entries', () => {
  expectError('find /lab /missing', /no such file or directory/);
  expectError('find /contact.txt/', /not a directory/);
  expectError('find / -unknown', /unknown option/);
  expectError('find / -name', /expects a glob pattern/);
  expectError('find / -type', /expects f or d/);
  expectError('find / -type x', /expects f or d/);
  expectError('find / -type f /projects', /paths must precede filters/);
  expectError("find / -name '[z-a]'", /invalid glob/);
  const result = run('find /projects -type f');
  assert.ok(result.lines.length > 0);
  for (const line of result.lines) {
    assert.equal(line.tone, 'plain');
    assert.ok(line.command);
    assert.deepEqual(texts(run(line.command)), fileLines(line.text));
  }
});

test('wc selects and combines flags in canonical line word byte order', () => {
  const text = 'A😀é words';
  const bytes = Buffer.byteLength(`${text}\n`, 'utf8');
  const cases = new Map([
    ['-l', '1'], ['-w', '2'], ['-c', String(bytes)], ['-wl', '1 2'],
    ['-lc', `1 ${bytes}`], ['-c -w', `2 ${bytes}`], ['-cwl', `1 2 ${bytes}`], ['-ll', '1'],
  ]);
  for (const [flags, expected] of cases) assert.deepEqual(texts(run(`echo ${quote(text)} | wc ${flags}`)), [expected]);
  assert.deepEqual(texts(run('echo "你好 ☕" | wc -c')), ['11']);
  assert.deepEqual(texts(run('echo "A😀é" | wc -c')), ['9']);
  assert.deepEqual(texts(run("echo '' | wc")), ['1 0 1']);
  assert.deepEqual(texts(run('echo one | grep absent | wc -lwc')), ['0 0 0']);
  expectError('wc -m contact.txt', /unknown option/);
  expectError('wc', /expected a file or piped input/);
});

test('wc counts original UTF-8 file bytes and produces multi-file totals', () => {
  const paths = ['contact.txt', 'lab/README.txt'];
  const counts = paths.map(path => [fileLines(`/${path}`).length, fileText(`/${path}`).match(/\S+/g)?.length ?? 0, Buffer.byteLength(fileText(`/${path}`), 'utf8')]);
  const total = counts.reduce((sum, count) => sum.map((value, index) => value + count[index]), [0, 0, 0]);
  assert.deepEqual(texts(run(`wc ${paths.join(' ')}`)), [
    ...counts.map((count, index) => `${count.join(' ')} ${paths[index]}`), `${total.join(' ')} total`,
  ]);
  assert.deepEqual(texts(run(`wc -cw ${paths.join(' ')}`)), [
    ...counts.map((count, index) => `${count[1]} ${count[2]} ${paths[index]}`), `${total[1]} ${total[2]} total`,
  ]);
  assert.deepEqual(texts(run('wc -c -- contact.txt')), [`${counts[0][2]} contact.txt`]);
  for (const file of files) assert.deepEqual(texts(run(`wc -c ${quote(file.path)}`)), [`${Buffer.byteLength(file.text, 'utf8')} ${file.path}`]);
  expectError('wc contact.txt /missing', /no such file or directory/);
  expectError('wc -l /projects', /is a directory/);
  expectError('wc -c contact.txt/', /not a directory/);
});

test('home and exit reset cwd with one home effect and preserve preferences', () => {
  const state: ShellState = { cwd: '/projects', theme: 'amber', motion: false };
  for (const command of ['home', 'exit']) {
    const result = run(command, state);
    assert.deepEqual(result, { lines: [], state: { ...state, cwd: '/' }, effect: { type: 'home' } });
    assert.notEqual(result.state, state);
    expectError(`${command} extra`, /usage/, state);
    expectError(`${command} | pwd`, /only text-producing commands/, state);
    expectError(`echo content | ${command}`, /only text-producing commands/, state);
  }
  assert.deepEqual(state, { cwd: '/projects', theme: 'amber', motion: false });
});

test('more and less return full file lines with canonical labels and navigation paths', () => {
  const post = posts.reduce((longest, post) => fileText(post.file).length > fileText(longest.file).length ? post : longest);
  const expected = run(`cat ${quote(post.file)}`).lines;
  assert.ok(expected.length > 20, 'the pager receives an article longer than one page');
  const state: ShellState = { cwd: '/projects', theme: 'light', motion: false };
  for (const mode of ['more', 'less']) {
    const result = run(`${mode} ${quote(`../posts/../${post.file.slice(1)}`)}`, state);
    assert.deepEqual(result, { lines: expected, state, effect: { type: 'pager', mode, label: post.file }, file: post.file });
    assert.deepEqual(run(`${mode} -- ~/contact.txt`).lines, run('cat contact.txt').lines);
    expectError(mode, /expected a file or piped input/, state);
    expectError(`${mode} /contact.txt /about.txt`, /usage/, state);
    expectError(`${mode} -x /contact.txt`, /unknown option/, state);
    expectError(`${mode} /missing`, /no such file or directory/, state);
    expectError(`${mode} /posts`, /is a directory/, state);
    expectError(`${mode} /contact.txt/`, /not a directory/, state);
  }
});

test('a final pager receives all pipe lines including blank lines, markup and navigation commands', () => {
  for (const mode of ['more', 'less']) {
    for (const prefix of [
      'cat /contact.txt', 'cat /contact.txt /lab/README.txt',
      'ls /projects | grep -F .md | head -2 | tail -1',
      "find /projects -type f -name '*.md'", 'posts', 'echo value | grep absent', "echo ''",
    ]) {
      const expected = run(prefix).lines;
      const result = run(`${prefix} | ${mode}`);
      assert.deepEqual(result, { lines: expected, state: initial, effect: { type: 'pager', mode, label: 'stdin' } }, prefix);
    }
    const literal = '[raw](https://example.com)';
    assert.deepEqual(run(`echo ${quote(literal)} | ${mode}`).lines, [{ text: literal }]);
  }
});

test('pipelines never publish a file navigation path even if their final stage reads one', () => {
  for (const final of ['cat /contact.txt', 'about', 'open blogmaker', 'more /contact.txt', 'less /contact.txt']) {
    const result = run(`echo ignored | ${final}`);
    assert.ok(!result.lines.some(line => line.tone === 'error'), final);
    assert.equal(result.file, undefined, final);
    assert.deepEqual(result.lines, run(final).lines);
  }
});

test('pagers are allowed only as the last stage and all other display effects remain standalone', () => {
  const state: ShellState = { cwd: '/projects', theme: 'light', motion: false };
  for (const input of ['more /contact.txt | wc', 'cat /contact.txt | less | head', 'echo x | more | less']) {
    expectError(input, /more\/less must be the final command/, state);
  }
  for (const input of ['theme amber | less', 'cd / | more', 'home | less', 'exit | more', 'clear | less', 'history | more', 'ascii donut | less', 'motion on | less']) {
    expectError(input, /only text-producing commands/, state);
  }
});

test('whole-pipeline validation occurs before any earlier text command executes', t => {
  let calls = 0;
  t.mock.method(Date.prototype, 'toISOString', () => { calls++; return '2026-01-01T00:00:00.000Z'; });
  for (const [input, error] of [
    ['date | grep "[" | less', /invalid regular expression/],
    ['date | head /missing | more', /no such file or directory/],
    ['date | find /lab /missing', /no such file or directory/],
    ['date | more | wc', /must be the final command/],
    ['date | home', /only text-producing commands/],
    ['date | less -x', /unknown option/],
    ['date | tail -n 1.5', /nonnegative safe integer/],
  ] as const) expectError(input, error);
  assert.equal(calls, 0, 'even an earlier pure stage waits for full syntax/source validation');
  assert.deepEqual(texts(run('date | less')), ['2026-01-01T00:00:00.000Z']);
  assert.equal(calls, 1);
});

test('completion covers new commands, short counts, grep flags and find filter values', () => {
  for (const [prefix, command] of [['tai', 'tail'], ['hom', 'home'], ['exi', 'exit'], ['mor', 'more'], ['les', 'less']]) {
    assert.deepEqual(completeCommand(prefix, initial), { value: `${command} `, candidates: [command] });
  }
  for (const [input, value] of [
    ['head -2', 'head -20 '], ['tail -n 1', 'tail -n 10 '], ['tail -n +2', 'tail -n +20 '],
    ['tail +2', 'tail +20 '], ['grep -F', 'grep -F '], ['grep -iF', 'grep -iF '],
    ['find / -ty', 'find / -type '], ['find / -na', 'find / -name '],
    ['find -type f', 'find -type f '], ['find -name *.m', 'find -name *.md '],
    ['wc -c', 'wc -c '], ['wc -lc', 'wc -lc '],
  ]) assert.equal(completeCommand(input, initial).value, value, input);
  assert.deepEqual(completeCommand('find / -type ', initial).candidates, ['d', 'f']);
  assert.deepEqual(completeCommand('wc -w', initial).candidates, ['-w', '-wc']);
});

test('completion respects grep patterns, multi-file arguments, pager arity and pipeline tokens', () => {
  for (const command of ['head -2', 'tail -n 3', 'wc -lc', 'find', 'grep -iF text']) {
    assert.equal(completeCommand(`${command} /contact.txt pro`, initial).value, `${command} /contact.txt projects/`);
  }
  assert.deepEqual(completeCommand('grep -iF pro', initial), { value: 'grep -iF pro', candidates: [] });
  assert.deepEqual(completeCommand('grep -- pro', initial), { value: 'grep -- pro', candidates: [] });
  assert.equal(completeCommand('grep -- -i pro', initial).value, 'grep -- -i projects/');
  assert.deepEqual(completeCommand('grep text -i', initial).candidates, []);
  for (const command of ['more', 'less']) {
    assert.equal(completeCommand(`${command} "projects/bl`, initial).value, `${command} "projects/blogmaker.md" `);
    assert.deepEqual(completeCommand(`${command} /contact.txt `, initial).candidates, []);
  }
  assert.equal(completeCommand('ls / | grep -F .md | les', initial).value, 'ls / | grep -F .md | less ');
  assert.equal(completeCommand('cat about.txt | tail -n +2', initial).value, 'cat about.txt | tail -n +20 ');
  assert.deepEqual(completeCommand('home ', initial).candidates, []);
  assert.deepEqual(completeCommand('exit ', initial).candidates, []);
});

test('help documents regex grep, UTF-8 bytes, filters, documents and the final-pager contract', () => {
  const help = texts(run('help')).join('\n');
  for (const text of ['home · exit', 'more [file]', 'less [file]', '[-name GLOB]', '[-type f|d]', 'JS regex', '-F is literal', 'tail [-n N|-N|+N]', 'UTF-8 byte', './file.md · contact · readme', 'pager must finish a pipeline']) {
    assert.ok(help.includes(text), text);
  }
});

test('document paths execute with full text, a document effect and their canonical file', () => {
  const post = posts[0];
  const cases: Array<[string, string, ShellState]> = [
    ['contact.txt', '/contact.txt', initial],
    ['./README.md', '/README.md', initial],
    [post.file, post.file, initial],
    [basename(post.file), post.file, { cwd: '/posts', theme: 'amber', motion: false }],
    [`../posts/./${basename(post.file)}`, post.file, { cwd: '/projects', theme: 'light', motion: true }],
    [`~${post.file}`, post.file, { cwd: '/lab', theme: 'dark', motion: false }],
  ];
  for (const [command, file, state] of cases) {
    const result = run(quote(command), state);
    assert.deepEqual(result, { lines: run(`cat ${quote(file)}`).lines, state, effect: { type: 'document' }, file }, command);
    assert.notEqual(result.state, state);
  }
});

test('contact and readme aliases open documents while built-in names take precedence over directories', () => {
  for (const [command, file] of [['contact', '/contact.txt'], ['readme', '/README.md']]) {
    const state: ShellState = { cwd: '/posts', theme: 'amber', motion: false };
    assert.deepEqual(run(command, state), { lines: run(`cat ${file}`).lines, state, effect: { type: 'document' }, file });
    expectError(`${command} extra`, /usage/, state);
  }
  assert.deepEqual(texts(run('projects')), sortedProjectNames());
  assert.equal(run('projects').effect, undefined);
  assert.equal(run('about').effect, undefined);
  expectError('projects/', /is a directory/);
});

test('document validation rejects directories, nonexistent commands and extra arguments atomically', () => {
  for (const directory of ['/', './', '/projects', '~/lab/']) expectError(directory, /is a directory/);
  expectError('contact.txt/', /not a directory/);
  expectError('contact.txt extra', /usage/);
  expectError('README.md -n 1', /usage/);
  expectError('missing.md', /command not found/);
  expectError('/missing.md', /command not found/);
  expectError('echo visible | /missing.md | less', /command not found/);
  expectError('theme light | contact.txt', /only text-producing commands/);
});

test('documents are pure text at every pipeline position and keep a final pager effect', () => {
  const original = run('cat /contact.txt').lines;
  for (const command of ['contact.txt', '/contact.txt', '~/contact.txt', 'contact', 'readme']) {
    const expected = command === 'readme' ? run('cat /README.md').lines : original;
    assert.deepEqual(run(`${command} | cat`), { lines: expected, state: initial });
    assert.deepEqual(run(`echo ignored | ${command}`), { lines: expected, state: initial });
    assert.deepEqual(run(`echo ignored | ${command} | head -2`), { lines: expected.slice(0, 2), state: initial });
    assert.deepEqual(run(`${command} | less`), { lines: expected, state: initial, effect: { type: 'pager', mode: 'less', label: 'stdin' } });
    assert.deepEqual(run(`echo ignored | ${command} | more`), { lines: expected, state: initial, effect: { type: 'pager', mode: 'more', label: 'stdin' } });
  }
});

test('first-token completion includes executable documents and directories in the current cwd', () => {
  assert.deepEqual(completeCommand('README', initial), { value: 'README.md ', candidates: ['README.md'] });
  assert.equal(completeCommand('./contact', initial).value, './contact.txt ');
  assert.equal(completeCommand('~/projects/bl', initial).value, '~/projects/blogmaker.md ');
  assert.equal(completeCommand('"/projects/bl', initial).value, '"/projects/blogmaker.md" ');
  assert.equal(completeCommand('   /projects/bl', initial).value, '   /projects/blogmaker.md ');
  assert.equal(completeCommand('echo text | ./contact', initial).value, 'echo text | ./contact.txt ');
  assert.deepEqual(completeCommand('/pro', initial), { value: '/projects/', candidates: ['/projects/'] });
  assert.deepEqual(completeCommand('contact', initial).candidates, ['contact', 'contact.txt']);
  assert.deepEqual(completeCommand('pro', initial).candidates, ['projects', 'projects/']);
  assert.deepEqual(completeCommand('readm', initial), { value: 'readme ', candidates: ['readme'] });
  const post = posts[0];
  const name = basename(post.file);
  const state: ShellState = { cwd: '/posts', theme: 'light', motion: false };
  assert.equal(completeCommand(name.slice(0, -3), state).value, `${name} `);
  assert.equal(completeCommand('../projects/bl', state).value, '../projects/blogmaker.md ');
  assert.deepEqual(completeCommand('README.md ', initial).candidates, []);
});
