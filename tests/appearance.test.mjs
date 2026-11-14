import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const html = await readFile(new URL('../terminal/index.html', import.meta.url), 'utf8');
const bootstrap = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(bootstrap, 'appearance preferences initialize before the app loads');

function initialize(preferences = {}, { reduced = false, blocked = false } = {}) {
  const dataset = { theme: 'dark', style: 'modern' };
  runInNewContext(bootstrap, {
    document: { documentElement: { dataset } },
    localStorage: { getItem(key) {
      if (blocked) throw new Error('Storage disabled');
      return preferences[key] ?? null;
    } },
    matchMedia: () => ({ matches: reduced }),
  });
  return dataset;
}

test('first visit defaults to modern and respects system motion', () => {
  assert.match(html, /<html[^>]+data-style="modern"/);
  assert.deepEqual(initialize(), { theme: 'dark', style: 'modern', motion: 'on' });
  assert.deepEqual(initialize({}, { reduced: true }), { theme: 'dark', style: 'modern', motion: 'off' });
});

test('saved layout and colors are independent before first paint', () => {
  for (const style of ['modern', 'retro']) for (const theme of ['dark', 'light', 'amber']) {
    assert.deepEqual(initialize({ 'sakauma:cli:style': style, 'sakauma:cli:theme': theme, 'sakauma:cli:motion': 'off' }),
      { style, theme, motion: 'off' });
  }
});

test('unknown saved preferences fall back without becoming DOM attributes', () => {
  assert.deepEqual(initialize({ 'sakauma:cli:style': '<invalid>', 'sakauma:cli:theme': 'neon' }),
    { theme: 'dark', style: 'modern', motion: 'on' });
});

test('disabled storage does not break startup or reduced-motion preference', () => {
  assert.deepEqual(initialize({}, { reduced: true, blocked: true }),
    { theme: 'dark', style: 'modern', motion: 'off' });
});
