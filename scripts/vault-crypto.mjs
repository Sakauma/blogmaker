import { createCipheriv, createDecipheriv, pbkdf2, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';

export const MAX_VAULT_BYTES = 32 * 1024 * 1024;
// Leave room for base64 expansion, the authentication tag, and envelope fields.
export const MAX_PAYLOAD_BYTES = 24 * 1024 * 1024 - 1024;
export const MAX_FILES = 10000;
const ITERATIONS = 600000;
const deriveKey = promisify(pbkdf2);
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export class VaultError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VaultError';
  }
}

function fail(message) {
  throw new VaultError(message);
}

function record(value, required, optional = []) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    fail('Invalid vault object.');
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string' || ![...required, ...optional].includes(key))
      || required.some(key => !Object.hasOwn(value, key))
      || keys.some(key => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable;
      })) {
    fail('Invalid vault fields.');
  }
}

function validString(value, maxBytes, message) {
  if (typeof value !== 'string' || value.length > maxBytes
      || !value.isWellFormed() || Buffer.byteLength(value, 'utf8') > maxBytes) {
    fail(message);
  }
}

function base64(value, maxBytes, minBytes = 0) {
  if (typeof value !== 'string' || value.length > 4 * Math.ceil(maxBytes / 3)
      || value.length % 4 !== 0
      || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    fail('Invalid vault base64.');
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length < minBytes || bytes.length > maxBytes || bytes.toString('base64') !== value) {
    fail('Invalid vault base64 length or encoding.');
  }
  return bytes;
}

function jsonEscapingBytes(text) {
  let extra = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code === 34 || code === 92) extra++;
    else if (code < 32) extra += [8, 9, 10, 12, 13].includes(code) ? 1 : 5;
  }
  return extra;
}

function validPassword(password) {
  validString(password, 4096, 'Password must contain 12 or more characters (at most 4096 UTF-8 bytes).');
  if ([...password].length < 12) {
    fail('Password must contain 12 or more characters (at most 4096 UTF-8 bytes).');
  }
}

function validPath(value) {
  validString(value, 1024, 'Invalid private file path.');
  if (!value.startsWith('/private/') || /[\\\x00-\x1f\x7f<>:"|?*]/u.test(value)) {
    fail('Invalid private file path.');
  }
  const parts = value.slice('/private/'.length).split('/');
  if (parts.length > 64 || parts.some(part => !part || part === '.' || part === '..'
      || /[. ]$/u.test(part) || Buffer.byteLength(part, 'utf8') > 255
      || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(part)
      // Disallow encoded separators/traversal and nested URL-encoding ambiguity.
      || /%(?:2e|2f|5c|25|00)/iu.test(part))) {
    fail('Invalid private file path.');
  }
  // A portable vault must not map two files to one Windows/macOS destination.
  return parts.map(part => part.normalize('NFC').toLowerCase()).join('/');
}

/** Validate a version-1 Payload, returning the same object or throwing VaultError. */
export function validatePayload(payload) {
  record(payload, ['version', 'files']);
  if (payload.version !== 1 || !Array.isArray(payload.files) || payload.files.length > MAX_FILES) {
    fail('Invalid vault payload version or file count.');
  }
  // Reject custom array serialization and sparse entries before JSON.stringify.
  const keys = Reflect.ownKeys(payload.files);
  if (Object.getPrototypeOf(payload.files) !== Array.prototype
      || keys.length !== payload.files.length + 1
      || keys.some(key => key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key)))
      || keys.some(key => !Object.hasOwn(Object.getOwnPropertyDescriptor(payload.files, key), 'value'))) {
    fail('Invalid vault file list.');
  }
  const paths = new Set();
  let byteCount = 0;
  for (const file of payload.files) {
    record(file, ['path', 'text'], ['attachment']);
    const key = validPath(file.path);
    if (paths.has(key)) fail('Duplicate private file path.');
    paths.add(key);
    validString(file.text, MAX_PAYLOAD_BYTES, 'Invalid or oversized vault text.');
    byteCount += Buffer.byteLength(file.path, 'utf8') + Buffer.byteLength(file.text, 'utf8') + jsonEscapingBytes(file.text);
    if (byteCount > MAX_PAYLOAD_BYTES) fail('Vault payload exceeds the size limit.');
    if (Object.hasOwn(file, 'attachment')) {
      record(file.attachment, ['mime', 'data']);
      if (typeof file.attachment.mime !== 'string' || file.attachment.mime.length > 127
          || !/^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/.test(file.attachment.mime)) {
        fail('Invalid attachment MIME type.');
      }
      if (typeof file.attachment.data !== 'string' || file.attachment.data.length > MAX_PAYLOAD_BYTES - byteCount) {
        fail('Invalid or oversized vault attachment.');
      }
      base64(file.attachment.data, MAX_PAYLOAD_BYTES);
      byteCount += file.attachment.mime.length + file.attachment.data.length;
    }
    if (byteCount > MAX_PAYLOAD_BYTES) fail('Vault payload exceeds the size limit.');
  }
  for (const key of paths) {
    const parts = key.split('/');
    for (let end = 1; end < parts.length; end++) {
      if (paths.has(parts.slice(0, end).join('/'))) fail('Private file and directory paths conflict.');
    }
  }
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_PAYLOAD_BYTES) {
    fail('Vault payload exceeds the size limit.');
  }
  return payload;
}

