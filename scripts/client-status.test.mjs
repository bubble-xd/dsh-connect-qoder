import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { runInNewContext } from 'node:vm'

const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

function renderPage(fetch, signalAPI = AbortSignal) {
  const hooks = []
  const effects = []
  let cursor = 0
  let page
  const react = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState(initial) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial
      return [hooks[index], update => {
        hooks[index] = typeof update === 'function' ? update(hooks[index]) : update
      }]
    },
    useRef(initial) {
      const index = cursor++
      return hooks[index] ??= { current: initial }
    },
    useEffect(effect) {
      const index = cursor++
      if (!(index in hooks)) {
        hooks[index] = true
        effects.push(effect)
      }
    },
  }

  let plugin
  runInNewContext(client, {
    window: { __ModuleLoader__: { load: ({ factory }) => { plugin = factory(() => react) } } },
    fetch, AbortController, AbortSignal: signalAPI,
    document: { hidden: true, addEventListener() {}, removeEventListener() {} },
    setInterval() {}, clearInterval() {},
  })
  plugin.apply({
    effect: setup => setup(),
    locale: { register() {}, bind: () => key => key },
    slots: {
      inject: (_name, mount) => mount(),
      register: ({ name, inject }, component) => {
        if (name === 'main') page = () => component(inject())
      },
    },
  })

  function render() {
    cursor = 0
    const result = page()
    for (const effect of effects.splice(0)) effect()
    return result
  }
  render()
  return render
}

function find(node, matches) {
  if (node && matches(node)) return node
  const children = Array.isArray(node) ? node : node?.children ?? []
  for (const child of children) {
    const found = find(child, matches)
    if (found) return found
  }
}

const channel = (id, extra) => ({ id, enabled: true, models: [], ...extra })
const response = data => ({ ok: true, json: async () => data })

test('old DSH host returns account data with no connection field', async () => {
  const render = renderPage(async () => response({
    settingsNs: 'dsh-connect-qoder',
    sidebarPanel: true,
    channels: [
      channel('cn', { account: { name: 'Example' }, usage: { userQuota: { remaining: 12 } } }),
      channel('global', { error: 'sign-in not found' }),
    ],
  }))
  await delay(0)
  const tree = render()
  assert.ok(find(tree, node => node.props?.['data-state'] === 'connected'))
  assert.ok(find(tree, node => node.props?.['data-state'] === 'sign-in-required'))
  assert.ok(find(tree, node => node === 'legacyHost'))
})

test('new DSH host keeps its reported connection status', async () => {
  const render = renderPage(async path => response({
    writable: true,
    channels: [channel(path.endsWith('cn') ? 'cn' : 'global', { connection: 'connected' })],
  }))
  await delay(0)
  const tree = render()
  assert.ok(find(tree, node => node.props?.['data-state'] === 'connected'))
  assert.equal(find(tree, node => node === 'legacyHost'), undefined)
})

test('a stalled account response releases the refresh button', async () => {
  const render = renderPage(async (path, { signal }) => {
    if (!path.endsWith('cn')) return response({ channels: [channel('global', { connection: 'unavailable' })] })
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  }, {
    timeout: () => AbortSignal.timeout(1),
    any: AbortSignal.any,
  })
  await delay(15)
  const tree = render()
  assert.ok(find(tree, node => node === 'readTimeout'))
  assert.equal(find(tree, node => node.type === 'button' && node.children.includes('refresh')).props.disabled, false)
})
