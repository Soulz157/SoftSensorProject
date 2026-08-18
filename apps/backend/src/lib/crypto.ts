import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Symmetric encryption for Data Source connection secrets (passwords, API keys,
 * bearer tokens). AES-256-GCM — authenticated, so tampering is detectable.
 *
 * The key comes from DATASOURCE_ENCRYPTION_KEY (server-only env, never
 * NEXT_PUBLIC_). Accepts a 32-byte key as base64 or hex. Rotating the key makes
 * existing ciphertext undecryptable, so treat it as a long-lived secret.
 *
 * Stored format: `v1:<iv>:<authTag>:<ciphertext>` (each part base64). The `v1`
 * prefix lets us change the scheme later without ambiguous parsing.
 */

const SCHEME = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit nonce — the GCM standard
const KEY_BYTES = 32;

let cachedKey: Buffer | null = null;

function loadKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.DATASOURCE_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'DATASOURCE_ENCRYPTION_KEY is not set — cannot encrypt/decrypt Data Source secrets.',
    );
  }

  let key: Buffer | null = null;

  // Prefer an exact 32-byte key supplied as base64 or hex.
  const asBase64 = tryDecode(raw, 'base64');
  if (asBase64?.length === KEY_BYTES) key = asBase64;

  if (!key) {
    const asHex = tryDecode(raw, 'hex');
    if (asHex?.length === KEY_BYTES) key = asHex;
  }

  if (!key) {
    throw new Error(
      'DATASOURCE_ENCRYPTION_KEY must be a 32-byte key encoded as base64 or hex.',
    );
  }

  cachedKey = key;
  return key;
}

function tryDecode(value: string, encoding: 'base64' | 'hex'): Buffer | null {
  try {
    const buf = Buffer.from(value, encoding);
    // Buffer.from is lenient; re-encode to reject malformed input.
    if (
      buf.toString(encoding).replace(/=+$/, '') !== value.replace(/=+$/, '')
    ) {
      return null;
    }
    return buf;
  } catch {
    return null;
  }
}

/** Encrypt a UTF-8 string. Empty input returns '' (no ciphertext for no secret). */
export function encryptSecret(plaintext: string): string {
  if (plaintext === '') return '';

  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    SCHEME,
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

/** Decrypt a value produced by encryptSecret. Empty input returns ''. */
export function decryptSecret(stored: string): string {
  if (stored === '') return '';

  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== SCHEME) {
    throw new Error('Ciphertext is malformed or uses an unsupported scheme.');
  }

  const key = loadKey();
  const iv = Buffer.from(parts[1], 'base64');
  const authTag = Buffer.from(parts[2], 'base64');
  const ciphertext = Buffer.from(parts[3], 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8');
}

/** True when a stored value looks like our ciphertext format (not plaintext). */
export function isEncrypted(value: string): boolean {
  return value.startsWith(`${SCHEME}:`) && value.split(':').length === 4;
}

/** Constant-time equality for comparing secrets without leaking length/timing. */
export function secretsEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
