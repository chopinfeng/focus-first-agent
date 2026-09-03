# FFA 测试方案

> 版本 0.2，2026-09-03（v0.2 新增：准入门槛、三级告警、速率/flood/抑制召回/chattering、效果分类、账本 v0.2、模拟器验证）。目标：让"注意力行为"和"安全不变量"像功能正确性一样可回归。测试分四层，核心是第三层的 **模拟人类回放**。

## 0. 原则

1. **注意力行为必须确定性可测**：内核的所有时间依赖（断点、TTL、合并窗口、利用率）通过注入的虚拟时钟驱动，测试不 sleep。
2. **人是被模拟的**：场景测试里的人由 `SimulatedHuman` 扮演，它有状态时间线和回答策略，见 `docs/BENCHMARK.md` 第 3 节。
3. **安全不变量用属性测试**：随机生成事件流，断言 P0 永不自动放行等性质在任何序列下成立。
4. **每个 use case 至少一个场景测试**，`USE-CASES.md` 的验收条款逐条对应断言。

## 1. 测试金字塔

```
          ┌──────────────────────────┐
          │  L4 真人评估（小样本）     │  每阶段末，8–12 人
          ├──────────────────────────┤
          │  L3 场景回放 + 属性测试    │  CI 必跑，覆盖 UC-01…15
          ├──────────────────────────┤
          │  L2 适配器集成            │  用录制的 SDK 事件 fixture
          ├──────────────────────────┤
          │  L1 内核单元              │  表驱动
          └──────────────────────────┘
```

## 2. L1 内核单元测试

### 2.1 AR schema
- 必填字段缺失 → 拒绝（headline、kind、risk、task_id）。
- `headline` > 120 字符 → 拒绝。
- `kind=approval` 且 `risk.level=P0` 且带 `default` → 拒绝（P0 不允许默认放行）。
- `on_expire=apply_default` 但无 `default` → 拒绝。
- `ttl`、`apply_after`、`confirm_delay`、`time_to_irreversible` 为合法 ISO 8601 duration。
- **准入门槛**：`required_action`、`consequence_if_ignored`、`time_to_irreversible` 缺任一项 → 校验通过但 `admissible=false`，只能进 digest。
- `on_expire` 必须是枚举之一；`risk.level=P0` 且 `on_expire ∈ {apply_default, skip_and_continue}` → 拒绝。
- `decision_class ∈ {goal, input, constraint, taste}` 必填；`goal/taste` 且带 `default` → 拒绝。
- `supersedes_id` 指向的 AR 必须存在且未终态。

### 2.2 Policy 决策表（表驱动）
输入：`(risk.level, reversible, scope_in, external_side_effect, trust_state, confidence, human_state)` → 期望：`ACT | ACT+NOTIFY | ASK_DEFER | ASK_NOW | BLOCK`。至少覆盖：

| level | reversible | scope_in | trust | 期望 |
|---|---|---|---|---|
| P3 | true | true | any | ACT |
| P2 | true | true | ask | ACT（可逆优先） |
| P2 | true | false | ask | ACT+NOTIFY |
| P1 | false | true | ask | ASK_DEFER |
| P1 | false | true | auto_allow | ACT（账本放行） |
| P1 | false | false | any | ASK_NOW |
| P0 | any | any | auto_allow | ASK_NOW（账本被硬规则覆盖） |
| any | any | any | deny | BLOCK |
| P3 | true | true | any, decision_class=taste | ASK（Caution，三轴覆盖矩阵） |
| P2 | true | true | any, decision_class=goal | ASK（Caution）+ spec_gap 计数 |
| P1 | false | true | auto_allow, confidence=0.99 | ACT（confidence 不影响 ask/act） |

输出除决策外还断言告警级别与自治模式：`(P0, now) → Warning/consent`；`(P1, now) → Caution/consent`；`(P2, reversible, whenever) → Advisory/exception`。

