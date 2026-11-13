import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  decryptVault, encryptVault, validateEnvelope, validatePayload,
  MAX_FILES, MAX_PAYLOAD_BYTES, MAX_VAULT_BYTES, VaultError,
} from './vault-crypto.mjs';

const root = process.cwd();
const local = path.join(root, '.private');
const filesRoot = path.join(local, 'files');
const defaultPassword = path.join(local, 'password.txt');
const vaultPath = path.join(root, 'private', 'vault.enc.json');
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const PASSWORD_FILE_BYTES = 4098; // Up to 4096 bytes plus an optional CRLF.
const usage = 'Usage: node scripts/vault.mjs init|seal|open|password|status [--password-file PATH] [--new-password-file PATH]';
const binaryMimes = new Map(Object.entries({
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.avif': 'image/avif', '.ico': 'image/x-icon', '.bmp': 'image/bmp',
  '.tif': 'image/tiff', '.tiff': 'image/tiff', '.heic': 'image/heic',
  '.zip': 'application/zip', '.gz': 'application/gzip', '.tgz': 'application/gzip',
  '.7z': 'application/x-7z-compressed', '.rar': 'application/vnd.rar',
  '.tar': 'application/x-tar', '.bz2': 'application/x-bzip2', '.xz': 'application/x-xz',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.odt': 'application/vnd.oasis.opendocument.text', '.epub': 'application/epub+zip',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.wasm': 'application/wasm', '.exe': 'application/octet-stream',
  '.dll': 'application/octet-stream', '.bin': 'application/octet-stream',
  '.sqlite': 'application/vnd.sqlite3', '.db': 'application/octet-stream',
}));

function fail(message) {
  throw new VaultError(message);
}

function inside(base, target) {
  const relative = path.relative(base, target);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

// Check only the named path and its ancestors; never enumerate outside filesRoot.
async function inspect(target, kind = 'file') {
  target = path.resolve(target);
  const base = inside(root, target) ? root : path.parse(target).root;
  const parts = path.relative(base, target).split(path.sep).filter(Boolean);
  let current = base;
  for (let index = -1; index < parts.length; index++) {
    if (index >= 0) current = path.join(current, parts[index]);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
    if (stat.isSymbolicLink()) fail('Symbolic links are not accepted by vault commands.');
    const last = index === parts.length - 1;
    if ((!last || kind === 'directory') && !stat.isDirectory()) fail('A required vault directory is occupied by another file type.');
    if (last && kind === 'file' && !stat.isFile()) fail('A required vault file is not a regular file.');
    if (last) return stat;
  }
}

async function ensureDirectory(target, mode = 0o700) {
  if (!inside(root, target)) fail('Vault output must stay inside the current repository.');
  await inspect(root, 'directory');
  let current = root;
  for (const part of path.relative(root, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (!await inspect(current, 'directory')) {
      try {
        await fs.mkdir(current, { mode });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      await inspect(current, 'directory');
    }
  }
}

async function readBounded(target, maxBytes) {
  if (!await inspect(target)) fail('A required vault input file is missing.');
  const handle = await fs.open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) fail('Vault input exceeds its size limit or is not a regular file.');
    // An extra byte detects growth without readFile allocating an unbounded buffer.
    const buffer = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset !== stat.size) fail('A vault input changed while it was being read; retry the command.');
    return buffer.subarray(0, offset);
  } finally {
    await handle.close();
  }
}

async function readOptional(target, maxBytes) {
  return await inspect(target) ? readBounded(target, maxBytes) : null;
}

