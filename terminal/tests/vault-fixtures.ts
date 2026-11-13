import { createCipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';

// Synthetic test material only. Never read the deployment password or real vault.
export const VAULT_PASSWORD = 'browser-fixture-only-口令-42-😀';
export const PRIVATE_MARKER = 'PRIVATE_BROWSER_FIXTURE_7F3B';
export const PRIVATE_DOCUMENT = '/private/notes/secret.txt';
export const PRIVATE_PROJECT = '/private/projects/fixture-project.md';
export const PRIVATE_ATTACHMENT = '/private/fixture.bin';
export const PRIVATE_README = '/private/README.md';
export const PRIVATE_PDF = '/private/fixture.pdf';
// Opaque binary download fixture; browser tests do not invoke a PDF viewer.
export const PRIVATE_PDF_BYTES = Buffer.from('%PDF-1.7\n% synthetic byte fixture\x00\xff\n%%EOF\n', 'latin1');
export const PRIVATE_BYTES = Buffer.concat([
  Buffer.from([0, 1, 2, 3, 127, 128, 254, 255]),
  Buffer.from(`${PRIVATE_MARKER}: binary fixture 中文 😀\n`, 'utf8'),
]);

export interface FixtureFile {
  path: string;
  text: string;
  attachment?: { mime: string; data: string };
}
export interface FixtureEnvelope {
  version: 1;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
  cipher: 'AES-256-GCM';
  iv: string;
  data: string;
}
export interface CapturedRequest { url: string; method: string; body: string | null; headers: Record<string, string> }

export const PRIVATE_FILES: FixtureFile[] = [
  {
    path: PRIVATE_README,
    text: [
      '# Private fixture manual', '', `${PRIVATE_MARKER} system document`,
      '[私密链接：相对正文](notes/secret.txt)',
      `[私密链接：PDF 附件](${PRIVATE_PDF})`,
      '[私密链接：目录](notes/)', '',
    ].join('\n'),
  },
  {
    path: PRIVATE_DOCUMENT,
    text: [
      '# Private fixture notebook', '', PRIVATE_MARKER,
      '[公开文章索引](/list/)', '', '  保留两个前导空格与 Unicode：е́ 👩‍💻',
      ...Array.from({ length: 86 }, (_, index) => `${String(index + 1).padStart(3, '0')} ${PRIVATE_MARKER} 私密测试行 / строка`),
      'PRIVATE_FIXTURE_END', '',
    ].join('\n'),
  },
  { path: '/private/notes/secrets-two.txt', text: `${PRIVATE_MARKER} second private note for completion\n` },
  { path: PRIVATE_PROJECT, text: `# Private fixture project\n\n${PRIVATE_MARKER} project details\n` },
  {
    path: PRIVATE_ATTACHMENT,
    text: `${PRIVATE_MARKER} binary attachment summary\n`,
    attachment: { mime: 'application/octet-stream', data: PRIVATE_BYTES.toString('base64') },
  },
  {
    path: PRIVATE_PDF,
    text: `${PRIVATE_MARKER} PDF attachment summary\n`,
    attachment: { mime: 'application/pdf', data: PRIVATE_PDF_BYTES.toString('base64') },
  },
];

/** Independent Node implementation cross-checked by the browser's Web Crypto decrypt. */
export function encryptFixture(files: FixtureFile[] = PRIVATE_FILES, password = VAULT_PASSWORD): FixtureEnvelope {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const iterations = 600_000;
  const key = pbkdf2Sync(Buffer.from(password, 'utf8'), salt, iterations, 32, 'sha256');
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const payload = Buffer.from(JSON.stringify({ version: 1, files }), 'utf8');
  const data = Buffer.concat([cipher.update(payload), cipher.final(), cipher.getAuthTag()]);
  key.fill(0);
  return {
    version: 1, kdf: 'PBKDF2-SHA256', iterations, salt: salt.toString('base64'),
    cipher: 'AES-256-GCM', iv: iv.toString('base64'), data: data.toString('base64'),
  };
}
export const VAULT_ENVELOPE = encryptFixture();
export const TAMPERED_ENVELOPE: FixtureEnvelope = (() => {
  const data = Buffer.from(VAULT_ENVELOPE.data, 'base64');
  data[0] ^= 1;
  return { ...VAULT_ENVELOPE, data: data.toString('base64') };
})();

export function privateText(path: string): string {
  const file = PRIVATE_FILES.find(file => file.path === path);
  if (!file) throw new Error(`Missing synthetic private fixture: ${path}`);
  return file.text;
}
export function privateLines(path: string): string[] {
  return privateText(path).replace(/\n$/, '').split('\n').map(line => line
    ? line.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1') : '\u00a0');
}
export const privateRootNames = (): string[] => [...new Set(PRIVATE_FILES.map(file => {
  const path = file.path.slice('/private/'.length);
  return path.includes('/') ? `${path.split('/')[0]}/` : path;
}))].sort();

/** All vault requests are fulfilled from this synthetic encrypted response. */
export async function installVaultFixture(page: Page, envelope = VAULT_ENVELOPE): Promise<CapturedRequest[]> {
  const requests: CapturedRequest[] = [];
  page.on('request', request => requests.push({
    url: request.url(), method: request.method(), body: request.postData(), headers: request.headers(),
  }));
  await page.route('**/private/vault.json?*', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(envelope) });
  });
  return requests;
}

/** Hold an already completed Web Crypto decrypt to reproduce a late async result. */
export async function delayVaultDecrypt(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
    crypto.subtle.decrypt = async (...args: Parameters<SubtleCrypto['decrypt']>): Promise<ArrayBuffer> => {
      const plaintext = await decrypt(...args);
      Reflect.set(window, '__fixtureDecryptEntered', true);
      await new Promise<void>(resolve => Reflect.set(window, '__fixtureReleaseDecrypt', resolve));
      Reflect.deleteProperty(window, '__fixtureReleaseDecrypt');
      Reflect.set(window, '__fixtureDecryptReturned', true);
      return plaintext;
    };
  });
}

export async function releaseVaultDecrypt(page: Page): Promise<void> {
  await page.evaluate(() => {
    const release = Reflect.get(window, '__fixtureReleaseDecrypt') as (() => void) | undefined;
    if (!release) throw new Error('The delayed decrypt has not reached its release point');
    release();
  });
  await page.waitForFunction(() => Reflect.get(window, '__fixtureDecryptReturned') === true);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
