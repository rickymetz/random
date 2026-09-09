/**
 * Encrypted export/import (REQUIREMENTS.md §4.5, threat T2).
 *
 * The only way data leaves the device. The bundle is a small JSON header
 * (format, KDF params, salt, iv — nothing sensitive) around an AES-GCM
 * ciphertext of all records, keyed from the passphrase alone so a backup
 * opens on a fresh device with no other material. Exporting requires
 * re-entering the passphrase, which doubles as proof the user still knows
 * it. There is deliberately no plaintext export path.
 */
import {
  DEFAULT_KDF_PARAMS,
  deriveExportKey,
  randomBytes,
  validateKdfParams,
  type KdfParams,
} from './crypto'
import type { DomainRecord } from './models'

export const EXPORT_FORMAT = 'dossier-export'
// v1: records only. v2: adds photo blobs.
export const EXPORT_VERSION = 2

export interface ExportBlob {
  id: string
  bytes: Uint8Array
}

export interface ImportedBundle {
  records: DomainRecord[]
  blobs: ExportBlob[]
}

interface ExportHeader {
  format: typeof EXPORT_FORMAT
  version: number
  kdf: KdfParams
  salt: string
  iv: string
  data: string
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
}

export async function exportBundle(
  passphrase: string,
  records: DomainRecord[],
  blobs: ExportBlob[] = [],
): Promise<string> {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = await deriveExportKey(passphrase, salt)
  const payload = {
    records,
    blobs: blobs.map((b) => ({ id: b.id, b64: toBase64(b.bytes) })),
  }
  const plaintext = new TextEncoder().encode(JSON.stringify(payload))
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    plaintext as BufferSource,
  )
  const header: ExportHeader = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    kdf: DEFAULT_KDF_PARAMS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(ciphertext)),
  }
  return JSON.stringify(header)
}

/** Throws on a bad file; returns null on a wrong passphrase. */
export async function importBundle(
  passphrase: string,
  fileText: string,
): Promise<ImportedBundle | null> {
  let header: ExportHeader
  try {
    header = JSON.parse(fileText) as ExportHeader
  } catch {
    throw new Error('Not a backup file.')
  }
  if (header.format !== EXPORT_FORMAT || typeof header.data !== 'string') {
    throw new Error('Not a backup file.')
  }
  if (header.version > EXPORT_VERSION) {
    throw new Error('Backup was made by a newer version of the app.')
  }
  // The header is attacker-controlled: bound the KDF params (a crafted
  // 2-billion-iteration header would otherwise hang the device) and turn
  // malformed base64/fields into the friendly error, not a raw TypeError.
  let key: CryptoKey
  let salt: Uint8Array
  let iv: Uint8Array
  let data: Uint8Array
  try {
    const kdf = validateKdfParams(header.kdf)
    salt = fromBase64(header.salt)
    iv = fromBase64(header.iv)
    data = fromBase64(header.data)
    if (salt.length < 8 || iv.length !== 12) throw new Error('bad header')
    key = await deriveExportKey(passphrase, salt, kdf)
  } catch {
    throw new Error('Not a backup file.')
  }
  try {
    const plaintext = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      data as BufferSource,
    )
    const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as {
      records: DomainRecord[]
      blobs?: { id: string; b64: string }[]
    }
    const blobs: ExportBlob[] = []
    for (const b of parsed.blobs ?? []) {
      if (typeof b?.id === 'string' && typeof b?.b64 === 'string') {
        try {
          blobs.push({ id: b.id, bytes: fromBase64(b.b64) })
        } catch {
          // Skip undecodable blob entries.
        }
      }
    }
    return { records: parsed.records, blobs }
  } catch {
    return null
  }
}

/** Nondescript filename (§6.5): no product name, no hint at contents. */
export function exportFileName(): string {
  const d = new Date()
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  return `backup-${stamp}.ledger`
}
