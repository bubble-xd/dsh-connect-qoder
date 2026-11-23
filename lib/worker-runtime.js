/**
 * Locate the worker runtime each channel needs.
 *
 * A worker runtime is a single 35 MB ES module the agent SDK spawns in a child
 * process; it holds the actual model plumbing. The two channels deliver it
 * differently:
 *
 *   cn     — bundled inside the desktop app, under
 *            `<installDir>/.qoder-versions/<version>/resources/app.asar.unpacked`.
 *            The launcher's `state.ini` names the running version, which is the
 *            one whose sign-in the credential reader also reads.
 *   global — not bundled at all. The SDK manifest says
 *            `workerRuntime.delivery: "install"` and points at a release tarball,
 *            so it is downloaded once into a cache directory and reused.
 *
 * @module dsh-connect-qoder/worker-runtime
 */

import { createWriteStream } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'

/** Worker module file name inside a runtime directory. */
const WORKER_FILE = 'qoder-worker-runtime.obf.mjs'

/** Relative path from a CN version directory to its worker runtime. */
const CN_WORKER_RELATIVE = join(
  'resources',
  'app.asar.unpacked',
  'node_modules',
  '@qoder-ai',
  'qoder-cn-agent-sdk',
  'dist',
  '_worker',
  WORKER_FILE,
)

/**
 * Global worker runtime release this plugin was verified against.
 *
 * Pinned rather than resolved from the npm registry so an upstream release
 * cannot silently change the wire protocol under a running install. Set
 * `workerRuntimeVersion` in settings to move it forward.
 */
export const GLOBAL_WORKER_VERSION = '1.1.92'

/** Release tarball URL template for the global worker runtime. */
const GLOBAL_WORKER_URL = `https://download.qoder.com/qodercli/releases/${GLOBAL_WORKER_VERSION}/qodercli-worker-runtime-{target}.tgz`

/** Download target token for this machine. */
function platformTarget() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  if (process.platform === 'win32') return `win32-${arch}`
  if (process.platform === 'darwin') return `darwin-${arch}`
  return `linux-${arch}`
}

/** Read `key=value` pairs out of the CN launcher's `state.ini`. */
function readStateIni(file) {
  try {
    const text = readFileSync(file, 'utf8')
    const out = {}
    for (const line of text.split(/\r?\n/u)) {
      const index = line.indexOf('=')
      if (index <= 0) continue
      out[line.slice(0, index).trim()] = line.slice(index + 1).trim()
    }
    return out
  } catch {
    return undefined
  }
}

/** Extract `0.5.17` out of `.qoder-versions\0.5.17\Qoder CN.exe`. */
function versionOf(appExecutable) {
  if (typeof appExecutable !== 'string') return undefined
  const match = /\.qoder-versions[\\/]([^\\/]+)[\\/]/u.exec(appExecutable)
  return match?.[1]
}

/**
 * CN install roots the desktop launcher may use on this machine.
 *
 * The launcher writes `state.ini` either directly under `%LOCALAPPDATA%` or one
 * level down inside its own product folder, depending on installer version, so
 * both shapes are probed.
 */
function cnInstallCandidates() {
  const out = []
  const local = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
  const layouts = [
    join('Qoder CN Launcher'),
    join('Qoder Launcher'),
    join('Qoder CN', 'Qoder CN Launcher'),
    join('Qoder', 'Qoder Launcher'),
  ]
  for (const layout of layouts) {
    const state = readStateIni(join(local, layout, 'state.ini'))
    if (state?.installDir === undefined) continue
    out.push({
      installDir: state.installDir,
      version: versionOf(state.appExecutable) ?? (typeof state.targetVersion === 'string' ? state.targetVersion : undefined),
    })
  }
  return out
}

