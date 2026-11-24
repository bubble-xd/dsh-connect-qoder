/**
 * Credential readers for both Qoder channels.
 *
 * Each Qoder product signs in separately and stores the result differently:
 *
 *   cn     — Electron safe-storage blob `auth.v1.dat` in the desktop app's
 *            userData directory (`%APPDATA%/com.qodercn.app.stable`).
 *   global — VS Code secret storage inside `state.vscdb`
 *            (`%APPDATA%/Qoder/User/globalStorage`), one row per secret.
 *
 * Both encrypt with the same Chromium scheme, so the AES key derivation is
 * shared:
 *
 *   "Local State" → os_crypt.encrypted_key (base64, "DPAPI" prefix)
 *   DPAPI Unprotect(CurrentUser) → 32-byte AES-256 key
 *   blob          → "v10" + 12-byte IV + ciphertext + 16-byte GCM tag
 *
 * The decrypted record carries a short-lived device token plus a long-lived
 * refresh token; the device token on disk is usually already stale, so it is
 * refreshed over HTTPS before use.
 *
 * @module dsh-connect-qoder/auth
 */

import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createDecipheriv, createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readRowsByPrefix } from './sqlite-keys.js'
import { regionOf } from './regions.js'

/** Device-token refresh endpoint, shared by both channels. */
export const REFRESH_PATH = '/api/v1/deviceToken/refresh'

/** CN userData directory names, most specific first. */
const CN_USERDATA_NAMES = ['com.qodercn.app.stable', 'com.qodercn.app', 'Qoder CN']

/** Global userData directory names, most specific first. */
const GLOBAL_USERDATA_NAMES = ['Qoder', 'Qoder CN']

/** Where Windows keeps per-user application data. */
function roamingRoot() {
  return process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
}

/**
 * Candidate userData directories for one channel.
 * @param {'cn'|'global'} regionId - channel identifier.
 * @param {string | undefined} override - explicit directory from config.
 * @returns {string[]} absolute candidate directories.
 */
export function userDataCandidates(regionId, override) {
  const out = []
  if (override !== undefined && override.trim() !== '') out.push(override.trim())
  const root = roamingRoot()
  for (const name of regionId === 'cn' ? CN_USERDATA_NAMES : GLOBAL_USERDATA_NAMES) out.push(join(root, name))
  return out
}

/**
 * Run DPAPI decryption in PowerShell.
 * @param {Buffer} payload - DPAPI-protected bytes.
 * @returns {Promise<Buffer>} plaintext key material.
 */
function dpapiUnprotect(payload) {
  const script = [
    'Add-Type -AssemblyName System.Security',
    '$b=[System.Convert]::FromBase64String($env:DSH_DPAPI_BLOB)',
    '$p=[System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
    '[System.Convert]::ToBase64String($p)',
  ].join(';')
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { env: { ...process.env, DSH_DPAPI_BLOB: payload.toString('base64') }, windowsHide: true, maxBuffer: 1 << 20 },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(new Error(`DPAPI unprotect failed: ${String(stderr || error.message).trim()}`))
          return
        }
        const text = String(stdout).trim()
        if (text === '') {
          reject(new Error('DPAPI unprotect returned no key material'))
          return
        }
        resolve(Buffer.from(text, 'base64'))
      },
    )
  })
}

/**
 * Derive the Chromium safe-storage AES key from a `Local State` file.
 * @param {string} userDataDir - directory holding `Local State`.
 * @returns {Promise<Buffer>} 32-byte AES-256 key.
 */
async function safeStorageKey(userDataDir) {
  const raw = JSON.parse(await readFile(join(userDataDir, 'Local State'), 'utf8'))
  const encoded = raw?.os_crypt?.encrypted_key
  if (typeof encoded !== 'string' || encoded === '') throw new Error('Local State carries no os_crypt.encrypted_key')
  const blob = Buffer.from(encoded, 'base64')
  const prefix = blob.subarray(0, 5).toString('latin1')
  if (prefix !== 'DPAPI') throw new Error(`unsupported os_crypt key prefix "${prefix}"`)
  const key = await dpapiUnprotect(blob.subarray(5))
  if (key.length !== 32) throw new Error(`unexpected AES key length ${key.length}`)
  return key
}

/**
 * Decrypt one safe-storage blob (`v10` layout).
 * @param {Buffer} blob - ciphertext.
 * @param {Buffer} key - AES-256 key.
 * @returns {string} plaintext.
 */
