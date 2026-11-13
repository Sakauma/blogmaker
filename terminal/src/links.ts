import { files, routeFor } from './content';

/** Only authored content gets links; command echoes and errors remain literal text. */
export function appendContentText(element: HTMLElement, text: string, sourceFile?: string): void {
  const pattern = /\[((?:\\.|[^\]\\\n])+)\]\(([^\s)]+)\)/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index!;
    element.append(document.createTextNode(text.slice(cursor, index)));
    let target: URL | undefined;
    try { target = new URL(match[2], new URL(sourceFile ?? '/', window.location.origin)); } catch { /* Render malformed URLs as text. */ }
    if (!target || !['http:', 'https:', 'mailto:'].includes(target.protocol)) {
      element.append(document.createTextNode(match[0]));
    } else {
      const label = match[1].replace(/\\([\\\[\]])/g, '$1');
      const local = target.origin === window.location.origin || target.hostname.toLowerCase() === 'sakauma.github.io';
      let virtualPath: string | undefined;
      try { virtualPath = decodeURIComponent(target.pathname); } catch { /* Keep malformed private URLs inert. */ }
      if (local && (virtualPath === '/private' || virtualPath?.startsWith('/private/') || target.pathname.startsWith('/private/'))) {
        if (!virtualPath) element.append(document.createTextNode(match[0]));
        else {
          const path = virtualPath.replace(/\/$/, '');
          const file = files.find(file => file.path === path);
          const directory = virtualPath.endsWith('/') || files.some(file => file.path.startsWith(path + '/'));
          const command = file?.attachment ? 'download' : directory ? 'cd' : 'cat';
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'text-command content-link';
          button.textContent = label;
          button.dataset.command = path === '/private' ? 'private' : `${command}${command === 'cd' ? '' : ' --'} ${JSON.stringify(path)}`;
          element.append(button);
        }
      } else {
        const anchor = document.createElement('a');
        anchor.className = 'content-link';
        anchor.textContent = label;
        const route = local ? routeFor(target.pathname) : undefined;
        if (route && target.protocol !== 'mailto:') {
          anchor.href = target.pathname + target.search + target.hash;
          anchor.dataset.route = target.pathname;
        } else {
          anchor.href = sourceFile ? target.href : match[2];
          if (target.protocol !== 'mailto:') { anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; }
        }
        element.append(anchor);
      }
    }
    cursor = index + match[0].length;
  }
  element.append(document.createTextNode(text.slice(cursor) || (cursor === 0 ? '\u00a0' : '')));
}
