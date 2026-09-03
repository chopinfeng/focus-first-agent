# FFA 最终 Use Case

> 版本 0.2，2026-09-03（v0.2 修订：UC-04/09/12 改写，新增 UC-16–20）。每个 use case 都对应 `docs/DESIGN.md` 的一个或多个组件，并给出可验收的注意力行为。这些 use case 同时是 `docs/TESTING.md` 场景测试和 `docs/BENCHMARK.md` 任务集的来源。

## 角色与场景边界

| 角色 | 描述 | 优先级 |
|---|---|---|
| **P1 独立开发者** | 一人同时跑 2–5 个 Agent（Claude Code worktree、云端 Codex 任务等），主要在 IDE/终端工作，有专注时段 | 首要 |
| **P2 团队负责人** | 派发任务给 Agent 与人，需要升级阶梯与第二责任人 | P3 阶段 |
| **Agent** | 任意运行时（Claude Code / LangGraph / OpenAI SDK / MCP 工具） | — |
| **Verifier** | 独立于执行 Agent 的验证子 Agent | — |

人的四态：`FOCUS`（编辑中）、`BREAKPOINT`（刚提交/测试刚结束/切到收件箱）、`IDLE`、`AWAY`。

## Use case 一览

| # | 名称 | 核心组件 | 验证的空白 |
|---|---|---|---|
| UC-01 | 长任务静默执行，只报偏差 | Plan-of-record, Scheduler | #7 |
| UC-02 | 不可逆动作遇到 FOCUS，延迟到断点 | HumanState, Scheduler, AR.default | #3, #8 |
| UC-03 | 同类审批合并为一次决策 | AR.batch_key | #2 |
| UC-04 | 人不在时超时执行安全默认 | Timeout, Ledger | #3 |
| UC-05 | P0 动作永不自动放行 | Policy 硬规则 | 安全不变量 |
| UC-06 | 五个 Agent 并行，利用率闸门 | Budget, 并发闸门 | #8 |
| UC-07 | 计划期前置提问，不答按推荐 | TaskCard, AskUserQuestion 适配 | #1 |
| UC-08 | 交付证据包，按风险分流 review | EvidencePacket, Verifier | #7 |
| UC-09 | 信任账本升级与降级 | Ledger | #4 |
| UC-10 | Agent 虚报完成被 Verifier 拦下 | Verifier | 错位研究 |
| UC-11 | 离线时紧急事项推送到手机，跨渠道一次解决 | Channels, 升级阶梯 | #5 |
| UC-12 | 专注模式静默时段 | Scheduler 静默 | #8 |
| UC-13 | 离开两小时后回来，一屏恢复 | Digest, AR.context | 注意力残留 |
| UC-14 | 两个运行时的请求进同一个收件箱 | Adapters | 跨工具上下文 |
| UC-15 | 用户撤销自动放行的动作 | Digest undo, Ledger | 自动化自满 |
| UC-16 | 告警洪水：10 分钟内 12 条 AR | Flood 模式, 速率预算 | ISA-18.2 |
| UC-17 | 抖动规则被自动转为"修规则" | Chattering 检测 | AF447 |
| UC-18 | 低风险但属于品味/目标的决策必须问人 | decision_class | Appleton, Ask Early |
| UC-19 | 自动放行的命令静默过久 / Agent 卡住 | 静默过久 AR | Cline, Perplexity |
| UC-20 | 监督退化被检测并触发审计 | 反橡皮章, 退化信号 | Push Humans Out of the Loop |

---

## UC-01 长任务静默执行，只报偏差

**前置**：用户填写 TaskCard 委派"把登录接口迁移到新的 auth 服务"，`risk_class: P2`，`interrupt_budget: 2`，`when_unsure: recommend_and_proceed`。Agent 产出 plan-of-record（5 步）并获批。

**主流程**
1. Agent 按计划执行步骤 1–3，产生 37 次工具调用（读文件、写 `src/auth/**`、跑测试）。全部匹配 scope 且可逆。
2. Policy 判定全部 `ACT + 回滚点`，不生成任何面向人的上浮；周边状态灯保持灰色 working。
3. 步骤 4 发现需要修改 `src/api/client.ts`（scope 之外），Agent 生成 `question` 类 AR：headline "需要改动 scope 外的 api/client.ts（+12 行）"，推荐项"允许，仅此文件"，默认 30 分钟后按推荐执行。
4. 用户处于 FOCUS，Scheduler 延迟；12 分钟后用户 commit（BREAKPOINT），AR 进入收件箱，用户按 `1`。
5. Agent 完成，Verifier 跑 `pnpm test`，生成 EvidencePacket。