// Temp files are flushed in the destination directory; publication is a single
// rename (replacement) or hard-link (exclusive creation). Never truncate a target.
async function atomicWrite(target, bytes, { expected = null, mode = 0o600 } = {}) {
  const parent = path.dirname(target);
  await ensureDirectory(parent, inside(local, target) ? 0o700 : 0o755);
  const temporary = path.join(parent, `.vault-${randomBytes(12).toString('hex')}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', mode);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await inspect(parent, 'directory');
    const current = await readOptional(target, MAX_VAULT_BYTES);
    if (expected === null ? current !== null : current === null || !current.equals(expected)) {
      fail('A vault destination already exists or changed; no replacement was made.');
    }
    if (expected === null) await fs.link(temporary, target);
    else await fs.rename(temporary, target);
  } finally {
    await handle?.close().catch(() => {});
    await fs.unlink(temporary).catch(() => {});
  }
}

function passwordFromBytes(bytes) {
  let value;
  try {
    value = utf8.decode(bytes).replace(/\r?\n$/u, '');
  } catch {
    fail('Password file must contain a single UTF-8 password.');
  }
  if (/[\r\n]/u.test(value) || [...value].length < 12 || Buffer.byteLength(value, 'utf8') > 4096) {
    fail('Password file must contain one password of 12 or more characters (at most 4096 UTF-8 bytes).');
  }
  return value;
}

async function readPassword(target) {
  const bytes = await readBounded(target, PASSWORD_FILE_BYTES);
  try {
    return passwordFromBytes(bytes);
  } finally {
    bytes.fill(0);
  }
}

function passwordBytes(value) {
  return Buffer.from(`${value}\n`, 'utf8');
}

function encryptedBytes(envelope) {
  return Buffer.from(`${JSON.stringify(envelope)}\n`, 'utf8');
}

async function readVault() {
  if (!await inspect(vaultPath)) fail('Encrypted vault is missing; run init first.');
  const bytes = await readBounded(vaultPath, MAX_VAULT_BYTES);
  let envelope;
  try {
    envelope = JSON.parse(utf8.decode(bytes));
  } catch {
    fail('Invalid encrypted vault JSON.');
  }
  validateEnvelope(envelope);
  return { bytes, envelope };
}

async function collectFiles() {
  if (!await inspect(filesRoot, 'directory')) fail('Local editing directory is missing; run open before seal.');
  const entries = [];
  let visited = 0;
  async function visit(directory, parts = []) {
    await inspect(directory, 'directory');
    const stream = await fs.opendir(directory);
    for await (const entry of stream) {
      if (++visited > MAX_FILES * 2) fail('Local editing directory has too many entries.');
      const nextParts = [...parts, entry.name];
      const virtualPath = `/private/${nextParts.join('/')}`;
      // Validate even empty directory names before descending into them.
      validatePayload({ version: 1, files: [{ path: virtualPath, text: '' }] });
      const target = path.join(directory, entry.name);
      const stat = await fs.lstat(target);
      if (stat.isSymbolicLink()) fail('Symbolic links are not accepted in the local editing directory.');
      if (stat.isDirectory()) await visit(target, nextParts);
      else if (stat.isFile()) {
        if (entries.length >= MAX_FILES) fail('Local editing directory has too many files.');
        entries.push({ target, path: virtualPath });
      } else fail('The local editing directory contains a non-regular file.');
    }
  }
  await visit(filesRoot);
  entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const files = [];
  let total = 0;
  for (const entry of entries) {
    const bytes = await readBounded(entry.target, MAX_PAYLOAD_BYTES);
    try {
      let text;
      const mime = binaryMimes.get(path.extname(entry.target).toLowerCase());
      if (!mime) {
        try {
          text = utf8.decode(bytes);
          if (/[\x00-\x08\x0b\x0e-\x1f]/u.test(text)) text = undefined;
        } catch {
          // Invalid UTF-8 is preserved as an attachment, never decoded lossily.
        }
      }
      const file = typeof text === 'string'
        ? { path: entry.path, text }
        : {
          path: entry.path,
          text: `${path.posix.basename(entry.path)} (${bytes.length} bytes)`,
          attachment: { mime: mime ?? 'application/octet-stream', data: bytes.toString('base64') },
        };
      total += Buffer.byteLength(file.text, 'utf8') + (file.attachment?.data.length ?? 0);
      if (total > MAX_PAYLOAD_BYTES) fail('Local files exceed the vault payload size limit.');
      files.push(file);
    } finally {
      bytes.fill(0);
    }
  }
  return validatePayload({ version: 1, files });
}

async function initialize(options) {
  if (await inspect(vaultPath)) fail('Encrypted vault already exists; init preserves it.');
  await ensureDirectory(filesRoot);
  const payload = await collectFiles();
  const previousPassword = await readOptional(defaultPassword, PASSWORD_FILE_BYTES);
  const password = options.passwordFile
    ? await readPassword(options.passwordFile)
    : previousPassword === null ? randomBytes(24).toString('base64url') : passwordFromBytes(previousPassword);
  const envelope = await encryptVault(payload, password);
  await ensureDirectory(path.dirname(vaultPath), 0o755);
  // Persist the key before publishing its first ciphertext, including after a crash.
  await atomicWrite(defaultPassword, passwordBytes(password), { expected: previousPassword });
  await atomicWrite(vaultPath, encryptedBytes(envelope), { mode: 0o644 });
  console.log(`Initialized private/vault.enc.json: ${payload.files.length} file(s); password file: .private/password.txt.`);
}

async function seal(options) {
  if (!await inspect(filesRoot, 'directory')) fail('Local editing directory is missing; run open before seal.');
  const old = await readVault();
  const password = await readPassword(options.passwordFile ?? defaultPassword);
  await decryptVault(old.envelope, password);
  const payload = await collectFiles();
  const envelope = await encryptVault(payload, password);
  await atomicWrite(vaultPath, encryptedBytes(envelope), { expected: old.bytes, mode: 0o644 });
  console.log(`Sealed ${payload.files.length} file(s): private/vault.enc.json.`);
}

async function open(options) {
  const { envelope } = await readVault();
  const password = await readPassword(options.passwordFile ?? defaultPassword);
  const payload = await decryptVault(envelope, password);
  await inspect(filesRoot, 'directory');
  const pending = [];
  // Preflight the entire payload and every destination before creating anything.
  for (const file of payload.files) {
    const target = path.join(filesRoot, ...file.path.slice('/private/'.length).split('/'));
    if (!inside(filesRoot, target)) fail('Invalid restore destination.');
    const bytes = file.attachment ? Buffer.from(file.attachment.data, 'base64') : Buffer.from(file.text, 'utf8');
    const existing = await readOptional(target, MAX_PAYLOAD_BYTES);
    if (existing !== null && !existing.equals(bytes)) {
      fail('Local files differ from the vault; move the local changes before running open.');
    }
    if (existing === null) pending.push({ target, bytes });
  }
  await ensureDirectory(filesRoot);
  for (const entry of pending) await atomicWrite(entry.target, entry.bytes);
  console.log(`Opened ${payload.files.length} file(s) into .private/files; restored ${pending.length} file(s).`);
}

async function rotatePassword(options) {
  const old = await readVault();
  const password = await readPassword(options.passwordFile ?? defaultPassword);
  const payload = await decryptVault(old.envelope, password);
  const nextPassword = options.newPasswordFile
    ? await readPassword(options.newPasswordFile)
    : randomBytes(24).toString('base64url');
  if (password === nextPassword) fail('The new password must differ from the current password.');
  const nextEnvelope = await encryptVault(payload, nextPassword);
  const previousLocalPassword = await readOptional(defaultPassword, PASSWORD_FILE_BYTES);
  const nextPasswordBytes = passwordBytes(nextPassword);
  const backups = path.join(local, 'backups');
  await ensureDirectory(backups);
  const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(8).toString('hex')}`;
  const backup = path.join(backups, name);
  await fs.mkdir(backup, { mode: 0o700 });
  await atomicWrite(path.join(backup, 'vault.enc.json'), old.bytes);
  await atomicWrite(path.join(backup, 'password.txt'), passwordBytes(password));
  // Both old artifacts are backed up before changing the active pair. Installing
  // the new key first leaves every crash state recoverable using this backup.
  await atomicWrite(defaultPassword, nextPasswordBytes, { expected: previousLocalPassword });
  try {
    await atomicWrite(vaultPath, encryptedBytes(nextEnvelope), { expected: old.bytes, mode: 0o644 });
  } catch {
    try {
      if (previousLocalPassword === null) {
        const current = await readBounded(defaultPassword, PASSWORD_FILE_BYTES);
        if (!current.equals(nextPasswordBytes)) fail('Local password file changed during rotation.');
        await fs.unlink(defaultPassword);
      } else {
        await atomicWrite(defaultPassword, previousLocalPassword, { expected: nextPasswordBytes });
      }
    } catch {
      fail('Password rotation interrupted; recover the previous vault and password from .private/backups.');
    }
    fail('Password rotation stopped; the previous vault and password are retained in .private/backups.');
  }
  console.log(`Rotated ${payload.files.length} file(s): private/vault.enc.json; backup: .private/backups/${name}; password file: .private/password.txt.`);
}

async function status(options) {
  const stat = await inspect(vaultPath);
  if (stat) await readVault();
  const source = await inspect(filesRoot, 'directory');
  const password = await inspect(options.passwordFile ?? defaultPassword);
  console.log(stat ? `Vault: private/vault.enc.json (${stat.size} bytes; envelope valid).` : 'Vault: private/vault.enc.json (missing).');
  console.log(`Local editing directory: .private/files (${source ? 'present' : 'missing'}).`);
  console.log(`Password file: ${options.passwordFile ? 'specified path' : '.private/password.txt'} (${password ? 'present' : 'missing'}).`);
}

function parseArguments(args) {
  const [command, ...rest] = args;
  if (!['init', 'seal', 'open', 'password', 'status'].includes(command)) fail(usage);
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const option = rest[index];
    const key = option === '--password-file' ? 'passwordFile' : option === '--new-password-file' ? 'newPasswordFile' : null;
    const value = rest[index + 1];
    if (!key || !value || value.startsWith('--') || value.includes('\0') || Object.hasOwn(options, key)) fail(usage);
    options[key] = path.resolve(root, value);
  }
  if (options.newPasswordFile && command !== 'password') fail('--new-password-file is only used by the password command.');
  return { command, options };
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  if (command === 'status') return status(options);
  await ensureDirectory(local);
  const lock = path.join(local, '.vault-lock');
  try {
    await fs.mkdir(lock, { mode: 0o700 });
  } catch (error) {
    if (error.code === 'EEXIST') fail('Another vault command may be active; inspect .private/.vault-lock before retrying.');
    throw error;
  }
  try {
    const commands = { init: initialize, seal, open, password: rotatePassword };
    await commands[command](options);
  } finally {
    await fs.rmdir(lock);
  }
}

main().catch(error => {
  // Do not print native parser errors, arguments, stack traces, or input bytes.
  console.error(error instanceof VaultError ? error.message : `Vault filesystem operation failed (${error.code ?? 'IO_ERROR'}).`);
  process.exitCode = 1;
});
