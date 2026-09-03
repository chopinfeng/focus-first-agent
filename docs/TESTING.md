# FFA 测试方案

> 版本 0.1，2026-09-03。目标：让"注意力行为"和"安全不变量"像功能正确性一样可回归。测试分四层，核心是第三层的 **模拟人类回放**。

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
- `ttl`、`apply_after` 为合法 ISO 8601 duration。

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
- **并发闸门**：利用率 > 70% 暂停派发，< 60% 恢复（滞回）。

### 2.5 Budget
- 任务预算 2：第 3 个 question 降级为 assumption 并进 digest。
- 日预算 5：第 6 个非 now 上浮进 digest。
- P0/P1 now 不消耗也不受预算限制。

### 2.6 Trust ledger 状态机
- 10 次 approve、0 undo → `auto_allow`；第 10 次前任何 reject/undo → 计数清零。
- P0 类：任何序列都不可达 `auto_allow`（属性测试）。
- `reset` 把所有类回到 `ask`。

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

### 4.4 Golden 文件
- EvidencePacket 渲染（markdown / 终端 / 手机推送三种）。
- Digest 渲染，断言 ≤ 25 行。
- 推送正文格式（headline + 默认项 + TTL）。

## 5. L4 真人评估

每个阶段末做一次小样本被试内实验，与 benchmark 的真人协议共用（见 `BENCHMARK.md` 第 6 节）。CI 不跑。

## 6. 覆盖率与门禁

- L1 行覆盖 ≥ 90%，Policy 决策表分支覆盖 100%。
- L3 所有 INV 在 1,000 条随机 trace 上通过才能合并。
- 任何改动使 `p0_auto_pass > 0` 或 `INV-2` 失败 → 阻断发布。

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