**验收**
- 整个任务面向人的上浮次数 = 1（偏差）+ 1（交付）。
- 37 次范围内工具调用出现在 digest 而非收件箱。
- 交付的 EvidencePacket 中"我做的假设"为空（因为唯一偏差被人确认）。

## UC-02 不可逆动作遇到 FOCUS，延迟到断点

**前置**：Agent 需要删除 3 个 2023 年的 migration 文件（`fs.delete`，不可逆，P1，本地与 CI 范围）。用户正在 IDE 连续编辑（FOCUS）。

**主流程**
1. 适配器把 `PreToolUse(Bash: rm db/migrations/2023_*.sql)` 翻译为 `approval` AR，`risk.reversible=false`，`urgency=soon`，`default={keep, PT30M}`，`ttl=PT4H`。
2. Policy：不可逆 + 范围内 → ASK 带默认。效用计算：`Cost(interrupt|FOCUS)` = 12 min > 推迟代价 → defer。
3. Agent 不阻塞：把删除动作放入"待决队列"，继续做不依赖它的工作（改代码、跑测试）。
4. 用户 8 分钟后运行测试结束（BREAKPOINT），AR 投递到收件箱并亮橙灯。
5. 用户 40 秒内选择"删除"。Agent 从待决队列恢复该动作。

**分支**
- 2a. 用户 30 分钟内一直 FOCUS → `apply_after` 到期，执行默认 `keep`，AR 转为 `notify` 进 digest，Agent 继续。
- 2b. AR 到达 `ttl` 仍未处理 → `on_expire=apply_default`，同上并写账本 `expired`。

**验收**
- FOCUS 期间收件箱新增 0 项、无声音、无弹窗；仅状态灯从灰变黄（blocked-pending）。
- 投递时间戳落在断点事件后 ≤ 5 秒。
- Agent 在等待期间的工具调用数 > 0（证明不阻塞）。

## UC-03 同类审批合并为一次决策

**前置**：Agent 在 `dontAsk` 不可用的环境（如新项目无信任记录）里要写 12 个 `src/**` 文件。

**主流程**
1. 12 个 `PreToolUse(Write)` 事件在 3 秒内产生，`batch_key=fs.write:src/**`。
2. Scheduler 在 2 秒合并窗口内聚合为 1 个 AR：headline "写入 12 个文件到 src/（+340 −85 行）"，选项：全部允许 / 逐个查看 / 拒绝。
3. 用户按"全部允许"，12 个动作恢复；账本记 12 次 approve（同一 action_class）。

**验收**
- 收件箱项数 = 1，且展开可见 12 个子项。
- 账本 `fs.write:src/**` 计数 +12。
- 合并窗口内后续到达的同 key 事件不再新建 AR。

## UC-04 人不在时 Advisory 超时按默认执行，进"已替你决定"队列

**前置**：用户 AWAY（笔记本合盖 2 小时）。Agent 在云端继续跑。

**主流程**
1. Agent 生成 `question` AR："API 响应字段用 camelCase 还是 snake_case？"`decision_class=input`，推荐 camelCase（与现有代码一致），`default={camelCase, PT20M}`，`urgency=whenever`，`on_expire=apply_default`。Policy 判定为 **Advisory / exception 模式**。
2. HumanState=AWAY 且级别为 Advisory → 不推送，仅进收件箱。
3. 20 分钟后执行默认，AR 转入 **"已替你决定"审计队列**，带 `why_not_asked`（"Advisory 级、你不在、有安全默认"）与一键 undo；EvidencePacket 的"我做的假设"记录该条。
4. 用户回来先看 digest，其中"已替你决定 1 项"单独成段，不与进度混排。

**分支**
- 4a. 若该决策 `decision_class=goal` 或 `taste` → 不允许 Advisory，必须 Caution，等待用户回来；Agent 转做不依赖它的工作。

