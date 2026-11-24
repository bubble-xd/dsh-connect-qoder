const DAY_MS = 86_400_000
const RETRY_MS = 30 * 60_000
const MANUAL_RETRY_MS = 15_000
const WINDOW_TOLERANCE_MS = 2 * 60_000
const WINDOW_OFFSET_MS = 2 * 3_600_000 // 10:00 in Beijing is 02:00 UTC.

function windowStart(now) {
  return Math.floor((now - WINDOW_OFFSET_MS) / DAY_MS) * DAY_MS + WINDOW_OFFSET_MS
}

function timestamp(value) {
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value
  return typeof value === 'string' ? Date.parse(value) : NaN
}

export function dailyCampaign(payload, now) {
  const campaigns = payload?.data?.campaigns ?? payload?.campaigns
  if (!Array.isArray(campaigns)) return undefined
  const window = windowStart(now)
  const matches = campaigns.filter(campaign => {
    if (campaign?.actionType !== 'CLAIM_BENEFIT' || Number(campaign.benefit?.amount) !== 100) return false
    if (campaign.benefit.type !== undefined && campaign.benefit.type !== 'CREDITS') return false
    if (!['CLAIMABLE', 'CLAIMED'].includes(campaign.claimStatus)) return false
    const start = timestamp(campaign.startAt ?? campaign.beginAt)
    const end = timestamp(campaign.endAt)
    return start <= now && now < end &&
      Math.abs(start - window) <= WINDOW_TOLERANCE_MS &&
      Math.abs(end - window - DAY_MS) <= WINDOW_TOLERANCE_MS
  })
  const campaign = matches.length === 1 ? matches[0] : undefined
  const id = campaign?.campaignId ?? campaign?.id
  if (typeof id !== 'string' || !/^[a-z0-9_-]{1,128}$/iu.test(id)) return undefined
  const claimedAt = timestamp(campaign.claimedAt)
  return { id, status: campaign.claimStatus, ...(Number.isFinite(claimedAt) ? { claimedAt } : {}) }
}

function finished(result) {
  return result?.state === 'signed' || result?.state === 'already'
}

export function createDailyCheckin({
  origin, channelEnabled, autoEnabled, getToken, onClaim, readResult, saveResult,
  fetcher = fetch, clock = Date.now,
}) {
  const campaigns = `${origin}/sash/api/v1/me/campaigns`
  let result
  let pending

  function status(recent) {
    const enabled = autoEnabled()
    if (pending) return { enabled, state: 'checking' }
    const window = windowStart(clock())
    const latest = result?.window === window ? result : recent?.window === window ? recent : undefined
    const nextAt = enabled && latest && !finished(latest) ? Math.min(window + DAY_MS, latest.at + RETRY_MS) : undefined
    return { enabled, state: latest?.state ?? (enabled ? 'waiting' : undefined), at: latest?.at, nextAt }
  }

  async function attempt(now, signal, task, manual) {
    try {
      task.auth = await getToken()
    } catch {
      return 'needsSignIn'
    }
    signal.throwIfAborted()
    const previous = await readResult?.(task.auth)
    if (previous?.window === windowStart(now) &&
        (finished(previous) || now - previous.at < (manual ? MANUAL_RETRY_MS : RETRY_MS))) return previous
    if (!channelEnabled()) return undefined
    const headers = { authorization: `Bearer ${task.auth.token}`, accept: 'application/json' }
    const request = (url, init) => fetcher(url, {
      ...init,
      headers: { ...headers, ...init?.headers },
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]),
    })
    const list = await request(campaigns)
    if (list.status === 401) return 'needsSignIn'
    if (list.status === 403) return 'activityUnavailable'
    if (!list.ok) return 'failed'
    const campaign = dailyCampaign(await list.json(), clock())
    if (!campaign) return 'activityUnavailable'
    if (campaign.status === 'CLAIMED') return { state: 'already', claimedAt: campaign.claimedAt }
    if (!channelEnabled() || windowStart(now) !== windowStart(clock())) return undefined
    signal.throwIfAborted()
    const claim = await request(`${campaigns}/${encodeURIComponent(campaign.id)}/claim`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })
    if (claim.status === 401) return 'needsSignIn'
    if (claim.status === 403) return 'activityUnavailable'
    if (!claim.ok) return 'failed'
    const body = await claim.json()
    const outcome = body?.data ?? body
    const claimedAt = timestamp(outcome?.claimedAt)
    if (outcome?.replayed === true) return { state: 'already', claimedAt: Number.isFinite(claimedAt) ? claimedAt : undefined }
    if (outcome?.status !== 'CLAIMED') return 'failed'
    const addOnRemaining = await onClaim(task.auth)
    return { state: 'signed', earned: 100, claimedAt: Number.isFinite(claimedAt) ? claimedAt : clock(), addOnRemaining }
  }

  function tick(manual = false) {
    if (!channelEnabled() || (!manual && !autoEnabled()) || pending) return pending?.promise
    const now = clock()
    const window = windowStart(now)
    if (result?.window === window &&
        (finished(result) ||
          now - result.at < (manual ? MANUAL_RETRY_MS : RETRY_MS))) return
    const controller = new AbortController()
    const task = { controller }
    pending = task
    task.promise = attempt(now, controller.signal, task, manual)
      .catch(() => 'failed')
      .then(async outcome => {
        if (!outcome) return
        if (outcome.window !== undefined) {
          if (!controller.signal.aborted) result = outcome
          return
        }
        const record = { window, at: clock(), ...(typeof outcome === 'string' ? { state: outcome } : outcome) }
        if (!controller.signal.aborted) result = record
        if (!controller.signal.aborted || finished(record)) await saveResult?.(record, task.auth)
      })
      .finally(() => { if (pending === task) pending = undefined })
    return task.promise
  }

  function reset() {
    pending?.controller.abort()
    pending = undefined
    result = undefined
  }

  return { status, tick, reset }
}
