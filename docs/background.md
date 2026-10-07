# Claude Fish：技术背景与"未知的未知"

> 目的：在进入 `/office-hours` 之前，把 Claude Code 扩展能力的版图摸清楚，标出会影响产品设计的约束与机会。
> 资料来源：code.claude.com 官方文档（2026-10-07 抓取，文档标注版本 v2.1.290）。标 **[未验证]** 的条目需要写原型确认。

---

## 0. 最重要的发现（TL;DR）

1. **Claude Code 有原生的 Mod 系统**（`plugins/mods`），用 JS/TS 写，**运行在 Claude Code 进程内部**，可以在界面里画面板、画"提示框上方的横条"、替换 spinner、画彩色像素格子。
   → Claude Code 版 demo **不需要 tmux 分屏**，游戏可以直接长在 Claude Code 界面里。
2. **版本门槛**：终端版 Mod 需要 **v2.1.287+**，本机是 **v2.1.283**，需要先 `claude update`。
3. **最难的问题是键盘**：Mod 无法直接读键盘，按键默认都进提示框。但有两个官方"后门"可以实现"不切焦点一键收杆"（见 §3）。
4. **Mod 是 Claude Code 独有的**。要扩展到 Codex / Pi，游戏核心必须和"宿主适配层"解耦（见 §9）。

---

## 1. 两套扩展机制：Settings Hooks vs Mods

| | Settings Hook（老机制） | Mod（新机制） |
|---|---|---|
| 形式 | settings.json 里配置 shell 命令 / HTTP / prompt | 插件里的 JS/TS 函数，在 Claude Code 进程内执行 |
| 能否画界面 | ❌ | ✅ 面板、横条、spinner、toast、像素格 |
| 能否改事件 | 能阻止/放行工具调用、注入上下文 | 能观察、改写、直接"代答"任何事件 |
| 状态 | 自己写文件 | `$.state`（会话级、响应式）/ `$.store`（跨会话 KV） |
| 关系 | — | Mod 可以用 `classic.<Event>` 监听所有 settings hook 事件 |

**结论**：demo 直接做 Mod。Settings hook 只在"给 Codex 做外挂"时有参考价值。

另外还有 statusline（底部状态行脚本），Mod 出现之后它基本被 `$.ui.status()` 和 band 取代了。

---

## 2. 游戏画在哪里：Render Sites

| 位置 | 说明 | 对钓鱼游戏的意义 |
|---|---|---|
| **Pane** | 终端够宽且全屏时，是右侧边栏；否则是提示框上方的框（默认占 1/3 高度） | 完整鱼塘 / 水族箱 / FishDex |
| **AbovePrompt band** | 提示框正上方的一条，**一直存在**，所有 mod 共享 | 低干扰模式：一行鱼线 + 浮漂 |
| **Spinner 替换** | 可以改写或替换 Claude 工作时的那行 "Thinking…" | 极简模式：把 spinner 变成鱼线 🎣 |
| `$.ui.status()` | 提示框下方一行，带 `⚠ 插件名` 前缀 | 显示渔获计数 |
| `$.ui.toast()` | 右上角提示，默认 4 秒 | "钓到传说鱼！" |
| `$.ui.log()` | 对话记录里的一行暗色文字，**Claude 读不到** | 渔获日志，不会污染上下文 |

**绘图能力**
- `Raster`：彩色字符网格（最大 512×256），每格包含字符、前景色和背景色（24 位 RGB），适合画像素风鱼塘。
- `$.ui.blit()`：只重绘某个 Raster，不触发整棵树重算，适合做动画。
- `Client` 元素：一个独立文件负责动画和指针输入，通过消息和 mod 通信。
- `$.audio.play()` / `speak()`：音效。

**限制**
- 重绘节流：一般 10 次/秒；终端里可见面板、band 和提示行可以到 **30 次/秒**。
- **自动弹出面板**（不是用户操作触发的）要求终端 **≥144 列**；用户主动打开过一次后降到 110 列。窄屏下 mod 不能自己霸屏。
- 一棵树最多画 100,000 字符。

**不同宿主的支持情况**

| 运行环境 | 事件钩子 | 能画界面 |
|---|---|---|
| 终端 `claude`（含 IDE 内置终端、JetBrains） | ✅ | ✅ |
| Desktop App 的 Code 标签 | ✅ | ✅，但**没有 Raster**，需要降级成文字 |
| VS Code 扩展聊天面板 | ✅ | ❌ |
| `claude -p` / Agent SDK / 云端会话 | ✅ | ❌ |
| Remote Control（手机/网页） | ✅ | 只画在本机终端上 |

