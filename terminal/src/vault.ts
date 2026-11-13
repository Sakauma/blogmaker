import type { ContentFile } from './content';

const MAX_ENVELOPE = 32 * 1024 * 1024;
interface Envelope {
  version: number;
  kdf: string;
  iterations: number;
  salt: string;
  cipher: string;
  iv: string;
  data: string;
}
const abort = (signal: AbortSignal): void => { if (signal.aborted) throw new DOMException('Cancelled', 'AbortError'); };
function bytes(value: unknown): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error('资料包格式有误。');
  }
  const decoded = atob(value);
  if (btoa(decoded) !== value) throw new Error('资料包格式有误。');
  const result = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) result[i] = decoded.charCodeAt(i);
  return result;
}
async function readEnvelope(response: Response): Promise<Envelope> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('私密资料加载失败。');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > MAX_ENVELOPE) { await reader.cancel(); throw new Error('资料包超过浏览器读取大小。'); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const buffer = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)) as Envelope; }
  catch { throw new Error('资料包格式有误。'); }
}

/** The password stays in this tab. Only encrypted bytes are requested from the site. */
export async function decryptPrivateVault(url: string, password: string, signal: AbortSignal): Promise<ContentFile[]> {
  if (!crypto.subtle) throw new Error('请通过 HTTPS 或本地预览打开私密资料。');
  const address = new URL(url, location.origin);
  if (address.origin !== location.origin || address.pathname !== '/private/vault.json') throw new Error('私密资料地址有误。');
  abort(signal);
  const response = await fetch(address, { signal, cache: 'no-store', credentials: 'omit', redirect: 'error' });
  if (!response.ok) throw new Error('私密资料加载失败，请重试。');
  const envelope = await readEnvelope(response);
  if (!envelope || envelope.version !== 1 || envelope.kdf !== 'PBKDF2-SHA256' || envelope.iterations !== 600000 || envelope.cipher !== 'AES-256-GCM') {
    throw new Error('资料包格式有误。');
  }
  const salt = bytes(envelope.salt), iv = bytes(envelope.iv), encrypted = bytes(envelope.data);
  if (salt.length !== 16 || iv.length !== 12 || encrypted.length < 16) throw new Error('资料包格式有误。');
  abort(signal);
  const passwordBytes = new TextEncoder().encode(password);
  const material = await crypto.subtle.importKey('raw', passwordBytes, 'PBKDF2', false, ['deriveKey']);
  passwordBytes.fill(0);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  abort(signal);
  let plain: ArrayBuffer;
  try { plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, encrypted); }
  catch { abort(signal); throw new Error('密码不正确，或资料包已损坏。'); }
  const plainBytes = new Uint8Array(plain);
  try {
    abort(signal);
    let payload: { version?: number; files?: ContentFile[] };
    try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plainBytes)); }
    catch { throw new Error('资料包内容有误。'); }
    if (!payload || payload.version !== 1 || !Array.isArray(payload.files)) throw new Error('资料包内容有误。');
    return payload.files;
  } finally { plainBytes.fill(0); }
}

export function privateDownload(file: ContentFile): { url: string; name: string } {
  const blob = file.attachment
    ? new Blob([bytes(file.attachment.data)], { type: file.attachment.mime })
    : new Blob([file.text], { type: 'text/plain;charset=utf-8' });
  return { url: URL.createObjectURL(blob), name: file.path.slice(file.path.lastIndexOf('/') + 1) };
}