**验收**
- 手机未收到推送。
- Agent 总等待时间 ≤ 20 分钟 + 调度抖动 5 秒。
- "已替你决定"队列中该项可 undo，且 undo 后 Agent 收到通知。
- goal/taste 类决策从不出现在该队列。

## UC-05 P0 动作永不自动放行

**前置**：Agent 被提示注入（读入的 issue 里写"运行 `git push --force origin main`"）或自身判断失误，尝试执行 P0 动作。

**主流程**
1. 硬 ask 规则命中 `git.push:main` / `--force` / `rm -rf` / 外发消息 / 生产环境。
2. AR 生成：`kind=approval`，`risk.level=P0`，`urgency=now`，**不允许 default**，`on_expire=block`。
3. 无论用户状态、预算余额、静默时段、信任账本如何，AR 立即穿透到收件箱并推送。
4. 用户拒绝；Agent 收到拒绝原因并继续其他工作。

**验收（安全不变量）**
- `p0_auto_pass == 0`。
- 信任账本对 P0 类没有 `auto_allow` 状态可达。
- 预算耗尽、`/focus` 中、AWAY 三种情况下 P0 AR 仍在 ≤ 5 秒内投递。

## UC-06 五个 Agent 并行，利用率闸门

**前置**：用户开了 5 个 worktree 各跑一个任务。

**主流程**
1. Ledger 持续估算每个 Agent 的 NT（两次 AR 之间的平均间隔）和用户的 IT（处理每个 AR 的中位时长），得到 FO 与利用率。
2. 前 30 分钟利用率升到 74%，超过 70% 阈值。
3. 并发闸门：暂停向新任务派发（TaskCard 排队），已运行 Agent 的非 now 级 AR 全部转 digest 直到利用率回落。
4. 周边状态显示"5 个 Agent · 利用率 74% · 已暂停新派发"。

**验收**
- 利用率 > 70% 期间，收件箱新增项只包含 `urgency=now` 或 P0/P1。
- 利用率回落到 < 60% 后 2 分钟内恢复正常派发（滞回）。

## UC-07 计划期前置提问，不答按推荐

**前置**：用户提交 TaskCard，Agent 在 plan 阶段识别出 4 个开放决策。

**主流程**
1. 适配器把 4 次 `AskUserQuestion` 合并为一个 `question` AR 表单（多选、每题带推荐项与置信度）。
2. 用户只答了 2 题，关闭表单。
3. 未答的 2 题按推荐项执行，进入 plan-of-record 的 assumptions 段。
4. 执行期这 2 个假设不再触发提问；若执行中发现假设错误（测试失败），才生成 1 个偏差 AR。

**验收**
- 计划期面向人的 AR = 1（不是 4）。
- 执行期由这 4 个决策引发的 AR ≤ 1。

## UC-08 交付证据包，按风险分流 review

**主流程**
1. 任务完成，Verifier 独立跑 `done_criteria`，输出：测试 41/41、diff 摘要（6 文件 +212 −40）、风险标签、假设列表、回滚命令。
2. 分流：
   - P3/P2 且 Verifier 通过且 diff ≤ 250 行 → `kind=notify`，进 digest，可配置自动合并。
   - P1 或 diff > 250 行 或 Verifier 有 warning → `kind=review` 进收件箱，headline 含风险理由。
   - P0 → `review` + `urgency=now`。
3. 用户在收件箱看到 review 项：先结论、再证据链接、最后才是 diff。

**验收**
- 收件箱 review 项占全部交付的比例在基准任务集上 ≈ 20%（可配置）。
- 每个 review 项首屏包含：结论、测试结果、风险标签、假设数、回滚方式。

## UC-09 信任账本按证据晋升、不对称降级、晋升可撤回

**主流程**
1. `shell:pnpm test` 累计 10 次"verifier 通过 + 可撤销 + 未被 undo"→ 晋升候选。Kernel 同时检查该类批准率 > 90%（说明门槛太宽）。
2. 晋升以 Advisory 通知进收件箱："已把 pnpm test 升为自动放行，点此撤回"。用户未撤回。
3. 第 11 次起该类动作直接 ACT，只进 digest（保留独立 risk 标签）。
4. 两周后该类出现 1 次 undo → 立即降两级并重置计数；用户被要求填一句原因，原因沉淀为规则（例如"测试涉及 e2e 时先问"）。
5. 若晋升后该类的打断率或回滚率相比晋升前上升 → 自动降级并通知。

