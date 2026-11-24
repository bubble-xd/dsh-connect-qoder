/**
 * Bridge between the DeepSeek Harness LLM contract and the Qoder agent SDK.
 *
 * Qoder exposes no OpenAI- or Anthropic-shaped HTTP surface: inference runs
 * inside its own worker runtime, signed per request. The supported seam is the
 * agent SDK each product ships, so this adapter drives that SDK and keeps the
 * tool loop on the DSH side:
 *
 *   DSH ──stream()──▶ adapter ──query()──▶ Qoder worker ──MCP tools/call──▶ adapter
 *        ◀─StreamChunk─        ◀──SSE──                        parked resolver
 *
 * A model turn that asks for tools ends with `finish: tool-calls`; DSH runs the
 * tools and calls `stream()` again with their results, at which point the parked
 * MCP resolvers are answered and the SAME iterator is pumped further. That
 * continuation is what the worker requires — a fresh query carrying injected
 * `tool_result` blocks never reaches the model (verified against 0.5.17 CN and
 * 1.1.92 global).
 *
 * One class serves both channels; everything that differs (SDK module, provider
 * id, catalog seed, credential and runtime wiring) comes in through `deps`.
 *
 * @module dsh-connect-qoder/adapter
 */

import { LlmAdapter } from './llm-base.js'
import { regionOf } from './regions.js'

/** Seconds of silence tolerated while the worker produces nothing. */
const STREAM_IDLE_TIMEOUT_MS = 180_000

/** How long to wait after `message_stop` for in-flight tool requests to land. */
const TOOL_SETTLE_MS = 500

/**
 * Official SDK package for each channel.
 *
 * Loaded on first use rather than at import time so a channel whose SDK cannot
 * load never takes the other channel (or the whole plugin) down with it.
 */
const SDK_MODULES = {
  cn: '@qodercn-ai/qodercn-agent-sdk',
  global: '@qoder-ai/qoder-agent-sdk',
}

/** @type {Map<string, Promise<any>>} */
const sdkCache = new Map()

/**
 * Load the official SDK for one channel.
 * @param {'cn'|'global'} regionId - channel identifier.
 * @returns {Promise<any>} SDK namespace.
 */
function loadSdk(regionId) {
  let pending = sdkCache.get(regionId)
  if (pending === undefined) {
    const specifier = SDK_MODULES[regionId]
    if (specifier === undefined) throw new Error(`no agent SDK is configured for Qoder channel "${regionId}"`)
    pending = import(specifier)
    sdkCache.set(regionId, pending)
  }
  return pending
}

/**
 * Static seed catalog per channel, used before the worker reports its live list.
 *
 * CN entries were observed in `system/available_models_update` on 0.5.17; global
 * entries on 1.1.92. The two products ship different line-ups, so they are kept
 * apart rather than merged.
 */
