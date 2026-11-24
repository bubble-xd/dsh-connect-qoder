import assert from 'node:assert/strict'
import { mkdtemp, readdir, rmdir, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createDailyCheckin, dailyCampaign } from '../lib/checkin.js'
import { createCheckinHistory } from '../lib/checkin-history.js'
import { summarizeCredits } from '../lib/index.js'

const now = Date.parse('2026-11-24T02:05:00Z')
const campaign = {
  campaignId: 'reward-1', actionType: 'CLAIM_BENEFIT', claimStatus: 'CLAIMABLE',
  startAt: '2026-11-24T02:00:00Z', endAt: '2026-11-25T01:59:59Z',
  benefit: { amount: 100 },
}
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status })

test('credit total includes add-on balance and preserves unknown balances', () => {
  const userQuota = { remaining: 2000, used: 0, total: 2000 }
  const addOnQuota = { remaining: 694, used: 6, total: 700 }
  assert.deepEqual(summarizeCredits({ userQuota, addOnQuota }), {
    plan: userQuota, addOn: addOnQuota, remaining: 2694, exhausted: false,
  })
  assert.equal(summarizeCredits({ userQuota }).remaining, undefined)
  assert.equal(summarizeCredits({ userQuota: { remaining: 0 }, addOnQuota, isQuotaExceeded: true }).exhausted, false)
  assert.equal(summarizeCredits({ userQuota, addOnQuota: { ...addOnQuota, expiresAt: now / 1000 } }).addOn.expiresAt, now)
  assert.equal(summarizeCredits({ userQuota, addOnQuota, expiresAt: now }).addOn.expiresAt, undefined)
})

test('only a single matching daily reward in the current Beijing window can be selected', () => {
  assert.deepEqual(dailyCampaign({ campaigns: [campaign] }, now), { id: 'reward-1', status: 'CLAIMABLE' })
  for (const changes of [
    { actionType: 'VIEW_DETAILS' }, { benefit: { amount: 500 } },
    { endAt: '2026-11-27T02:00:00Z' }, { campaignId: '../other' },
  ]) {
    assert.equal(dailyCampaign({ campaigns: [{ ...campaign, ...changes }] }, now), undefined)
  }
  assert.equal(dailyCampaign({ campaigns: [campaign, { ...campaign, campaignId: 'reward-2' }] }, now), undefined)
  assert.equal(dailyCampaign({ campaigns: [campaign] }, Date.parse(campaign.endAt)), undefined)
})

test('manual check-in works with auto off and shares the in-flight claim', async () => {
  const methods = []
  let refreshed = 0
  const checkin = createDailyCheckin({
    origin: 'https://example.test', channelEnabled: () => true, autoEnabled: () => false,
    getToken: async () => ({ token: 'test' }), onClaim: () => { refreshed++ }, clock: () => now,
    fetcher: async (_url, options) => {
      methods.push(options.method ?? 'GET')
      return options.method === 'POST' ? reply({ status: 'CLAIMED' }) : reply({ campaigns: [campaign] })
    },
  })
  assert.equal(checkin.tick(), undefined)
  const first = checkin.tick(true)
  assert.equal(checkin.tick(true), first)
  await first
  assert.equal(checkin.status().state, 'signed')
  await checkin.tick(true)
  assert.deepEqual(methods, ['GET', 'POST'])
  assert.equal(refreshed, 1)
})

test('automatic check-in retries unavailable activity and stops on a confirmed claim', async () => {
  const methods = []
  let time = now
  let campaigns = []
  const checkin = createDailyCheckin({
    origin: 'https://example.test', channelEnabled: () => true, autoEnabled: () => true,
    getToken: async () => ({ token: 'test' }), onClaim: () => assert.fail('no new reward'),
    clock: () => time, fetcher: async (_url, options) => {
      methods.push(options.method ?? 'GET')
      return reply({ campaigns })
    },
  })
  await checkin.tick()
  assert.equal(checkin.status().state, 'activityUnavailable')
  time += 29 * 60_000
  assert.equal(checkin.tick(), undefined)
  time += 60_000
  campaigns = [{ ...campaign, claimStatus: 'CLAIMED' }]
  await checkin.tick()
  assert.equal(checkin.status().state, 'already')
  assert.equal(checkin.tick(), undefined)
  assert.deepEqual(methods, ['GET', 'GET'])
})

test('confirmed history survives a restart and stays isolated by account', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-qoder-checkin-'))
  t.after(async () => {
    for (const file of await readdir(directory)) await unlink(join(directory, file))
    await rmdir(directory)
  })
  const history = createCheckinHistory(directory)
  const calls = []
  const create = key => createDailyCheckin({
    origin: 'https://example.test', channelEnabled: () => true, autoEnabled: () => true,
    getToken: async () => ({ token: 'test' }), onClaim: () => 794, clock: () => now,
    readResult: async () => (await history.read(key))[0],
    saveResult: record => history.append(key, record),
    fetcher: async (_url, options) => {
      calls.push([key, options.method ?? 'GET'])
      return options.method === 'POST' ? reply({ status: 'CLAIMED' }) : reply({ campaigns: [campaign] })
    },
  })
  await create('cn:test-a').tick()
  const [receipt] = await createCheckinHistory(directory).read('cn:test-a')
  assert.equal(receipt.earned, 100)
  assert.equal(receipt.addOnRemaining, 794)
  assert.equal(receipt.claimedAt, now)
  assert.deepEqual(await history.read('cn:test-b'), [])
  const reopened = create('cn:test-a')
  await reopened.tick()
  assert.equal(reopened.status().state, 'signed')
  assert.deepEqual(calls, [['cn:test-a', 'GET'], ['cn:test-a', 'POST']])
})