### 2.2b 效果分类（动作类）
- `rm -rf x && git push --force` → 合成一个动作，effects = {fs.delete, git.push}，取最高风险。
- `echo … | base64 -d | sh`、`bash -c "$(cat run.sh)"` → 归为 `proc.exec:opaque`，默认 ask，不依赖字符串。
- MCP tool `destructiveHint=true` → `reversible=false`；`readOnlyHint=true` → P3。
- 相同命令不同目标路径（`src/**` vs `infra/**`）→ 不同动作类。

评估顺序测试：硬 deny 覆盖账本；硬 ask 覆盖账本；账本覆盖效用；效用覆盖默认。

### 2.3 效用计算
- 固定 `P(need)`、`Cost(wrong)`，改变 `human_state`：FOCUS 下 defer，BREAKPOINT 下 surface。
- `Cost(interrupt|FOCUS)` 参数可配置，默认 12 分钟；断言阈值处的边界行为。

### 2.4 Scheduler
- **断点延迟**：AR(urgency=soon) 在 FOCUS 到达 → 队列；注入 `breakpoint(commit)` 事件 → ≤ 1 tick 投递。
- **合并**：同 `batch_key` 在 2 秒窗口内 N 条 → 1 个 AR，`children.length == N`；窗口外 → 新 AR。
- **静默**：`focus(45m)` 期间只投递 P0/P1 now。
- **渠道选择**：状态 × urgency → 渠道，表驱动。
- **升级阶梯**：AR 在渠道 k 等待超过 `wait_k` → 渠道 k+1；已 resolved 的不升级。
- **TTL**：到期执行 `on_expire` 三种分支；到期后收件箱不再含该项。
- **并发闸门**：利用率 > 70% 暂停派发，< 60% 恢复（滞回）；待处理线程 > 4 暂停派发。
- **确认延迟**：AR 在 `confirm_delay` 内收到 `resolved_by_agent` → 撤回，不投递、不计预算。
- **断点三粒度**：Advisory 在 fine 断点不投递、coarse 投递；Caution-soon 在 medium 投递。
- **Flood**：10 分钟内第 10 条 → 折叠；期间 Warning 单独投递；窗口新增 < 5 退出；退出后仍有效的 AR 重新投递。
- **Standing 上限**：未处理 = 10 时新 Advisory 只进 digest。
- **抑制与召回**：focus 期间 Advisory/Caution-soon 进入 suppressed 集合而非 digest；退出后 ≤ 10 秒重现；过期的按 `on_expire`；白名单项不抑制；Warning 不抑制。
- **Chattering**：同 (batch_key, effects) 24h 第 3 次 → 不生成第 3 条，生成"修规则"AR；第 4 次仍不生成。
- **Cooldown**：同 agent 同 risk 无 key 的 AR 在 5 分钟内合并。
- **静默过久**：auto_allow 动作无输出 5 分钟 → Advisory；受 chattering 约束不重复。
- **Ack / snooze**：ack 后升级阶梯停止；snooze 后同 key 新 Warning 仍投递。

### 2.5 Budget
- 任务预算 2：第 3 个 question 降级为 assumption 并进 digest。
- 日预算 5：第 6 个非 now 上浮进 digest。
- P0/P1 now 不消耗也不受预算限制。
- **速率预算**：10 分钟窗口第 2 条 Advisory → digest；1 小时窗口第 7 条 → digest；软阈 80% 时 Advisory 降级、硬阈 100% 时只放行 Warning/Caution；双窗口任一触发即生效。

### 2.6 Trust ledger 状态机
- 10 次 approve、0 undo → `auto_allow`；第 10 次前任何 reject/undo → 计数清零。
- P0 类：任何序列都不可达 `auto_allow`（属性测试）。
- `reset` 把所有类回到 `ask`。
- **证据计数**：10 次 approve 但 0 次 verifier 通过 → 不晋升；10 次 verifier 通过 + 可撤销 + 未 undo → 晋升候选。
- **不对称**：晋升后 1 次 undo/override/verifier 失败 → 降两级并重置。
- **双向监测**：晋升后该类打断率或回滚率高于晋升前基线 → 自动降级并生成通知。
- **晋升通知**：晋升生成 Advisory；撤回后立即回到 ask。
- **拒绝原因**：reject 无原因 → 拒绝提交；原因写入规则表。
- **治理**：阈值修改无 `actor` 字段 → 拒绝；`actor` 为 agent → 拒绝。
- **反橡皮章**：停留 < 3s 计入 rubber_stamp；5% Caution 标 deep_review，未展开 proof 不能批准；退化信号（任一）→ 生成审计 AR，且该 AR 不可抑制。