export const SEED_MODELS = {
  cn: [
    { id: 'auto', name: 'Auto', contextWindow: 200_000, maxTokens: 32_000, note: '自动选路' },
    { id: 'fast', name: 'Fast', contextWindow: 200_000, maxTokens: 32_000, note: '低延迟' },
    { id: 'qmodel_latest', name: 'Qwen4-Max', contextWindow: 1_000_000, maxTokens: 32_000, note: '' },
    { id: 'qmodel_38max', name: 'Qwen3.8-Max', contextWindow: 180_000, maxTokens: 32_000, note: '' },
    { id: 'qfmodel', name: 'Qwen3.8-Flash', contextWindow: 180_000, maxTokens: 32_000, note: '轻量' },
    { id: 'dmodel', name: 'DeepSeek-V4-Pro', contextWindow: 96_000, maxTokens: 32_000, note: '' },
    { id: 'dfmodel', name: 'DeepSeek-Flash', contextWindow: 200_000, maxTokens: 32_000, note: '' },
    { id: 'gmodel', name: 'GLM-5.3', contextWindow: 200_000, maxTokens: 32_000, note: '' },
    { id: 'gfmodel', name: 'GLM-5.3-Flash', contextWindow: 200_000, maxTokens: 32_000, note: '' },
    { id: 'kmodel_latest', name: 'Kimi-K3.1-Pro', contextWindow: 200_000, maxTokens: 32_000, note: '' },
    { id: 'kmodel', name: 'Kimi-K2.8-Preview', contextWindow: 200_000, maxTokens: 32_000, note: '' },
    { id: 'jmodel', name: 'Step-5-Preview', contextWindow: 200_000, maxTokens: 32_000, note: '' },
    { id: 'mmodel', name: 'MiniMax-M3.1-Flash', contextWindow: 200_000, maxTokens: 32_000, note: '' },
  ],
  global: [
    { id: 'auto', name: 'Auto', contextWindow: 200_000, maxTokens: 32_000, note: '自动选路' },
    { id: 'ultimate', name: 'Ultimate', contextWindow: 1_000_000, maxTokens: 32_000, note: '最高档' },
    { id: 'fast', name: 'Fast', contextWindow: 200_000, maxTokens: 32_000, note: '低延迟' },
    { id: 'efficient', name: 'Efficient', contextWindow: 200_000, maxTokens: 32_000, note: '省额度' },
    { id: 'smodel', name: 'Sonus', contextWindow: 200_000, maxTokens: 32_000, note: '' },
    { id: 'cmodel', name: 'Cantus', contextWindow: 200_000, maxTokens: 32_000, note: '' },
    { id: 'qmodel_latest', name: 'Qwen4-Max', contextWindow: 1_000_000, maxTokens: 32_000, note: '' },
    { id: 'qmodel_38max', name: 'Qwen3.8-Max', contextWindow: 200_000, maxTokens: 32_000, note: '' },
    { id: 'qfmodel', name: 'Qwen3.8-Flash', contextWindow: 200_000, maxTokens: 32_000, note: '轻量' },
    { id: 'kmodel_latest', name: 'Kimi-K3.1-Pro', contextWindow: 200_000, maxTokens: 32_000, note: '' },
    { id: 'kmodel', name: 'Kimi-K2.8-Preview', contextWindow: 200_000, maxTokens: 32_000, note: '' },
    { id: 'gmodel', name: 'GLM-5.3', contextWindow: 200_000, maxTokens: 32_000, note: '' },
    { id: 'gfmodel', name: 'GLM-5.3-Flash', contextWindow: 200_000, maxTokens: 32_000, note: '' },
    { id: 'dmodel', name: 'DeepSeek-V4-Pro', contextWindow: 1_000_000, maxTokens: 32_000, note: '' },
    { id: 'dfmodel', name: 'DeepSeek-Flash', contextWindow: 1_000_000, maxTokens: 32_000, note: '' },
    { id: 'mmodel', name: 'MiniMax-M3.1-Flash', contextWindow: 200_000, maxTokens: 32_000, note: '' },
  ],
}

/** Map one upstream catalog row into the fields this adapter keeps. */
function normalizeModel(row) {
  const id = typeof row?.value === 'string' && row.value !== '' ? row.value : row?.modelId
  if (typeof id !== 'string' || id === '') return undefined
  const windows = Array.isArray(row?.availableContextWindows)
    ? row.availableContextWindows.filter(value => typeof value === 'number' && value > 0)
    : []
  const declared = typeof row?.defaultContextWindow === 'number' && row.defaultContextWindow > 0
    ? row.defaultContextWindow
    : undefined
  const contextWindow = declared ?? (windows.length > 0 ? Math.max(...windows) : 200_000)
  const efforts = Array.isArray(row?.efforts)
    ? row.efforts.filter(value => typeof value === 'string' && value !== '')
    : []
  const declaredEffort = typeof row?.defaultEffort === 'string' ? row.defaultEffort : undefined
  return {
    id,
    name: typeof row?.displayName === 'string' && row.displayName !== '' ? row.displayName : id,
    contextWindow,
    maxTokens: typeof row?.maxOutputTokens === 'number' && row.maxOutputTokens > 0 ? row.maxOutputTokens : 32_000,
    efforts,
    defaultEffort: declaredEffort !== undefined && efforts.includes(declaredEffort) ? declaredEffort : undefined,
    priceFactor: typeof row?.priceFactor === 'number' ? row.priceFactor : undefined,
    reasoning: row?.isReasoning === true,
    vision: row?.isVl === true,
    note: typeof row?.description === 'string' ? row.description : '',
  }
}

