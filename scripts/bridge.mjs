// Exercise the tool bridge through the real adapter: Qoder asks for a tool,
// DSH answers, the same query continues and produces final text.
import { readDesktopAuth, refreshDeviceToken } from '../lib/auth.js'
import { resolveCnWorkerRuntime } from '../lib/worker-runtime.js'
import { QoderAdapter } from '../lib/adapter.js'

const auth = await readDesktopAuth('cn')
const fresh = await refreshDeviceToken('cn', auth.refreshToken)
const runtime = await resolveCnWorkerRuntime()

const adapter = new QoderAdapter({
  region: 'cn',
  token: async () => ({ token: fresh.token, expiresAt: fresh.expiresAt }),
  runtime: async () => runtime,
  workingDirectory: () => process.cwd(),
  log: () => {},
  requestTimeoutSeconds: 180,
})

const tools = [{
  name: 'read_hostname',
  description: 'Read the machine hostname. Takes no arguments.',
  parameters: { type: 'object', properties: {} },
}]

const sessionId = `bridge-${Date.now()}`
const messages = [{
  role: 'user',
  content: [{ type: 'text', text: 'Use the read_hostname tool, then tell me the hostname it returned.' }],
}]

async function consume(label) {
  let text = ''
  const toolCalls = []
  let finish
  for await (const chunk of adapter.stream({
    provider: 'qoder-cn',
    model: 'auto',
    messages,
    system: 'You must call the provided tool before answering.',
    tools,
    signal: new AbortController().signal,
    sessionId,
  })) {
    if (chunk.type === 'text-delta') text += chunk.text
    else if (chunk.type === 'block-end' && chunk.block?.type === 'tool-call') toolCalls.push(chunk.block)
    else if (chunk.type === 'finish') finish = chunk.reason
  }
  console.log(`[${label}] finish=${JSON.stringify(finish)} tools=${JSON.stringify(toolCalls)} text=${JSON.stringify(text.slice(0, 200))}`)
  return { text, toolCalls, finish }
}

const first = await consume('turn1')
if (first.finish?.kind !== 'tool-calls') {
  console.log('turn1 did not request a tool; aborting')
  await adapter.dispose()
  process.exit(0)
}

const HOSTNAME = 'bridge-host-99'
messages.push(
  { role: 'assistant', content: first.toolCalls.map(call => ({ type: 'tool-call', id: call.id, name: call.name, arguments: call.arguments })) },
  { role: 'tool', toolCallId: first.toolCalls[0].id, content: [{ type: 'text', text: HOSTNAME }] },
)

const second = await consume('turn2')
console.log(`[turn2] contains hostname: ${second.text.includes(HOSTNAME)}`)
await adapter.dispose()
process.exit(0)
