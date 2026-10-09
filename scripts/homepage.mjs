import { escapeHTML as e } from './content.mjs';

// Only a nonempty, balanced final pair denotes an original-title subtitle.
// Keep earlier parentheses and non-final/mismatched parentheses in the title.
export function titleParts(title) {
  const match = title.match(/^(.+?)\s*(?:（([^（）()]+)）|\(([^（）()]+)\))\s*$/u);
  const main = match?.[1].trim();
  const original = (match?.[2] ?? match?.[3] ?? '').trim();
  if (!main || !original) return `<span class="entry-title">${e(title)}</span>`;
  return `<span class="entry-title">${e(main)}</span><span class="entry-original"${/[А-Яа-яЁё]/.test(original) ? ' lang="ru"' : ''}>${e(original)}</span>`;
}

// Standalone previews must not use <base>: even #main would leave the document.
// Resolve navigation/resource URLs explicitly, leaving fragments and schemes alone.
export function resolvePreviewURLs(html, origin = 'https://sakauma.github.io/') {
  return html.replace(/\b(href|src)=(['"])(.*?)\2/gi, (attribute, name, quote, value) => {
    if (!value || value.startsWith('#') || /^[a-z][a-z\d+.-]*:/i.test(value)) return attribute;
    return `${name}=${quote}${new URL(value, origin).href}${quote}`;
  });
}