/** Join every text block of one message into a single string. */
function textOf(message) {
  const parts = []
  for (const block of message.content ?? []) {
    if (block.type === 'text') parts.push(block.text)
    else if (block.type === 'reasoning') parts.push(`(thinking) ${block.text}`)
    else if (block.type === 'image') parts.push('[image omitted: the Qoder route carries text only]')
    else if (block.type === 'file') parts.push('[file omitted: the Qoder route carries text only]')
    else if (block.type === 'tool-call') parts.push(`(tool call ${block.name} ${block.arguments})`)
  }
  return parts.join('\n').trim()
}

/**
 * Render the messages a resumed worker has not seen yet.
 *
 * After the first turn the worker holds the conversation itself, so only the
 * trailing user content is new; the first turn gets the whole transcript.
 * @param {readonly object[]} messages - DSH request messages.
 * @param {boolean} whole - render everything instead of only the tail.
 * @returns {string} prompt text.
 */
function renderPrompt(messages, whole) {
  const relevant = whole ? messages : (() => {
    let lastAssistant = -1
    messages.forEach((message, index) => {
      if (message.role === 'assistant') lastAssistant = index
    })
    const tail = messages.slice(lastAssistant + 1).filter(message => message.role === 'user' || message.role === 'developer')
    return tail.length > 0 ? tail : messages.slice(-1)
  })()
  const sections = []
  for (const message of relevant) {
    const body = textOf(message)
    if (body === '') continue
    sections.push(whole ? `### ${message.role}\n${body}` : body)
  }
  return sections.join('\n\n').trim()
}

/** Normalize a DSH tool name into an MCP-safe identifier. */
function mcpToolName(name) {
  const cleaned = String(name).replace(/[^A-Za-z0-9_-]/gu, '_')
  return cleaned === '' ? 'tool' : cleaned
}

/**
 * One parked MCP tool request: the model asked, DSH has not answered yet.
 * @typedef {{ id: string, name: string, args: Record<string, unknown>, resolve: (result: object) => void }} ParkedCall
 */

/**
 * The live state of one DSH conversation against the worker.
 *
 * Holds the message iterator so a tool-call turn can be resumed on the same
 * query, plus the parked MCP resolvers DSH answers on the next `stream()`.
 */
class QoderConversation {
  constructor(owner) {
    this.owner = owner
    /** @type {AsyncIterator<any> | undefined} */
    this.iterator = undefined
    /** @type {Map<string, ParkedCall>} */
    this.parked = new Map()
    /** Tool-call blocks the model produced but DSH has not answered yet. */
    this.pendingBlocks = []
    /** @type {string | undefined} */
    this.qoderSessionId = undefined
    this.started = false
    /** @type {string} */
    this.toolSignature = ''
    /** @type {readonly object[] | undefined} */
    this.tools = undefined
    this.creditTotal = 0
  }

  /** Signature of the currently advertised tool set. */
  static signatureOf(tools) {
    return (tools ?? []).map(tool => `${tool.name}:${tool.deferLoading === true ? 'lazy' : 'eager'}`).sort().join('|')
  }