---

## 3. 键盘输入：最关键的 UX 约束

**规则**
- Mod **永远不直接读键盘**。按键默认进提示框，只有面板或 band **获得焦点**时才会进 mod。
- 获得焦点的方式：mod 用 `focus: true` 打开面板（**仅在提示框为空**、且没有别的东西占着焦点时才会生效）；用户按 `Ctrl+X Tab`；用户鼠标点击。
- `Esc` 把焦点还给提示框。Tab 和方向键不能重新绑定，游戏操作只能用 wasd、字母和数字。

**两个可以"不切焦点"的后门**
1. **Band 上按钮的数字热键**：如果 band 里有一个 `hotkey: '1'` 的按钮，用户在**空提示框**里只打一个 `1` 并停顿，就会触发这个按钮。
   → "鱼咬钩时按 1 收杆"可以完全不离开提示框。
2. **Button 的 `action` 属性**：可以绑定到 Claude Code 自己的某个快捷键动作，只要用户把那个动作绑成组合键（chord 或带修饰键），按下就会触发按钮。

**设计张力**
- 很多用户在 Claude 工作时会**提前输入下一条指令**，这时提示框不为空，数字热键失效。要想好怎么办。
- 误触：用户本来就想发一个 "1"（比如回答"选方案 1"）。

---

## 4. 感知 Agent 状态：事件映射

| 游戏行为 | 可用事件 | 备注 |
|---|---|---|
| 抛竿 | `prompt.submit` / `turn.start` | `turn.start` 带 `turnId` |
| 鱼塘运行中 | `tool.call`（每次工具调用）、`turn.step`（每次模型请求，流式） | `turn.step` 结果里有 `usage`（input/output/cache tokens） |
| **需要用户确认 → 暂停** | `tool.check` 返回 `ask`（即将弹权限框）；`classic.PermissionRequest`；`classic.Notification`，matcher 可以是 `permission_prompt` / `idle_prompt` / `elicitation_dialog` / `agent_needs_input` | 权限框**不是** render site，mod 改不了它的样子（这对"不打扰"是好事） |
| Claude 提问 → 暂停 | `AskUserQuestion` 工具 / render site | |
| 任务完成 → 暂停 | `turn.complete`（带 `durationMs`、`usage`、`isAborted`）、`classic.Stop` | 子代理的 turn 也会触发，要用 `e.agentId` 过滤掉 |
| 用户中断 | `turn.complete` 且 `isAborted: true` | |
| 测试通过 → 稀有鱼 | `tool.call` 加 `{ tool: 'Bash' }`，`await next(e)` 拿到结果（`isError`） | **[未验证]** 结果里是否有退出码；"这是不是测试命令"只能靠匹配命令文本 |
| 长时间推理 → 深水鱼 | `turn.step` 的耗时与 `output_tokens` | **[未验证]** thinking 块是否单独暴露 |
| 夜间限定鱼 | `$.clock.now()` | |
| 仓库/语言生态 | `$.session.repo()`、`$.session.cwd()`，以及 Edit/Write 的文件后缀 | |
| 上下文快满 / 额度 | `$.session.usage()`、`session.measure` | 可以做"潮汐"之类的机制 |

**坑**
- **后台子代理**在主 turn 结束后可能还在跑，需要决定"后台还在干活"时算不算在钓鱼。
- 一个 turn 里通常有多次 `turn.step`，不能把每次 step 当成一次"新抛竿"。

---

## 5. 状态与持久化

| 存储 | 生命周期 | 坑 |
|---|---|---|
| 模块变量 | **每次保存文件都会热重载并清空**（开发时） | 只适合放临时数据 |
| `$.state` | 一个会话；`/clear`、`/resume`、`/branch` 后**重置**，而且 `session.start` 不会再触发 | 需要监听 `classic.SessionStart`（source 为 clear/resume/fork）重新加载 |
| `$.store` | 跨会话持久，JSON 文件放在 `~/.claude/plugins/store/` | **总共 4 MiB**；**本机所有会话共享**，get+set 不是原子操作，多个 Claude 会话同时钓鱼会产生写竞争；超过 `cleanupPeriodDays` 没有读写会**被清理** |

→ FishDex 和渔获记录要按"每条一个 key"来设计，防止竞争；还要考虑导出和备份。

---

## 6. "低干扰"相关的隐藏规则