/** Every version directory under one install root, newest first. */
function versionDirs(installDir) {
  try {
    return readdirSync(join(installDir, '.qoder-versions'), { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  } catch {
    return []
  }
}

/**
 * Resolve the CN worker runtime shipped with the desktop app.
 * @param {string | undefined} override - explicit file, install root, or version root.
 * @returns {{ path: string, version?: string, source: 'bundled' } | undefined}
 */
export function resolveCnWorkerRuntime(override) {
  if (typeof override === 'string' && override.trim() !== '') {
    const value = override.trim()
    if (value.endsWith('.mjs')) return existsSync(value) ? { path: value, source: 'bundled' } : undefined
    for (const version of versionDirs(value)) {
      const candidate = join(value, '.qoder-versions', version, CN_WORKER_RELATIVE)
      if (existsSync(candidate)) return { path: candidate, version, source: 'bundled' }
    }
    const direct = join(value, CN_WORKER_RELATIVE)
    if (existsSync(direct)) return { path: direct, source: 'bundled' }
    return undefined
  }
  for (const { installDir, version } of cnInstallCandidates()) {
    if (version !== undefined) {
      const candidate = join(installDir, '.qoder-versions', version, CN_WORKER_RELATIVE)
      if (existsSync(candidate)) return { path: candidate, version, source: 'bundled' }
    }
    for (const other of versionDirs(installDir)) {
      const candidate = join(installDir, '.qoder-versions', other, CN_WORKER_RELATIVE)
      if (existsSync(candidate)) return { path: candidate, version: other, source: 'bundled' }
    }
  }
  return undefined
}

/**
 * Cache directory for downloaded worker runtimes.
 * @returns {string} absolute directory.
 */
export function workerCacheDir() {
  const base = process.env.LOCALAPPDATA ?? process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache')
  return join(base, 'dsh-connect-qoder', 'worker-runtime')
}

/**
 * Where one version of the global worker runtime is unpacked.
 * @param {string} version - release version, e.g. `1.1.92`.
 * @returns {string} absolute directory holding the runtime tree.
 */
function globalWorkerDir(version) {
  return join(workerCacheDir(), `${version}-${platformTarget()}`, 'qoder-worker-runtime')
}

/**
 * Read a NUL-terminated ASCII field out of a tar header.
 * @param {Buffer} header - 512-byte header block.
 * @param {number} offset - field offset.
 * @param {number} length - field length.
 * @returns {string} trimmed value.
 */
function tarField(header, offset, length) {
  return header.subarray(offset, offset + length).toString('utf8').replace(/\0+$/u, '').trim()
}

/**
 * Read an octal number out of a tar header field.
 * @param {Buffer} header - 512-byte header block.
 * @param {number} offset - field offset.
 * @param {number} length - field length.
 * @returns {number} parsed value.
 */
function tarOctal(header, offset, length) {
  const text = tarField(header, offset, length)
  return text === '' ? 0 : Number.parseInt(text, 8)
}

/**
 * Unpack a gzipped tar archive into a directory.
 *
 * Handles the subset npm and the Qoder release pipeline produce: regular files,
 * directories, and pax extended headers carrying a `path` override for entries
 * whose name does not fit the 100-byte field.
 *
 * @param {Buffer} archive - gzipped tar bytes.
 * @param {string} destination - directory to write into.
 * @returns {Promise<number>} number of files written.
 */
async function extractTarball(archive, destination) {
  const tar = await new Promise((resolve, reject) => {
    const gunzip = createGunzip()
    const chunks = []
    gunzip.on('data', chunk => chunks.push(chunk))
    gunzip.on('error', reject)
    gunzip.on('end', () => resolve(Buffer.concat(chunks)))
    gunzip.end(archive)
  })

  let offset = 0
  let written = 0
  let pendingPath
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    const type = String.fromCharCode(header[156] === 0 ? 0x30 : header[156])
    const size = tarOctal(header, 124, 12)
    const dataStart = offset + 512
    const dataEnd = dataStart + size
    const body = tar.subarray(dataStart, dataEnd)
    offset = dataStart + Math.ceil(size / 512) * 512

    // pax headers override the path of the entry that follows them.
    if (type === 'x' || type === 'g') {
      const text = body.toString('utf8')
      const match = /(?:^|\n)\d+ path=([^\n]+)/u.exec(text)
      if (match !== null) pendingPath = match[1]
      continue
    }

    let name = tarField(header, 0, 100)
    const prefix = tarField(header, 345, 155)
    if (prefix !== '') name = `${prefix}/${name}`
    if (pendingPath !== undefined) {
      name = pendingPath
      pendingPath = undefined
    }
    if (name === '' || name.startsWith('/') || name.includes('..')) continue

    const target = join(destination, name)
    if (type === '5') {
      await mkdir(target, { recursive: true })
      continue
    }
    if (type !== '0' && type !== '7') continue
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, body)
    written += 1
  }
  return written
}