  /**
   * Build the plain MCP server the worker talks to.
   *
   * It implements exactly the four methods the worker issues, and answers
   * `tools/call` by parking the request until DSH produces a result.
   */
  createMcpServer() {
    const conversation = this
    return {
      type: 'sdk',
      name: 'dsh',
      async connect(transport) {
        transport.onmessage = async (message) => {
          const reply = result => transport.send({ jsonrpc: '2.0', id: message.id, result })
          const fail = (code, text) => transport.send({ jsonrpc: '2.0', id: message.id, error: { code, message: text } })
          switch (message.method) {
            case 'initialize':
              return reply({
                protocolVersion: message.params?.protocolVersion ?? '2025-06-18',
                capabilities: { tools: {} },
                serverInfo: { name: 'dsh', version: '1.0.0' },
              })
            case 'notifications/initialized':
              return undefined
            case 'tools/list':
              return reply({
                tools: (conversation.tools ?? []).map(tool => ({
                  name: mcpToolName(tool.name),
                  description: tool.description ?? '',
                  inputSchema: tool.parameters ?? { type: 'object', properties: {} },
                })),
              })
            case 'tools/call': {
              const name = String(message.params?.name ?? '')
              const args = message.params?.arguments ?? {}
              const id = `call_${String(message.params?._meta?.progressToken ?? Math.random().toString(16).slice(2))}`
              conversation.parked.set(id, { id, name, args, resolve: result => reply(result) })
              return undefined
            }
            default:
              return fail(-32601, `unsupported method ${String(message.method)}`)
          }
        }
      },
    }
  }

  /**
   * Start a worker query for this conversation.
   * @param {{ prompt: string, model?: string, resume?: string, system?: string }} request - query parameters.
   */
  async start(request) {
    const tools = (this.tools ?? []).map(tool => ({
      name: mcpToolName(tool.name),
      exposedName: mcpToolName(tool.name),
      alwaysLoad: tool.deferLoading !== true,
      permission_policy: 'always_allow',
    }))
    const server = this.createMcpServer()
    const handle = this.owner.client.query({
      prompt: request.prompt,
      options: {
        daemon: this.owner.daemon,
        cwd: this.owner.workingDirectory(),
        tools: [],
        mcpServers: { dsh: { type: 'sdk', instance: server, tools } },
        includePartialMessages: true,
        permissionMode: 'bypassPermissions',
        maxTurns: 200,
        ...request.model === undefined ? {} : { model: request.model },
        ...request.resume === undefined ? {} : { resume: request.resume },
        ...request.system === undefined || request.system.trim() === '' ? {} : { systemPrompt: request.system },
      },
    })
    this.iterator = handle[Symbol.asyncIterator]()
    this.started = true
  }

  /** Answer every parked call with a "host did not answer" error result. */
  drainParked(text) {
    for (const call of this.parked.values()) {
      try {
        call.resolve({ content: [{ type: 'text', text }], isError: true })
      } catch {}
    }
    this.parked.clear()
  }

  /** Release the worker side of this conversation. */
  async close() {
    this.drainParked('the DSH session ended before this tool call was answered')
    const iterator = this.iterator
    this.iterator = undefined
    this.started = false
    this.pendingBlocks = []
    if (iterator?.return !== undefined) {
      try {
        await iterator.return()
      } catch {}
    }
  }
}

/**
 * The DSH LLM adapter over one Qoder channel's agent SDK.
 *
 * One adapter instance serves one provider route for the whole profile;
 * conversations are keyed by `GenerateOptions.sessionId` so a tool-call turn can
 * be resumed on the query that produced it.
 */
