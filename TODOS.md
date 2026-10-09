# TODOS: 推迟事项索引

> 本文件只是**推迟事项的索引，不是设计文档的副本**。详细理由以 [docs/designs/claude-fish-v0.1.md](docs/designs/claude-fish-v0.1.md) 中的 "Eng Review" 一节为唯一依据；决策记录可以用 `gstack-decision-search` 查询。

## Stage 2 Engineering Review

**状态**：BLOCKED（等待前置条件满足）

**Gate**：
1. Stage 1 完成（包括 GIF 录制）。
2. 必要的探针都已完成，并记录了结果，包括 isDraft 刷新时机、组合键触发方式、数字热键的停顿时长、权限等待位置与多冻结的时长（OQ6）、blit 能否用于横条、JSON 能否 import、`keys()` 的延迟。
3. 至少自用一周，并记录 Recent memories 的使用情况，以及稀有遭遇的频率。

**Gate 满足后状态只变为 READY_FOR_REVIEW，不会自动进入实现。** Stage 2 必须重新做一次 scope review，对下面每一项决定 IMPLEMENT、MODIFY 或 DROP。

| ID | 范围 | 状态 | 重开前提 | 不可违反的约束 | 来源 |
|---|---|---|---|---|---|
| R3-1 至 R3-6 | 存储：压缩、租约、汇总键、可变键清单、容量预算、长期保留 | DEFERRED_TO_STAGE_2 | **必须先拿到 `keys()` 的实测延迟，以及真实的单条记录大小和记录总量** | **不得依赖 CAS 或原子租约**（`$.store` 只有 get/set/delete/keys）；所有键带 `v1:` 前缀和 `schema_version`；2,000 条只是安全上限，不代表容量结论 | 设计文档 Eng Review D1；决策 d4a5c187 |
| R3-13 / OQ10 | 鱼饵的数值、库存、获取与消耗；奖励表参数；遭遇的概率、时间窗口和每日预算；`postSubmitGraceMs` | DEFERRED_TO_STAGE_2 | 自用一周的数据 | 鱼饵语义契约：鱼饵影响咬钩机会、物种池和栖息地，而不是简单的稀有度倍数；同一 hash 或 amend 不重复奖励；Sparse Active Encounters（每天约 0 到 2 次）；不能通过挂机或多开会话刷 | D2、D9、D13；决策 34b5c09d |
| — | bait 与 diet/habitat 的匹配规则 | DEFERRED_TO_STAGE_2 | 鱼饵参数确定之后 | species.json 只记录生物学事实，不加入游戏数值 | D10 |
| R3-9、R3-12、OQ5、OQ8、D-DESKTOP | Desktop 渲染与刷新；右侧面板与 144/110 列阈值 | DEFERRED_TO_STAGE_2 | 平台 API 的验证结果 | Stage 1 只支持终端，其他宿主一律静默 | D3；决策 43a26bdb |
| R3-8 | "稀有加成"的定义（只在 Desktop 自动收杆分支中用到） | DEFERRED_TO_STAGE_2 | 和 D-DESKTOP 一起重开 | — | 设计文档 R3-8/R3-11 一节 |
| R3-10（声音部分） | 音效的实现、素材和交互 | DEFERRED_TO_STAGE_2 | 确认开关入口所用的平台 API | Sound UX Contract：默认关闭，需主动开启；用 `v1:p:sound.enabled` 保存；不改变概率和规则；不推送 toast | D8 |
| — | reflog 提交奖励（包括 worktree、bare 仓库、超过 4 MiB 等边界情况）；`/reelquiet export` | DEFERRED_TO_STAGE_2 | 奖励参数确定之后 | 只能用 `fs.read`/`fs.stat` 读取 reflog，不执行 `git`；Stage 1 不访问任何文件 | D7 |
| OQ6（剩余部分） | 更精确的"权限已处理"信号，用来减少多冻结的时间 | DEFERRED_TO_STAGE_2 | 探针测出多冻结的实际时长 | 不能阻塞 Agent；只观察，出错时放行 | D11 |
| — | Journal/FishDex（从 Recent memories 发展而来） | DEFERRED_TO_STAGE_2 | 自用期间 Recent memories 的使用数据 | 遵循 D12 的白名单；分享卡片只能通过 allowlist 投影生成 | D12、D14 |
| — | Extract shared visual contracts into DESIGN.md（把 V-MONO、V-LABEL、V-COLOR 的 token 和状态文案抽出来） | DEFERRED_TO_STAGE_2 | Stage 2 的 Gate 已通过；已正式批准第二个独立界面（FishDex 面板或 Desktop）；确实有多个界面需要共用视觉规范 | 必须继承 V-MONO、V-LABEL、V-COLOR；保留单色优先、稀有度文字标签、低频动画、窄屏降级这几条规则；不能借此新增主题系统，也不能重新设计已冻结的交互。抽取完成后，DESIGN.md 成为权威来源，原设计文档只保留决策背景和引用 | 设计文档 Stage 1 Visual Spec；设计评审 D11 |
| G3-R1 | **Unresolved encounter recovery**：进程重启（`--continue`、进程被杀）时，正挂在钩上或 carried 的稀有遭遇会丢失，因为 `$.state` 只在单个进程内有效。已结算的 caught/sighted 记录不受影响。Stage 1 状态：APPROVED_KNOWN_LIMITATION | DEFERRED_TO_STAGE_2 | dogfood 中发现实际损失；有用户反馈；或者对可靠性的要求提高 | 不能直接假设"其他会话留下的 pending key 就是孤儿"；优先研究只追加的 encounter ledger、确定性事件 ID、幂等结算、活跃会话判定这几个方向；不能依赖 CAS 或原子租约；Stage 1 不新增 `v1:o:*` 键，D1 的只追加约束不变 | G3 冒烟测试 2026-10-08；决策 D13（G3） |
| DF-1 | **测试命令被管道包住时，红→绿检测不到**：Agent 常用 `make test 2>&1 \| tail -60` 这类写法。管道让退出码变成 `tail` 的 0，Claude Code 不会把这次运行标成错误；而且每次 `tail -N` 不同，指纹也对不上。结果是 "tests turned green" 的工作记忆拿不到。GIF 第二版录制时实测发现（demo 仓库用 CLAUDE.md 约定 `make test` 规避） | DOGFOOD_OBSERVE | dogfood 中统计这类写法占测试命令的比例 | 只观察 `tool.call` 的结果，不执行命令、不读文件；指纹仍然只存哈希（D12）；不得为此新增权限 | GIF v2 录制 2026-10-09 |
