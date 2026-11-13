import generated from './generated/content.json';

export interface ContentFile {
  path: string;
  text: string;
  attachment?: { mime: string; data: string };
}
export type VaultFile = ContentFile;
export interface Post {
  id: string;
  title: string;
  date: string;
  updated: string;
  path: string;
  file: string;
  tags: string[];
  category?: string;
}
export interface ContentRoute { title: string; command: string }
export interface SiteManifest {
  version: number;
  profile: {
    brand: string; name: string; role: string; email: string; github: string;
    bilibili: string; motto: string[]; interests: string; welcome: string; footer: string;
  };
  files: ContentFile[];
  posts: Post[];
  routes: Record<string, ContentRoute>;
  vault?: { url: string };
}
export const manifest = generated as SiteManifest;
export const { profile, posts, routes } = manifest;
const publicFiles = manifest.files;
export let files: readonly ContentFile[] = publicFiles;
export let projectFiles: readonly VaultFile[] = [];
let vaultUnlocked = false;
const filesChangeListeners = new Set<() => void>();

/** Invalidate derived caches immediately, including when locking without another command. */
export function onFilesChanged(listener: () => void): () => void {
  filesChangeListeners.add(listener);
  return () => { filesChangeListeners.delete(listener); };
}

export function isVaultUnlocked(): boolean { return vaultUnlocked; }

function validBase64(data: string): boolean {
  // A flat character scan avoids the regex stack growth of repeated four-character groups on large attachments.
  if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return false;
  if (!data) return true; // A valid zero-byte attachment.
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  const last = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.indexOf(data[data.length - padding - 1]);
  // The final alphabet check also excludes a trailing line terminator tolerated by the regex $ anchor.
  return last >= 0 && (padding === 0 || (last & (padding === 2 ? 15 : 3)) === 0);
}

/** Validate and copy the whole payload before making any private document visible. */
export function setPrivateFiles(privateFiles: readonly VaultFile[]): void {
  if (!Array.isArray(privateFiles)) throw new Error('vault: expected a file array');
  const paths = new Set<string>();
  const directories = new Set<string>(['/private']);
  const validated = Array.from(privateFiles, (file: VaultFile): VaultFile => {
    if (!file || typeof file.path !== 'string' || typeof file.text !== 'string') {
      throw new Error('vault: each file needs a path and text');
    }
    const parts = file.path.split('/');
    if (!file.path.startsWith('/private/') || /[\\\0]/.test(file.path)
      || parts.slice(1).some(part => !part || part === '.' || part === '..')) {
      throw new Error('vault: expected a canonical file path under /private/');
    }
    if (paths.has(file.path)) throw new Error('vault: duplicate file path');
    paths.add(file.path);
    for (let depth = 2; depth < parts.length; depth++) directories.add(parts.slice(0, depth).join('/'));
    let attachment: ContentFile['attachment'];
    if (file.attachment !== undefined) {
      const value = file.attachment;
      if (!value || typeof value.mime !== 'string' || !value.mime.trim() || /[\r\n\0]/.test(value.mime)
        || typeof value.data !== 'string' || !validBase64(value.data)) {
        throw new Error('vault: invalid attachment MIME type or base64 data');
      }
      attachment = Object.freeze({ mime: value.mime, data: value.data });
    }
    return Object.freeze({ path: file.path, text: file.text, ...(attachment ? { attachment } : {}) });
  });
  if ([...paths].some(path => directories.has(path))) throw new Error('vault: file and directory paths conflict');
  files = Object.freeze([...publicFiles, ...validated]);
  projectFiles = Object.freeze(validated.filter(file => file.path.startsWith('/private/projects/')));
  vaultUnlocked = true;
  filesChangeListeners.forEach(listener => listener());
}

/** Drop private documents, attachment payloads and all registered derived caches. */
export function clearPrivateFiles(): void {
  files = publicFiles;
  projectFiles = [];
  vaultUnlocked = false;
  filesChangeListeners.forEach(listener => listener());
}

/** Resolve published Unicode URLs and the historic index.html aliases. */
export function routeFor(pathname: string): ContentRoute | undefined {
  let path: string;
  try { path = decodeURIComponent(pathname); } catch { return undefined; }
  if (Object.hasOwn(routes, path)) return routes[path];
  path = path.replace(/index\.html$/, '');
  if (!path.endsWith('/')) path += '/';
  return Object.hasOwn(routes, path) ? routes[path] : undefined;
}

function commandFile(value: string): string | undefined {
  if (!/^cat\s/.test(value)) return undefined;
  return value.replace(/^cat\s+(?:--\s+)?/, '').replace(/^(['"])(.*)\1$/, '$2').replace(/'\\''/g, "'");
}
export function hrefForFile(file: string): string | undefined {
  if (file === '/private' || file.startsWith('/private/')) return undefined;
  const post = posts.find(post => post.file === file);
  if (post) return post.path;
  const match = Object.entries(routes).find(([path, route]) => path !== '/' && commandFile(route.command) === file);
  return match?.[0];
}
export function hrefForCommand(command: string): string | undefined {
  const file = commandFile(command);
  return file ? hrefForFile(file) : undefined;
}