export class QoderAdapter extends LlmAdapter {
  /**
   * @param {object} deps - host wiring.
   * @param {'cn'|'global'} deps.region - channel this adapter serves.
   * @param {() => Promise<{token: string, expiresAt: number}>} [deps.token] - device-token provider.
   * @param {() => () => Promise<{token: string, expiresAt: number}>} [deps.tokenForDaemon] - binds the daemon to one account.
   * @param {() => ({path: string} | undefined) | Promise<{path: string} | undefined>} deps.runtime - worker runtime resolver.
   * @param {() => string} deps.workingDirectory - cwd for worker queries.
   * @param {(message: string, error?: unknown) => void} deps.log - host logger.
   * @param {(models: readonly object[]) => void} [deps.onModels] - catalog observer.
   * @param {number | (() => number)} [deps.requestTimeoutSeconds] - silence budget for one worker message.
   */
  constructor(deps) {
    super()
    this.deps = deps
    this.region = regionOf(deps.region)
    this.provider = this.region.provider
    this.displayName = this.region.displayName
    /** @type {any} */
    this.client = undefined
    /** @type {any} */
    this.daemon = undefined
    /** @type {Promise<any> | undefined} */
    this.daemonPromise = undefined
    /** @type {Map<string, QoderConversation>} */
    this.conversations = new Map()
    /** @type {Map<string, object>} */
    this.catalog = new Map(
      (SEED_MODELS[deps.region] ?? []).map(model => {
        const seed = {
          efforts: [],
          defaultEffort: undefined,
          priceFactor: undefined,
          reasoning: false,
          vision: false,
          ...model,
        }
        return [seed.id, seed]
      }),
    )
    this.disposed = false
  }

  /** Load the SDK for this channel on first use. */
  async sdk() {
    if (this.client === undefined) this.client = await loadSdk(this.region.id)
    return this.client
  }

  /** @inheritdoc */
  providerInfo(provider) {
    return { id: provider, name: this.displayName }
  }

  /** Working directory handed to worker queries. */
  workingDirectory() {
    try {
      return this.deps.workingDirectory()
    } catch {
      return process.cwd()
    }
  }

  /** The live model catalog, seed entries overlaid by worker reports. */
  models() {
    const models = [...this.catalog.values()]
    const order = new Map(this.deps.pinnedModels?.().map((id, index) => [id, index]))
    return models.sort((a, b) => (order.get(a.id) ?? order.size) - (order.get(b.id) ?? order.size))
  }

  /** Merge a worker catalog report into the live catalog. */
  absorbCatalog(rows) {
    let changed = false
    for (const row of rows ?? []) {
      const model = normalizeModel(row)
      if (model === undefined) continue
      this.catalog.set(model.id, { ...model, source: 'worker' })
      changed = true
    }
    if (changed) this.deps.onModels?.(this.models())
  }

  /** @inheritdoc */
  async listModels(provider) {
    if (provider !== this.provider) return []
    return this.models().filter(model => this.deps.modelVisible?.(model.id) !== false).map(model => ({
      provider,
      id: model.id,
      name: model.name,
      inputModalities: ['text'],
      ...model.note === '' ? {} : { description: model.note },
    }))
  }

  /** @inheritdoc */
  async resolveModel(provider, model) {
    const known = this.catalog.get(model)
    const base = known ?? {
      id: model,
      name: model,
      contextWindow: 200_000,
      maxTokens: 32_000,
      efforts: [],
      defaultEffort: undefined,
      note: '',
    }
    const efforts = Array.isArray(base.efforts) ? base.efforts : []
    return {
      provider,
      id: base.id,
      name: base.name,
      ...typeof base.note === 'string' && base.note !== '' ? { description: base.note } : {},
      context: { contextWindow: base.contextWindow },
      defaultMaxTokens: base.maxTokens,
      ...efforts.length === 0 ? {} : {
        reasoning: {
          efforts: efforts.map(effort => ({ id: effort, name: effort })),
          ...base.defaultEffort === undefined ? {} : { defaultEffort: base.defaultEffort },
        },
      },
    }
  }

  /** Start the worker daemon, reusing it across conversations. */
  async ensureDaemon() {
    if (this.disposed) throw new Error('Qoder adapter is disposed')
    if (this.resetPromise !== undefined) {
      await this.resetPromise
      return this.ensureDaemon()
    }
    if (this.daemon !== undefined) return this.daemon
    if (this.daemonPromise !== undefined) return this.daemonPromise
    const pending = this.startDaemon()
    this.daemonPromise = pending
    try {
      this.daemon = await pending
      return this.daemon
    } finally {
      this.daemonPromise = undefined
    }
  }

