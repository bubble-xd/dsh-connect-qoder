window.__ModuleLoader__.load({
  id: 'dsh-connect-qoder',
  factory(require) {
    const { createElement: h, Fragment, useEffect, useId, useRef, useState } = require('react')
    const panelId = 'dsh-connect-qoder'
    const namespace = 'settings.qoder'
    const base = '/plugins/dsh-connect-qoder'
    const requestTimeoutMs = 25_000
    const regions = [
      { id: 'cn', displayName: 'Qoder CN', provider: 'qoder-cn' },
      { id: 'global', displayName: 'Qoder', provider: 'qoder' },
    ]
    const zh = {
      title: 'Qoder', back: '返回会话', refresh: '刷新状态', reconnect: '重新连接',
      loading: '正在读取状态…', busy: '处理中…', account: '账号与额度', models: '模型', diagnostics: '诊断',
      cn: '国内版', global: '国际版', enabled: '在 DSH 中启用', enabledCount: '{enabled} / {total} 个已显示',
      connected: '账号已连接', disabled: '已关闭', 'sign-in-required': '需要登录', unavailable: '账号状态不可用',
      signIn: '请登录对应版本的 Qoder 桌面端，再点击「重新连接」。',
      checkAgain: '暂时无法从 Qoder 获取账号状态。请稍后刷新，或在桌面端确认登录状态。',
      channelOff: '开启此通道后，可以查看账号和模型，并在 DSH 中选择模型。',
      credits: '剩余额度', used: '套餐已用 {used} / {total}', usageMeter: '套餐已用额度比例', exhausted: '当前额度已用尽。',
      quotaUnknown: '有额度分项暂未返回，合计待确认。', name: '账号', email: '邮箱', plan: '套餐',
      planCredits: '套餐余额', addOnCredits: '资源包余额', bonusNote: '每日领取的 100 Credits 计入资源包。',
      dailyCredits: '每日 100 Credits', dailyDetails: '活动说明', autoCheckin: '自动签到', claimNow: '立即签到',
      checkinLast: '最近检查 {time}（北京时间）', checkinRequestError: '签到请求未完成，请刷新状态后重试。',
      autoCheckinNote: '开启后，DSH 运行时会在北京时间每天 10:00 开放新一轮后尝试领取。',
      checkinChecking: '正在查询领取状态…', checkinWaiting: '等待查询本轮活动',
      checkinSigned: '本轮已领取 100 Credits', checkinAlready: 'Qoder 已确认本轮领过',
      checkinNeedsSignIn: '请先在 Qoder CN 登录',
      checkinActivityUnavailable: 'Qoder 暂未向插件返回本轮活动，请在官方客户端核对。',
      checkinFailed: '本次查询或领取失败，稍后重试。',
      accountPool: '账号池', desktopAccount: '默认桌面登录', currentAccount: '当前使用',
      useAccount: '设为当前账号', addAccount: '添加登录资料', removeAccount: '移出账号池',
      accountLabel: '账号备注', accountDirectory: '桌面版登录数据目录',
      accountPoolHint: '请添加已登录的独立 Qoder 用户数据目录。',
      accountSelectHint: '切换账号会重新建立当前通道的模型连接。',
      poolError: '账号设置保存失败，请重试。',
      poolInvalidDirectory: '请填写存在的 Windows 本地目录。',
      poolSignIn: '该目录里没有可读取的本通道账号，请检查登录状态和路径。',
      poolDuplicate: '这个账号已在池中。', poolFull: '当前通道的账号池已满。',
      refreshBalances: '刷新全部余额', refreshBalance: '刷新余额',
      balanceUpdated: '余额更新', balanceUnread: '暂无余额数据', balanceRefreshError: '余额刷新未完成。',
      planExpires: '套餐额度到期 {time}', addOnExpires: '资源包到期 {time}', expiring: '即将到期',
      checkinHistory: '签到记录', checkinEmpty: '暂无签到记录', checkinToday: '本轮签到',
      checkinNext: '下次尝试约 {time}', checkinNoAttempt: '本轮尚未检查',
      earnedCredits: '服务端确认领取 +{amount} Credits', balanceAfterClaim: '领取后资源包余额 {balance}',
      claimedAt: '领取时间 {time}',
      pinModel: '置顶 {model}', unpinModel: '取消置顶 {model}', pinnedModel: '已置顶',
      modelSearch: '搜索模型名称或 ID', visible: '在模型选择器中显示 {model}', seed: '内置', worker: '上游',
      context: '上下文 {value}', output: '输出上限 {value}', factor: '倍率 ×{value}', reasoning: '推理',
      modelNotes: '此接入支持文本输入。模型目录会在 Qoder worker 推理时更新。',
      noMatches: '没有匹配的模型。', noModels: '当前通道未提供模型。',
      runtime: 'Worker 运行时', ready: '已找到', missing: '未找到', lookupFailed: '检查失败',
      missingCn: '安装 Qoder CN 桌面版，或在插件配置里指定运行时路径。',
      missingGlobal: '首次使用国际版模型时会下载运行时。也可以在插件配置里指定运行时路径。',
      provider: '供应商 ID', endpoint: '服务地址', version: '版本', source: '来源', path: '路径',
      checked: '账号状态更新时间', bundled: '随桌面版安装', cache: '本地下载缓存', explicit: '手动指定',
      reconnectNote: '重新读取本机登录状态并重置当前通道的 worker。进行中的请求可能中断。',
      readError: '暂时读不到插件状态，请刷新重试。', writeError: '设置保存失败，请刷新后重试。',
      reconnectError: '重新连接失败，请稍后重试。', readOnly: '当前 DSH 配置为只读。',
      legacyHost: 'DSH 后台仍在运行旧版 Qoder 插件。请从托盘退出 DSH NEXT，再重新打开以启用模型管理。',
      readTimeout: '读取状态超时，可以点击「刷新状态」重试。',
      creditChip: '{channel} · {balance}', creditTitle: '{channel} 额度', details: '查看详情',
    }
    const en = {
      title: 'Qoder', back: 'Back to chat', refresh: 'Refresh status', reconnect: 'Reconnect',
      loading: 'Checking status…', busy: 'Working…', account: 'Account & credits', models: 'Models', diagnostics: 'Diagnostics',
      cn: 'China', global: 'Global', enabled: 'Enable in DSH', enabledCount: '{enabled} of {total} shown',
      connected: 'Account connected', disabled: 'Disabled', 'sign-in-required': 'Sign-in required', unavailable: 'Account status unavailable',
      signIn: 'Sign in to the matching Qoder desktop app, then select Reconnect.',
      checkAgain: 'Qoder account status is unavailable. Refresh later or check your desktop sign-in.',
      channelOff: 'Enable this channel to view its account and models and select them in DSH.',
      credits: 'Credits remaining', used: '{used} / {total} plan credits used', usageMeter: 'Plan credit usage', exhausted: 'This account is out of credits.',
      quotaUnknown: 'The total is unavailable until Qoder reports both balances.', name: 'Account', email: 'Email', plan: 'Plan',
      planCredits: 'Plan balance', addOnCredits: 'Add-on balance', bonusNote: 'The daily 100 Credits go into Add-on Credits.',
      dailyCredits: 'Daily 100 Credits', dailyDetails: 'Promotion details', autoCheckin: 'Auto-claim', claimNow: 'Claim now',
      checkinLast: 'Last checked {time} (Beijing time)', checkinRequestError: 'The claim request did not finish. Refresh and try again.',
      autoCheckinNote: 'While DSH is running, it tries to claim after the daily window opens at 10:00 Beijing time.',
      checkinChecking: 'Checking reward status…', checkinWaiting: 'Waiting to check the current reward window',
      checkinSigned: 'Claimed 100 Credits this window', checkinAlready: 'Qoder confirmed this window was already claimed',
      checkinNeedsSignIn: 'Sign in to Qoder CN first',
      checkinActivityUnavailable: 'Qoder hasn’t returned this reward to the plugin. Check the official app.',
      checkinFailed: 'The reward could not be checked or claimed. Retrying later.',
      accountPool: 'Accounts', desktopAccount: 'Default desktop sign-in', currentAccount: 'In use',
      useAccount: 'Use account', addAccount: 'Add sign-in profile', removeAccount: 'Remove from accounts',
      accountLabel: 'Account label', accountDirectory: 'Desktop user data folder',
      accountPoolHint: 'Add a separate Qoder user data folder with an active sign-in.',
      accountSelectHint: 'Switching accounts reconnects the models in this channel.',
      poolError: 'Could not save the account settings. Please retry.',
      poolInvalidDirectory: 'Enter an existing local Windows folder.',
      poolSignIn: 'No readable account for this channel was found in the folder. Check the sign-in and path.',
      poolDuplicate: 'This account is already listed.', poolFull: 'This channel’s account list is full.',
      refreshBalances: 'Refresh all balances', refreshBalance: 'Refresh balance',
      balanceUpdated: 'Balance updated', balanceUnread: 'No balance data', balanceRefreshError: 'Balance refresh did not finish.',
      planExpires: 'Plan credits expire {time}', addOnExpires: 'Add-on credits expire {time}', expiring: 'Expiring soon',
      checkinHistory: 'Check-in history', checkinEmpty: 'No check-in records', checkinToday: 'This window',
      checkinNext: 'Next attempt around {time}', checkinNoAttempt: 'Not checked this window',
      earnedCredits: 'Server confirmed +{amount} Credits', balanceAfterClaim: 'Add-on balance after claim {balance}',
      claimedAt: 'Claimed at {time}',
      pinModel: 'Pin {model}', unpinModel: 'Unpin {model}', pinnedModel: 'Pinned',
      modelSearch: 'Search by model name or ID', visible: 'Show {model} in the model picker', seed: 'Built-in', worker: 'Upstream',
      context: '{value} context', output: '{value} output limit', factor: '×{value} credits', reasoning: 'Reasoning',
      modelNotes: 'This connection accepts text input. The catalog updates as the Qoder worker serves requests.',
      noMatches: 'No matching models.', noModels: 'This channel has no models.',
      runtime: 'Worker runtime', ready: 'Found', missing: 'Missing', lookupFailed: 'Check failed',
      missingCn: 'Install Qoder CN desktop or set the runtime path in plugin configuration.',
      missingGlobal: 'The runtime downloads on first use of a global model. You can also set its path in plugin configuration.',
      provider: 'Provider ID', endpoint: 'Service URL', version: 'Version', source: 'Source', path: 'Path',
      checked: 'Account status updated', bundled: 'Bundled with desktop app', cache: 'Local download cache', explicit: 'Manually configured',
      reconnectNote: 'Reload the local sign-in and reset this channel’s worker. This can interrupt requests in progress.',
      readError: 'Could not read plugin status. Refresh to retry.', writeError: 'Could not save settings. Refresh and retry.',
      reconnectError: 'Could not reconnect. Try again later.', readOnly: 'This DSH profile is read-only.',
      legacyHost: 'The DSH host is still running an older Qoder plugin. Quit DSH NEXT from the tray and reopen it to enable model management.',
      readTimeout: 'The status request timed out. Select Refresh status to retry.',
      creditChip: '{channel} · {balance}', creditTitle: '{channel} credits', details: 'View details',
    }

    const css = `
      .qoder-page-scroll { flex:1 1 auto; min-height:0; height:100%; width:100%; overflow-y:auto; overscroll-behavior-y:contain; }
      .qoder-panel { --q-ink:var(--dsw-alias-label-primary,#18202b); --q-muted:var(--dsw-alias-label-secondary,#586477); --q-line:var(--dsw-alias-border-l1,#d7dce5); --q-surface:var(--dsw-alias-bg-layer-1,#fff); --q-tint:var(--dsw-alias-bg-layer-2,#f3f6fa); --q-accent:color-mix(in srgb,var(--dsw-alias-brand-primary,#3867dc) 25%,#7864e3); --q-good:var(--dsw-alias-label-success,#148466); --q-warn:var(--dsw-alias-label-caution,#9a5c16); color:var(--q-ink); padding:clamp(16px,4vw,36px); max-width:1080px; margin:0 auto; width:100%; box-sizing:border-box; }
      .qoder-panel * { box-sizing:border-box; }
      .qoder-panel header,.qoder-toolbar,.qoder-model,.qoder-model-head { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; }
      .qoder-brand { display:flex; align-items:center; gap:13px; }
      .qoder-mark { display:grid; place-items:center; width:44px; height:44px; color:var(--q-accent); background:color-mix(in srgb,var(--q-accent) 12%,var(--q-surface)); border:1px solid color-mix(in srgb,var(--q-accent) 30%,var(--q-line)); border-radius:12px; }
      .qoder-panel h1 { margin:0; font-size:28px; line-height:1.2; letter-spacing:-.025em; }
      .qoder-panel h2 { margin:0 0 14px; font-size:15px; line-height:1.35; }
      .qoder-panel p { margin:0; line-height:1.5; }
      .qoder-panel button,.qoder-panel input[type=search] { font:inherit; color:inherit; background:var(--q-surface); border:1px solid var(--q-line); border-radius:8px; padding:8px 12px; }
      .qoder-panel button { cursor:pointer; }
      .qoder-panel button:disabled { opacity:.55; cursor:default; }
      .qoder-panel button:focus-visible,.qoder-panel input:focus-visible { outline:2px solid var(--q-accent); outline-offset:3px; }
      .qoder-panel button:not(:disabled):hover { border-color:var(--q-accent); }
      .qoder-panel button[aria-pressed=true] { border-color:color-mix(in srgb,var(--q-accent) 68%,var(--q-line)); background:linear-gradient(145deg,color-mix(in srgb,var(--q-accent) 15%,var(--q-surface)),color-mix(in srgb,var(--q-accent) 7%,var(--q-surface))); }
      .qoder-channels,.qoder-overview { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; margin-top:20px; }
      .qoder-panel .qoder-channel { display:grid; grid-template-columns:auto minmax(0,1fr); align-items:center; gap:12px; text-align:left; min-width:0; padding:13px; border-radius:17px; }
      .qoder-channel-copy { display:grid; gap:5px; }
      .qoder-channel-icon { display:grid; place-items:center; width:35px; height:35px; border-radius:11px; color:var(--q-accent); background:linear-gradient(160deg,color-mix(in srgb,var(--q-accent) 19%,var(--q-surface)),var(--q-surface)); box-shadow:inset 0 1px 0 #fff5,0 2px 5px #121b3511; }
      .qoder-channel-title { display:flex; align-items:baseline; flex-wrap:wrap; gap:4px 9px; font-size:15px; }
      .qoder-subtle,.qoder-badge,.qoder-line dt { color:var(--q-muted); font-size:12px; }
      .qoder-state { display:inline-flex; align-items:center; gap:6px; color:var(--q-muted); font-size:12px; }
      .qoder-state::before { content:''; width:7px; height:7px; border-radius:50%; background:currentColor; }
      .qoder-state[data-state=connected] { color:var(--q-good); }
      .qoder-state[data-state=sign-in-required],.qoder-state[data-state=unavailable] { color:var(--q-warn); }
      .qoder-toolbar { margin:16px 0 12px; }
      .qoder-actions,.qoder-sections,.qoder-badges { display:flex; flex-wrap:wrap; gap:6px; }
      .qoder-sections button { font-size:13px; }
      .qoder-switch { display:inline-flex; align-items:center; gap:6px; font-size:13px; }
      .qoder-switch input { accent-color:var(--q-accent); width:16px; height:16px; }
      .qoder-card,.qoder-notice { min-width:0; border:1px solid var(--q-line); border-radius:18px; padding:16px; }
      .qoder-card,.qoder-panel .qoder-channel { background:linear-gradient(155deg,color-mix(in srgb,var(--q-surface) 92%,transparent),color-mix(in srgb,var(--q-tint) 70%,transparent)); backdrop-filter:blur(16px) saturate(135%); box-shadow:inset 0 1px 0 #fff5,0 5px 18px #2531550c; }
      .qoder-panel .qoder-channel[aria-pressed=true] { background:linear-gradient(145deg,color-mix(in srgb,var(--q-accent) 15%,var(--q-surface)),color-mix(in srgb,var(--q-accent) 7%,var(--q-surface))); }
      .qoder-notice { margin-top:12px; background:var(--q-tint); font-size:13px; }
      .qoder-notice button { margin-top:8px; }
      .qoder-overview { margin:0; }
      .qoder-credits { background:radial-gradient(ellipse at 5% 0%,color-mix(in srgb,var(--q-accent) 15%,transparent),transparent 70%),linear-gradient(145deg,var(--q-surface),color-mix(in srgb,var(--q-tint) 75%,transparent)); }
      .qoder-credits .qoder-details { margin-top:10px; }
      .qoder-reward { margin-top:12px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; }
      .qoder-reward h2 { margin-bottom:4px; }
      .qoder-reward a { color:var(--q-accent); font-size:13px; text-underline-offset:3px; }
      .qoder-reward-controls { display:flex; align-items:center; flex-wrap:wrap; gap:9px 14px; }
      .qoder-reward-status { flex:1 0 100%; border-top:1px solid var(--q-line); padding-top:9px; }
      .qoder-reward-status small { display:block; margin-top:3px; }
      .qoder-panel .qoder-claim-button { color:var(--q-accent); border-color:color-mix(in srgb,var(--q-accent) 35%,var(--q-line)); background:color-mix(in srgb,var(--q-accent) 9%,var(--q-surface)); font-size:13px; }
      .qoder-pool { margin-top:12px; }
      .qoder-pool-list { margin:10px 0 0; padding:0; list-style:none; }
      .qoder-pool-row { border-top:1px solid var(--q-line); padding:11px 0; display:flex; justify-content:space-between; gap:8px 14px; align-items:center; flex-wrap:wrap; }
      .qoder-pool-row strong { overflow-wrap:anywhere; }
      .qoder-pool-row small { display:block; }
      .qoder-pool-row > div:first-child { flex:1 1 210px; min-width:0; }
      .qoder-pool-row[data-focus=true] { border-radius:10px; outline:2px solid var(--q-accent); outline-offset:3px; }
      .qoder-pool-balances { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:4px 12px; margin:8px 0; max-width:300px; }
      .qoder-pool-balances dt { color:var(--q-muted); font-size:12px; }
      .qoder-pool-balances dd { margin:2px 0 0; font-weight:600; font-variant-numeric:tabular-nums; }
      .qoder-pool-history { flex:1 0 100%; }
      .qoder-pool-history ol { margin:7px 0 0; padding-inline-start:18px; font-size:12px; }
      .qoder-pool-history li { padding:3px 0; }
      .qoder-expiring { color:var(--q-warn); }
      .qoder-pool-form { display:flex; flex-wrap:wrap; align-items:end; gap:8px; margin-top:10px; }
      .qoder-pool-form label { display:grid; gap:4px; flex:1 1 150px; min-width:0; font-size:12px; color:var(--q-muted); }
      .qoder-pool-form input { width:100%; min-width:0; font:inherit; color:var(--q-ink); background:var(--q-surface); border:1px solid var(--q-line); border-radius:8px; padding:8px; }
      .qoder-pool summary { cursor:pointer; color:var(--q-accent); font-size:13px; }
      .qoder-pool .qoder-reward-controls button { font-size:12px; }
      .qoder-number { font-size:32px; letter-spacing:-.04em; line-height:1.25; font-weight:650; font-variant-numeric:tabular-nums; margin-bottom:7px; overflow-wrap:anywhere; }
      .qoder-meter { background:var(--q-tint); height:7px; border-radius:999px; margin:8px 0; overflow:hidden; }
      .qoder-meter span { display:block; height:100%; background:var(--q-accent); border-radius:999px; }
      .qoder-meter[data-exhausted=true] span { background:var(--q-warn); }
      .qoder-credit-warning { color:var(--q-warn); margin-top:7px !important; font-size:12px; }
      .qoder-details { margin:0; }
      .qoder-line { display:grid; grid-template-columns:minmax(64px,auto) minmax(0,1fr); gap:8px; padding:7px 0; border-bottom:1px solid var(--q-line); }
      .qoder-line:last-child { border-bottom:0; }
      .qoder-line dd { margin:0; text-align:right; overflow-wrap:anywhere; font-size:13px; }
      .qoder-model-head { margin-bottom:12px; }
      .qoder-model-head input { min-width:0; width:min(100%,290px); }
      .qoder-model-list { margin:12px 0 0; padding:0; list-style:none; }
      .qoder-model { padding:12px 0; border-top:1px solid var(--q-line); }
      .qoder-model-name { overflow-wrap:anywhere; display:block; }
      .qoder-model-actions { display:flex; align-items:center; gap:9px; }
      .qoder-panel .qoder-model-pin { background:var(--q-surface); font-size:17px; padding:4px 8px; line-height:1; color:var(--q-accent); }
      .qoder-badges { margin-top:6px; }
      .qoder-badge { padding:2px 6px; border-radius:5px; background:var(--q-tint); }
      .qoder-diagnostics { display:grid; gap:12px; }
      .qoder-diagnostics .qoder-subtle { margin:10px 0; }
      .qoder-panel { container-type:inline-size; }
      @container(max-width:480px) { .qoder-overview { grid-template-columns:1fr; } .qoder-panel header { align-items:flex-start; } .qoder-panel h1 { font-size:23px; } }
      @container(max-width:285px) { .qoder-channels { grid-template-columns:1fr; } }
    `
    const creditsCss = `
      .qoder-credit-chip, .qoder-credit-popover button { font:inherit; color:inherit; cursor:pointer; border:1px solid var(--dsw-alias-border-l1,#d9dae1); background:var(--dsw-alias-bg-layer-1,#fff); border-radius:7px; padding:4px 8px; }
      .qoder-credit-chip { white-space:nowrap; color:var(--dsw-alias-label-secondary,#586477); font-size:12px; font-variant-numeric:tabular-nums; }
      .qoder-credit-popover { position:fixed; inset:auto var(--q-credits-right,8px) var(--q-credits-bottom,50px) auto; margin:0; box-sizing:border-box; width:min(320px,calc(100vw - 16px)); max-height:var(--q-credits-height,60vh); overflow:auto; border:1px solid var(--dsw-alias-border-l1,#d9dae1); border-radius:18px; padding:13px 14px; color:var(--dsw-alias-label-primary,#161821); background:linear-gradient(150deg,color-mix(in srgb,var(--dsw-alias-bg-layer-1,#fff) 88%,transparent),color-mix(in srgb,var(--dsw-alias-bg-layer-2,#f3f6fa) 92%,transparent)); backdrop-filter:blur(20px) saturate(145%); box-shadow:inset 0 1px 0 #fff5,0 12px 30px #12182c24; font-size:13px; }
      .qoder-credit-popover header { display:flex; align-items:baseline; justify-content:space-between; gap:8px; margin-bottom:7px; }
      .qoder-credit-popover p { margin:8px 0 0; line-height:1.4; }
      .qoder-credit-popover dl { margin:0; }
      .qoder-credit-popover dl div { display:flex; align-items:baseline; justify-content:space-between; gap:10px; padding:5px 0; }
      .qoder-credit-popover dt { flex-shrink:0; color:var(--dsw-alias-label-secondary,#586477); }
      .qoder-credit-popover dd { margin:0; text-align:right; overflow-wrap:anywhere; font-variant-numeric:tabular-nums; }
      .qoder-credit-popover footer { display:flex; justify-content:space-between; flex-wrap:wrap; gap:5px 8px; margin-top:9px; padding-top:8px; border-top:1px solid var(--dsw-alias-border-l1,#d9dae1); }
      .qoder-credit-popover button:disabled { opacity:.6; cursor:default; }
    `

    function Icon({ size = 20 } = {}) {
      return h('svg', { width: size, height: size, viewBox: '0 0 36 36', fill: 'none', 'aria-hidden': true },
        h('circle', { cx: 17, cy: 17, r: 9.5, stroke: 'currentColor', strokeWidth: 3.2 }),
        h('path', { d: 'M22.6 22.6 L29 29', stroke: 'currentColor', strokeWidth: 3.2, strokeLinecap: 'round' }),
        h('circle', { cx: 17, cy: 17, r: 3.1, fill: 'currentColor' }))
    }

    function Details({ rows }) {
      return h('dl', { className: 'qoder-details' }, rows.map(([label, value]) =>
        h('div', { className: 'qoder-line', key: label }, h('dt', null, label), h('dd', null, value ?? '—'))))
    }

    function translate(t, key, values) {
      return Object.entries(values).reduce((value, [name, replacement]) =>
        value.replace(`{${name}}`, () => String(replacement)), t(key))
    }

    function numeric(value, notation = 'standard') {
      return Number.isFinite(value) ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 2, notation }).format(value) : '—'
    }

    function beijingTime(value) {
      return Number.isFinite(value) ? new Intl.DateTimeFormat(undefined, {
        timeZone: 'Asia/Shanghai', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      }).format(value) : undefined
    }

    function connectionBadge(t, channel) {
      const status = channel.connection ?? (channel.enabled === false ? 'disabled' : undefined)
      return h('span', { className: 'qoder-state', 'data-state': status }, t(status ?? 'loading'))
    }

    function legacyChannel(data) {
      const { account, usage, plan } = data
      const quota = usage?.userQuota
      const addOn = usage?.addOnQuota
      const known = Number.isFinite(quota?.remaining) && Number.isFinite(addOn?.remaining)
      const connection = data.enabled === false ? 'disabled'
        : data.error ? 'sign-in-required'
        : account || usage || plan ? 'connected' : 'unavailable'
      return {
        ...data, connection,
        account: account || plan || usage ? {
          name: account?.name ?? account?.username,
          email: account?.email,
          plan: plan?.plan_tier_name ?? usage?.userType,
        } : undefined,
        credits: usage ? {
          plan: quota,
          addOn,
          remaining: known ? quota.remaining + addOn.remaining : undefined,
          exhausted: known ? quota.remaining === 0 && addOn.remaining === 0 : usage.isQuotaExceeded === true,
        } : undefined,
        worker: data.workerRuntime ?? (data.workerError ? { error: true } : undefined),
        models: data.models?.map(model => ({ ...model, enabled: true })),
      }
    }

    function channelFromResponse(result, id) {
      const raw = result.channels?.find(channel => channel.id === id)
      const legacy = typeof result.settingsNs === 'string' && raw?.connection === undefined
      const data = legacy ? legacyChannel(raw ?? { ...regions.find(region => region.id === id), enabled: false }) : raw
      if (!data) throw new Error('Channel missing')
      if (data.credits && !data.credits.plan && !data.credits.addOn &&
          ['remaining', 'used', 'total'].some(key => Object.hasOwn(data.credits, key))) {
        // Hosts before the split only expose the plan quota.
        const { remaining, used, total } = data.credits
        return { data: { ...data, credits: { plan: { remaining, used, total } } }, legacy }
      }
      return { data, legacy }
    }

    function balanceRows(t, credits) {
      return [[t('planCredits'), numeric(credits?.plan?.remaining)], [t('addOnCredits'), numeric(credits?.addOn?.remaining)]]
    }

    const checkinLabels = {
      checking: 'checkinChecking', waiting: 'checkinWaiting', signed: 'checkinSigned',
      already: 'checkinAlready', needsSignIn: 'checkinNeedsSignIn',
      activityUnavailable: 'checkinActivityUnavailable', failed: 'checkinFailed',
    }

    function CheckinHistory({ t, records }) {
      return h('details', { className: 'qoder-pool-history' },
        h('summary', null, t('checkinHistory')),
        records.length ? h('ol', null, records.map((record, index) => h('li', { key: `${record.at}-${index}` },
          h('time', { dateTime: new Date(record.at).toISOString() }, beijingTime(record.at)),
          ' · ', t(checkinLabels[record.state] ?? 'checkinFailed'),
          Number.isFinite(record.earned) ? h('small', { className: 'qoder-subtle' },
            translate(t, 'earnedCredits', { amount: numeric(record.earned) })) : null,
          Number.isFinite(record.claimedAt) ? h('small', { className: 'qoder-subtle' },
            translate(t, 'claimedAt', { time: beijingTime(record.claimedAt) })) : null,
          Number.isFinite(record.addOnRemaining) ? h('small', { className: 'qoder-subtle' },
            translate(t, 'balanceAfterClaim', { balance: numeric(record.addOnRemaining) })) : null)))
          : h('p', { className: 'qoder-subtle' }, t('checkinEmpty')))
    }

    function Expiry({ t, keyName, date }) {
      if (!Number.isFinite(date) || date <= Date.now()) return null
      const soon = date - Date.now() <= 3 * 86_400_000
      return h('small', { className: soon ? 'qoder-expiring' : 'qoder-subtle' },
        translate(t, keyName, { time: beijingTime(date) }), soon ? ` · ${t('expiring')}` : null)
    }

    function AccountPool({ t, channel, busy, writable, editPool, claim, refreshBalances, focusAccount }) {
      const [label, setLabel] = useState('')
      const [directory, setDirectory] = useState('')
      const focusedRow = useRef()
      const focusAvailable = channel.accounts.some(item => item.id === focusAccount)
      useEffect(() => {
        if (focusAvailable) focusedRow.current?.scrollIntoView({ block: 'nearest' })
      }, [focusAccount, focusAvailable])
      const isCn = channel.id === 'cn'
      const disabled = busy || !writable
      return h('section', { className: 'qoder-card qoder-pool' },
        h('header', null, h('h2', null, t('accountPool')),
          refreshBalances ? h('button', { type: 'button', disabled: busy, onClick: () => refreshBalances() }, t('refreshBalances')) : null,
          isCn ? h('a', { className: 'qoder-subtle', href: 'https://docs.qoder.cn/events/100credits', target: '_blank', rel: 'noopener noreferrer' }, t('dailyDetails')) : null),
        isCn ? h('p', { className: 'qoder-subtle' }, t('autoCheckinNote')) : null,
        h('ul', { className: 'qoder-pool-list' }, channel.accounts.map(item => {
          const active = item.id === channel.activeAccountId
          const checkin = item.checkin
          const finished = checkin?.state === 'signed' || checkin?.state === 'already'
          const focused = item.id === focusAccount
          const checked = beijingTime(item.balanceCheckedAt)
          return h('li', { className: 'qoder-pool-row', key: item.id, 'data-focus': focused, ref: focused ? focusedRow : null },
            h('div', null,
              h('strong', null, item.label ?? t('desktopAccount')),
              active ? h('span', { className: 'qoder-badge' }, t('currentAccount')) : null,
              item.accountName ? h('small', { className: 'qoder-subtle' }, item.accountName) : null,
              Number.isFinite(item.credits?.remaining) ? h('small', { className: 'qoder-subtle' },
                `${t('credits')} ${numeric(item.credits.remaining)}`) : null,
              h('dl', { className: 'qoder-pool-balances' }, balanceRows(t, item.credits).map(([label, value]) =>
                h('div', { key: label }, h('dt', null, label), h('dd', null, value)))),
              h('small', { className: 'qoder-subtle' }, checked ? `${t('balanceUpdated')} ${checked}` : t(item.connection ?? 'balanceUnread')),
              h(Expiry, { t, keyName: 'planExpires', date: item.credits?.plan?.expiresAt }),
              h(Expiry, { t, keyName: 'addOnExpires', date: item.credits?.addOn?.expiresAt }),
              checkinLabels[checkin?.state] ? h('small', { className: 'qoder-subtle', role: 'status' }, t(checkinLabels[checkin.state])) : null,
              checkin?.nextAt ? h('small', { className: 'qoder-subtle' },
                translate(t, 'checkinNext', { time: beijingTime(checkin.nextAt) })) : null),
            h('div', { className: 'qoder-reward-controls' },
              refreshBalances ? h('button', { type: 'button', disabled: busy,
                onClick: () => refreshBalances(item.id) }, t('refreshBalance')) : null,
              active ? null : h('button', { type: 'button', disabled, title: t('accountSelectHint'),
                onClick: () => editPool({ action: 'select', accountId: item.id }) }, t('useAccount')),
              checkin ? h('label', { className: 'qoder-switch' },
                h('input', { type: 'checkbox', checked: checkin.enabled, disabled,
                  onChange: event => editPool({ action: 'auto', accountId: item.id, enabled: event.currentTarget.checked }) }), t('autoCheckin')) : null,
              checkin ? h('button', { type: 'button', className: 'qoder-claim-button',
                disabled: busy || finished || checkin.state === 'checking',
                onClick: () => claim(item.id) }, t('claimNow')) : null,
              item.id === 'desktop' ? null : h('button', { type: 'button', disabled,
                onClick: () => editPool({ action: 'remove', accountId: item.id }) }, t('removeAccount'))),
            item.checkinHistory ? h(CheckinHistory, { t, records: item.checkinHistory }) : null)
        })),
        writable ? h('details', null, h('summary', null, t('addAccount')),
          h('form', { className: 'qoder-pool-form', onSubmit: async event => {
            event.preventDefault()
            if (await editPool({ action: 'add', label, directory })) { setLabel(''); setDirectory('') }
          } },
          h('label', null, t('accountLabel'), h('input', { value: label, required: true, maxLength: 64,
            onChange: event => setLabel(event.currentTarget.value) })),
          h('label', null, t('accountDirectory'), h('input', { value: directory, required: true, maxLength: 1024,
            onChange: event => setDirectory(event.currentTarget.value) })),
          h('button', { type: 'submit', disabled }, t('addAccount'))),
          h('p', { className: 'qoder-subtle' }, t('accountPoolHint'))) : null)
    }

    function Account({ t, channel, busy, reconnect, writable, save, claim, editPool, refreshBalances, focusAccount }) {
      const { account, credits, connection, checkin } = channel
      const claimFinished = checkin?.state === 'signed' || checkin?.state === 'already'
      const plan = credits?.plan
      const percentage = plan?.total > 0 && Number.isFinite(plan.used) ? plan.used / plan.total * 100 : undefined
      const used = Number.isFinite(percentage) ? Math.min(100, Math.max(0, percentage)) : undefined
      return h(Fragment, null,
        h('div', { className: 'qoder-overview' },
          h('section', { className: 'qoder-card qoder-credits' },
            h('h2', null, t('credits')),
            h('div', { className: 'qoder-number' }, numeric(credits?.remaining)),
            used === undefined ? null : h('div', {
              className: 'qoder-meter', role: 'progressbar', 'aria-label': t('usageMeter'),
              'aria-valuenow': Math.round(used), 'data-exhausted': credits?.exhausted,
            }, h('span', { style: { width: `${used}%` } })),
            used === undefined ? null : h('p', { className: 'qoder-subtle' },
              translate(t, 'used', { used: numeric(plan.used), total: numeric(plan.total) })),
            h(Details, { rows: balanceRows(t, credits) }),
            Number.isFinite(credits?.remaining) ? null : h('p', { className: 'qoder-subtle' }, t('quotaUnknown')),
            credits?.exhausted ? h('p', { className: 'qoder-credit-warning' }, t('exhausted')) : null),
          h('section', { className: 'qoder-card' },
            h('h2', null, t('name')),
            h(Details, { rows: [[t('name'), account?.name], [t('email'), account?.email], [t('plan'), account?.plan]] }))),
        channel.accounts ? h(AccountPool, { key: channel.id, t, channel, busy, writable, editPool, claim, refreshBalances, focusAccount })
          : channel.id === 'cn' ? h('section', { className: 'qoder-card qoder-reward' },
          h('div', null, h('h2', null, t('dailyCredits')), h('p', { className: 'qoder-subtle' }, t('bonusNote'))),
          h('div', { className: 'qoder-reward-controls' },
            checkin ? h('label', { className: 'qoder-switch', title: t('autoCheckinNote') },
              h('input', { type: 'checkbox', checked: checkin.enabled, disabled: busy || !writable,
                onChange: event => save({ autoCheckin: event.currentTarget.checked }) }), t('autoCheckin')) : null,
            checkin ? h('button', { type: 'button', className: 'qoder-claim-button',
              disabled: busy || claimFinished || checkin.state === 'checking' || connection === 'sign-in-required',
              onClick: () => claim() }, t('claimNow')) : null,
            h('a', { href: 'https://docs.qoder.cn/events/100credits', target: '_blank', rel: 'noopener noreferrer' }, t('dailyDetails'))),
          checkinLabels[checkin?.state] ? h('p', { className: 'qoder-subtle qoder-reward-status', role: 'status' },
            t(checkinLabels[checkin.state]),
            checkin.at ? h('small', null, translate(t, 'checkinLast', {
              time: new Date(checkin.at).toLocaleTimeString(undefined, { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' }),
            })) : null) : null) : null,
        connection === 'sign-in-required' || connection === 'unavailable'
          ? h('div', { className: 'qoder-notice' },
            h('p', null, t(connection === 'sign-in-required' ? 'signIn' : 'checkAgain')),
            reconnect ? h('button', {
              type: 'button', disabled: busy, onClick: reconnect, title: t('reconnectNote'),
            }, t('reconnect')) : null) : null)
    }

    function ModelCatalog({ t, channel, input, query, busy, writable, save }) {
      const models = channel.models ?? []
      const filter = query.trim().toLowerCase()
      const matched = models.filter(model => `${model.id} ${model.name}`.toLowerCase().includes(filter))
      return h('section', { className: 'qoder-card' },
        h('div', { className: 'qoder-model-head' },
          h('input', { type: 'search', value: query, onChange: event => input(event.currentTarget.value),
            placeholder: t('modelSearch'), 'aria-label': t('modelSearch') }),
          h('span', { className: 'qoder-subtle' }, translate(t, 'enabledCount',
            { enabled: models.filter(model => model.enabled).length, total: models.length }))),
        h('p', { className: 'qoder-subtle' }, t('modelNotes')),
        matched.length === 0
          ? h('p', { className: 'qoder-notice' }, t(models.length ? 'noMatches' : 'noModels'))
          : h('ul', { className: 'qoder-model-list' }, matched.map(model => {
            const badges = [
              t(model.source === 'worker' ? 'worker' : 'seed'),
              Number.isFinite(model.contextWindow) && translate(t, 'context', { value: numeric(model.contextWindow, 'compact') }),
              Number.isFinite(model.maxTokens) && translate(t, 'output', { value: numeric(model.maxTokens, 'compact') }),
              Number.isFinite(model.priceFactor) && translate(t, 'factor', { value: numeric(model.priceFactor) }),
              model.reasoning && t('reasoning'),
              model.pinned && t('pinnedModel'),
            ].filter(Boolean)
            return h('li', { key: model.id, className: 'qoder-model' },
              h('div', null, h('strong', { className: 'qoder-model-name' }, model.name),
                model.name !== model.id ? h('span', { className: 'qoder-subtle' }, model.id) : null,
                h('div', { className: 'qoder-badges' }, badges.map(badge => h('span', { key: badge, className: 'qoder-badge' }, badge)))),
              h('div', { className: 'qoder-model-actions' },
              typeof model.pinned === 'boolean' ? h('button', {
                type: 'button', className: 'qoder-model-pin', disabled: !writable || busy, 'aria-pressed': model.pinned,
                'aria-label': translate(t, model.pinned ? 'unpinModel' : 'pinModel', { model: model.name }),
                onClick: () => save({ modelId: model.id, pinned: !model.pinned }),
              }, model.pinned ? '★' : '☆') : null,
              h('label', { className: 'qoder-switch' }, h('input', {
                type: 'checkbox', checked: model.enabled, disabled: !writable || busy,
                'aria-label': translate(t, 'visible', { model: model.name }),
                onChange: event => save({ modelId: model.id, visible: event.currentTarget.checked }),
              }))))
          })))
    }

    function Diagnostics({ t, channel, busy, reconnect }) {
      const worker = channel.worker
      return h('div', { className: 'qoder-diagnostics' },
        h('section', { className: 'qoder-card' },
          h('h2', null, t('diagnostics')),
          h(Details, { rows: [
            [t('provider'), channel.provider], [t('endpoint'), channel.origin],
            [t('checked'), channel.checkedAt ? new Date(channel.checkedAt).toLocaleString() : undefined],
          ] })),
        h('section', { className: 'qoder-card' },
          h('h2', null, t('runtime')),
          h(Details, { rows: [
            [t('runtime'), t(worker?.error ? 'lookupFailed' : worker ? 'ready' : 'missing')],
            [t('version'), worker?.version], [t('source'), worker?.source ? t(worker.source) : undefined],
            [t('path'), worker?.path ? h('code', null, worker.path) : undefined],
          ] }),
          worker?.path ? null : h('p', { className: 'qoder-subtle' }, t(channel.id === 'cn' ? 'missingCn' : 'missingGlobal')),
          reconnect ? h('p', { className: 'qoder-subtle' }, t('reconnectNote')) : null,
          reconnect ? h('button', { type: 'button', disabled: busy, onClick: reconnect }, t('reconnect')) : null))
    }

    async function request(path, signal, body, timeoutMs = requestTimeoutMs) {
      const response = await fetch(base + path, {
        method: body === undefined ? 'GET' : 'POST',
        credentials: 'same-origin', signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
        headers: body === undefined ? { accept: 'application/json' } : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => undefined)
        throw Object.assign(new Error(`HTTP ${response.status}`), { code: data?.error })
      }
      return response.json()
    }

    function ComposerCredits({ t, region, openDetails }) {
      const [state, setState] = useState({ busy: true })
      const [expanded, setExpanded] = useState(false)
      const active = useRef()
      const trigger = useRef()
      const popover = useRef()
      const popoverId = useId()

      async function load(force = false) {
        if (active.current) return
        const controller = new AbortController()
        active.current = controller
        setState(previous => ({ ...previous, busy: true, error: undefined }))
        try {
          const result = await request(`/status?region=${region.id}${force ? '&refresh=1' : ''}`, controller.signal)
          if (!controller.signal.aborted) setState({ channel: channelFromResponse(result, region.id).data, busy: false })
        } catch (error) {
          if (!controller.signal.aborted) {
            setState(previous => ({ ...previous, busy: false, error: error?.name === 'TimeoutError' ? 'readTimeout' : 'readError' }))
          }
        } finally {
          if (active.current === controller) active.current = undefined
        }
      }

      useEffect(() => {
        void load()
        const timer = setInterval(() => { if (!document.hidden) void load() }, 5 * 60_000)
        return () => {
          clearInterval(timer)
          active.current?.abort()
          active.current = undefined
        }
      }, [region.id])

      function positionPopover() {
        const panel = popover.current
        const rect = trigger.current.getBoundingClientRect()
        panel.style.setProperty('--q-credits-right', `${Math.max(8, window.innerWidth - rect.right)}px`)
        panel.style.setProperty('--q-credits-bottom', `${window.innerHeight - rect.top + 8}px`)
        panel.style.setProperty('--q-credits-height', `${Math.max(0, rect.top - 16)}px`)
      }

      const { channel, busy, error } = state
      if (channel?.enabled === false) return null
      const { credits, account, checkedAt } = channel ?? {}
      const activeAccount = channel?.accounts?.find(item => item.id === channel.activeAccountId)
      const displayAccount = [activeAccount?.label, account?.name ?? account?.email].filter(Boolean).join(' · ')
      const balanceTime = channel?.balanceRefresh ? channel.balanceCheckedAt : checkedAt
      const title = translate(t, 'creditTitle', { channel: region.displayName })
      const balance = numeric(credits?.remaining)
      return h(Fragment, null,
        h('style', null, creditsCss),
        h('button', { type: 'button', className: 'qoder-credit-chip', ref: trigger, title,
          'aria-expanded': expanded, 'aria-controls': popoverId, popoverTarget: popoverId, onClick: positionPopover },
        translate(t, 'creditChip', { channel: region.displayName, balance })),
        h('section', { id: popoverId, ref: popover, popover: 'auto', className: 'qoder-credit-popover',
          'aria-label': title, onToggle: event => {
            const open = event.nativeEvent.newState === 'open'
            setExpanded(open)
            if (open) void load()
          } },
        h('header', null, h('strong', null, title), channel ? connectionBadge(t, channel) : null),
        h(Details, { rows: [
          [t('currentAccount'), displayAccount || (activeAccount?.id === 'desktop' ? t('desktopAccount') : undefined)],
          [t('plan'), account?.plan], [t('credits'), balance],
          ...balanceRows(t, credits),
          ...(region.id === 'cn' ? [[t('checkinToday'), t(checkinLabels[channel?.checkin?.state] ?? 'checkinNoAttempt')]] : []),
          [t('balanceUpdated'), beijingTime(balanceTime)],
        ] }),
        busy ? h('p', { role: 'status' }, t('loading')) : null,
        error ? h('p', { role: 'alert' }, t(error)) : null,
        h('footer', null,
          h('button', { type: 'button', disabled: busy, onClick: () => void load(true) }, t('refresh')),
          h('button', { type: 'button', onClick: () => { popover.current.hidePopover(); openDetails(region.id, channel?.activeAccountId) } }, t('details')))))
    }

    function ComposerCreditsGate({ useProjection, t, openDetails }) {
      const selection = useProjection?.('modelSelection')
      const provider = (selection?.next ?? selection?.lastUsed)?.provider
      const region = regions.find(item => item.provider === provider)
      return region ? h(ComposerCredits, { key: region.id, t, region, openDetails }) : null
    }

    function QoderPage({ t, back, initialRegion, initialAccount }) {
      const [active, setActive] = useState(() => initialRegion?.() ?? 'cn')
      const [focusAccount, setFocusAccount] = useState(() => initialAccount?.())
      const [section, setSection] = useState('account')
      const [search, setSearch] = useState({})
      const [states, setStates] = useState({})
      const [writable, setWritable] = useState(false)
      const controllers = useRef(new Map())

      async function run(id, action, body) {
        if (controllers.current.has(id)) return
        const controller = new AbortController()
        controllers.current.set(id, controller)
        setStates(previous => ({ ...previous, [id]: { ...previous[id], busy: true, error: undefined } }))
        const suffix = `?region=${id}`
        const account = action === 'balances' && body?.accountId ? `&account=${encodeURIComponent(body.accountId)}` : ''
        try {
          const result = await request(
            action === 'load' || action === 'refresh'
              ? `/status${suffix}${action === 'refresh' ? '&refresh=1' : ''}`
              : `/${action}${suffix}${account}`,
            controller.signal, action === 'reconnect' ? {} : action === 'balances' ? undefined : body,
            action === 'balances' || action === 'checkin' ? 60_000 : requestTimeoutMs)
          const { data, legacy } = channelFromResponse(result, id)
          if (controller.signal.aborted) return
          if (legacy || typeof result.writable === 'boolean') setWritable(!legacy && result.writable === true)
          setStates(previous => ({ ...previous, [id]: { data, legacy, busy: false } }))
          return true
        } catch (failure) {
          if (!controller.signal.aborted) {
            const poolErrors = {
              'invalid-directory': 'poolInvalidDirectory', 'profile-sign-in-required': 'poolSignIn',
              'duplicate-account': 'poolDuplicate', 'pool-full': 'poolFull',
            }
            const error = action === 'accounts' ? poolErrors[failure?.code] ?? 'poolError'
              : action === 'balances' ? 'balanceRefreshError'
              : action === 'settings' ? 'writeError' : action === 'reconnect' ? 'reconnectError' : action === 'checkin' ? 'checkinRequestError'
              : failure?.name === 'TimeoutError' ? 'readTimeout' : 'readError'
            setStates(previous => ({ ...previous, [id]: { ...previous[id], busy: false, error } }))
          }
        } finally {
          if (controllers.current.get(id) === controller) controllers.current.delete(id)
        }
      }

      useEffect(() => {
        for (const region of regions) void run(region.id, 'load')
        return () => {
          for (const controller of controllers.current.values()) controller.abort()
          controllers.current.clear()
        }
      }, [])

      const state = states[active] ?? {}
      const channel = state.data
      const busy = state.busy === true
      const watchCheckin = active === 'cn' && section === 'account' &&
        (channel?.accounts?.some(account => account.checkin?.enabled) ?? channel?.checkin?.enabled === true)
      useEffect(() => {
        if (!watchCheckin) return
        const timer = setInterval(() => {
          if (!document.hidden) void run('cn', 'load')
        }, 30_000)
        return () => clearInterval(timer)
      }, [watchCheckin])
      const save = edit => void run(active, 'settings', edit)
      const reconnect = state.legacy ? undefined : () => void run(active, 'reconnect')
      const legacyHost = Object.values(states).some(region => region.legacy)
      const content = h('main', { className: 'qoder-panel' },
        h('style', null, css),
        h('header', null,
          h('div', { className: 'qoder-brand' }, h('span', { className: 'qoder-mark' }, h(Icon, { size: 26 })), h('h1', null, t('title'))),
          h('div', { className: 'qoder-actions' },
            back ? h('button', { type: 'button', onClick: back }, t('back')) : null,
            h('button', { type: 'button', disabled: busy, onClick: () => void run(active, 'refresh') }, t('refresh')))),
        h('div', { className: 'qoder-channels', role: 'group', 'aria-label': t('title') },
          regions.map(region => h('button', {
            type: 'button', key: region.id, className: 'qoder-channel',
            'aria-pressed': active === region.id, onClick: () => { setActive(region.id); setFocusAccount(undefined) },
          }, h('span', { className: 'qoder-channel-icon' }, h(Icon)),
          h('span', { className: 'qoder-channel-copy' }, h('span', { className: 'qoder-channel-title' },
            h('strong', null, region.displayName), h('span', { className: 'qoder-subtle' }, t(region.id))),
          states[region.id]?.error && !states[region.id]?.data
            ? connectionBadge(t, { connection: 'unavailable' }) : connectionBadge(t, states[region.id]?.data ?? region))))),
        h('div', { className: 'qoder-toolbar' },
          h('nav', { className: 'qoder-sections', 'aria-label': t('title') },
            ['account', 'models', 'diagnostics'].map(id => h('button', {
              key: id, type: 'button', 'aria-pressed': section === id, onClick: () => setSection(id),
            }, t(id)))),
          channel ? h('label', { className: 'qoder-switch', title: writable ? undefined : t('readOnly') },
            h('input', { type: 'checkbox', checked: channel.enabled, disabled: busy || !writable,
              onChange: event => save({ enabled: event.currentTarget.checked }) }), t('enabled')) : null),
        busy ? h('p', { role: 'status', className: 'qoder-subtle' }, t(channel ? 'busy' : 'loading')) : null,
        state.error ? h('p', { role: 'alert', className: 'qoder-notice' }, t(state.error)) : null,
        legacyHost ? h('p', { className: 'qoder-notice' }, t('legacyHost')) : null,
        channel?.enabled === false ? h('p', { className: 'qoder-notice' }, t('channelOff')) : null,
        channel?.enabled === true && section === 'account' ? h(Account, {
          t, channel, busy, reconnect, writable, save, focusAccount,
          refreshBalances: channel.balanceRefresh ? accountId => void run(active, 'balances', { accountId }) : undefined,
          editPool: edit => run(active, 'accounts', edit), claim: accountId => void run('cn', 'checkin', { accountId }),
        }) : null,
        channel?.enabled === true && section === 'models' ? h(ModelCatalog, {
          t, channel, busy, writable, save, query: search[active] ?? '',
          input: value => setSearch(previous => ({ ...previous, [active]: value })),
        }) : null,
        channel?.enabled === true && section === 'diagnostics' ? h(Diagnostics, { t, channel, busy, reconnect }) : null)

      return back ? h('div', { className: 'qoder-page-scroll', tabIndex: 0, role: 'region', 'aria-label': t('title') }, content) : content
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(namespace, { zh, en }))
      const t = ctx.locale.bind(namespace)
      const back = () => ctx.get('layout')?.selectPanel?.(null)
      let preferredRegion = 'cn'
      let preferredAccount
      const openDetails = (id, accountId) => {
        preferredRegion = id
        preferredAccount = accountId
        ctx.get('layout')?.selectPanel?.(panelId)
      }
      const mount = (name, options, component) => ctx.slots.inject(name,
        () => ctx.slots.register({ name, locale: namespace, ...options }, component))
      ctx.effect(() => mount('main', { key: panelId, inject: () => ({
        t, back, initialRegion: () => preferredRegion,
        initialAccount: () => preferredAccount,
      }) }, QoderPage))
      ctx.effect(() => mount('conversation.input.right', {
        id: `${panelId}-credits`, order: 4, inject: () => ({ t, openDetails }),
      }, ComposerCreditsGate))
      ctx.effect(() => mount('settings.section', {
        id: panelId, order: 30, label: () => t('title'), inject: () => ({ t }),
      }, QoderPage))
      ctx.effect(() => mount('settings.section.icon', { id: panelId }, Icon))
      ctx.effect(() => {
        let release
        let wanted
        let pending = false
        let legacy = false
        const lifetime = new AbortController()
        function sync(value) {
          if (wanted === value || lifetime.signal.aborted) return
          wanted = value
          release?.()
          release = value ? mount('sidebar.panellist', { id: panelId, order: 3, label: () => t('title') }, Icon) : undefined
        }
        async function refresh() {
          if (pending || legacy || lifetime.signal.aborted || document.hidden) return
          pending = true
          try {
            const result = await request('/status?view=navigation', lifetime.signal, undefined, 4_000)
            legacy = typeof result.settingsNs === 'string'
            sync(result.sidebarPanel !== false)
          } catch {
            if (wanted === undefined) sync(true)
          } finally {
            pending = false
          }
        }
        void refresh()
        const timer = setInterval(refresh, 15_000)
        document.addEventListener('visibilitychange', refresh)
        return () => {
          lifetime.abort()
          clearInterval(timer)
          document.removeEventListener('visibilitychange', refresh)
          release?.()
        }
      })
    }

    return { inject: ['slots', 'locale'], apply }
  },
})