export function decryptSafeStorage(blob, key) {
  const tag = blob.subarray(0, 3).toString('latin1')
  if (tag !== 'v10') throw new Error(`unsupported auth blob prefix "${tag}"`)
  const iv = blob.subarray(3, 15)
  const ciphertext = blob.subarray(15, blob.length - 16)
  const authTag = blob.subarray(blob.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

/**
 * Turn one secret-storage row value into its decrypted text.
 * @param {string} value - the `{"type":"Buffer","data":[…]}` wrapper.
 * @param {Buffer} key - AES-256 key.
 * @returns {string | undefined} plaintext, or undefined when unreadable.
 */
function decryptSecretRow(value, key) {
  let parsed
  try {
    parsed = JSON.parse(value)
  } catch {
    return undefined
  }
  if (!Array.isArray(parsed?.data)) return undefined
  try {
    return decryptSafeStorage(Buffer.from(parsed.data), key)
  } catch {
    return undefined
  }
}

/**
 * Normalize any expiry the Qoder surfaces hand us into epoch milliseconds.
 *
 * The desktop records store either an ISO string or a millisecond number, and
 * the worker refuses an `expiresAt` that is not a finite number above 1e12, so
 * every reader funnels through here.
 * @param {unknown} value - ISO string, epoch seconds, or epoch milliseconds.
 * @returns {number | undefined} epoch milliseconds.
 */
function parseExpiry(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? value : Math.round(value * 1000)
  }
  if (typeof value === 'string' && value !== '') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
    const numeric = Number(value)
    if (Number.isFinite(numeric) && numeric > 0) return numeric > 1e12 ? numeric : Math.round(numeric * 1000)
  }
  return undefined
}

/**
 * Read the CN desktop sign-in record.
 * @param {string | undefined} override - explicit userData directory.
 * @returns {Promise<{token: string, refreshToken: string, expiresAt?: number, user?: object, source: string}>}
 */
async function readCnAuth(override, strict) {
  let lastError
  for (const dir of strict ? [override] : userDataCandidates('cn', override)) {
    let blob
    try {
      blob = await readFile(join(dir, 'auth.v1.dat'))
    } catch (error) {
      lastError = error
      continue
    }
    const key = await safeStorageKey(dir)
    const record = JSON.parse(decryptSafeStorage(blob, key))
    if (typeof record?.token !== 'string' || record.token === '') throw new Error('decrypted auth record carries no token')
    return {
      token: record.token,
      refreshToken: typeof record.refreshToken === 'string' ? record.refreshToken : '',
      expiresAt: parseExpiry(record.expiresAt),
      user: record.user ?? undefined,
      source: join(dir, 'auth.v1.dat'),
    }
  }
  const detail = lastError === undefined ? 'no candidate path exists' : String(lastError.message ?? lastError)
  throw new Error(`Qoder CN sign-in not found (${detail}); sign in to the Qoder CN desktop app or set its data directory in settings`)
}

/** Secret-storage keys that may hold the global sign-in, most complete first. */
const GLOBAL_USERINFO_KEYS = ['secret://aicoding.auth.userInfo']
const GLOBAL_TOKEN_KEYS = [
  'secret://{"extensionId":"aicoding.aicoding-agent","key":"secret.pkce.access.token"}',
  'secret://{"extensionId":"alibaba-cloud.tongyi-lingma","key":"cosyAuthSecret"}',
]
const GLOBAL_REFRESH_KEYS = [
  'secret://{"extensionId":"aicoding.aicoding-agent","key":"secret.pkce.refresh.token"}',
]

/**
 * Read the global sign-in record from VS Code secret storage.
 * @param {string | undefined} override - explicit userData directory.
 * @returns {Promise<{token: string, refreshToken: string, expiresAt?: number, user?: object, source: string}>}
 */
