const crypto = require('crypto');

// Master encryption key derived via SHA-256 to guarantee 32 bytes for AES-256-GCM
const RAW_KEY =
  process.env.ENCRYPTION_MASTER_KEY ||
  process.env.JWT_SECRET ||
  'weveprint-aes-256-gcm-master-vault-key-2026';

const ENCRYPTION_KEY = crypto.createHash('sha256').update(RAW_KEY).digest();
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Standard 96-bit IV for GCM

/**
 * Encrypts a sensitive credential (e.g. Razorpay Key ID or Secret) using AES-256-GCM.
 * Formatted as: enc:v1:<iv_hex>:<authTag_hex>:<cipher_hex>
 * @param {string} text
 * @returns {string|null}
 */
function encryptCredential(text) {
  if (!text || typeof text !== 'string') return text;
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Prevent double encryption
  if (trimmed.startsWith('enc:v1:')) {
    return trimmed;
  }

  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);

    let encrypted = cipher.update(trimmed, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag().toString('hex');
    const ivHex = iv.toString('hex');

    return `enc:v1:${ivHex}:${authTag}:${encrypted}`;
  } catch (err) {
    console.error('[Crypto Error] Failed to encrypt credential:', err.message);
    throw new Error('Credential encryption failed');
  }
}

/**
 * Decrypts a sensitive credential stored with AES-256-GCM.
 * Supports legacy unencrypted values gracefully (backward compatibility).
 * @param {string} text
 * @returns {string|null}
 */
function decryptCredential(text) {
  if (!text || typeof text !== 'string') return text;
  const trimmed = text.trim();
  if (!trimmed) return null;

  // If not encrypted with our schema, return as-is (graceful fallback)
  if (!trimmed.startsWith('enc:v1:')) {
    return trimmed;
  }

  try {
    const parts = trimmed.split(':');
    if (parts.length !== 5) {
      console.warn('[Crypto Warning] Invalid encrypted format, returning null');
      return null;
    }

    const ivHex = parts[2];
    const authTagHex = parts[3];
    const encryptedHex = parts[4];

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (err) {
    console.error('[Crypto Error] Failed to decrypt credential:', err.message);
    return null;
  }
}

/**
 * Checks if a string is encrypted with enc:v1:
 * @param {string} str
 * @returns {boolean}
 */
function isEncrypted(str) {
  return typeof str === 'string' && str.startsWith('enc:v1:');
}

/**
 * Masks a key for UI presentation (e.g. rzp_live_••••1234)
 * @param {string} key
 * @returns {string}
 */
function maskKey(key) {
  if (!key || typeof key !== 'string') return '';
  const decrypted = decryptCredential(key);
  if (!decrypted) return '';
  if (decrypted.length <= 8) return '••••••••';
  const prefix = decrypted.slice(0, 8);
  const suffix = decrypted.slice(-4);
  return `${prefix}••••${suffix}`;
}

module.exports = {
  encryptCredential,
  decryptCredential,
  isEncrypted,
  maskKey,
};
