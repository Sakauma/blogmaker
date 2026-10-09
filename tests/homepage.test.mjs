import test from 'node:test';
import assert from 'node:assert/strict';
import { titleParts, resolvePreviewURLs } from '../scripts/homepage.mjs';

test('homepage subtitle: paired trailing full/half-width parentheses and whitespace', () => {
  for (const title of ['雷鬼 (Reggae )', '雷鬼（Reggae）', '雷鬼  (  Reggae  )  ', '雷鬼　（ Reggae ）　']) {
    assert.equal(titleParts(title), '<span class="entry-title">雷鬼</span><span class="entry-original">Reggae</span>');
  }
  assert.equal(titleParts('标题（Привет）'), '<span class="entry-title">标题</span><span class="entry-original" lang="ru">Привет</span>');
  assert.equal(titleParts('A (part one) (Original)'), '<span class="entry-title">A (part one)</span><span class="entry-original">Original</span>');
  for (const title of ['标题', '标题（副题）后记', '标题 (subtitle) ending', '标题（wrong)', '标题(wrong）', '标题 (nested (text))', '标题（）', '标题 (   )', '(Only)', ' （Only）']) {
    assert.equal(titleParts(title), `<span class="entry-title">${title}</span>`, title);
  }
  assert.equal(titleParts('A & B (<C>)'), '<span class="entry-title">A &amp; B</span><span class="entry-original">&lt;C&gt;</span>');
});

test('preview navigation preserves current-document fragments and explicit schemes', () => {
  const html = '<a href="#main">Skip</a><a href="/tags/翻译/">Tag</a><img src="images/a.png"><a href="mailto:a@example.com">Mail</a><img src="data:image/png;base64,AA=="><a href="https://other.example/">Other</a>';
  const result = resolvePreviewURLs(html);
  assert.ok(!result.includes('<base'));
  assert.ok(result.includes('href="#main"'));
  assert.ok(result.includes('href="https://sakauma.github.io/tags/%E7%BF%BB%E8%AF%91/"'));
  assert.ok(result.includes('src="https://sakauma.github.io/images/a.png"'));
  for (const unchanged of ['mailto:a@example.com', 'data:image/png;base64,AA==', 'https://other.example/']) assert.ok(result.includes(unchanged));
  assert.equal(new URL('#main', 'file:///tmp/preview.html').href, 'file:///tmp/preview.html#main');
});