async function readGlobalAuth(override, strict) {
  let lastError
  for (const dir of strict ? [override] : userDataCandidates('global', override)) {
    const database = join(dir, 'User', 'globalStorage', 'state.vscdb')
    let rows
    try {
      rows = await readRowsByPrefix(database, 'secret://')
    } catch (error) {
      lastError = error
      continue
    }
    if (rows.size === 0) {
      lastError = new Error('no secret rows in state.vscdb')
      continue
    }
    const key = await safeStorageKey(dir)

    // The userInfo row is the most complete: it carries the account, the
    // device token, the refresh token and the expiry in one record.
    for (const name of GLOBAL_USERINFO_KEYS) {
      const text = rows.has(name) ? decryptSecretRow(rows.get(name), key) : undefined
      if (text === undefined) continue
      let record
      try {
        record = JSON.parse(text)
      } catch {
        continue
      }
      const token = typeof record?.token === 'string' && record.token !== '' ? record.token : undefined
      if (token === undefined) continue
      return {
        token,
        refreshToken: typeof record.refreshToken === 'string' ? record.refreshToken : '',
        expiresAt: parseExpiry(record.expireTime),
        user: {
          id: record.id,
          name: record.name,
          username: record.name,
          email: record.email,
          avatarUrl: record.avatarUrl,
        },
        source: `${database} (${name})`,
      }
    }

    // Fall back to the individual PKCE rows.
    const token = GLOBAL_TOKEN_KEYS.map(name => (rows.has(name) ? decryptSecretRow(rows.get(name), key) : undefined))
      .find(text => typeof text === 'string' && text.startsWith('dt-'))
    const refreshToken = GLOBAL_REFRESH_KEYS.map(name => (rows.has(name) ? decryptSecretRow(rows.get(name), key) : undefined))
      .find(text => typeof text === 'string' && text.startsWith('drt-'))
    if (token !== undefined) {
      return { token, refreshToken: refreshToken ?? '', expiresAt: undefined, user: undefined, source: database }
    }
    lastError = new Error('secret rows carry no readable device token')
  }
  const detail = lastError === undefined ? 'no candidate path exists' : String(lastError.message ?? lastError)
  throw new Error(`Qoder sign-in not found (${detail}); sign in to the Qoder desktop app or set its data directory in settings`)
}

/**
 * Read the sign-in record for one channel.
 * @param {'cn'|'global'} regionId - channel identifier.
 * @param {string | undefined} override - explicit userData directory.
 * @returns {Promise<{token: string, refreshToken: string, expiresAt?: string | number, user?: object, source: string}>}
 */
export async function readDesktopAuth(regionId, override, { strict = false } = {}) {
  return regionId === 'cn' ? readCnAuth(override, strict) : readGlobalAuth(override, strict)
}

/**
 * Exchange a refresh token for a fresh device token.
 * @param {'cn'|'global'} regionId - channel identifier.
 * @param {string} refreshToken - `drt-…` value.
 * @param {AbortSignal | undefined} signal - cancellation.
 * @returns {Promise<{token: string, refreshToken: string, expiresAt?: number}>}
 */
export async function refreshDeviceToken(regionId, refreshToken, signal) {
  const region = regionOf(regionId)
  const response = await fetch(`${region.origin}${REFRESH_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
    signal,
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`token refresh failed (${response.status}): ${text.slice(0, 200)}`)
  const body = JSON.parse(text)
  const token = body?.device_token
  if (typeof token !== 'string' || token === '') throw new Error('token refresh returned no device_token')
  return {
    token,
    refreshToken: typeof body.refresh_token === 'string' && body.refresh_token !== '' ? body.refresh_token : refreshToken,
    expiresAt: parseExpiry(body.expires_at),
  }
}

/**
 * Read the account profile for a device token.
 * @param {'cn'|'global'} regionId - channel identifier.
 * @param {string} token - `dt-…` device token.
 * @param {AbortSignal | undefined} signal - cancellation.
 * @returns {Promise<object | undefined>} upstream user payload.
 */
export async function fetchUserInfo(regionId, token, signal) {
  const region = regionOf(regionId)
  try {
    const response = await fetch(`${region.origin}/api/v1/userinfo`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal,
    })
    if (!response.ok) return undefined
    return await response.json()
  } catch {
    return undefined
  }
}

/**
 * Read the credit balance for a device token.
 * @param {'cn'|'global'} regionId - channel identifier.
 * @param {string} token - `dt-…` device token.
 * @param {AbortSignal | undefined} signal - cancellation.
 * @returns {Promise<object | undefined>} upstream usage payload.
 */
export async function fetchUsage(regionId, token, signal) {
  const region = regionOf(regionId)
  try {
    const response = await fetch(`${region.origin}/api/v2/quota/usage`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal,
    })
    if (!response.ok) return undefined
    return await response.json()
  } catch {
    return undefined
  }
}

/**
 * Read the plan record for a device token.
 * @param {'cn'|'global'} regionId - channel identifier.
 * @param {string} token - `dt-…` device token.
 * @param {AbortSignal | undefined} signal - cancellation.
 * @returns {Promise<object | undefined>} upstream plan payload.
 */
export async function fetchPlan(regionId, token, signal) {
  const region = regionOf(regionId)
  try {
    const response = await fetch(`${region.origin}/api/v2/user/plan`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal,
    })
    if (!response.ok) return undefined
    return await response.json()
  } catch {
    return undefined
  }
}

/**
 * Short, non-reversible fingerprint of a token, for diagnostics only.
 * @param {string} token - any token string.
 * @returns {string} first 8 hex characters of its SHA-256.
 */
export function tokenFingerprint(token) {
  return createHash('sha256').update(token).digest('hex').slice(0, 8)
}