/**
 * Download and unpack one global worker runtime release.
 * @param {string} version - release version.
 * @param {object} options - download options.
 * @param {(line: string) => void} [options.log] - progress sink.
 * @param {AbortSignal} [options.signal] - cancellation.
 * @returns {Promise<string>} absolute path of the unpacked worker module.
 */
async function installGlobalWorkerRuntime(version, options = {}) {
  const { log, signal } = options
  const target = platformTarget()
  const url = GLOBAL_WORKER_URL.replace('{version}', version).replace('{target}', target)
  const cache = join(workerCacheDir(), `${version}-${target}`)
  const staging = `${cache}.partial`
  const archive = join(workerCacheDir(), `qodercli-worker-runtime-${version}-${target}.tgz`)

  log?.(`downloading worker runtime ${version} (${target})`)
  await mkdir(workerCacheDir(), { recursive: true })
  const response = await fetch(url, { signal, headers: { accept: 'application/octet-stream' } })
  if (!response.ok || response.body === null) {
    throw new Error(`worker runtime download failed (${response.status}) for ${url}`)
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(archive))

  log?.(`unpacking worker runtime into ${cache}`)
  await rm(staging, { recursive: true, force: true })
  await mkdir(staging, { recursive: true })
  const written = await extractTarball(await readFile(archive), staging)
  if (written === 0) throw new Error(`worker runtime archive ${archive} contained no files`)
  await rm(cache, { recursive: true, force: true })
  await rename(staging, cache)
  await rm(archive, { force: true })

  const module = join(globalWorkerDir(version), WORKER_FILE)
  if (!existsSync(module)) throw new Error(`worker runtime archive did not contain ${WORKER_FILE}`)
  return module
}

/**
 * Resolve the global worker runtime, installing it on first use.
 * @param {object} options - resolution options.
 * @param {string | undefined} options.override - explicit file or directory from settings.
 * @param {string | undefined} options.version - release version override.
 * @param {(line: string) => void} [options.log] - progress sink.
 * @param {AbortSignal} [options.signal] - cancellation.
 * @param {boolean} [options.install] - allow a download when nothing is cached.
 * @returns {Promise<{ path: string, version: string, source: 'cache'|'explicit' } | undefined>}
 */
export async function resolveGlobalWorkerRuntime(options = {}) {
  const { override, version, log, signal, install = true } = options

  if (typeof override === 'string' && override.trim() !== '') {
    const value = override.trim()
    const module = value.endsWith('.mjs') ? value : join(value, WORKER_FILE)
    if (existsSync(module)) return { path: module, version: version ?? GLOBAL_WORKER_VERSION, source: 'explicit' }
    return undefined
  }

  const wanted = version ?? GLOBAL_WORKER_VERSION
  const cached = join(globalWorkerDir(wanted), WORKER_FILE)
  if (existsSync(cached)) return { path: cached, version: wanted, source: 'cache' }

  // A newer cached release is fine to use when the pinned one is absent.
  try {
    const entries = await readdir(workerCacheDir(), { withFileTypes: true })
    for (const entry of entries.filter(item => item.isDirectory()).sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }))) {
      const candidate = join(workerCacheDir(), entry.name, 'qoder-worker-runtime', WORKER_FILE)
      if (existsSync(candidate)) return { path: candidate, version: entry.name.split('-')[0], source: 'cache' }
    }
  } catch {
    // No cache directory yet.
  }

  if (!install) return undefined
  const module = await installGlobalWorkerRuntime(wanted, { log, signal })
  return { path: module, version: wanted, source: 'cache' }
}

/**
 * Describe whether a resolved runtime still exists on disk.
 * @param {{ path: string } | undefined} runtime - resolution result.
 * @returns {Promise<boolean>} true when the module file is readable.
 */
export async function runtimeExists(runtime) {
  if (runtime === undefined) return false
  try {
    const info = await stat(runtime.path)
    return info.isFile() && info.size > 0
  } catch {
    return false
  }
}