  async startDaemon() {
    const token = this.deps.tokenForDaemon?.() ?? this.deps.token
    await token()
    const runtime = await this.deps.runtime()
    if (runtime === undefined) {
      throw new Error(
        `${this.displayName} worker runtime not found; install the Qoder desktop app, or let the plugin download it, or set an explicit path in settings`,
      )
    }
    const client = await this.sdk()
    return client.startDaemon({
      auth: client.jobToken(async () => {
        const fresh = await token()
        // The worker rejects a non-finite or implausibly small expiry, and the
        // desktop records hand out ISO strings, so normalize before handing over.
        const raw = fresh.expiresAt
        const parsed = typeof raw === 'number' ? raw : Date.parse(String(raw ?? ''))
        const expiresAt = Number.isFinite(parsed) && parsed > 1e12 ? parsed : Date.now() + 3_600_000
        return { token: fresh.token, expiresAt }
      }),
      launchMode: 'worker',
      pathToQoderWorkerRuntime: runtime.path,
      stderr: (text) => this.deps.log(`worker: ${String(text).trim()}`),
    })
  }

  /** Drop the daemon so the next call starts a fresh one. */
  async resetDaemon() {
    if (this.resetPromise !== undefined) return this.resetPromise
    this.resetPromise = this.closeDaemon()
    try {
      await this.resetPromise
    } finally {
      this.resetPromise = undefined
    }
  }

  async closeDaemon() {
    await this.daemonPromise?.catch(() => {})
    const daemon = this.daemon
    this.daemon = undefined
    const conversations = [...this.conversations.values()]
    this.conversations.clear()
    const closing = conversations.map(conversation => conversation.close())
    if (daemon !== undefined) closing.push(this.sdk().then(client => client.shutdownDaemon(daemon)))
    await Promise.allSettled(closing)
  }

  /** The conversation for one DSH session id. */
  conversationFor(sessionId) {
    const key = typeof sessionId === 'string' && sessionId !== '' ? sessionId : 'default'
    let conversation = this.conversations.get(key)
    if (conversation === undefined) {
      conversation = new QoderConversation(this)
      this.conversations.set(key, conversation)
    }
    return conversation
  }