- **不要污染 Claude 的上下文**：命令返回 `{ text }` 时，**Claude 会读到这段文字**；返回 `{}` 或者用 `$.ui.log()` 才是 Claude 读不到的。`/fish` 系列命令应该一律走后者。
- **不要动 prompt**：通过 `prompt.submit` 往上下文里塞东西会**让 prompt cache 失效**，花用户的钱、拖慢速度。
- **不要调用模型**：`$.model.*` 消耗的是用户的额度。
- **命令要能在 Claude 工作时运行**：注册命令时加 `immediate: true`，否则会排队到 turn 结束才执行。
- **性能**：mod 跑在 Claude Code 进程里。单个 hook 的执行时间上限是 10 秒，超时会被跳过。渲染太重会拖慢整个界面。

---

## 7. 信任、安全与分发

- Mod **没有沙箱**，以用户的权限运行（读写文件、起进程、联网、读环境变量里的 API key）。
- `claude plugin validate` 会列出 mod 用到的所有事件和 API 调用。**卖点**：钓鱼 mod 可以做到零 `http`、零 `process`、零 `model` 调用，让用户一眼就能放心。
- 分发：插件 marketplace（可以自建 GitHub marketplace），用户通过 `/plugin install fish@xxx` 安装；也能提交到 Anthropic 的官方或社区目录。
- **企业环境可能装不上**：`allowManagedModsOnly`、`allowManagedHooksOnly`、`disableAllHooks`、`disableSideloadFlags` 都可能拦截。Team/Enterprise 用户还会默认加载 `sec-default` 守卫。在公司电脑上的目标用户要考虑这一点。
- 命名和品牌：叫"Claude Code 钓鱼 Mod"可能让人误以为是官方产品，正式发布前要想好名字和免责声明。

---

## 8. 开发体验

- `claude --plugin-dir ./claude-fish`：加载本地插件，**保存即热重载**。
- `claude plugin validate`：检查代码并列出权限面。
- `claude plugin test`：跑 `*.test.ts`，不需要启动真实会话就能模拟事件和按键。
- Claude Code 会为当前版本生成 TypeScript 类型文件，这是最权威的 API 参考。
- 模块里**没有 Node API**，也没有 `setTimeout`，要用 `$.clock.after/every`。`URL`、`TextEncoder`、`crypto.subtle` 这类 Web API 可以用。
- 内置的 `plugin-authoring` skill 可以让 Claude 帮忙写 mod。

**可参考的官方样例**
- [`token-weather`](https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods/token-weather)：在提示框上方画上下文"天气预报"，**和我们的形态最接近**。
- [`blast-radius`](https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods/blast-radius)：拦截危险命令并画按钮。
- [内置 `diff` mod 源码](https://github.com/anthropics/claude-code/tree/main/mods/diff)：面板、键位绑定、自定义滚动。

---

## 9. 扩展到 Codex / Pi 的架构含义

Mod 只存在于 Claude Code。如果一开始把游戏逻辑写死在 mod 里，以后移植就得重写。建议从第一天就分三层：

```
game-core      纯逻辑：鱼塘状态机、掉落表、FishDex、存档格式（与宿主无关，可单测）
  ↑ 事件（cast / working / pause / complete / signal:test_passed ...）
adapter        把宿主事件翻译成游戏事件
  ├─ claude-mod     （demo）
  ├─ codex-sidecar  （以后：tmux 分屏 + Codex 的通知机制）[未调研]
  └─ pi-agent       [未调研]
renderer       把游戏状态画出来
  ├─ claude-mod Raster / band
  └─ 终端 TUI（给 sidecar 用）
```

---

## 10. 待你补充的问题（进 office hours 前）

1. **默认形态**：极简模式（spinner / band 一行）、中等（inline 面板）还是沉浸式（右侧面板）？先做哪一个？
2. **收杆按键**：接受"空提示框里按数字"的方案吗？如果用户正在打下一条指令，鱼就跑了，还是自动收杆？
3. **游戏性有多重**：是纯放置（自动钓，按键只是加成），还是需要一点技巧（时机判定、QTE）？
4. **奖励和 token 的关系**：要不要奖励"长时间推理"？这可能变相鼓励用户多烧 token。这个张力你怎么看？
5. **多会话**：同时开多个 Claude 会话时，是共享一个鱼塘、每个会话一个浮漂，还是各钓各的？
6. **目标用户**：自己玩、开源社区传播，还是想做成产品？会不会有很多用户在公司电脑上（企业策略可能拦截）？
7. **美术风格**：ASCII、Unicode 方块像素风，还是 emoji？
8. **是否支持 Desktop App**（没有 Raster，需要另做一套渲染）？
