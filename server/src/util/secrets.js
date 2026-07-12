// At-rest encryption for UI-saved API keys (Phase 2-3).
//
// Threat model: the SQLite file leaks on its own (cloud backup, copied
// veemp-data folder, stray zip). Values encrypted here are unreadable without
// the SEPARATE key file that lives next to the database (`.veemp-secret`).
// This is deliberately NOT tied to OS keychains — zero dependencies, portable
// (copying the whole data folder keeps working), and honest about its
// boundary: an attacker with full disk access can read both files; one with
// only the DB cannot.
//
// Format: enc:v1:<iv b64>:<authTag b64>:<ciphertext b64>  (AES-256-GCM)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const PREFIX = 'enc:v1:';
let cachedKey = null;

/** The 32-byte key, created lazily next to the DB. In-memory DBs (tests) get
 *  an ephemeral key — nothing persists anyway. */
function masterKey() {
  if (cachedKey) return cachedKey;
  if (config.dbFile === ':memory:') {
    cachedKey = crypto.randomBytes(32);
    return cachedKey;
  }
  const file = path.join(path.dirname(config.dbFile), '.veemp-secret');
  try {
    const raw = fs.readFileSync(file);
    if (raw.length === 32) { cachedKey = raw; return cachedKey; }
  } catch { /* first run */ }
  cachedKey = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, cachedKey, { mode: 0o600 }); // mode is a no-op on Windows, meaningful elsewhere
  return cachedKey;
}

/** Encrypt a secret string for storage. Empty stays empty. */
export function encryptSecret(plain) {
  const value = String(plain || '');
  if (!value) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  const ct = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return PREFIX + [iv, cipher.getAuthTag(), ct].map((b) => b.toString('base64')).join(':');
}

/**
 * Decrypt a stored value. Legacy PLAINTEXT values (saved before encryption
 * existed) pass through unchanged so nothing breaks — callers may re-save to
 * upgrade them. A value that has the prefix but fails to decrypt (e.g. the
 * key file was deleted) returns '' — an honest "not configured" beats a crash.
 */
export function decryptSecret(storedValue) {
  const value = String(storedValue || '');
  if (!value.startsWith(PREFIX)) return value; // legacy plaintext or empty
  try {
    const [iv, tag, ct] = value.slice(PREFIX.length).split(':').map((s) => Buffer.from(s, 'base64'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

/** Whether a stored value is already in encrypted form. */
export function isEncrypted(storedValue) {
  return String(storedValue || '').startsWith(PREFIX);
}