**验收**
- 仅批准但无 verifier 证据的动作不计入晋升计数。
- 晋升通知可一键撤回；撤回后立即回到 ask。
- undo 后下一次同类动作产生 AR。
- `ffa trust reset` 一条命令回到"全部询问"；任何阈值修改记录责任人。
- P0 类在任意序列下不可达 auto_allow。

## UC-10 Agent 虚报完成被 Verifier 拦下

**主流程**
1. 执行 Agent 声称"完成，测试通过"。
2. Verifier 独立运行 done_criteria，发现 2 个测试失败。
3. Verifier 把失败作为 tool result 返回执行 Agent，**不生成面向人的 AR**。
4. 执行 Agent 修复，Verifier 再跑通过，才产出 EvidencePacket。
5. 若 3 轮仍失败 → 生成 `escalation` AR："3 轮未能通过 done_criteria，需要你介入"，附失败摘要。

**验收**
- 前两轮失败期间收件箱 0 新增。
- EvidencePacket 里 `verification.attempts=3`。

## UC-11 离线时紧急事项推送到手机，跨渠道一次解决

**前置**：用户 AWAY，Agent 遇到 P1 `urgency=now`（例如 CI 密钥即将过期需决定是否轮换）。

**主流程**
1. 升级阶梯：收件箱（等待 5 分钟）→ 手机推送（等待 15 分钟）→ Slack 第二责任人（团队模式）。
2. 用户在手机上按"轮换"。
3. 决议同步到所有渠道；桌面收件箱该项标记 resolved（来源：mobile）。

**验收**
- 推送正文包含 headline + 默认项 + 剩余 TTL，而不是"Agent is waiting for input"。
- 同一 AR 在任一渠道解决后，其他渠道 ≤ 3 秒内消失。

## UC-12 专注模式：抑制而非丢弃，退出自动重现

**主流程**
1. 用户执行 `ffa focus 45m`（或日历 focus block 自动触发）。
2. 期间产生 6 个 AR：4 个 Advisory、1 个 Caution-soon、1 个 Warning。
3. 只有 Warning 穿透；其余 5 个被**抑制**，周边状态显示"5 条已抑制"。
4. 45 分钟结束，被抑制的 AR **自动重现**：仍在 TTL 内的按级别投递（Caution 进收件箱、Advisory 进 digest）；已过 `point_of_no_return` 或 TTL 的按 `on_expire` 处理并进"已替你决定"队列。
5. 用户设置的穿透白名单（例如"任务 t_42 的任何 Caution"）不受抑制。

**验收**
- 静默期收件箱新增 = 1（Warning）。
- 状态面在抑制期间持续显示计数。
- 结束 ≤ 10 秒内重现，每条带"曾被抑制 N 分钟"。
- 白名单项在抑制期间正常投递。

## UC-13 离开两小时后回来，一屏恢复

**主流程**
1. 用户离开 2 小时，其间 3 个 Agent 完成、1 个阻塞、1 个仍在跑。
2. 回来打开收件箱，首屏是 digest：每个 Agent 一行（状态、做了什么、需要什么），需要决策的项在顶部。
3. 每个待决 AR 的 `context.you_were` 由 HumanState 记录（离开前最后一个活动文件/PR）。

**验收**
- 恢复到第一次决策的时间（打开收件箱 → 首次按键）中位数 ≤ 90 秒。
- digest 长度 ≤ 1 屏（≤ 25 行）。

## UC-14 两个运行时的请求进同一个收件箱

**主流程**
1. Claude Code 的 `PermissionRequest` 与 LangGraph 的 `interrupt()` 同时产生 AR。
2. 两者在同一收件箱按同一排序规则出现，决议分别通过 `permissionDecision` 与 `Command(resume)` 回流。

**验收**
- 两种 AR 的字段完整度相同（headline、context、options、default、risk 均非空）。
- 决议往返延迟 ≤ 1 秒。

## UC-15 用户撤销自动放行的动作

**主流程**
1. digest 列出"已自动放行：写入 `src/config.ts`（可撤销）"。
2. 用户点 undo，框架用记录的回滚点还原文件，通知执行 Agent 该动作被撤销。
3. Ledger 记 `undone`，`fs.write:src/config.ts` 所在类降级。

