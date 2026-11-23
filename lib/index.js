import z from '@deepseek-ai/schemastery'
import { QoderAdapter } from './adapter.js'
import { readDesktopAuth, refreshDeviceToken, fetchUserInfo, fetchUsage, fetchPlan } from './auth.js'
import { REGION_IDS, REGIONS, regionOf } from './regions.js'
import { resolveCnWorkerRuntime, resolveGlobalWorkerRuntime, GLOBAL_WORKER_VERSION } from './worker-runtime.js'

/** Loader row id, also the settings namespace this plugin serves. */
export const name = 'dsh-connect-qoder'

/** Services this plugin needs before it activates. */
export const inject = ['llm']

/** Declared settings namespace, used only when the Loader entry id is unavailable. */
const FALLBACK_SETTINGS_NS = 'dsh-connect-qoder'

/** Refresh the device token this long before it expires. */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000

/** How long an account snapshot stays fresh. */
const SNAPSHOT_TTL_MS = 60_000
const ACCOUNT_TIMEOUT_MS = 8_000

/** Route prefix every HTTP endpoint of this plugin lives under. */
const ROUTE_PREFIX = `/plugins/${name}`

/** Mark a field as volatile so the settings service accepts edits to it. */
function asVolatile(schema) {
  return typeof schema.volatile === 'function' ? schema.volatile() : schema
}

/** Peel one `{ get(): T }` live reference. */
function unwrapVolatile(value) {
  if (value !== null && typeof value === 'object' && typeof value.get === 'function') return value.get()
  return value
}

/** Plugin configuration schema. */
export const Config = z.object({
  sidebarPanel: asVolatile(z.boolean().default(true)
    .description('在 DSH 左侧栏显示 Qoder 入口。')),
  cnEnabled: asVolatile(z.boolean().default(true)
    .description('注册 Qoder CN（国内）通道。')),
  globalEnabled: asVolatile(z.boolean().default(true)
    .description('注册 Qoder 国际通道；首次使用时自动下载 worker 运行时。')),
  cnHiddenModels: asVolatile(z.array(z.string()).default([])
    .description('从 Qoder CN 模型选择器隐藏的模型 ID。')),
  globalHiddenModels: asVolatile(z.array(z.string()).default([])
    .description('从 Qoder 国际版模型选择器隐藏的模型 ID。')),
  workingDirectory: asVolatile(z.string().default('')
    .description('Qoder 会话的工作目录；留空则使用 DSH 的主目录配置。')),
  requestTimeoutSeconds: asVolatile(z.number().default(180).min(30).max(1800).step(1)
    .description('单次上游静默超时（秒）。')),
  cnWorkerRuntimePath: asVolatile(z.string().default('')
    .description('Qoder CN 安装目录或 worker 运行时文件路径；留空则从启动器 state.ini 自动探测。')),
  cnAuthDir: asVolatile(z.string().default('')
    .description('Qoder CN 桌面版 userData 目录（含 auth.v1.dat）；留空则按产品名自动探测。')),
  globalWorkerRuntimePath: asVolatile(z.string().default('')
    .description('国际版 worker 运行时文件或目录；留空则使用自动下载的缓存。')),
  globalWorkerVersion: asVolatile(z.string().default(GLOBAL_WORKER_VERSION)
    .description('国际版 worker 运行时版本；修改后会在下次启动时下载对应版本。')),
  globalAuthDir: asVolatile(z.string().default('')
    .description('国际版 userData 目录（含 Local State 与 state.vscdb）；留空则按产品名自动探测。')),
})

/** The settings namespace the host actually serves for this plugin. */
function settingsNamespaceOf(ctx) {
  const id = ctx?.fiber?.entry?.options?.id
  return typeof id === 'string' && id !== '' ? id : FALLBACK_SETTINGS_NS
}