### 2.7 HumanState
- 输入信号序列（键鼠活跃、前台应用、日历、显式 focus）→ 状态转移；断言迟滞（不在 FOCUS/IDLE 间抖动）。
- 断点识别：commit、测试结束、窗口失焦 ≥ 30 秒、打开收件箱。

## 3. L2 适配器集成测试

用录制的真实 SDK 事件作为 fixture（JSON），断言"事件 → AR → 决议 → 运行时调用"往返。

| 适配器 | Fixture | 断言 |
|---|---|---|
| Claude Code hooks | `PreToolUse(Bash rm)`, `PermissionRequest(Write)`, `Notification(idle_prompt)`, `Stop` | AR 字段完整；决议输出合法 hook JSON（`permissionDecision`、追加规则） |
| Claude Agent SDK | `canUseTool` 调用 | 返回 allow/deny + `updatedInput` |
| LangGraph | `HITLRequest{action_requests, review_configs}` | `allowed_decisions` 映射到 options；决议生成 `Command(resume={decisions:[…]})` |
| OpenAI Agents SDK | `RunResult.interruptions` 序列化 | `RunState.approve/reject` 调用正确的 item |
| MCP | `elicitation` form 请求；tool 带 `destructiveHint` | form → options；`destructiveHint=true` → `reversible=false` |
| A2A | task `input-required` | question AR；决议追加 message |

持久化：内核重启后未决 AR 及其 TTL 计时恢复（写入 SQLite，重启回放）。

## 4. L3 场景回放与属性测试

### 4.1 Trace 格式
一次场景 = 三条时间线的合并，全部用虚拟时钟：
```yaml
trace: uc-02-irreversible-in-focus
clock: virtual
agent_events:                       # 来自运行时或录制
  - t: 0s    kind: tool_call  tool: Bash  cmd: "rm db/migrations/2023_*.sql"  meta: {destructive: true}
  - t: 1s    kind: tool_call  tool: Write path: src/auth/token.ts
human_timeline:                     # 模拟人类状态
  - t: 0s    state: FOCUS
  - t: 8m    event: test_finished   # 断点
  - t: 8m5s  state: BREAKPOINT
human_policy: default_dev           # 回答策略，见 BENCHMARK.md
expect:
  inbox_additions_during: {from: 0s, to: 8m, count: 0}
  delivered_within: {after_event: test_finished, seconds: 5}
  agent_tool_calls_while_pending: ">0"
  terminal_state: acted
```

### 4.2 场景清单
`USE-CASES.md` 的 15 个 use case 各一条主流程 trace，加分支：
- UC-02a（30 分钟持续 FOCUS → apply_after 生效）、UC-02b（TTL 到期）
- UC-05 × 3（预算耗尽 / focus 中 / AWAY 时 P0 仍穿透）
- UC-08 × 3（P3 自动合并 / P1 进收件箱 / P0 now）
- UC-10（3 轮失败后 escalation）
- UC-04a（goal/taste 类不允许 Advisory）
- UC-09 × 3（证据不足不晋升 / undo 降级 / 双向监测降级）
- UC-12（抑制召回 + 白名单 + 过期）
- UC-16 / 17 / 18 / 19 / 20 各一条

### 4.3 属性测试（随机事件流）
生成器：随机 AR 序列（kind、risk、reversible、urgency、batch_key、ttl）× 随机人类状态时间线 × 随机回答策略。对每条随机 trace 断言：

