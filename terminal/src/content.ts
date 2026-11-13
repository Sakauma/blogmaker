import generated from './generated/content.json';

export interface ContentFile { path: string; text: string }
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
}
export const manifest = generated as SiteManifest;
export const { profile, files, posts, routes } = manifest;
export const projectFiles = files.filter(file => file.path.startsWith('/projects/'));

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
  const post = posts.find(post => post.file === file);
  if (post) return post.path;
  const match = Object.entries(routes).find(([path, route]) => path !== '/' && commandFile(route.command) === file);
  return match?.[0];
}
export function hrefForCommand(command: string): string | undefined {
  const file = commandFile(command);
  return file ? hrefForFile(file) : undefined;
}
