import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const html = await readFile(new URL('../terminal/index.html', import.meta.url), 'utf8');
const bootstrap = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(bootstrap, 'appearance preferences initialize before the app loads');

function initialize(preferences = {}, { reduced = false, blocked = false } = {}) {
  const dataset = {
    theme: html.match(/<html[^>]+data-theme="([^"]+)"/)[1],
    style: html.match(/<html[^>]+data-style="([^"]+)"/)[1],
  };
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

test('first visit defaults to retro and respects system motion', () => {
  assert.match(html, /<html[^>]+data-style="retro"/);
  assert.deepEqual(initialize(), { theme: 'dark', style: 'retro', motion: 'on' });
  assert.deepEqual(initialize({}, { reduced: true }), { theme: 'dark', style: 'retro', motion: 'off' });
});

test('saved layout and colors are independent before first paint', () => {
  for (const style of ['modern', 'retro']) for (const theme of ['dark', 'light', 'amber']) {
    assert.deepEqual(initialize({ 'sakauma:cli:style': style, 'sakauma:cli:theme': theme }),
      { style, theme, motion: 'on' });
  }
});

test('system motion takes precedence over retired motion preferences', () => {
  for (const saved of ['on', 'off']) for (const reduced of [true, false]) {
    assert.equal(initialize({ 'sakauma:cli:motion': saved }, { reduced }).motion, reduced ? 'off' : 'on');
  }
});

test('unknown saved preferences fall back without becoming DOM attributes', () => {
  assert.deepEqual(initialize({ 'sakauma:cli:style': '<invalid>', 'sakauma:cli:theme': 'neon' }),
    { theme: 'dark', style: 'retro', motion: 'on' });
});

test('disabled storage does not break startup or reduced-motion preference', () => {
  assert.deepEqual(initialize({}, { reduced: true, blocked: true }),
    { theme: 'dark', style: 'retro', motion: 'off' });
});
