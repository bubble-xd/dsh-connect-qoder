/**
 * Minimal read-only SQLite reader for one two-column table.
 *
 * Qoder's global build keeps its sign-in in VS Code's `state.vscdb` secret
 * table. That file is ordinary SQLite, but the plugin must not depend on a
 * native module (or on `node:sqlite` being unflagged in whichever Node the
 * harness runs). So this module walks the B-tree pages directly and returns
 * the `(key, value)` pairs whose key matches a predicate.
 *
 * Only what a `SELECT key, value FROM ItemTable WHERE key LIKE ?` needs is
 * implemented: page 1's header offset, leaf/interior table pages, varints,
 * record serial types, and text/utf8 decoding. Overflow chains are skipped,
 * because every row this plugin reads fits in one page.
 *
 * @module dsh-connect-qoder/sqlite-keys
 */

import { readFile } from 'node:fs/promises'

/** SQLite page types. */
const LEAF_TABLE = 0x0d
const INTERIOR_TABLE = 0x05

/**
 * Read one big-endian unsigned integer.
 * @param {Buffer} buffer - source.
 * @param {number} offset - byte offset.
 * @param {number} width - byte width.
 * @returns {number} the value.
 */
function uint(buffer, offset, width) {
  let value = 0
  for (let index = 0; index < width; index += 1) value = value * 256 + buffer[offset + index]
  return value
}

/**
 * Decode a SQLite varint.
 * @param {Buffer} buffer - source.
 * @param {number} offset - byte offset.
 * @returns {{value: number, length: number}} decoded varint.
 */
function varint(buffer, offset) {
  let value = 0
  for (let index = 0; index < 9; index += 1) {
    const byte = buffer[offset + index]
    if (index === 8) return { value: value * 256 + byte, length: 9 }
    value = value * 128 + (byte & 0x7f)
    if ((byte & 0x80) === 0) return { value, length: index + 1 }
  }
  throw new Error('malformed varint')
}

/**
 * Read one record's column values.
 * @param {Buffer} payload - the record payload.
 * @returns {Array<string | number | null>} decoded columns.
 */
function record(payload) {
  // The header length varint is counted inside the header, so serial types run
  // from after that varint up to `headerSize`, and values start at `headerSize`.
  const header = varint(payload, 0)
  const headerSize = header.value
  const types = []
  let offset = header.length
  while (offset < headerSize) {
    const type = varint(payload, offset)
    types.push(type.value)
    offset += type.length
  }
  const values = []
  let cursor = headerSize
  for (const type of types) {
    if (type === 0) {
      values.push(null)
    } else if (type >= 1 && type <= 6) {
      const width = [0, 1, 2, 3, 4, 6, 8][type]
      values.push(uint(payload, cursor, width))
      cursor += width
    } else if (type === 7) {
      values.push(payload.readDoubleBE(cursor))
      cursor += 8
    } else if (type === 8) {
      values.push(0)
    } else if (type === 9) {
      values.push(1)
    } else if (type >= 12) {
      // For serial types at or above 12, N = type - 12: an odd N is TEXT of
      // length (N-1)/2, an even N is a BLOB of length N/2.
      const width = Math.floor((type - 12) / 2)
      if ((type - 12) % 2 === 1) {
        values.push(payload.subarray(cursor, cursor + width).toString('utf8'))
      } else {
        values.push(payload.subarray(cursor, cursor + width))
      }
      cursor += width
    } else {
      values.push(null)
    }
  }
  return values
}

/**
 * Walk every leaf table page and yield its records.
 * @param {Buffer} file - whole database file.
 * @returns {Array<Array<string | number | null>>} decoded records.
 */
function leafRecords(file) {
  if (file.subarray(0, 15).toString('latin1') !== 'SQLite format 3') throw new Error('not a SQLite database')
  const pageSize = uint(file, 16, 2) === 1 ? 65536 : uint(file, 16, 2)
  const pageCount = Math.floor(file.length / pageSize)
  const out = []
  for (let page = 1; page <= pageCount; page += 1) {
    const start = (page - 1) * pageSize
    const headerOffset = page === 1 ? 100 : 0
    const type = file[start + headerOffset]
    if (type !== LEAF_TABLE) continue
    let cellCount
    try {
      cellCount = uint(file, start + headerOffset + 3, 2)
    } catch {
      continue
    }
    for (let cell = 0; cell < cellCount; cell += 1) {
      try {
        const pointer = uint(file, start + headerOffset + 8 + cell * 2, 2)
        const cellOffset = start + pointer
        const size = varint(file, cellOffset)
        let cursor = cellOffset + size.length
        const rowid = varint(file, cursor)
        cursor += rowid.length
        const payload = file.subarray(cursor, cursor + size.value)
        if (payload.length < size.value) continue
        out.push(record(payload))
      } catch {
        // A malformed or overflow cell is not one of ours; skip it.
      }
    }
  }
  return out
}

/**
 * Read key/value rows whose key starts with a prefix.
 * @param {string} file - database path.
 * @param {string} prefix - required key prefix.
 * @returns {Promise<Map<string, string>>} matching rows.
 */
export async function readRowsByPrefix(file, prefix) {
  const rows = leafRecords(await readFile(file))
  const out = new Map()
  for (const row of rows) {
    if (row.length < 2) continue
    const key = row[0]
    const value = row[1]
    if (typeof key !== 'string' || typeof value !== 'string') continue
    if (!key.startsWith(prefix)) continue
    out.set(key, value)
  }
  return out
}