| 不变量 | 断言 |
|---|---|
| INV-1 P0 不自动放行 | 任何 P0 AR 的终态 ∈ {acted, rejected, blocked}，从不 `auto_applied` |
| INV-2 不无限等待 | 每个 AR 在 `ttl` 内到达终态 |
| INV-3 终态唯一 | 每个 AR 恰好一个终态事件 |
| INV-4 FOCUS 静默 | FOCUS 期间投递的 AR 满足 `urgency=now ∧ level≤P1` |
| INV-5 预算上界 | 非 now 上浮数 ≤ 预算 |
| INV-6 合并幂等 | 合并前后动作集合相同 |
| INV-7 撤销可逆 | ACT 且 reversible 的动作 undo 后状态等于回滚点 |
| INV-8 账本单调 | P0 类永不进入 auto_allow |
| INV-9 跨渠道一致 | AR 在一处 resolved 后所有渠道状态一致 |
| INV-10 不可逆不进 digest | `reversible=false` 的 AR 终态从不为 `digested` 或 `auto_applied` |
| INV-11 抑制必重现 | 被 suppressed 的 AR 在 focus 结束后要么投递、要么按 `on_expire` 终态，从不丢失 |
| INV-12 P0 过期不放行 | P0 的 `on_expire ∈ {escalate, end_task}` 且终态从不为 `auto_applied` |
| INV-13 goal/taste 必问 | `decision_class ∈ {goal, taste}` 的 AR 从不进入"已替你决定"队列 |
| INV-14 速率上界 | 任意 10 分钟窗口内投递到收件箱的 Advisory ≤ 1，任意 1 小时 ≤ 6（Warning/Caution 除外） |
| INV-15 flood 单条 | flood 模式期间收件箱新增非 Warning 项 ≤ 1 |
| INV-16 审计不可压 | 退化审计 AR 不受预算、抑制、flood 影响 |
| INV-17 账本单向 P0 | 与 INV-8 合并：P0 与 `effects ∋ money/message.out` 永不 auto_allow |

### 4.4 Golden 文件
- EvidencePacket 渲染（markdown / 终端 / 手机推送三种）。
- Digest 渲染，断言 ≤ 25 行。
- 推送正文格式（headline + 默认项 + TTL + deep link）。
- "已替你决定"队列渲染（每条含 `why_not_asked` 与 undo）。
- 自治面板（速率仪表、分布、已抑制计数）。

## 5. L4 真人评估

每个阶段末做一次小样本被试内实验，与 benchmark 的真人协议共用（见 `BENCHMARK.md` 第 6 节）。CI 不跑。

### 5.1 SimulatedHuman 验证（v0.2 新增，借鉴 Collaborative Gym）
模拟人本身是被测对象。每次修改模拟人参数或策略后：
- 抽 100 条模拟轨迹由 2 名标注者评 accuracy / consistency / plausibility，目标各 ≥ 90%。
- 真人轨迹与模拟轨迹成对呈现，让第三人判断哪条是真人，目标区分准确率 ≤ 60%（接近随机）。
- 真人与模拟条件下的失败类型分布（Co-Gym 五类）Spearman 相关 ≥ 0.7。
- 未通过则 benchmark 结果标注"模拟器未验证"。

## 6. 覆盖率与门禁

- L1 行覆盖 ≥ 90%，Policy 决策表分支覆盖 100%。
- L3 所有 INV 在 1,000 条随机 trace 上通过才能合并。
- 任何改动使 `p0_auto_pass > 0`、`INV-2`、`INV-10`、`INV-12`、`INV-13` 失败 → 阻断发布。
- `priority_distribution` 在 smoke 集上 Warning 占比 > 10% → 警告（后果分析不足）。

## 7. 建议目录结构

```
ffa/
  kernel/         policy.py scheduler.py budget.py timeout.py ledger.py humanstate.py
  schema/         attention_request.json evidence_packet.json task_card.json
  adapters/       claude_code/ langgraph/ openai_agents/ mcp/ a2a/
  surfaces/       inbox_cli/ digest/ channels/
tests/
  unit/           test_policy_table.py test_scheduler.py …
  integration/    fixtures/<adapter>/*.json  test_<adapter>.py
  scenarios/      traces/uc-01.yaml … uc-15b.yaml  test_replay.py
  properties/     test_invariants.py
  golden/         evidence_packet/*.md digest/*.txt
bench/            见 BENCHMARK.md
```
