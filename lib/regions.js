/**
 * The two Qoder channels this plugin bridges.
 *
 * Qoder ships as two independent products with separate sign-ins, separate API
 * origins and separate worker runtimes:
 *
 *   cn     — Qoder CN (formerly Tongyi Lingma), `openapi.qoder.com.cn`,
 *            worker runtime inside the desktop app's `app.asar.unpacked`.
 *   global — Qoder, `openapi.qoder.sh`, worker runtime delivered separately by
 *            the `@qoder-ai/qoder-agent-sdk` npm package.
 *
 * Everything that differs between them is captured here so the adapter, the
 * credential reader and the runtime resolver stay single-implementation.
 *
 * @module dsh-connect-qoder/regions
 */

/** Channel identifiers, in the order the panel lists them. */
export const REGION_IDS = ['cn', 'global']

/**
 * @typedef {object} Region
 * @property {'cn'|'global'} id - channel identifier.
 * @property {string} provider - LLM provider id registered with DSH.
 * @property {string} displayName - human name shown in model selectors.
 * @property {string} origin - open API origin for credentials and usage.
 * @property {string} shortName - compact label for the panel.
 * @property {string} note - one line describing the channel.
 */

/** @type {Record<'cn'|'global', Region>} */
export const REGIONS = {
  cn: {
    id: 'cn',
    provider: 'qoder-cn',
    displayName: 'Qoder CN',
    shortName: 'CN',
    origin: 'https://openapi.qoder.com.cn',
    note: 'Qoder CN 桌面版（国内），登录态取自 auth.v1.dat，运行时取自 app.asar.unpacked。',
  },
  global: {
    id: 'global',
    provider: 'qoder',
    displayName: 'Qoder',
    shortName: 'Global',
    origin: 'https://openapi.qoder.sh',
    note: 'Qoder 国际版，登录态取自 VS Code secret storage，运行时取自 @qoder-ai/qoder-agent-sdk。',
  },
}

/**
 * Resolve one channel definition.
 * @param {'cn'|'global'} id - channel identifier.
 * @returns {Region} the channel.
 */
export function regionOf(id) {
  const region = REGIONS[id]
  if (region === undefined) throw new Error(`unknown Qoder channel "${String(id)}"`)
  return region
}
