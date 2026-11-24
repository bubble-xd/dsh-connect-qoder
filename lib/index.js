import z from '@deepseek-ai/schemastery'
import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { win32 } from 'node:path'
import { QoderAdapter } from './adapter.js'
import { readDesktopAuth, refreshDeviceToken, fetchUserInfo, fetchUsage, fetchPlan } from './auth.js'
import { createDailyCheckin } from './checkin.js'
import { createCheckinHistory } from './checkin-history.js'
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
const DEFAULT_ACCOUNT = 'desktop'
const MAX_POOL_ACCOUNTS = 8

/** Route prefix every HTTP endpoint of this plugin lives under. */
const ROUTE_PREFIX = `/plugins/${name}`
const accountProfile = z.object({
  id: z.string(), label: z.string(), directory: z.string(), identity: z.string(),
  autoCheckin: z.boolean().default(false),
})

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
  cnAutoCheckin: asVolatile(z.boolean().default(false)
    .description('DSH 运行时自动尝试领取 Qoder CN 每日 100 Credits。')),
  cnAutoCheckinIdentity: asVolatile(z.string().default('')),
  globalEnabled: asVolatile(z.boolean().default(true)
    .description('注册 Qoder 国际通道；首次使用时自动下载 worker 运行时。')),
  cnAccounts: asVolatile(z.array(accountProfile).default([])),
  globalAccounts: asVolatile(z.array(accountProfile).default([])),
  cnActiveAccount: asVolatile(z.string().default(DEFAULT_ACCOUNT)),
  globalActiveAccount: asVolatile(z.string().default(DEFAULT_ACCOUNT)),
  cnHiddenModels: asVolatile(z.array(z.string()).default([])
    .description('从 Qoder CN 模型选择器隐藏的模型 ID。')),
  globalHiddenModels: asVolatile(z.array(z.string()).default([])
    .description('从 Qoder 国际版模型选择器隐藏的模型 ID。')),
  cnPinnedModels: asVolatile(z.array(z.string()).default([])),
  globalPinnedModels: asVolatile(z.array(z.string()).default([])),
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
    cnAutoCheckin: value('cnAutoCheckin') === true,
    cnAutoCheckinIdentity: value('cnAutoCheckinIdentity') ?? '',
    globalEnabled: value('globalEnabled') !== false,
    cnAccounts: value('cnAccounts') ?? [],
    globalAccounts: value('globalAccounts') ?? [],
    cnActiveAccount: value('cnActiveAccount') ?? DEFAULT_ACCOUNT,
    globalActiveAccount: value('globalActiveAccount') ?? DEFAULT_ACCOUNT,
    cnHiddenModels: value('cnHiddenModels') ?? [],
    globalHiddenModels: value('globalHiddenModels') ?? [],
    cnPinnedModels: value('cnPinnedModels') ?? [],
    globalPinnedModels: value('globalPinnedModels') ?? [],
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

function creditBucket(quota) {
  if (!quota) return undefined
  const bucket = {
    remaining: number(quota.remaining),
    used: number(quota.used),
    total: number(quota.total),
  }
  const expiry = expiryTime(quota.expiresAt)
  if (expiry !== undefined) bucket.expiresAt = expiry
  return Object.values(bucket).some(value => value !== undefined) ? bucket : undefined
}

function expiryTime(value) {
  const time = typeof value === 'number' ? (value > 0 && value < 1e12 ? value * 1000 : value)
    : typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(time) && time > 0 ? time : undefined
}

export function summarizeCredits(usage) {
  if (!usage) return undefined
  const plan = creditBucket(usage.userQuota)
  const addOn = creditBucket(usage.addOnQuota)
  const known = plan?.remaining !== undefined && addOn?.remaining !== undefined
  return {
    plan,
    addOn,
    remaining: known ? plan.remaining + addOn.remaining : undefined,
    exhausted: known ? plan.remaining === 0 && addOn.remaining === 0 : usage.isQuotaExceeded === true,
  }
}

