import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createCipheriv, pbkdf2Sync, randomBytes, webcrypto } from 'node:crypto';
import {
  encryptVault, decryptVault, validateEnvelope, validatePayload,
  MAX_PAYLOAD_BYTES, MAX_VAULT_BYTES, MAX_FILES, VaultError,
} from '../scripts/vault-crypto.mjs';

const script = fileURLToPath(new URL('../scripts/vault.mjs', import.meta.url));
// These are deliberately synthetic test secrets. Every CLI invocation uses a
// temporary repository; no test reads this checkout's .private or real vault.
const PASSWORD = 'fixture-only-old-password-93';
const NEXT_PASSWORD = 'fixture-only-next-password-71';
const WRONG_PASSWORD = 'fixture-only-wrong-password-52';
const DOCUMENT_SECRET = 'fixture-document-content-cb8506';
const BINARY_SECRET = 'fixture-binary-content-a4e12f';
const SECRETS = [PASSWORD, NEXT_PASSWORD, WRONG_PASSWORD, DOCUMENT_SECRET, BINARY_SECRET];
const minimalPayload = () => ({ version: 1, files: [{ path: '/private/note.txt', text: DOCUMENT_SECRET }] });
const envelopeShape = () => ({
  version: 1, kdf: 'PBKDF2-SHA256', iterations: 600000,
  salt: Buffer.alloc(16).toString('base64'), cipher: 'AES-256-GCM',
  iv: Buffer.alloc(12).toString('base64'), data: Buffer.alloc(17).toString('base64'),
});

function assertNoSecrets(output, extra = []) {
  for (const secret of [...SECRETS, ...extra]) {
    assert.ok(!output.includes(secret), 'Console output must not contain fixture secrets.');
  }
}