/** Read one config field, tolerating volatile wrappers and absent config. */
function readConfig(ctx, fallback) {
  const raw = ctx?.fiber?.entry?.options?.config ?? fallback ?? {}
  const value = key => unwrapVolatile(raw?.[key])
  return {
    sidebarPanel: value('sidebarPanel') !== false,
    cnEnabled: value('cnEnabled') !== false,
    globalEnabled: value('globalEnabled') !== false,
    cnHiddenModels: value('cnHiddenModels') ?? [],
    globalHiddenModels: value('globalHiddenModels') ?? [],
    workingDirectory: String(value('workingDirectory') ?? '').trim(),
    requestTimeoutSeconds: Number(value('requestTimeoutSeconds') ?? 180),
    cnWorkerRuntimePath: String(value('cnWorkerRuntimePath') ?? '').trim(),
    cnAuthDir: String(value('cnAuthDir') ?? '').trim(),
    globalWorkerRuntimePath: String(value('globalWorkerRuntimePath') ?? '').trim(),
    globalWorkerVersion: String(value('globalWorkerVersion') ?? '').trim() || GLOBAL_WORKER_VERSION,
    globalAuthDir: String(value('globalAuthDir') ?? '').trim(),
  }
}

/** Write a JSON response. */
function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(payload)
}


function isLoopback(address) {
  return address === '::1' || /^(?:::ffff:)?127(?:\.\d{1,3}){3}$/u.test(address ?? '')
}

function trustedRequest(req) {
  if (!isLoopback(req.socket?.remoteAddress) || req.headers['sec-fetch-site'] === 'cross-site') return false
  try {
    const protocol = req.socket.encrypted ? 'https:' : 'http:'
    const target = new URL(`${protocol}//${req.headers.host}`)
    if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) return false
    const port = Number(target.port || (protocol === 'https:' ? 443 : 80))
    if (req.socket.localPort !== port) return false
    const origin = req.headers.origin
    return origin === undefined || origin === target.origin
  } catch {
    return false
  }
}

function number(value) {
  return Number.isFinite(value) ? value : undefined
}

function string(...values) {
  return values.find(value => typeof value === 'string' && value.trim() !== '')
}

