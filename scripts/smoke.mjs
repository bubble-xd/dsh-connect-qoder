/**
 * End-to-end smoke test for dsh-connect-qoder, run outside DSH.
 *
 * For each channel it does exactly what the Host does: read the desktop
 * sign-in, refresh the device token, resolve the worker runtime, start the
 * daemon, and run one query. The global channel is expected to reach the
 * worker and then be refused upstream when the account has no credits, which
 * still proves the transport works.
 *
 * Usage: node scripts/smoke.mjs [cn|global]
 */

import { readDesktopAuth, refreshDeviceToken, fetchUserInfo, fetchUsage } from '../lib/auth.js'
import { resolveCnWorkerRuntime, resolveGlobalWorkerRuntime } from '../lib/worker-runtime.js'
import { QoderAdapter } from '../lib/adapter.js'

const regions = process.argv[2] === undefined ? ['cn', 'global'] : [process.argv[2]]

const log = (message) => console.log(`[smoke] ${message}`)

async function runOne(regionId) {
  log(`--- ${regionId} ---`)

  const auth = await readDesktopAuth(regionId)
  log('desktop sign-in found')

  const fresh = await refreshDeviceToken(regionId, auth.refreshToken)
  log('device token refreshed')

  const user = await fetchUserInfo(regionId, fresh.token).catch(error => ({ error: String(error) }))
  log(`account data: ${user?.name || user?.username ? 'available' : 'unavailable'}`)

  const usage = await fetchUsage(regionId, fresh.token).catch(error => ({ error: String(error) }))
  log(`quota data: ${usage?.userQuota ? 'available' : 'unavailable'}`)

  const runtime = regionId === 'cn'
    ? await resolveCnWorkerRuntime()
    : await resolveGlobalWorkerRuntime({ log })
  log(`runtime: ${JSON.stringify(runtime)}`)
  if (runtime === undefined) throw new Error('no worker runtime')

  const adapter = new QoderAdapter({
    region: regionId,
    token: async () => ({ token: fresh.token, expiresAt: fresh.expiresAt }),
    runtime: async () => runtime,
    workingDirectory: () => process.cwd(),
    log,
    onModels: (models) => log(`catalog: ${models.length} models (${models.map(m => m.id).join(',')})`),
    requestTimeoutSeconds: 120,
  })

  const provider = adapter.providerInfo(regionId === 'cn' ? 'qoder-cn' : 'qoder')
  log(`providerInfo: ${JSON.stringify(provider)}`)
  log(`listModels: ${(await adapter.listModels(provider.id)).length}`)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 180_000)
  const started = Date.now()
  let text = ''
  let finish
  try {
    for await (const chunk of adapter.stream({
      provider: provider.id,
      model: 'auto',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with exactly: PONG' }] }],
      system: 'You are a smoke test. Answer with the single word requested.',
      signal: controller.signal,
      sessionId: `smoke-${regionId}-${Date.now()}`,
    })) {
      if (chunk.type === 'text-delta') text += chunk.text
      else if (chunk.type === 'block-start') log(`block-start #${chunk.index} ${chunk.blockType}`)
      else if (chunk.type === 'finish') finish = chunk.reason
      else if (chunk.type === 'usage') log(`usage: ${JSON.stringify(chunk.usage)}`)
    }
  } catch (error) {
    log(`stream threw: ${error?.message ?? error}`)
  } finally {
    clearTimeout(timer)
    await adapter.dispose?.()
  }

  log(`elapsed: ${Date.now() - started}ms`)
  log(`text: ${JSON.stringify(text.slice(0, 300))}`)
  log(`finish: ${JSON.stringify(finish)}`)
}

for (const regionId of regions) {
  try {
    await runOne(regionId)
  } catch (error) {
    log(`${regionId} FAILED: ${error?.stack ?? error}`)
  }
}

log('done')
process.exit(0)
