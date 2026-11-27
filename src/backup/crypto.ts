/** Password-based encryption for backups: AES-256-GCM with a PBKDF2-SHA256 key. Nothing leaves the device. */
const enc = new TextEncoder();
const dec = new TextDecoder();
export const KDF_ITERATIONS = 600_000;

export const toB64 = (u8: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};
export const fromB64 = (s: string): Uint8Array => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export interface Envelope {
  app: 'SPRM Rice Mill';
  format: 'sprm-backup-encrypted';
  formatVersion: 1;
  cipher: 'AES-256-GCM';
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  /** unique per backup */ salt: string;
  /** unique per backup */ iv: string;
  createdAt: string;
  data: string;
}

/** The password is only used to build this key object; it is never stored. The key itself cannot be read back out. */
export function passwordBaseKey(password: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
}
const deriveAes = (base: CryptoKey, salt: Uint8Array, iterations: number) =>
  crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
// the header is authenticated too, so changing the iteration count or date in the file is detected
const aad = (iterations: number, createdAt: string) => enc.encode(`SPRM|1|AES-256-GCM|${iterations}|${createdAt}`);

export async function encryptText(plain: string, base: CryptoKey): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const createdAt = new Date().toISOString();
  const key = await deriveAes(base, salt, KDF_ITERATIONS);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(KDF_ITERATIONS, createdAt) as BufferSource }, key, enc.encode(plain));
  const env: Envelope = {
    app: 'SPRM Rice Mill', format: 'sprm-backup-encrypted', formatVersion: 1, cipher: 'AES-256-GCM', kdf: 'PBKDF2-SHA256',
    iterations: KDF_ITERATIONS, salt: toB64(salt), iv: toB64(iv), createdAt, data: toB64(new Uint8Array(ct)),
  };
  return JSON.stringify(env);
}

export const isEnvelope = (x: any): x is Envelope => !!x && x.format === 'sprm-backup-encrypted' && typeof x.data === 'string' && typeof x.salt === 'string' && typeof x.iv === 'string';

/** Throws a clear error when the password is wrong or the file was changed / damaged (GCM authentication fails). */
export async function decryptEnvelope(env: Envelope, password: string): Promise<string> {
  if (env.cipher !== 'AES-256-GCM' || env.kdf !== 'PBKDF2-SHA256') throw new Error('This backup uses an unsupported encryption format.');
  if (!(env.iterations >= 100_000 && env.iterations <= 5_000_000)) throw new Error('This backup file is damaged (invalid key settings).');
  try {
    const key = await deriveAes(await passwordBaseKey(password), fromB64(env.salt), env.iterations);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(env.iv) as BufferSource, additionalData: aad(env.iterations, env.createdAt) as BufferSource }, key, fromB64(env.data) as BufferSource);
    return dec.decode(pt);
  } catch {
    throw new Error('Wrong password, or the backup file is damaged or was changed. Nothing was restored.');
  }
}
