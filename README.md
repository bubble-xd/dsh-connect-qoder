# Qoder 接入 DeepSeek Harness

在 DSH 左侧栏点 **Qoder**，可切换 **Qoder CN（国内版）** 和 **Qoder（国际版）**。两个通道可同时用于不同会话，各自使用对应桌面端的登录状态、模型目录、额度和运行时。

| 通道 | DSH 供应商 ID | Worker 运行时 |
| --- | --- | --- |
| Qoder CN | `qoder-cn` | 自动探测 Qoder CN 桌面端附带的运行时 |
| Qoder 国际版 | `qoder` | 首次使用模型时按需下载，或使用手动指定的路径 |

## 安装与更新

在 Windows 上先登录要使用的 Qoder 桌面端。在 DSH Desktop 的插件管理中粘贴 GitHub 仓库地址安装，也可在 Web profile 中运行以下命令。

```powershell
dsh plugin --profile web add "github:bubble-xd/dsh-connect-qoder"
```

本地 `link:` 开发安装需先在本目录运行 `npm ci --ignore-scripts`，再让 DSH 加载本目录。插件从 npm 使用两版官方 Qoder Agent SDK。修改后重新启动 DSH，已有会话可继续使用原来的供应商 ID。

侧栏入口默认显示。在 DSH 的插件配置里可用 `sidebarPanel` 控制。支持 `settings.section` 槽位的 DSH 版本也可从 **设置 → Qoder** 打开同一面板。

## 面板

- **输入框额度**在当前模型属于 Qoder 时显示该通道的余额。点击可查看账号和套餐、刷新额度，或打开对应通道的详情。
- **账号与额度**显示登录状态、账号、套餐和 Qoder 返回的额度。额度缺失时会显示为未知。刷新只针对当前通道。
- **模型**支持按名称或 ID 搜索，并逐项控制它是否出现在 DSH 模型选择器里。设置按通道保存。内置条目和运行时返回的条目有各自的来源标记。倍率只在上游提供时显示。
- **诊断**显示供应商、账号状态更新时间和 worker 运行时信息。重新连接会清除该通道缓存并重置它的 worker，可能中断该通道正在进行的请求。查看面板和刷新不会安装运行时，也不会发送模型推理请求。
- **在 DSH 中启用**可即时启停当前供应商。重新启用后会恢复此前的模型显示设置。隐藏模型只影响目录，仍可继续使用已有会话中引用的模型。关闭供应商会撤下路由，使用该供应商的会话需要切换模型或重新启用通道。

## 插件设置

| 设置 | 用途 |
| --- | --- |
| `sidebarPanel` | 是否显示侧栏入口 |
| `cnEnabled` / `globalEnabled` | 是否启用对应供应商 |
| `cnHiddenModels` / `globalHiddenModels` | 从各自模型选择器隐藏的模型 ID，由面板更新 |
| `cnAuthDir` / `globalAuthDir` | 覆盖对应桌面端的数据目录，留空时自动探测 |
| `cnWorkerRuntimePath` / `globalWorkerRuntimePath` | 覆盖运行时目录或模块路径 |
| `globalWorkerVersion` | 国际版下载版本 |
| `workingDirectory` | worker 工作目录，留空时使用 DSH 的主目录配置 |
| `requestTimeoutSeconds` | 等待下一条 worker 消息的静默超时，默认 180 秒 |

插件复用本机同一 Windows 用户下已登录的客户端。登录凭据由宿主处理，侧栏只接收渲染所需的账号、额度、模型和诊断字段。面板接口仅接收本机请求。

Qoder 负责推理，DSH 负责执行工具。当前接入支持文本输入，模型目录在 worker 推理过程中更新。调用使用对应 Qoder 账号的额度。

交互参考 [DSH Connect WorkBuddy](https://github.com/dingminhua/dsh-connect-workbuddy) 的双区域面板、模型管理和诊断页。