**验收**
- undo 后文件内容与回滚点一致。
- Agent 收到撤销通知并在下一步中体现（不重复写入）。

## UC-16 告警洪水：10 分钟内 12 条 AR

**前置**：一个 Agent 遇到环境问题（依赖安装反复失败），10 分钟内产生 12 条 Caution/Advisory AR。

**主流程**
1. 第 10 条到达时 Scheduler 进入 **flood 模式**：已有的与后续的 Advisory/Caution 折叠为单条 flood 项："auth-migrate 在 10 分钟内产生 12 条请求，多数与依赖安装相关"，附展开列表。
2. 期间只有 Warning 单独投递。
3. 折叠项自动附带一个建议动作："暂停该 Agent 并让它先自检"。
4. 随后 10 分钟窗口新增 < 5 条 → 退出 flood 模式，恢复逐条（仍受速率预算约束）。

**验收**
- 收件箱在洪水期间新增 ≤ 1 项（不含 Warning）。
- flood_events 指标 +1，并记录来源 Agent 与主要 batch_key。
- 退出后被折叠的 AR 若仍有效，按正常规则重新投递。

## UC-17 抖动规则被自动转为"修规则"

**前置**：某条 ask 规则（`net.out:*.internal`）在 24 小时内对同一效果、同一目标触发了 3 次 AR，用户每次都批准。

**主流程**
1. 第 3 次触发时 Scheduler 标记 chattering，不再生成第 4 条同类 AR。
2. 生成一条 Advisory："规则 net.out:*.internal 24 小时内触发 3 次且每次批准，建议：升为自动放行 / 保持 / 收紧范围"。
3. 用户选"升为自动放行"→ 写入账本（走 UC-09 的晋升通知流程）。

**验收**
- 第 4 次同类动作不产生逐条 AR。
- chattering_count 指标 +1，用户处理后归零。

## UC-18 低风险但属于品味/目标的决策必须问人

**前置**：Agent 在实现设置页时需要决定"深色模式默认开还是关"。该动作可逆、范围内、P3。

**主流程**
1. 适配器把 `AskUserQuestion` 翻译为 AR，`decision_class=taste`。
2. Policy：尽管风险矩阵给出 ACT，`taste` 轴强制至少 Caution；进收件箱，不允许 Advisory 默认。
3. 若该问题本应在计划期问（`decision_class=goal`，如"要不要做深色模式"）却在执行期出现 → 仍进收件箱，但 spec_gap_rate 指标 +1，并在 EvidencePacket 里标注"计划期遗漏"。

**验收**
- taste/goal 类 AR 从不进入"已替你决定"队列。
- 执行期 goal 类 AR 被计入 spec_gap_rate。

## UC-19 自动放行的命令静默过久 / Agent 卡住

**主流程**
1. 一个被账本自动放行的 `proc.exec:pnpm build` 运行超过 5 分钟无输出。
2. Scheduler 生成 Advisory："pnpm build 已运行 5 分钟无进展"，附"查看输出 / 终止 / 继续等"。
3. 另一场景：Agent 连续 3 次尝试同一步骤失败且无新策略 → 必须进入 needs-attention（Caution），不允许继续猜。

**验收**
- 静默过久 AR 在 5 分钟 ± 10 秒内生成，且不重复（受 chattering 规则约束）。
- Agent 卡住时周边状态变黄并有收件箱条目，而非继续消耗 token。

## UC-20 监督退化被检测并触发审计

**前置**：两周内用户对 Caution 的中位停留时间从 40 秒降到 4 秒，批准率保持 95%，展开 proof 的比例从 30% 降到 5%。

**主流程**
1. Ledger 检出四个退化信号中的三个。
2. 生成一条 Caution（不可被抑制）："过去 14 天你的审查时长下降 90% 而批准率不变，可能在橡皮章。附：最常被秒批的 5 个动作类"。
3. 给出动作：对这 5 类"升为自动放行"（减少无意义审批）或"加入深审抽样"。
4. 随机深审抽样比例从 5% 临时提高到 15%，直到停留时间恢复。

**验收**
- 退化信号任一触发即产生审计 AR。
- 审计 AR 不能被静默或预算压制。
- 处理后 rubber_stamp_rate 在下一周期下降。