  /**
   * Await one worker message, failing when the worker stays silent too long.
   * @param {AsyncIterator<any>} iterator - the conversation's message iterator.
   * @returns {Promise<IteratorResult<any>>} the next message.
   */
  nextWithTimeout(iterator) {
    const configured = this.deps.requestTimeoutSeconds
    const seconds = typeof configured === 'function' ? configured() : configured
    const budget = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : STREAM_IDLE_TIMEOUT_MS
    let timer
    return Promise.race([
      iterator.next(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${this.displayName} worker produced no output in time`)), budget)
        timer.unref?.()
      }),
    ]).finally(() => clearTimeout(timer))
  }

  /**
   * Answer parked calls whose tool results DSH has just delivered.
   * @param {QoderConversation} conversation - the conversation to resume.
   * @param {readonly object[]} messages - full request messages.
   * @returns {boolean} whether anything was answered (i.e. the query can continue).
   */
  answerToolResults(conversation, messages) {
    const results = new Map()
    for (const message of messages) {
      if (message.role !== 'tool') continue
      const id = message.toolCallId
      if (typeof id !== 'string' || id === '') continue
      results.set(id, message)
    }
    let answered = false
    for (const block of [...conversation.pendingBlocks]) {
      const message = results.get(block.id)
      if (message === undefined) continue
      const call = conversation.parked.get(block.id)
      const text = textOf(message) || '(no output)'
      if (call !== undefined) {
        try {
          call.resolve(message.isError === true
            ? { content: [{ type: 'text', text }], isError: true }
            : { content: [{ type: 'text', text }] })
        } catch {}
        conversation.parked.delete(block.id)
      }
      conversation.pendingBlocks = conversation.pendingBlocks.filter(entry => entry.id !== block.id)
      answered = true
    }
    return answered
  }

  /**
   * Turn a failed `result` message into text worth showing.
   *
   * The worker puts the useful detail in different fields depending on the
   * failure: `errors[]` for upstream refusals, `error_message` for HTTP-shaped
   * ones, and `result` when the run itself failed after producing text.
   * @param {any} message - the terminal `result` message.
   * @returns {string} human-readable failure text.
   */
  failureText(message) {
    const errors = Array.isArray(message?.errors) ? message.errors.filter(entry => typeof entry === 'string' && entry !== '') : []
    const candidates = [
      ...errors,
      typeof message?.error_message === 'string' ? message.error_message : undefined,
      typeof message?.result === 'string' && message.result !== '' ? message.result : undefined,
      typeof message?.subtype === 'string' ? message.subtype : undefined,
    ]
    const text = candidates.find(value => typeof value === 'string' && value !== '')
    if (text === undefined) return `${this.displayName} reported a failure`
    const pricing = /pricingUrl/.test(text)
    return pricing
      ? `${this.displayName} refused the request: the signed-in account has no credits left. ${text}`
      : text
  }

  /**
   * Pump the worker's message stream into DSH chunks.
   *
   * Ends either with `finish: tool-calls` (tool blocks parked for DSH) or with
   * a terminal reason once the worker reports its result.
   */
  async * pump(conversation, options) {
    const signal = options.signal
    /** Block index handed to DSH; counts every content block in order. */
    let index = -1
    let open = undefined
    let text = ''
    let reasoning = ''
    let finished = false

    const close = (block) => {
      const current = open
      open = undefined
      if (current === undefined) return undefined
      return { type: 'block-end', index: current.index, block }
    }

    while (!finished) {
      if (signal?.aborted === true) {
        yield { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'request aborted' } } }
        return
      }
      let next
      try {
        next = await this.nextWithTimeout(conversation.iterator)
      } catch (error) {
        yield { type: 'finish', reason: { kind: 'error', failure: { code: 'TRANSPORT', message: String(error?.message ?? error) } } }
        return
      }
      if (next.done === true) {
        const closing = close({ type: open?.kind === 'reasoning' ? 'reasoning' : 'text', text: open?.kind === 'reasoning' ? reasoning : text })
        if (closing !== undefined) yield closing
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
      const message = next.value
      if (message?.type === 'system' && message.subtype === 'init') {
        conversation.qoderSessionId = message.session_id
      }
      if (message?.type === 'system' && message.subtype === 'available_models_update') {
        this.absorbCatalog(message.models)
      }
      if (message?.type === 'stream_event') {
        const event = message.event
        if (event.type === 'content_block_start') {
          const type = event.content_block?.type
          if (type === 'text' || type === 'thinking') {
            const closing = close(open?.kind === 'reasoning' ? { type: 'reasoning', text: reasoning } : { type: 'text', text })
            if (closing !== undefined) yield closing
            index += 1
            open = { index, kind: type === 'text' ? 'text' : 'reasoning' }
            if (open.kind === 'text') text = ''
            else reasoning = ''
            yield { type: 'block-start', index, blockType: open.kind }
          }
        } else if (event.type === 'content_block_delta') {
          if (open?.kind === 'text' && event.delta?.type === 'text_delta') {
            text += event.delta.text
            yield { type: 'text-delta', index: open.index, text: event.delta.text }
          } else if (open?.kind === 'reasoning' && event.delta?.type === 'thinking_delta') {
            reasoning += event.delta.thinking
            yield { type: 'reasoning-delta', index: open.index, text: event.delta.thinking }
          }
        } else if (event.type === 'content_block_stop') {
          const closing = close(open?.kind === 'reasoning' ? { type: 'reasoning', text: reasoning } : { type: 'text', text })
          if (closing !== undefined) yield closing
        } else if (event.type === 'message_stop') {
          const closing = close(open?.kind === 'reasoning' ? { type: 'reasoning', text: reasoning } : { type: 'text', text })
          if (closing !== undefined) yield closing
          await new Promise(resolve => setTimeout(resolve, TOOL_SETTLE_MS))
          if (conversation.parked.size > 0) {
            for (const call of conversation.parked.values()) {
              index += 1
              const argsJson = JSON.stringify(call.args ?? {})
              yield { type: 'block-start', index, blockType: 'tool-call' }
              yield { type: 'tool-call-delta', index, id: call.id, name: call.name, argumentsDelta: argsJson }
              yield { type: 'block-end', index, block: { type: 'tool-call', id: call.id, name: call.name, arguments: argsJson } }
              conversation.pendingBlocks.push({ id: call.id, name: call.name })
            }
            yield { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } }
            yield { type: 'finish', reason: { kind: 'tool-calls' } }
            return
          }
        }
      }
      if (message?.type === 'result') {
        conversation.creditTotal += typeof message.total_credits === 'number' ? message.total_credits : 0
        conversation.qoderSessionId = message.session_id ?? conversation.qoderSessionId
        const closing = close(open?.kind === 'reasoning' ? { type: 'reasoning', text: reasoning } : { type: 'text', text })
        if (closing !== undefined) yield closing
        if (conversation.parked.size > 0) {
          for (const call of conversation.parked.values()) {
            index += 1
            const argsJson = JSON.stringify(call.args ?? {})
            yield { type: 'block-start', index, blockType: 'tool-call' }
            yield { type: 'tool-call-delta', index, id: call.id, name: call.name, argumentsDelta: argsJson }
            yield { type: 'block-end', index, block: { type: 'tool-call', id: call.id, name: call.name, arguments: argsJson } }
            conversation.pendingBlocks.push({ id: call.id, name: call.name })
          }
          yield { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } }
          yield { type: 'finish', reason: { kind: 'tool-calls' } }
          return
        }
        yield { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } }
        const isError = message.is_error === true || message.subtype !== 'success'
        yield {
          type: 'finish',
          reason: isError
            ? { kind: 'error', failure: { code: 'UPSTREAM', message: this.failureText(message) } }
            : { kind: 'stop' },
        }
        finished = true
      }
    }
  }

  /** @inheritdoc */
  async * stream(options) {
    try {
      await this.ensureDaemon()
    } catch (error) {
      yield { type: 'finish', reason: { kind: 'error', failure: { code: 'AUTH', message: String(error?.message ?? error) } } }
      return
    }
    const conversation = this.conversationFor(options.sessionId)
    const tools = options.tools ?? []
    conversation.tools = tools
    const signature = QoderConversation.signatureOf(tools)
    const resuming = this.answerToolResults(conversation, options.messages)
    if (!resuming || conversation.iterator === undefined || signature !== conversation.toolSignature) {
      if (conversation.iterator !== undefined) await conversation.close()
      const whole = conversation.qoderSessionId === undefined
      const prompt = renderPrompt(options.messages, whole)
      if (prompt === '') {
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
      conversation.toolSignature = signature
      try {
        await conversation.start({
          prompt,
          model: options.model,
          resume: conversation.qoderSessionId,
          system: options.system,
        })
      } catch (error) {
        yield { type: 'finish', reason: { kind: 'error', failure: { code: 'TRANSPORT', message: String(error?.message ?? error) } } }
        return
      }
    }
    yield* this.pump(conversation, options)
  }

  /** Release every conversation and the worker process. */
  async dispose() {
    this.disposed = true
    await this.resetDaemon()
  }
}

/** Backwards-compatible alias for the CN channel class name. */
export const QoderCnAdapter = QoderAdapter

/** Provider route the CN channel serves. */
export const QODER_CN_PROVIDER = 'qoder-cn'

/** Provider route the global channel serves. */
export const QODER_GLOBAL_PROVIDER = 'qoder'