function string(...values) {
  return values.find(value => typeof value === 'string' && value.trim() !== '')
}

function desktopIdentity(user) {
  const id = user?.id
  return typeof id === 'string' ? id.trim() : Number.isSafeInteger(id) ? String(id) : ''
}

async function poolDirectory(input) {
  const path = typeof input === 'string' ? input.trim() : ''
  if (!/^[a-z]:[\\/]/iu.test(path) || path.length > 1024) return undefined
  try {
    const directory = await realpath(path)
    return /^[a-z]:[\\/]/iu.test(directory) ? win32.normalize(directory) : undefined
  } catch {
    return undefined
  }
}

function createAccount(region, profile, channelEnabled, log, history) {
  const regionId = region.id
  const enabled = () => channelEnabled() && profile() !== undefined
  let credential
  let tokenRead
  let snapshot
  let snapshotRead
  let generation = 0
  const historyKey = (auth = credential) => {
    const entry = profile()
    const identity = entry?.identity || desktopIdentity(auth?.user) || entry?.checkinIdentity
    return identity ? `${regionId}:${identity}` : undefined
  }
  const records = auth => history.read(historyKey(auth)).catch(() => [])
  const checkin = regionId === 'cn' ? createDailyCheckin({
    origin: region.origin,
    channelEnabled: enabled,
    autoEnabled: () => profile()?.autoCheckin === true,
    getToken: async () => {
      const auth = await getToken(true)
      const identity = profile()?.checkinIdentity
      if (identity && desktopIdentity(auth.user) !== identity) throw new Error('The desktop sign-in has changed.')
      return auth
    },
    readResult: async auth => (await records(auth))[0],
    saveResult: (record, auth) => history.append(historyKey(auth), record).catch(() => log('Qoder check-in history write failed')),
    onClaim: async auth => {
      snapshot = undefined
      snapshotRead = undefined
      const state = await readSnapshot(false).catch(() => undefined)
      const identity = desktopIdentity(auth.user)
      if (identity && identity === desktopIdentity(credential?.user)) return state?.credits?.addOn?.remaining
    },
  }) : undefined
  let checkinSettings

  function syncCheckin() {
    if (!checkin) return
    const entry = profile()
    const key = JSON.stringify([enabled(), entry?.directory, entry?.autoCheckin, entry?.identity, entry?.checkinIdentity])
    if (key === checkinSettings) return
    checkinSettings = key
    checkin.reset()
  }

  async function getToken(forceRead = false) {
    if (!enabled()) throw new Error(`${region.displayName} is disabled`)
    const entry = profile()
    const authDir = entry.directory
    if (!forceRead && credential?.authDir === authDir && credential.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) return credential
    if (tokenRead?.authDir === authDir) return tokenRead.promise
    const revision = generation
    const promise = (async () => {
      const stored = await readDesktopAuth(regionId, authDir || undefined, { strict: entry.id !== DEFAULT_ACCOUNT })
      if (entry.identity && desktopIdentity(stored.user) !== entry.identity) {
        throw new Error('The Qoder desktop profile is signed in to a different account.')
      }
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

  async function readSnapshot(force) {
    const authDir = profile()?.directory
    if (snapshotRead?.authDir === authDir) return snapshotRead.promise
    if (!force && snapshot?.authDir === authDir && Date.now() - snapshot.checkedAt < SNAPSHOT_TTL_MS) return snapshot
    const revision = generation
    const promise = (async () => {
      let authenticated
      try {
        authenticated = await getToken(force)
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
      return {
        connection: user || usage || plan ? 'connected' : 'unavailable',
        checkedAt: Date.now(),
        balanceCheckedAt: usage ? Date.now() : undefined,
        account: {
          name: string(user?.name, user?.username, localUser?.name, localUser?.username),
          email: string(user?.email, localUser?.email),
          plan: string(plan?.plan_tier_name, usage?.userType),
        },
        credits: summarizeCredits(usage),
      }
    })()
    snapshotRead = { authDir, promise }
    try {
      const result = await promise
      if (generation === revision && snapshotRead?.promise === promise) snapshot = { ...result, authDir }
      return result
    } finally {
      if (snapshotRead?.promise === promise) snapshotRead = undefined
    }
  }

  function reset() {
    checkin?.reset()
    generation += 1
    credential = undefined
    tokenRead = undefined
    snapshot = undefined
    snapshotRead = undefined
  }

  async function summary() {
    const entry = profile()
    if (!entry) return undefined
    const checkinHistory = checkin ? await records() : undefined
    return {
      id: entry.id, label: entry.label, checkin: checkin?.status(checkinHistory?.[0]), checkinHistory,
      accountName: snapshot?.account?.name, connection: snapshot?.connection, credits: snapshot?.credits,
      checkedAt: snapshot?.checkedAt, balanceCheckedAt: snapshot?.balanceCheckedAt,
    }
  }

  return { getToken, readSnapshot, checkin, syncCheckin, reset, summary }
}

function createChannel(ctx, config, regionId, log, history) {
  const region = regionOf(regionId)
  const current = () => readConfig(ctx, config)
  const enabled = () => current()[`${regionId}Enabled`]
  const modelVisible = id => enabled() && !current()[`${regionId}HiddenModels`].includes(id)
  const entries = () => current()[`${regionId}Accounts`]
  const findProfile = id => id === DEFAULT_ACCOUNT ? {
    id, directory: current()[`${regionId}AuthDir`], autoCheckin: regionId === 'cn' && current().cnAutoCheckin,
    checkinIdentity: regionId === 'cn' ? current().cnAutoCheckinIdentity : undefined,
  } : entries().find(entry => entry.id === id)
  const accounts = new Map()
  let selected
  let sweep
  let stopped = false

  function accountById(id) {
    if (stopped || !findProfile(id)) return undefined
    if (!accounts.has(id)) {
      const account = createAccount(region, () => findProfile(id), enabled, log, history)
      account.syncCheckin()
      accounts.set(id, account)
    }
    return accounts.get(id)
  }

  function activeId() {
    const id = current()[`${regionId}ActiveAccount`]
    return findProfile(id) ? id : DEFAULT_ACCOUNT
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
    tokenForDaemon: () => accountById(activeId()).getToken,
    pinnedModels: () => current()[`${regionId}PinnedModels`],
    runtime,
    modelVisible,
    workingDirectory: () => current().workingDirectory || ctx.get('homePaths')?.homeDirectory || process.cwd(),
    log,
    onModels: () => ctx.emit('llm/adapters-updated'),
    requestTimeoutSeconds: () => current().requestTimeoutSeconds,
  })

  function tickCheckins() {
    if (stopped || regionId !== 'cn' || !enabled() || sweep) return
    sweep = (async () => {
      for (const id of [DEFAULT_ACCOUNT, ...entries().map(entry => entry.id)]) {
        if (stopped) return
        await accountById(id)?.checkin.tick()
      }
    })().catch(() => log('Qoder CN automatic check-in interrupted')).finally(() => { sweep = undefined })
  }

  function syncAccounts() {
    for (const [id, account] of accounts) {
      if (findProfile(id)) {
        account.syncCheckin()
      } else {
        account.reset()
        accounts.delete(id)
      }
    }
    const id = activeId()
    const selection = JSON.stringify([id, findProfile(id).directory, findProfile(id).identity])
    if (selected !== undefined && selected !== selection) void adapter.resetDaemon()
    selected = selection
    tickCheckins()
  }

  function overview() {
    return { id: regionId, provider: region.provider, displayName: region.displayName, enabled: enabled() }
  }

  async function refreshBalances(accountId) {
    const ids = accountId ? [accountId] : [DEFAULT_ACCOUNT, ...entries().map(entry => entry.id)]
    for (let offset = 0; offset < ids.length; offset += 3) {
      await Promise.all(ids.slice(offset, offset + 3).map(id => accountById(id)?.readSnapshot(true)))
    }
  }

  async function describe(force) {
    if (adapter.resetPromise !== undefined) await adapter.resetPromise
    const base = { ...overview(), origin: region.origin }
    if (!base.enabled) return { ...base, connection: 'disabled', models: [] }
    const activeAccountId = activeId()
    const selectedAccount = accountById(activeAccountId)
    const [worker, state] = await Promise.all([
      Promise.resolve().then(() => runtime(false)).catch(() => ({ error: true })),
      selectedAccount.readSnapshot(force),
    ])
    const summaries = (await Promise.all([DEFAULT_ACCOUNT, ...entries().map(entry => entry.id)]
      .map(id => accountById(id)?.summary()))).filter(Boolean)
    const pinned = new Set(current()[`${regionId}PinnedModels`])
    return {
      ...base,
      connection: state.connection,
      checkedAt: state.checkedAt,
      account: state.account,
      credits: state.credits,
      balanceCheckedAt: state.balanceCheckedAt,
      checkin: summaries.find(account => account.id === activeAccountId)?.checkin,
      activeAccountId,
      accounts: summaries,
      balanceRefresh: true,
      worker,
      models: adapter.models().map(model => ({
        id: model.id, name: model.name, contextWindow: model.contextWindow,
        maxTokens: model.maxTokens, priceFactor: model.priceFactor,
        reasoning: model.reasoning, enabled: modelVisible(model.id), source: model.source ?? 'seed',
        pinned: pinned.has(model.id),
      })),
    }
  }

  return {
    region, adapter, enabled, modelVisible, overview, describe, accountById, activeId, syncAccounts, tickCheckins, refreshBalances,
    stopAccounts() {
      stopped = true
      for (const account of accounts.values()) account.reset()
      accounts.clear()
    },
    async reset() {
      accountById(activeId()).reset()
      await adapter.resetDaemon()
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
  const history = createCheckinHistory()
  const channels = new Map(REGION_IDS.map(id => [id, createChannel(ctx, config, id, log, history)]))
  const cn = channels.get('cn')
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
    for (const channel of channels.values()) channel.syncAccounts()
  }

  const releaseProviders = () => {
    for (const release of releases.splice(0).reverse()) release()
    for (const channel of channels.values()) {
      channel.stopAccounts()
      void channel.adapter.dispose()
    }
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
  ctx.effect(() => {
    const timer = setInterval(() => cn.tickCheckins(), 60_000)
    timer.unref?.()
    return () => {
      clearInterval(timer)
    }
  })

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
      route('balances', 'GET', async (_req, res, query, channel) => {
        if (!channel?.enabled()) return sendJson(res, 400, { error: 'inactive-channel' })
        const accountId = query.get('account')
        if (accountId !== null && !channel.accountById(accountId)) return sendJson(res, 400, { error: 'invalid-account' })
        await channel.refreshBalances(accountId)
        return sendJson(res, 200, { channels: [await channel.describe(false)] })
      })
      route('checkin', 'POST', async (req, res, _query, channel) => {
        if (channel !== cn || !cn.enabled()) return sendJson(res, 400, { error: 'inactive-channel' })
        const edit = await readSettingsPatch(req)
        if (!edit || typeof edit !== 'object') return sendJson(res, 400, { error: 'invalid-body' })
        const account = cn.accountById(edit.accountId ?? cn.activeId())
        if (!account) return sendJson(res, 400, { error: 'invalid-account' })
        await account.checkin.tick(true)
        await account.readSnapshot(false)
        return sendJson(res, 200, { channels: [await cn.describe(false)] })
      })
      route('accounts', 'POST', async (req, res, _query, channel) => {
        if (!channel?.enabled()) return sendJson(res, 400, { error: 'inactive-channel' })
        if (settings?.writable !== true) return sendJson(res, 409, { error: 'settings-unavailable' })
        const edit = await readSettingsPatch(req)
        const id = channel.region.id
        const field = `${id}Accounts`
        const activeField = `${id}ActiveAccount`
        const write = writeQueue.then(async () => {
          const live = current()
          const records = live[field]
          const target = records.find(record => record.id === edit?.accountId)
          const isDefault = edit?.accountId === DEFAULT_ACCOUNT
          let patch
          if (edit?.action === 'add') {
            if (records.length >= MAX_POOL_ACCOUNTS) return 'pool-full'
            const label = typeof edit.label === 'string' ? edit.label.trim() : ''
            if (!label || label.length > 64) return 'invalid-account'
            const directory = await poolDirectory(edit.directory)
            if (!directory) return 'invalid-directory'
            const added = await readDesktopAuth(id, directory, { strict: true }).catch(() => undefined)
            const identity = desktopIdentity(added?.user)
            if (!identity) return 'profile-sign-in-required'
            const primary = await readDesktopAuth(id, live[`${id}AuthDir`] || undefined).catch(() => undefined)
            if (identity === desktopIdentity(primary?.user) || records.some(record =>
              record.identity === identity || record.directory.toLowerCase() === directory.toLowerCase())) return 'duplicate-account'
            patch = { [field]: [...records, { id: randomUUID(), label, directory, identity, autoCheckin: false }] }
          } else if (edit?.action === 'select' && (target || isDefault)) {
            patch = { [activeField]: edit.accountId }
          } else if (edit?.action === 'remove' && target) {
            patch = { [field]: records.filter(record => record.id !== target.id) }
            if (live[activeField] === target.id) patch[activeField] = DEFAULT_ACCOUNT
          } else if (id === 'cn' && edit?.action === 'auto' && typeof edit.enabled === 'boolean' && (target || isDefault)) {
            if (isDefault) {
              const auth = edit.enabled
                ? await readDesktopAuth(id, live.cnAuthDir || undefined).catch(() => undefined)
                : undefined
              const identity = desktopIdentity(auth?.user)
              if (edit.enabled && !identity) return 'profile-sign-in-required'
              patch = { cnAutoCheckin: edit.enabled, cnAutoCheckinIdentity: identity }
            } else {
              patch = { [field]: records.map(record => record === target ? { ...record, autoCheckin: edit.enabled } : record) }
            }
          } else {
            return 'invalid-account'
          }
          await settings.update(settingsNs, patch)
          channel.syncAccounts()
        })
        writeQueue = write.catch(() => {})
        const error = await write
        if (error) return sendJson(res, 400, { error })
        return sendJson(res, 200, { channels: [await channel.describe(false)] })
      })
      route('settings', 'POST', async (req, res, _query, channel) => {
        if (channel === undefined) return sendJson(res, 400, { error: 'invalid-channel' })
        if (settings?.writable !== true) return sendJson(res, 409, { error: 'settings-unavailable' })
        const edit = await readSettingsPatch(req)
        const id = channel.region.id
        const autoCheckin = id === 'cn' && typeof edit?.autoCheckin === 'boolean'
        const modelEdit = (typeof edit?.pinned === 'boolean' || typeof edit?.visible === 'boolean') &&
          channel.adapter.models().some(model => model.id === edit.modelId)
        if (typeof edit?.enabled !== 'boolean' &&
            !autoCheckin && !modelEdit) {
          return sendJson(res, 400, { error: 'invalid-setting' })
        }
        const write = writeQueue.then(async () => {
          if (typeof edit.enabled === 'boolean') {
            await settings.update(settingsNs, { [`${id}Enabled`]: edit.enabled })
            syncProviders()
          } else if (autoCheckin) {
            await settings.update(settingsNs, { cnAutoCheckin: edit.autoCheckin })
            cn.syncAccounts()
          } else if (typeof edit.pinned === 'boolean') {
            const field = `${id}PinnedModels`
            const pinned = new Set(current()[field])
            if (edit.pinned) pinned.add(edit.modelId)
            else pinned.delete(edit.modelId)
            await settings.update(settingsNs, { [field]: [...pinned] })
            ctx.emit('llm/adapters-updated')
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
