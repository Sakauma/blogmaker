import { routeFor } from './content';

/** Only authored content gets links; command echoes and errors remain literal text. */
export function appendContentText(element: HTMLElement, text: string): void {
  const pattern = /\[((?:\\.|[^\]\\\n])+)\]\(([^\s)]+)\)/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index!;
    element.append(document.createTextNode(text.slice(cursor, index)));
    let target: URL | undefined;
    try { target = new URL(match[2], window.location.origin); } catch { /* Render malformed URLs as text. */ }
    if (!target || !['http:', 'https:', 'mailto:'].includes(target.protocol)) {
      element.append(document.createTextNode(match[0]));
    } else {
      const anchor = document.createElement('a');
      anchor.className = 'content-link';
      anchor.textContent = match[1].replace(/\\([\\\[\]])/g, '$1');
      const local = target.origin === window.location.origin || target.hostname.toLowerCase() === 'sakauma.github.io';
      const route = local ? routeFor(target.pathname) : undefined;
      if (route && target.protocol !== 'mailto:') {
        anchor.href = target.pathname + target.search + target.hash;
        anchor.dataset.route = target.pathname;
      } else {
        anchor.href = match[2];
        if (target.protocol !== 'mailto:') { anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; }
      }
      element.append(anchor);
    }
    cursor = index + match[0].length;
  }
  element.append(document.createTextNode(text.slice(cursor) || (cursor === 0 ? '\u00a0' : '')));
}