function run(repo, args, { preload, secrets = [] } = {}) {
  const result = spawnSync(process.execPath, [
    ...(preload ? ['--import', pathToFileURL(preload).href] : []), script, ...args,
  ], {
    cwd: repo, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024,
    env: { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ''}` },
  });
  assert.ifError(result.error);
  assertNoSecrets(`${result.stdout}${result.stderr}`, secrets);
  return result;
}

function success(result) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
}

function failure(result, message) {
  assert.notEqual(result.status, 0);
  if (message) assert.match(result.stderr, message);
  assert.ok(!result.stderr.includes(' at '), 'Do not expose native stack traces.');
}

async function repository(t) {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'blogmaker-vault-test-'));
  t.after(() => fs.rm(repo, { recursive: true, force: true }));
  await fs.writeFile(path.join(repo, '.gitignore'), '.private/\n');
  return repo;
}

async function put(repo, relative, bytes) {
  const target = path.join(repo, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, bytes);
  return target;
}

async function exists(target) {
  try { await fs.lstat(target); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function envelopeAt(repo) {
  return JSON.parse(await fs.readFile(path.join(repo, 'private/vault.enc.json'), 'utf8'));
}

async function passwordAt(repo) {
  return (await fs.readFile(path.join(repo, '.private/password.txt'), 'utf8')).replace(/\r?\n$/u, '');
}

async function seed(repo) {
  const files = new Map([
    ['文字/письмо.md', Buffer.from(`\uFEFF${DOCUMENT_SECRET}\r\n中文 Привет 😀\r\n\tending  \n`, 'utf8')],
    ['notes.txt', Buffer.from(`readable ${DOCUMENT_SECRET}\n`, 'utf8')],
    ['documents/report.pdf', Buffer.from(`%PDF-1.7\n${BINARY_SECRET}\n%%EOF\n`, 'utf8')],
    ['images/pixel.PNG', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 128])],
    ['odd.dat', Buffer.concat([Buffer.from([255, 254, 128]), Buffer.from(BINARY_SECRET)])],
    ['control-byte.txt', Buffer.from(`\0${BINARY_SECRET}\0`)],
    ['zero.bin', Buffer.alloc(0)],
    ['empty.txt', Buffer.alloc(0)],
  ]);
  for (const [name, bytes] of files) await put(repo, `.private/files/${name}`, bytes);
  // An unrelated directory must never be collected.
  await put(repo, 'unrelated/outside.txt', 'outside-the-selected-editing-directory');
  return files;
}

async function initializeFixture(repo) {
  await seed(repo);
  await put(repo, '.private/password.txt', `${PASSWORD}\n`);
  success(run(repo, ['init']));
}

// Build authentic GCM envelopes without payload validation, for hostile decoded
// payload and malformed-JSON tests. This is independent of encryptVault.
function uncheckedEnvelope(plaintext, password = PASSWORD) {
  const salt = randomBytes(16), iv = randomBytes(12);
  const key = pbkdf2Sync(password, salt, 600000, 32, 'sha256');
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  const data = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  key.fill(0);
  return { version: 1, kdf: 'PBKDF2-SHA256', iterations: 600000, salt: salt.toString('base64'),
    cipher: 'AES-256-GCM', iv: iv.toString('base64'), data: data.toString('base64') };
}

async function assertNoTemporaryFiles(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    assert.ok(!entry.name.startsWith('.vault-'), 'No transaction lock or temporary file should remain.');
    if (entry.isDirectory() && !entry.isSymbolicLink()) await assertNoTemporaryFiles(path.join(directory, entry.name));
  }
}

test('AES-GCM roundtrip, random salt/IV, snapshots and browser Web Crypto interoperability', async () => {
  const payload = minimalPayload();
  payload.files.push({ path: '/private/二进制.bin', text: 'binary fixture', attachment: {
    mime: 'application/octet-stream', data: Buffer.from([0, 255, 128, 10]).toString('base64'),
  } });
  assert.equal(validatePayload(payload), payload);
  const first = await encryptVault(payload, PASSWORD);
  const second = await encryptVault(payload, PASSWORD);
  assert.equal(validateEnvelope(first), first);
  assert.equal(first.iterations, 600000);
  assert.equal(Buffer.from(first.salt, 'base64').length, 16);
  assert.equal(Buffer.from(first.iv, 'base64').length, 12);
  assert.equal(Buffer.from(first.data, 'base64').length, Buffer.byteLength(JSON.stringify(payload)) + 16);
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.iv, second.iv);
  assert.notEqual(first.data, second.data);
  assert.deepEqual(await decryptVault(first, PASSWORD), payload);
  assertNoSecrets(JSON.stringify(first));
  const material = await webcrypto.subtle.importKey('raw', Buffer.from(PASSWORD), 'PBKDF2', false, ['deriveKey']);
  const key = await webcrypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256',
    iterations: 600000, salt: Buffer.from(first.salt, 'base64') }, material,
  { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const decoded = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(first.iv, 'base64'), tagLength: 128 },
    key, Buffer.from(first.data, 'base64'));
  assert.deepEqual(JSON.parse(Buffer.from(decoded).toString('utf8')), payload);
  const mutable = minimalPayload();
  const encrypting = encryptVault(mutable, PASSWORD);
  mutable.files[0].path = '/private/../changed';
  mutable.files[0].text = 'changed after validation';
  assert.deepEqual(await decryptVault(await encrypting, PASSWORD), minimalPayload());
  const decrypting = decryptVault(first, PASSWORD);
  first.data = Buffer.alloc(20).toString('base64');
  assert.deepEqual(await decrypting, payload);
});

test('wrong passwords and modified salt, IV, ciphertext or GCM tag fail authentication', async () => {
  const envelope = await encryptVault(minimalPayload(), PASSWORD);
  await assert.rejects(decryptVault(envelope, WRONG_PASSWORD), /authentication failed/);
  for (const [field, position] of [['salt', 0], ['iv', 0], ['data', 0], ['data', -1]]) {
    const bytes = Buffer.from(envelope[field], 'base64');
    bytes[position < 0 ? bytes.length - 1 : position] ^= 1;
    await assert.rejects(decryptVault({ ...envelope, [field]: bytes.toString('base64') }, PASSWORD), /authentication failed/);
  }
  for (const password of ['', 'too-short', 123, null, '😀'.repeat(11), '\ud800'.repeat(12), 'x'.repeat(4097)]) {
    await assert.rejects(encryptVault(minimalPayload(), password), /Password/);
    await assert.rejects(decryptVault(envelope, password), /Password/);
  }
  const unicodePassword = '口令😀'.repeat(4);
  assert.deepEqual(await decryptVault(await encryptVault(minimalPayload(), unicodePassword), unicodePassword), minimalPayload());
});

test('protocol validation rejects unsupported algorithms, arbitrary KDF cost and malformed base64', async () => {
  const invalid = [
    null, [], {}, { ...envelopeShape(), version: 2 }, { ...envelopeShape(), version: '1' },
    { ...envelopeShape(), kdf: 'scrypt' }, { ...envelopeShape(), iterations: 599999 },
    { ...envelopeShape(), iterations: 600001 }, { ...envelopeShape(), iterations: 1e12 },
    { ...envelopeShape(), iterations: '600000' }, { ...envelopeShape(), cipher: 'AES-256-CBC' },
    { ...envelopeShape(), extra: 'field' }, { ...envelopeShape(), salt: Buffer.alloc(15).toString('base64') },
    { ...envelopeShape(), salt: Buffer.alloc(17).toString('base64') },
    { ...envelopeShape(), salt: `${'A'.repeat(21)}B==` },
    { ...envelopeShape(), iv: Buffer.alloc(11).toString('base64') },
    { ...envelopeShape(), iv: Buffer.alloc(13).toString('base64') },
    { ...envelopeShape(), data: Buffer.alloc(16).toString('base64') },
  ];
  for (const data of ['', '!!!!', 'AA', 'AA==\n', '-_==', 'A===', 'AB==', 7, null]) {
    invalid.push({ ...envelopeShape(), data });
  }
  for (const envelope of invalid) {
    assert.throws(() => validateEnvelope(envelope), VaultError);
    await assert.rejects(decryptVault(envelope, PASSWORD), VaultError);
  }
  const getter = envelopeShape();
  Object.defineProperty(getter, 'iterations', { get() { throw new Error('getter must not execute'); } });
  assert.throws(() => validateEnvelope(getter), VaultError);
});

test('payload validation enforces portable private paths, fields and collisions', () => {
  for (const name of ['', '/', '/private', '/private/', '/public/a', '/privateish/a', 'private/a',
    '/private/../x', '/private/./x', '/private/a/../x', '/private//x', '/private/x/',
    '/private/a\\b', '/private/C:/x', '/private/%2e%2e/x', '/private/%2Fetc', '/private/%252e/x',
    '/private/a\0b', '/private/a\nb', '/private/a.', '/private/a ', '/private/CON.txt',
    '/private/lpt1', '/private/a:b', '/private/a?b', `/private/${'x'.repeat(256)}`, `/private/${'x/'.repeat(65)}z`]) {
    assert.throws(() => validatePayload({ version: 1, files: [{ path: name, text: '' }] }), VaultError);
  }
  for (const names of [
    ['same', 'same'], ['A/file.txt', 'a/FILE.txt'], ['folder', 'folder/file'],
    ['folder/file', 'folder'], ['café.txt', 'cafe\u0301.txt'], ['FOLDER/file', 'folder'],
  ]) {
    assert.throws(() => validatePayload({ version: 1, files: names.map(name => ({ path: `/private/${name}`, text: '' })) }), VaultError);
  }
  const invalid = [null, [], {}, { version: 2, files: [] }, { version: 1, files: {}, extra: 1 },
    { version: 1, files: new Array(1) }, { version: 1, files: [null] },
    { version: 1, files: [{ path: '/private/a', text: 1 }] },
    { version: 1, files: [{ path: '/private/a', text: '\ud800' }] },
    { version: 1, files: [{ path: '/private/a', text: '', unknown: true }] }];
  for (const attachment of [null, {}, { mime: 'text/plain; charset=utf-8', data: '' },
    { mime: 'application/octet-stream', data: 'AB==' }, { mime: 'text/plain', data: 'YQ' },
    { mime: 'image/png', data: '', extra: 1 }]) {
    invalid.push({ version: 1, files: [{ path: '/private/a', text: '', attachment }] });
  }
  for (const payload of invalid) assert.throws(() => validatePayload(payload), VaultError);
  const nonEnumerable = minimalPayload();
  Object.defineProperty(nonEnumerable, 'version', { value: 1, enumerable: false });
  assert.throws(() => validatePayload(nonEnumerable), VaultError);
  const valid = { version: 1, files: [{ path: '/private/说明.md', text: '中文\r\n' }, {
    path: '/private/empty.bin', text: 'empty file', attachment: { mime: 'application/octet-stream', data: '' },
  }] };
  assert.equal(validatePayload(valid), valid);
});

test('size and count limits include JSON escaping and base64 expansion', () => {
  assert.throws(() => validatePayload({ version: 1, files: Array(MAX_FILES + 1).fill({ path: '/private/a', text: '' }) }), VaultError);
  assert.throws(() => validatePayload({ version: 1, files: [{ path: '/private/large', text: 'x'.repeat(MAX_PAYLOAD_BYTES + 1) }] }), /size|oversized/);
  assert.throws(() => validatePayload({ version: 1, files: [{ path: '/private/escaped', text: '\0'.repeat(Math.ceil(MAX_PAYLOAD_BYTES / 6)) }] }), /size/);
  assert.throws(() => validatePayload({ version: 1, files: [{ path: '/private/large.bin', text: '', attachment: {
    mime: 'application/octet-stream', data: 'A'.repeat(MAX_PAYLOAD_BYTES + 4),
  } }] }), /oversized/);
  assert.throws(() => validateEnvelope({ ...envelopeShape(), data: 'A'.repeat(MAX_VAULT_BYTES) }), VaultError);
  // A near-limit, canonical envelope validates without a recursive-regex overflow.
  const nearLimit = { ...envelopeShape(), data: Buffer.alloc(MAX_PAYLOAD_BYTES + 16).toString('base64') };
  assert.equal(validateEnvelope(nearLimit), nearLimit);
  assert.ok(Buffer.byteLength(JSON.stringify(nearLimit)) < MAX_VAULT_BYTES);
});

test('authenticated invalid JSON and invalid decoded payload never leak parser snippets', async () => {
  for (const plaintext of [Buffer.from(`{"${DOCUMENT_SECRET}": broken}`), Buffer.from([255, 254])]) {
    await assert.rejects(decryptVault(uncheckedEnvelope(plaintext), PASSWORD), error => {
      assertNoSecrets(error.message);
      return error.message === 'Invalid decrypted vault JSON.';
    });
  }
  await assert.rejects(decryptVault(uncheckedEnvelope(Buffer.from(JSON.stringify({ version: 1, files: [
    { path: '/private/../escape', text: DOCUMENT_SECRET },
  ] }))), PASSWORD), /path/);
});

test('init generates a strong local key, preserves existing vault and only seals selected files', async t => {
  const repo = await repository(t);
  const files = await seed(repo);
  const initialized = run(repo, ['init']);
  success(initialized);
  const password = await passwordAt(repo);
  assert.match(password, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(Buffer.from(password, 'base64url').length, 24);
  assertNoSecrets(`${initialized.stdout}${initialized.stderr}`, [password]);
  const envelope = await envelopeAt(repo);
  const payload = await decryptVault(envelope, password);
  assert.equal(payload.files.length, files.size);
  assert.deepEqual(new Set(payload.files.map(file => file.path)), new Set([...files.keys()].map(name => `/private/${name}`)));
  assert.deepEqual(await fs.readdir(path.join(repo, 'private')), ['vault.enc.json']);
  if (process.platform !== 'win32') assert.equal((await fs.stat(path.join(repo, '.private/password.txt'))).mode & 0o777, 0o600);
  const before = await fs.readFile(path.join(repo, 'private/vault.enc.json'));
  failure(run(repo, ['init', '--password-file', 'missing-password.txt'], { secrets: [password] }), /already exists/);
  assert.deepEqual(await fs.readFile(path.join(repo, 'private/vault.enc.json')), before);
  assert.equal(await passwordAt(repo), password);
  await assertNoTemporaryFiles(repo);
});

test('init uses explicit/default password files and protects even a malformed existing vault', async t => {
  const repo = await repository(t);
  await put(repo, '.private/files/note.txt', DOCUMENT_SECRET);
  const supplied = await put(repo, 'supplied-key.txt', `${PASSWORD}\r\n`);
  success(run(repo, ['init', '--password-file', supplied]));
  assert.equal(await passwordAt(repo), PASSWORD);
  assert.equal(await fs.readFile(supplied, 'utf8'), `${PASSWORD}\r\n`);
  assert.equal((await decryptVault(await envelopeAt(repo), PASSWORD)).files[0].text, DOCUMENT_SECRET);
  const protectedRepo = await repository(t);
  await put(protectedRepo, 'private/vault.enc.json', DOCUMENT_SECRET);
  failure(run(protectedRepo, ['init']), /already exists/);
  assert.equal(await fs.readFile(path.join(protectedRepo, 'private/vault.enc.json'), 'utf8'), DOCUMENT_SECRET);
  assert.equal(await exists(path.join(protectedRepo, '.private/password.txt')), false);
  assert.equal(await exists(path.join(protectedRepo, '.private/files')), false);
});

test('seal/open preserve UTF-8 BOM, CRLF, binary, MIME, empty files and original bytes', async t => {
  const repo = await repository(t);
  const originals = await seed(repo);
  await put(repo, '.private/password.txt', `${PASSWORD}\n`);
  success(run(repo, ['init']));
  const originalEnvelope = await envelopeAt(repo);
  const payload = await decryptVault(originalEnvelope, PASSWORD);
  const byName = new Map(payload.files.map(file => [file.path.slice('/private/'.length), file]));
  assert.equal(byName.get('文字/письмо.md').text, originals.get('文字/письмо.md').toString('utf8'));
  assert.equal(byName.get('文字/письмо.md').attachment, undefined);
  for (const name of ['documents/report.pdf', 'images/pixel.PNG', 'odd.dat', 'control-byte.txt', 'zero.bin']) {
    assert.deepEqual(Buffer.from(byName.get(name).attachment.data, 'base64'), originals.get(name));
    assert.ok(byName.get(name).text.includes(`${originals.get(name).length} bytes`));
    assertNoSecrets(byName.get(name).text);
  }
  assert.equal(byName.get('documents/report.pdf').attachment.mime, 'application/pdf');
  assert.equal(byName.get('images/pixel.PNG').attachment.mime, 'image/png');
  assert.equal(byName.get('odd.dat').attachment.mime, 'application/octet-stream');
  await fs.rm(path.join(repo, '.private/files'), { recursive: true });
  failure(run(repo, ['seal']), /run open before seal/);
  assert.deepEqual(await envelopeAt(repo), originalEnvelope);
  success(run(repo, ['open']));
  for (const [name, bytes] of originals) assert.deepEqual(await fs.readFile(path.join(repo, '.private/files', name)), bytes);
  const note = path.join(repo, '.private/files/notes.txt');
  await fs.utimes(note, new Date('2000-01-01T00:00:00Z'), new Date('2000-01-01T00:00:00Z'));
  const before = await fs.stat(note);
  const unchanged = run(repo, ['open']);
  success(unchanged);
  assert.match(unchanged.stdout, /restored 0 file/);
  assert.equal((await fs.stat(note)).mtimeMs, before.mtimeMs);
  await fs.writeFile(note, `${DOCUMENT_SECRET}\nnew edit\r\n`);
  success(run(repo, ['seal']));
  const sealed = await envelopeAt(repo);
  assert.notEqual(sealed.salt, originalEnvelope.salt);
  assert.notEqual(sealed.iv, originalEnvelope.iv);
  assert.equal((await decryptVault(sealed, PASSWORD)).files.find(file => file.path === '/private/notes.txt').text, `${DOCUMENT_SECRET}\nnew edit\r\n`);
  await assertNoTemporaryFiles(repo);
});

test('wrong credentials and tampering leave vault and local files untouched', async t => {
  const repo = await repository(t);
  await initializeFixture(repo);
  const wrong = await put(repo, 'wrong-key.txt', WRONG_PASSWORD);
  const original = await fs.readFile(path.join(repo, 'private/vault.enc.json'));
  for (const command of ['seal', 'open', 'password']) failure(run(repo, [command, '--password-file', wrong]), /authentication failed/);
  assert.deepEqual(await fs.readFile(path.join(repo, 'private/vault.enc.json')), original);
  assert.equal(await passwordAt(repo), PASSWORD);
  await fs.rm(path.join(repo, '.private/files'), { recursive: true });
  const tampered = JSON.parse(original);
  const bytes = Buffer.from(tampered.data, 'base64');
  bytes[bytes.length - 1] ^= 1;
  tampered.data = bytes.toString('base64');
  await put(repo, 'private/vault.enc.json', JSON.stringify(tampered));
  failure(run(repo, ['open']), /authentication failed/);
  assert.equal(await exists(path.join(repo, '.private/files')), false);
  await assertNoTemporaryFiles(repo);
});

test('open preflights all conflicts before writing any new file', async t => {
  const repo = await repository(t);
  const payload = { version: 1, files: [
    { path: '/private/a-new.txt', text: DOCUMENT_SECRET },
    { path: '/private/z-existing.txt', text: 'sealed old text' },
  ] };
  await put(repo, '.private/password.txt', PASSWORD);
  await put(repo, 'private/vault.enc.json', JSON.stringify(await encryptVault(payload, PASSWORD)));
  await put(repo, '.private/files/z-existing.txt', 'local unsaved text');
  failure(run(repo, ['open']), /Local files differ/);
  assert.equal(await exists(path.join(repo, '.private/files/a-new.txt')), false);
  assert.equal(await fs.readFile(path.join(repo, '.private/files/z-existing.txt'), 'utf8'), 'local unsaved text');
  await fs.rm(path.join(repo, '.private/files'), { recursive: true });
  await fs.mkdir(path.join(repo, '.private/files/z-existing.txt'), { recursive: true });
  failure(run(repo, ['open']), /not a regular file/);
  assert.equal(await exists(path.join(repo, '.private/files/a-new.txt')), false);
});

test('open rejects authenticated traversal before restore and scrubs JSON parser errors', async t => {
  const repo = await repository(t);
  await put(repo, '.private/password.txt', PASSWORD);
  const hostile = { version: 1, files: [
    { path: '/private/a-first.txt', text: DOCUMENT_SECRET },
    { path: '/private/../../escaped.txt', text: DOCUMENT_SECRET },
  ] };
  await put(repo, 'private/vault.enc.json', JSON.stringify(uncheckedEnvelope(Buffer.from(JSON.stringify(hostile)))));
  failure(run(repo, ['open']), /path/);
  assert.equal(await exists(path.join(repo, '.private/files')), false);
  assert.equal(await exists(path.join(repo, 'escaped.txt')), false);
  await put(repo, 'private/vault.enc.json', JSON.stringify(uncheckedEnvelope(Buffer.from(`{"secret":"${DOCUMENT_SECRET}", oops}`))));
  failure(run(repo, ['open']), /Invalid decrypted vault JSON/);
  await put(repo, 'private/vault.enc.json', `{"secret":"${DOCUMENT_SECRET}", broken}`);
  failure(run(repo, ['status']), /Invalid encrypted vault JSON/);
});

test('password rotation preserves sealed data, backs up old key/ciphertext and retires old password', async t => {
  const repo = await repository(t);
  await initializeFixture(repo);
  const oldBytes = await fs.readFile(path.join(repo, 'private/vault.enc.json'));
  const oldPayload = await decryptVault(JSON.parse(oldBytes), PASSWORD);
  await put(repo, '.private/files/notes.txt', 'unsealed local edit must stay local');
  const newFile = await put(repo, 'new-key.txt', `${NEXT_PASSWORD}\n`);
  success(run(repo, ['password', '--new-password-file', newFile]));
  assert.equal(await passwordAt(repo), NEXT_PASSWORD);
  assert.equal(await fs.readFile(newFile, 'utf8'), `${NEXT_PASSWORD}\n`);
  const rotated = await envelopeAt(repo);
  assert.deepEqual(await decryptVault(rotated, NEXT_PASSWORD), oldPayload);
  await assert.rejects(decryptVault(rotated, PASSWORD), /authentication failed/);
  const backupRoot = path.join(repo, '.private/backups');
  const backups = await fs.readdir(backupRoot);
  assert.equal(backups.length, 1);
  const backup = path.join(backupRoot, backups[0]);
  assert.deepEqual(await fs.readFile(path.join(backup, 'vault.enc.json')), oldBytes);
  assert.equal((await fs.readFile(path.join(backup, 'password.txt'), 'utf8')).trimEnd(), PASSWORD);
  if (process.platform !== 'win32') {
    assert.equal((await fs.stat(path.join(backup, 'password.txt'))).mode & 0o777, 0o600);
    assert.equal((await fs.stat(path.join(backup, 'vault.enc.json'))).mode & 0o777, 0o600);
  }
  const generated = run(repo, ['password']);
  success(generated);
  const generatedPassword = await passwordAt(repo);
  assert.match(generatedPassword, /^[A-Za-z0-9_-]{32}$/);
  assertNoSecrets(`${generated.stdout}${generated.stderr}`, [generatedPassword]);
  const current = await envelopeAt(repo);
  await assert.rejects(decryptVault(current, NEXT_PASSWORD), /authentication failed/);
  assert.deepEqual(await decryptVault(current, generatedPassword), oldPayload);
  assert.equal((await fs.readdir(backupRoot)).length, 2);
  assert.equal(await fs.readFile(path.join(repo, '.private/files/notes.txt'), 'utf8'), 'unsealed local edit must stay local');
  await assertNoTemporaryFiles(repo);
});

test('password rotation rolls back an injected ciphertext write failure and retains recovery artifacts', async t => {
  const repo = await repository(t);
  await initializeFixture(repo);
  const original = await fs.readFile(path.join(repo, 'private/vault.enc.json'));
  const fault = await put(repo, 'fail-vault-rename.mjs', `import { promises as fs } from 'node:fs';
import path from 'node:path';
const rename = fs.rename.bind(fs);
fs.rename = async (source, target) => {
  if (target === path.join(process.cwd(), 'private', 'vault.enc.json')) {
    throw Object.assign(new Error('injected fixture failure'), { code: 'EIO' });
  }
  return rename(source, target);
};
`);
  failure(run(repo, ['password'], { preload: fault }), /previous vault and password/);
  assert.deepEqual(await fs.readFile(path.join(repo, 'private/vault.enc.json')), original);
  assert.equal(await passwordAt(repo), PASSWORD);
  const backupRoot = path.join(repo, '.private/backups');
  const backups = await fs.readdir(backupRoot);
  assert.equal(backups.length, 1);
  assert.deepEqual(await fs.readFile(path.join(backupRoot, backups[0], 'vault.enc.json')), original);
  assert.equal((await fs.readFile(path.join(backupRoot, backups[0], 'password.txt'), 'utf8')).trimEnd(), PASSWORD);
  await assertNoTemporaryFiles(repo);
});

test('status is read-only and reveals neither filenames, document data nor passwords', async t => {
  const repo = await repository(t);
  success(run(repo, ['status']));
  assert.equal(await exists(path.join(repo, '.private')), false);
  await initializeFixture(repo);
  // Status checks existence, not password contents or authentication.
  await put(repo, '.private/password.txt', 'short');
  const result = run(repo, ['status']);
  success(result);
  assert.match(result.stdout, /envelope valid/);
  assert.ok(!result.stdout.includes('notes.txt'));
  assert.ok(!result.stdout.includes('report.pdf'));
  assert.ok(!result.stdout.includes('short'));
  assert.equal(await fs.readFile(path.join(repo, '.private/password.txt'), 'utf8'), 'short');
});

test('symlinks and directory junctions are rejected without traversing or writing their targets', async t => {
  const repo = await repository(t);
  await fs.mkdir(path.join(repo, '.private/files'), { recursive: true });
  const outside = path.join(repo, 'outside-link-target');
  await put(repo, 'outside-link-target/sentinel.txt', DOCUMENT_SECRET);
  await fs.symlink(outside, path.join(repo, '.private/files/linked'), process.platform === 'win32' ? 'junction' : 'dir');
  failure(run(repo, ['init']), /Symbolic links/);
  assert.equal(await exists(path.join(repo, 'private/vault.enc.json')), false);
  assert.equal(await exists(path.join(repo, '.private/password.txt')), false);
  const payload = { version: 1, files: [
    { path: '/private/a-first.txt', text: DOCUMENT_SECRET },
    { path: '/private/linked/new.txt', text: DOCUMENT_SECRET },
  ] };
  await put(repo, '.private/password.txt', PASSWORD);
  await put(repo, 'private/vault.enc.json', JSON.stringify(await encryptVault(payload, PASSWORD)));
  failure(run(repo, ['open']), /Symbolic links/);
  assert.equal(await exists(path.join(repo, '.private/files/a-first.txt')), false);
  assert.equal(await exists(path.join(outside, 'new.txt')), false);
  assert.equal(await fs.readFile(path.join(outside, 'sentinel.txt'), 'utf8'), DOCUMENT_SECRET);
});

test('CLI rejects short/multiline keys, unchanged rotation keys, bad arguments and oversized files', async t => {
  const repo = await repository(t);
  await put(repo, '.private/files/note.txt', DOCUMENT_SECRET);
  for (const secret of ['short', `${PASSWORD}\n${NEXT_PASSWORD}`, '😀'.repeat(11)]) {
    await put(repo, 'bad-key.txt', secret);
    failure(run(repo, ['init', '--password-file', 'bad-key.txt']), /12 or more/);
    assert.equal(await exists(path.join(repo, 'private/vault.enc.json')), false);
  }
  for (const args of [[], ['bogus'], ['init', '--password', PASSWORD], ['init', '--password-file'],
    ['seal', '--new-password-file', 'x'], ['init', '--password-file', 'a', '--password-file', 'b']]) {
    failure(run(repo, args), /Usage|only used/);
  }
  await put(repo, '.private/password.txt', PASSWORD);
  success(run(repo, ['init']));
  const original = await fs.readFile(path.join(repo, 'private/vault.enc.json'));
  failure(run(repo, ['password', '--new-password-file', '.private/password.txt']), /must differ/);
  assert.equal(await exists(path.join(repo, '.private/backups')), false);
  const handle = await fs.open(path.join(repo, '.private/files/oversized.bin'), 'w');
  await handle.truncate(MAX_PAYLOAD_BYTES + 1);
  await handle.close();
  failure(run(repo, ['seal']), /size limit/);
  assert.deepEqual(await fs.readFile(path.join(repo, 'private/vault.enc.json')), original);
  const vault = await fs.open(path.join(repo, 'private/vault.enc.json'), 'w');
  await vault.truncate(MAX_VAULT_BYTES + 1);
  await vault.close();
  failure(run(repo, ['status']), /size limit/);
  await assertNoTemporaryFiles(repo);
});
