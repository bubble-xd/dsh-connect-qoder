import { createHash } from 'node:crypto'
import { appendFile, mkdir, open } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const MAX_READ_BYTES = 16_384
const MAX_VISIBLE_RECORDS = 12
const states = new Set(['signed', 'already', 'needsSignIn', 'activityUnavailable', 'failed'])

export function createCheckinHistory(directory = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'dsh-connect-qoder', 'checkin')) {
  const fileFor = key => join(directory, createHash('sha256').update(key).digest('hex') + '.jsonl')

  async function read(key) {
    if (!key) return []
    const file = await open(fileFor(key), 'r').catch(error => {
      if (error.code !== 'ENOENT') throw error
    })
    if (!file) return []
    try {
      const { size } = await file.stat()
      const start = Math.max(0, size - MAX_READ_BYTES)
      const buffer = Buffer.alloc(size - start)
      const { bytesRead } = await file.read(buffer, 0, buffer.length, start)
      const lines = buffer.toString('utf8', 0, bytesRead).trimEnd().split('\n')
      if (start > 0) lines.shift()
      return lines.slice(-MAX_VISIBLE_RECORDS).flatMap(line => {
        try {
          const record = JSON.parse(line)
          if (states.has(record?.state) && Number.isFinite(record.at) && Number.isFinite(record.window)) return [record]
        } catch {}
        return []
      }).reverse()
    } finally {
      await file.close()
    }
  }

  async function append(key, record) {
    if (!key) return
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await appendFile(fileFor(key), JSON.stringify(record) + '\n', { mode: 0o600 })
  }

  return { read, append }
}
