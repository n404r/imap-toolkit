import crypto from 'crypto'
import { env } from '../env.js'

const ALGORITHM = 'aes-256-gcm'
const KEY = Buffer.from(env.ENCRYPTION_KEY, 'hex')
const IV_BYTES = 12
const TAG_BYTES = 16

/** Encrypt a plaintext string. Returns a base64-encoded string: iv + ciphertext + authTag */
export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv)
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  // layout: [12-byte IV][N-byte ciphertext][16-byte tag]
  return Buffer.concat([iv, encrypted, tag]).toString('base64')
}

/** Decrypt a base64-encoded string produced by encrypt(). */
export function decrypt(ciphertext: string): string {
  const buf = Buffer.from(ciphertext, 'base64')
  const iv = buf.subarray(0, IV_BYTES)
  const tag = buf.subarray(buf.length - TAG_BYTES)
  const encrypted = buf.subarray(IV_BYTES, buf.length - TAG_BYTES)
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv)
  decipher.setAuthTag(tag)
  return decipher.update(encrypted).toString('utf8') + decipher.final('utf8')
}

/** Hash the admin password with PBKDF2 for safe comparison. */
export function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 100_000, 32, 'sha256').toString('hex')
}

/** Generate a random hex salt. */
export function generateSalt(): string {
  return crypto.randomBytes(16).toString('hex')
}