function createChannel(ctx, config, regionId, log) {
  const region = regionOf(regionId)
  const current = () => readConfig(ctx, config)
  const enabled = () => current()[`${regionId}Enabled`]
  const modelVisible = id => enabled() && !current()[`${regionId}HiddenModels`].includes(id)
  let credential
  let tokenRead
  let snapshot
  let snapshotRead
  let reconnecting
  let generation = 0

  async function getToken() {
    if (!enabled()) throw new Error(`${region.displayName} is disabled`)
    const authDir = current()[`${regionId}AuthDir`]
    if (credential?.authDir === authDir && credential.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) return credential
    if (tokenRead?.authDir === authDir) return tokenRead.promise
    const revision = generation
    const promise = (async () => {
      const stored = await readDesktopAuth(regionId, authDir || undefined)
      let next = stored
      if (stored.refreshToken && !(stored.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now())) {
        try {
          next = { ...stored, ...await refreshDeviceToken(regionId, stored.refreshToken, AbortSignal.timeout(ACCOUNT_TIMEOUT_MS)) }
        } catch {
          log(`${region.displayName}: device token refresh unavailable`)
          if (stored.expiresAt !== undefined && stored.expiresAt <= Date.now()) {
            throw new Error(`${region.displayName} sign-in expired; sign in again in the desktop app`)
          }
        }
      }
      if (revision !== generation) throw new Error(`${region.displayName} connection was reset`)
      const result = {
        authDir,
        token: next.token,
        expiresAt: next.expiresAt ?? Date.now() + 3_600_000,
        user: stored.user,
      }
      credential = result
      return result
    })()
    tokenRead = { authDir, promise }
    try {
      return await promise
    } finally {
      if (tokenRead?.promise === promise) tokenRead = undefined
    }
  }

  function runtime(install = true) {
    const live = current()
    if (regionId === 'cn') return resolveCnWorkerRuntime(live.cnWorkerRuntimePath || undefined)
    return resolveGlobalWorkerRuntime({
      override: live.globalWorkerRuntimePath || undefined,
      version: live.globalWorkerVersion,
      install,
      signal: install ? AbortSignal.timeout(120_000) : undefined,
      log: line => log(`${region.displayName}: ${line}`),
    })
  }

  const adapter = new QoderAdapter({
    region: regionId,
    token: getToken,
    runtime,
    modelVisible,
    workingDirectory: () => current().workingDirectory || ctx.get('homePaths')?.homeDirectory || process.cwd(),
    log,
    onModels: () => ctx.emit('llm/adapters-updated'),
    requestTimeoutSeconds: () => current().requestTimeoutSeconds,
  })

  async function readSnapshot(force) {
    const authDir = current()[`${regionId}AuthDir`]
    if (snapshotRead?.authDir === authDir) return snapshotRead.promise
    if (!force && snapshot?.authDir === authDir && Date.now() - snapshot.checkedAt < SNAPSHOT_TTL_MS) return snapshot
    const revision = generation
    const promise = (async () => {
      let authenticated
      try {
        authenticated = await getToken()
      } catch {
        return { connection: 'sign-in-required', checkedAt: Date.now() }
      }
      const { token, user: localUser } = authenticated
      const signal = AbortSignal.timeout(ACCOUNT_TIMEOUT_MS)
      const [user, usage, plan] = await Promise.all([
        fetchUserInfo(regionId, token, signal),
        fetchUsage(regionId, token, signal),
        fetchPlan(regionId, token, signal),
      ])
      const quota = usage?.userQuota
      return {
        connection: user || usage || plan ? 'connected' : 'unavailable',
        checkedAt: Date.now(),
        account: {
          name: string(user?.name, user?.username, localUser?.name, localUser?.username),
          email: string(user?.email, localUser?.email),
          plan: string(plan?.plan_tier_name, usage?.userType),
        },
        credits: usage ? {
          remaining: number(quota?.remaining),
          used: number(quota?.used),
          total: number(quota?.total),
          percentage: number(usage.totalUsagePercentage),
          exhausted: usage.isQuotaExceeded === true || quota?.remaining === 0,
        } : undefined,
      }
    })()
    snapshotRead = { authDir, promise }
    try {
      const result = await promise
      if (generation === revision) snapshot = { ...result, authDir }
      return result
    } finally {
      if (snapshotRead?.promise === promise) snapshotRead = undefined
    }
  }

  function overview() {
    return { id: regionId, provider: region.provider, displayName: region.displayName, enabled: enabled() }
  }

  async function describe(force) {
    if (reconnecting !== undefined) await reconnecting
    const base = { ...overview(), origin: region.origin }
    if (!base.enabled) return { ...base, connection: 'disabled', models: [] }
    const [worker, state] = await Promise.all([
      Promise.resolve().then(() => runtime(false)).catch(() => ({ error: true })),
      readSnapshot(force),
    ])
    return {
      ...base,
      connection: state.connection,
      checkedAt: state.checkedAt,
      account: state.account,
      credits: state.credits,
      worker,
      models: adapter.models().map(model => ({
        id: model.id, name: model.name, contextWindow: model.contextWindow,
        maxTokens: model.maxTokens, priceFactor: model.priceFactor,
        reasoning: model.reasoning, enabled: modelVisible(model.id), source: model.source ?? 'seed',
      })),
    }
  }

  return {
    region, adapter, enabled, modelVisible, overview, describe,
    async reset() {
      if (reconnecting !== undefined) return reconnecting
      generation += 1
      credential = undefined
      tokenRead = undefined
      snapshot = undefined
      snapshotRead = undefined
      reconnecting = adapter.resetDaemon()
      try {
        await reconnecting
      } finally {
        reconnecting = undefined
      }
    },
  }
}

async function readSettingsPatch(req) {
  if (req.headers['content-type']?.split(';', 1)[0] !== 'application/json') return undefined
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > 4096) {
      req.resume()
      return undefined
    }
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return undefined
  }
}

