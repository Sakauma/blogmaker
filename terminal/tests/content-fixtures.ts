import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseFragment } from 'parse5';
import { marked } from 'marked';
import { parse } from 'yaml';
import { files, posts, projectFiles } from '../src/content';

export interface SourcePost {
  filename: string;
  title: string;
  date: string;
  updated?: string;
  path: string;
  tags: string[];
  category?: string;
  body: string;
  renderedBody: string;
  historicalUpdated?: string;
  format?: 'html' | 'markdown';
  draft?: boolean;
}

// Read the preserved author sources directly. No generator or shell helper is
// used to derive the expected metadata, original prose or preformatted poems.
export const legacySourceFilenames = Array.from({ length: 70 }, (_, index) =>
  `${String(index + 1).padStart(3, '0')}-2026-01-${index < 22 ? '21' : '22'}.md`);
const sourceDirectory = resolve(__dirname, '../../content/posts');
export const sourcePosts: SourcePost[] = readdirSync(sourceDirectory).filter((name) => name.endsWith('.md')).sort().flatMap((filename) => {
  const source = readFileSync(resolve(sourceDirectory, filename), 'utf8');
  const match = source.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?([\s\S]*)$/);
  assert.ok(match, `source front matter: ${filename}`);
  const metadata = parse(match[1]) as Omit<SourcePost, 'filename' | 'body' | 'renderedBody' | 'historicalUpdated'>;
  if (metadata.draft) return [];
  const snapshotPath = resolve(__dirname, `../../src/publish-snapshot${metadata.path}index.html`);
  const snapshot = existsSync(snapshotPath) ? readFileSync(snapshotPath, 'utf8') : '';
  const historicalUpdated = snapshot.match(/最近更新[：:]\s*(\d{4}-\d{2}-\d{2})/)?.[1];
  const body = match[2];
  const isHTML = metadata.format === 'html' || (!metadata.format && /^\s*</.test(body));
  const renderedBody = isHTML ? body : marked.parse(body, { gfm: true, async: false });
  return [{ ...metadata, tags: [...new Set(metadata.tags ?? [])], filename, body, renderedBody, historicalUpdated }];
});

export function fileText(path: string): string {
  const file = files.find((entry) => entry.path === path);
  assert.ok(file, `real manifest file exists: ${path}`);
  return file.text;
}
export const textLines = (text: string): string[] => text ? text.replace(/\n$/, '').split('\n') : [];
export const fileLines = (path: string): string[] => textLines(fileText(path));
export const quote = (text: string): string => `'${text.replace(/'/g, "'\\''")}'`;
export const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
export const sortedPostNames = (): string[] => posts.map((post) => basename(post.file)).sort();
export const sortedProjectNames = (): string[] => projectFiles.map((file) => basename(file.path)).sort();
export function directoryNames(directory: string): string[] {
  const prefix = directory === '/' ? '/' : `${directory}/`;
  return [...new Set(files.filter((file) => file.path.startsWith(prefix)).map((file) => {
    const relative = file.path.slice(prefix.length);
    return relative.includes('/') ? `${relative.split('/')[0]}/` : relative;
  }))].sort();
}

interface HTMLNode { nodeName: string; value?: string; childNodes?: HTMLNode[] }
function walkText(node: HTMLNode): string[] {
  if (node.nodeName === '#text') return node.value?.trim() ? [node.value.trim()] : [];
  return (node.childNodes ?? []).flatMap(walkText);
}
export const originalTextRuns = (post: SourcePost): string[] => walkText(parseFragment(post.renderedBody));
export function preformattedPoems(post: SourcePost): string[] {
  const result: string[] = [];
  const fullText = (node: HTMLNode): string => node.nodeName === '#text' ? node.value ?? '' : (node.childNodes ?? []).map(fullText).join('');
  const visit = (node: HTMLNode): void => {
    if (node.nodeName === 'pre') result.push(fullText(node));
    else node.childNodes?.forEach(visit);
  };
  visit(parseFragment(post.renderedBody));
  return result;
}

// Content links are displayed as their human-readable labels. Command echo and
// arbitrary echo output never use this transformation.
export const visibleContentLine = (line: string): string => line.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
export const visibleFileLines = (path: string): string[] => fileLines(path).map((line) => line ? visibleContentLine(line) : '\u00a0');
export function sourceForFile(path: string): SourcePost {
  const source = sourcePosts.find((post) => `/posts/${post.filename}` === path);
  assert.ok(source, `original source exists: ${path}`);
  return source;
}

export const chinesePost = posts.find((post) => post.file === '/posts/001-2026-01-21.md')!;
export const russianPost = posts.find((post) => post.file === '/posts/002-2026-01-21.md')!;
export const poemPost = posts.find((post) => post.file === '/posts/018-2026-01-21.md')!;
export const longestPost = [...posts].sort((a, b) => fileText(b.file).length - fileText(a.file).length)[0]!;
