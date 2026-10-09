# G3 Live Smoke 验收记录（2026-10-08，Claude Code 2.1.292）

两套环境：
- **真实构建**：`claude --plugin-dir .`，参数用默认值。
- **冒烟副本**：`/tmp/rq-smoke`，只把 `src/core/params.ts` 改成"稀有鱼一定出现、咬钩时间缩短"，用来稳定触发稀有路径；**仓库里的代码没有改**。

| # | 场景 | 环境 | 结果 |
|---|---|---|---|
| 1 | 加载；空闲时横条不渲染 | 真实 | PASS |
| 2 | 提交任务 → 抛竿 → WAITING，装饰鱼影慢速移动 | 真实 | PASS |
| 3 | 普通鱼自动收杆，结果停留在横条上 | 真实 | PASS（修复了一个问题：下一竿之后旧结果会重新出现 → `fdf5e8a` 之前的 retire 修复） |
| 4 | 权限确认：确认框期间冻结；批准后、工具运行期间仍冻结（over-freeze，符合 D11）；工具结束后解冻 | 真实 + 冒烟 | PASS |
| 5 | 稀有咬钩显示 `! RARE bite · 0:19` 加 `1: reel in`，按 `1` 收杆（约 400ms 生效） | 冒烟 | PASS |
| 6 | 有草稿时显示 `paused`，以及 `Send your draft, then reel it in.` | 冒烟 | PASS |
| 7 | carried：有草稿时暂停计时；清空草稿后开始宽限期倒计时 | 冒烟 | PASS |
| 8 | 宽限期超时 → 横条显示 sighted，transcript 写 1 行 | 冒烟 | PASS |
| 9 | 稀有鱼收获卡片：3 行、按顺序、每个事件只输出一次；Claude 读不到（用哨兵词实测，回答 NO） | 冒烟 | PASS |
| 10 | Recent memories：本地时间、不被平台折行、Claude 读不到 | 冒烟 | PASS（修复了 UTC 时间显示和 log 宽度问题，见 `fdf5e8a`） |
| 11 | 重启：已结算的 caught/sighted 记录在 `--continue` 之后仍然保留，Recent memories 显示正常 | 冒烟 | PASS |
| 12 | 重启：还没结算的 hooked/carried 稀有遭遇 | 冒烟 | **APPROVED_KNOWN_LIMITATION**（不计为 PASS）。会静默丢失，见 TODOS G3-R1 和 README Limitations |
| 13 | 模块热重载后 `$.state` 恢复 | 冒烟 | PASS（会话中途热重载过 3 次，鱼塘状态和已见卡片集合都保留了） |

观察（不阻塞发布，记录下来供 dogfood 参考）：
- 体长显示一位小数（例如 `38.8 cm`、`13.7 cm`）。fixture 里用的都是整数输入，所以两者一致。
- Recent memories 按 80 列 log 宽度排版时，大多数行会把 repo 字段省略掉。
- 平台会在每条 `$.ui.log` 之间插入空行，3 行卡片看起来是三条分开的消息，但没有被别的消息插进来，所以不需要降级成单行。

## G3 重跑：非阻塞串行队列（`3ad5c1f` + `9f5137f`，2026-10-08）

这次只改了执行调度，没有改动概率、稀有度、交互窗口和功能范围。测试环境同上：用冒烟副本强制触发稀有鱼。

| # | 场景 | 结果 |
|---|---|---|
| R1 | 稀有咬钩 → 有草稿时暂停计时 → 清空草稿 → 按 `1` 收杆，3 行卡片只输出一次 | PASS |
| R2 | 批准权限：工具运行期间显示 `RARE on the line · paused`（over-freeze 符合 D11）；工具执行完后解冻，carried 宽限期继续计时 | PASS |
| R3 | 拒绝权限：拒绝后解冻；对话框期间宽限期没有被计时（约 10 秒的对话框只扣了约 2 秒） | PASS |
| R4 | carried 宽限期超时 → 横条显示 sighted，transcript 写 1 行 | PASS |
| R5 | Recent memories 显示 `5 of 5`，时间为本地时间，没有被折行 | PASS |
| R6 | 用 `--continue` 重启后，已结算的 5 条记录全部保留 | PASS |
| R7 | 重启时还没结算的遭遇 | APPROVED_KNOWN_LIMITATION（不计入 PASS，见 TODOS G3-R1） |

G2 的覆盖（mock.clock / mock.store）如下：
- 工具调用在存储写入延迟 60 秒的情况下不会额外等待。这条测试在旧实现上会 5 秒超时。
- 两个工具调用同时冻结、只释放其中一个时，仍然保持冻结。
- 拒绝权限后会解冻。
- AskUserQuestion 调用期间全程冻结。
- 过期的 `turn.complete` 被忽略。这条测试在旧实现上会失败。
- `$.state` 写入失败一次之后，队列能继续处理后续任务。

权限确认（`tool.check` 返回 ask）只能在实机上触发，因为测试工具里的 `$.tool.call` 不会触发 `tool.check`，所以这一项由上面的 R2 和 R3 覆盖。

## Live Smoke：收杆热键稳定期 + 工作记忆修复（`5bcddc8` + `63a4332`，2026-10-09）

GIF 草稿验收时发现两个问题，修复后重跑。隔离方式同 demo 录制：`/tmp` 下的副本，ReelQuiet store 录前移走、录后恢复（已逐字节比对）。

| # | 场景 | 环境 | 结果 |
|---|---|---|---|
| H1 | 稀有咬钩期间输入真实草稿：输入后 0.5 秒不提示，1.5 秒和 3.5 秒显示 `bite · paused` 和 `Send your draft`；清空草稿后倒计时继续（2 秒内 0:09 → 0:07），暂停的约 3 秒没有消耗窗口 | 冒烟 | PASS |
| H2 | 按 `1` 收杆：数字留在提示框期间（约 0.35 秒）连续采样，横条没有出现 `paused` 或草稿提示；卡片 3 行只写一次；横条显示 caught | 冒烟 + GIF v2 录制 | PASS |
| H3 | 真实测试先红后绿，绿之后的模型请求不再覆盖工作记忆：卡片第三行 `caught as tests turned green`。debug 日志记录 `signal: test command red`、`signal: test command green -> tests-green`（只记结果，不记命令文本） | GIF v2 录制 | PASS（修复前同一流程得到 `caught during a tool run`） |
| H4 | 工具运行中收杆，期间有模型请求：卡片如实写 `caught during a tool run` | 冒烟 | PASS |
| H5 | 真实构建、默认参数：加载、抛竿、`waiting · 0:02 · depth 0 m`；debug 日志中没有 reelquiet 的 refused/failed/error | 真实 | PASS |

Transcript 重绘：v1 GIF 约第 10 秒，第三行卡片在一帧（38ms）内出现两次。会话 transcript 显示插件只写了 3 行，所以这是 Claude Code TUI 滚动时的差分重绘，不是插件缺陷，代码没有改。v2（88x28）没有任何一帧重复。工具：`docs/demo/check-transcript.py`。