export function apply(ctx, config) {
  const settingsNs = settingsNamespaceOf(ctx)
  const current = () => readConfig(ctx, config)
  const log = message => ctx.logger?.info?.(`${name}: ${message}`)
  const channels = new Map(REGION_IDS.map(id => [id, createChannel(ctx, config, id, log)]))
  const releases = []
  const adapters = new Map()
  const directoryEntry = channel => ({
    provider: channel.region.provider,
    displayName: channel.region.displayName,
    settingsNs, settingsPath: [], declared: false,
  })
  let directory
  let settings
  let writeQueue = Promise.resolve()

  function syncProviders() {
    for (const [id, channel] of channels) {
      const handle = adapters.get(id)
      const wanted = channel.enabled()
      if (handle.enabled === wanted) continue
      handle.release.replace(wanted ? [channel.region.provider] : [])
      handle.enabled = wanted
      if (!wanted) void channel.reset()
    }
    directory.replace([...channels.values()].filter(channel => channel.enabled()).map(directoryEntry))
  }

  const releaseProviders = () => {
    for (const release of releases.splice(0).reverse()) release()
    for (const channel of channels.values()) void channel.adapter.dispose()
  }
  try {
    for (const [id, channel] of channels) {
      const release = ctx.llm.registerAdapter([channel.region.provider], channel.adapter)
      releases.push(release)
      adapters.set(id, { release, enabled: true })
    }
    directory = ctx.llm.registerConfigurableProviders([...channels.values()].map(directoryEntry))
    releases.push(directory)
    syncProviders()
    releases.push(ctx.llm.registerModelDiscovery(settingsNs, async request => {
      const channel = [...channels.values()].find(candidate => candidate.region.provider === request?.provider)
      if (channel === undefined) return []
      return channel.adapter.models().filter(model => channel.modelVisible(model.id)).map(model => ({
        id: model.id, name: model.name, contextWindow: model.contextWindow,
        maxTokens: model.maxTokens, inputModalities: ['text'],
      }))
    }))
  } catch (error) {
    releaseProviders()
    throw error
  }
  ctx.effect(() => releaseProviders)

  ctx.on('loader/volatile-update', () => syncProviders())
  ctx.inject(['settings'], settingsCtx => {
    const service = settingsCtx.settings
    settings = service
    settingsCtx.effect(() => service.configure({ auto: true }, ctx.fiber))
    return () => { settings = undefined }
  })

  ctx.inject(['webServer'], webCtx => {
    const routes = []
    const route = (path, method, handle) => routes.push(webCtx.webServer.register({
      kind: 'exact',
      path: `${ROUTE_PREFIX}/${path}`,
      async handler(req, res) {
        if (!trustedRequest(req)) return sendJson(res, 403, { error: 'forbidden' })
        if (req.method !== method) return sendJson(res, 405, { error: 'method-not-allowed' })
        try {
          const query = new URL(req.url ?? '/', 'http://localhost').searchParams
          const channel = channels.get(query.get('region'))
          if (query.has('region') && channel === undefined) return sendJson(res, 400, { error: 'invalid-channel' })
          return await handle(req, res, query, channel)
        } catch {
          log(`${path} request failed`)
          return sendJson(res, 500, { error: 'operation-failed' })
        }
      },
    }))
    const cleanup = () => { for (const release of routes.reverse()) release() }
    try {
      route('status', 'GET', async (_req, res, query, channel) => {
        const base = { sidebarPanel: current().sidebarPanel, writable: settings?.writable === true }
        if (query.get('view') === 'navigation') {
          return sendJson(res, 200, { ...base, channels: [...channels.values()].map(item => item.overview()) })
        }
        const requested = channel ? [channel] : [...channels.values()]
        return sendJson(res, 200, {
          ...base,
          channels: await Promise.all(requested.map(item => item.describe(query.get('refresh') === '1'))),
        })
      })
      route('reconnect', 'POST', async (_req, res, _query, channel) => {
        if (channel === undefined || !channel.enabled()) return sendJson(res, 400, { error: 'inactive-channel' })
        await channel.reset()
        return sendJson(res, 200, { channels: [await channel.describe(true)] })
      })
      route('settings', 'POST', async (req, res, _query, channel) => {
        if (channel === undefined) return sendJson(res, 400, { error: 'invalid-channel' })
        if (settings?.writable !== true) return sendJson(res, 409, { error: 'settings-unavailable' })
        const edit = await readSettingsPatch(req)
        const id = channel.region.id
        if (typeof edit?.enabled !== 'boolean' &&
            !(typeof edit?.visible === 'boolean' && channel.adapter.models().some(model => model.id === edit.modelId))) {
          return sendJson(res, 400, { error: 'invalid-setting' })
        }
        const write = writeQueue.then(async () => {
          if (typeof edit.enabled === 'boolean') {
            await settings.update(settingsNs, { [`${id}Enabled`]: edit.enabled })
            syncProviders()
          } else {
            const field = `${id}HiddenModels`
            const hidden = new Set(current()[field])
            if (edit.visible) hidden.delete(edit.modelId)
            else hidden.add(edit.modelId)
            await settings.update(settingsNs, { [field]: [...hidden] })
          }
        })
        writeQueue = write.catch(() => {})
        await write
        return sendJson(res, 200, { channels: [await channel.describe(false)] })
      })
    } catch (error) {
      cleanup()
      throw error
    }
    return cleanup
  })
}

export { REGION_IDS, REGIONS }