/** Validate the fixed-cost version-1 Envelope before any password derivation. */
export function validateEnvelope(envelope) {
  record(envelope, ['version', 'kdf', 'iterations', 'salt', 'cipher', 'iv', 'data']);
  if (envelope.version !== 1 || envelope.kdf !== 'PBKDF2-SHA256'
      || envelope.iterations !== ITERATIONS || envelope.cipher !== 'AES-256-GCM') {
    fail('Unsupported vault encryption protocol.');
  }
  base64(envelope.salt, 16, 16);
  base64(envelope.iv, 12, 12);
  base64(envelope.data, MAX_PAYLOAD_BYTES + 16, 17);
  if (Buffer.byteLength(JSON.stringify(envelope), 'utf8') > MAX_VAULT_BYTES) {
    fail('Encrypted vault exceeds the size limit.');
  }
  return envelope;
}

/** encryptVault(Payload, string): Promise<Envelope>. A fresh salt and IV are used on every call. */
export async function encryptVault(payload, password) {
  validatePayload(payload);
  validPassword(password);
  // Snapshot before the asynchronous KDF so callers cannot mutate the checked input.
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  let key;
  try {
    key = await deriveKey(password, salt, ITERATIONS, 32, 'sha256');
    const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    const data = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
    return validateEnvelope({
      version: 1,
      kdf: 'PBKDF2-SHA256',
      iterations: ITERATIONS,
      salt: salt.toString('base64'),
      cipher: 'AES-256-GCM',
      iv: iv.toString('base64'),
      data: data.toString('base64'),
    });
  } finally {
    key?.fill(0);
    plaintext.fill(0);
  }
}

/** decryptVault(Envelope, string): Promise<Payload>. Authentication precedes JSON parsing. */
export async function decryptVault(envelope, password) {
  validateEnvelope(envelope);
  validPassword(password);
  const salt = Buffer.from(envelope.salt, 'base64');
  const iv = Buffer.from(envelope.iv, 'base64');
  const data = Buffer.from(envelope.data, 'base64');
  let key;
  let plaintext;
  let partial;
  try {
    key = await deriveKey(password, salt, ITERATIONS, 32, 'sha256');
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
      decipher.setAuthTag(data.subarray(-16));
      partial = decipher.update(data.subarray(0, -16));
      plaintext = Buffer.concat([partial, decipher.final()]);
    } catch {
      fail('Vault authentication failed: wrong password or damaged encrypted data.');
    }
    let payload;
    try {
      payload = JSON.parse(utf8.decode(plaintext));
    } catch {
      // JSON parser messages can contain decrypted content; never forward them.
      fail('Invalid decrypted vault JSON.');
    }
    return validatePayload(payload);
  } finally {
    key?.fill(0);
    partial?.fill(0);
    plaintext?.fill(0);
  }
}
