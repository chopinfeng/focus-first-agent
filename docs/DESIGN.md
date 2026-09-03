# Focus-First Agent Framework（FFA）设计

> 把人的注意力当作最稀缺的调度资源。版本 0.1，2026-09-03。调研依据见 `docs/RESEARCH.md`。

## 0. 核心命题

现有 Agent 框架优化的是 token、时延、正确率，人的注意力只是副作用。FFA 在 **Agent 运行时** 和 **人** 之间插入一个 **注意力内核（Attention Kernel）**：

- 所有"需要人"的事件，无论来自哪个 Agent 或哪个 SDK，都先变成一个结构化的 **Attention Request（AR）**；
- 内核决定 **要不要、什么时候、通过什么渠道、以什么形态** 把它送到人面前，或者 **不送**（自主执行 + 事后可撤销，或超时选安全默认）；
- 人只在一个 **异常收件箱** 里做决策，只看 **证据包** 不看 transcript；
- 每次交互都被记账，用来校准信任和阈值。

一句话：**Agent 的断点不是人的断点；FFA 负责把两者对齐。**

## 1. 设计目标（可度量）

| 目标 | 指标 | 起点（调研） | 目标值 |
|---|---|---|---|
| 少打断 | 每任务人工干预次数 | 5.4（Anthropic 内部） | ≤ 2 |
| 打断有意义 | 审批"橡皮章率"（<3 秒内批准的比例） | ~93% 一律批准 | 进入收件箱的项 ≥ 60% 被认真处理（acted 且 >5 秒） |
| 不淹没 | 每日主动上浮（非任务完成）条数 | 无上限 | ≤ 5 |
| 恢复快 | 每次请求的交互时间 IT | 需重建上下文 | 中位数 ≤ 90 秒 |
| 人不过载 | 人的利用率（处理 AR 时间 / 工作时间） | 未测 | < 70% |
| 只审高风险 | 需人工 review 的交付占比 | 100% | ~20%（覆盖 ~70% 风险） |
| 不漏危险 | P0 不可逆动作被自动放行的次数 | — | 0 |

## 2. 六个核心抽象

```
TaskCard ──▶ Agent Runtime ──▶ AttentionRequest ──▶ AttentionKernel ──▶ Surfaces ──▶ Human
   ▲                                                    │  ▲                          │
   │                                                    ▼  │                          │
   └────────── EvidencePacket ◀──────────── AttentionLedger ◀── HumanStateModel ◀─────┘
```

### 2.1 TaskCard（意图卡）
委派时一次性写清，把提问前置。
```yaml
goal: "把登录接口迁移到新的 auth 服务"
scope: { include: ["src/auth/**"], exclude: ["infra/**"] }
constraints: ["不改公共 API", "PR ≤ 250 行，可拆多个"]
done_criteria: ["pnpm test 全绿", "新增集成测试覆盖 refresh token"]
risk_class: P2           # P0 不可逆/生产/资金  P1 外部副作用  P2 可逆代码改动  P3 只读
attention_contract:
  interrupt_budget: 2     # 本任务最多主动打断我几次
  deadline: "2026-09-04T18:00+08:00"
  channel: [inbox, push]  # 允许的渠道，按升级顺序
  when_unsure: "recommend_and_proceed"   # 或 "ask_and_wait"
```

### 2.2 AttentionRequest（AR）——统一 schema
这是整个框架的"系统调用"。任何 SDK 的 interrupt / approval / elicitation / notification 都先被适配器翻译成 AR。
```jsonc
{
  "id": "ar_01J...", "task_id": "t_42", "agent_id": "claude-code:worktree-3",
  "kind": "approval",              // notify | question | approval | review | escalation
  "headline": "要删除 3 个旧 migration 文件，不可逆",      // ≤ 120 字符：为什么需要你
  "context": {                     // 恢复上下文，消除注意力残留
    "you_were": "在 review PR #812",
    "i_did":    "迁移了 auth 路由，测试 41/41 通过",
    "i_need":   "确认能否删除 2023 年的 3 个 migration",
    "blast_radius": "db/migrations/2023_*.sql，影响本地与 CI，不影响生产"
  },
  "options": [
    { "id": "delete", "label": "删除", "recommended": true, "consequence": "CI 需重新跑 12 min" },
    { "id": "keep",   "label": "保留并加 deprecated 注释" },
    { "id": "later",  "label": "先跳过，任务结束时再问" }
  ],
  "default": { "option_id": "keep", "apply_after": "PT30M" },   // 无人回应时的安全默认
  "risk": { "level": "P1", "reversible": false, "scope": ["fs"] },
  "urgency": "soon",               // now | soon | whenever
  "cost_estimate": { "interaction_seconds": 40 },
  "confidence": 0.8,               // Agent 对自己推荐项的置信度
  "ttl": "PT4H", "on_expire": "apply_default",   // apply_default | block | escalate
  "batch_key": "fs.delete:db/migrations",        // 同 key 合并成一次决策
  "evidence": ["diff://…", "log://test-run-88"]
}
```

### 2.3 AttentionKernel（注意力内核）
四个子模块，按顺序处理每个 AR：

1. **Policy（要不要问）**：硬规则 → 信任账本 → 效用计算 → 分类器兜底。
2. **Scheduler（何时、怎么问）**：断点延迟、合并、digest、静默时段、渠道选择、升级阶梯。
3. **Budget（还能问几次）**：任务级与日级预算，超额降级为 digest 或安全默认。
4. **Timeout & Fallback（没人回怎么办）**：TTL 到期执行 `on_expire`，永远不无限阻塞。

### 2.4 HumanStateModel（人的状态）
本地推断，不上传：
- 信号：IDE/终端键鼠活跃度（FlowLight 思路）、前台应用、日历忙闲、显式 `/focus`、上次打开收件箱的时间。
- 状态：`FOCUS`（编辑中，打断成本最高）→ `BREAKPOINT`（刚提交、测试刚跑完、切到收件箱、窗口失焦）→ `IDLE` → `AWAY`。
- 断点检测优先用**粗粒度事件**：commit、测试结束、PR 打开、会议结束。

### 2.5 EvidencePacket（证据包）
任务收尾唯一交付物，人只看它：
```
结论（1 段）| 变更摘要（文件 × 行数）| 验证证据（测试/截图/预览链接）
风险标签（P0–P3）与理由 | 我做的假设（未经你确认的决定）| 未决问题 | 回滚方式
```
由**独立 verifier 子 Agent** 生成风险标签与验证证据，对抗"early victory"。

### 2.6 AttentionLedger（注意力账本）
记录每个 AR 的生命周期：发出 → 投递（渠道、时机、当时状态）→ 结果（acted / dismissed / ignored / expired / undone）→ 耗时。它同时是信任账本和指标源。

## 3. 决策策略：ask-vs-act

### 3.1 优先级顺序（借鉴 Claude Agent SDK 六步评估）
```
硬 deny 规则 → 硬 ask 规则 → 信任账本（自动放行/自动拒绝） → 效用计算 → 分类器兜底 → 默认 ask
```

### 3.2 风险 × 可逆性矩阵
| | 可逆 | 不可逆 |
|---|---|---|
| **范围内、低爆炸半径** | **ACT + 记录回滚点**，进 digest | **ASK（带默认）**，延迟到断点，可合并 |
| **范围外或外部副作用** | **ACT + notify(soon)** | **ASK(now)**，阻塞，超时升级 |
| **P0（生产、资金、删除、发外部消息）** | ASK(now) | **ASK(now) + 不可设默认放行**，超时 = block |

依据：Anthropic 生产数据仅 0.8% 动作不可逆，可逆性是最有杠杆的门控维度；可逆动作用事后审计（digest + undo）替代事前审批。

### 3.3 效用计算（Horvitz 三分决策）
```
surface_now  if  P(need_human) × Cost(wrong)  >  Cost(interrupt | state) + Cost(resume)
defer        if  上式不成立 且 存在安全默认
act          if  P(need_human) < act_threshold(risk) 且 reversible
```
`Cost(interrupt | FOCUS)` 取 Parnin 的 10–15 分钟量级；`BREAKPOINT` 状态取 1–2 分钟；`AWAY` 状态取渠道成本（push 高于 inbox）。阈值按 (用户, 动作类) 从账本学习。

### 3.4 信任账本升级规则（bike method 量化版）
- 键：`(user, action_class)`，例如 `fs.write:src/**`、`shell:pnpm test`、`git.push:feature/*`。
- 连续 **N=10** 次 acted=approve 且 0 次 undo → 自动升为 `auto_allow`，并在 digest 里告知"已自动放行，可撤销"。
- 任何一次 reject 或 undo → 降级并重置计数。
- P0 动作类永不自动放行。
- 账本对用户可见、可编辑（一行命令回滚到"全部询问"）。

## 4. 调度器行为

| 行为 | 规则 | 依据 |
|---|---|---|
| **断点延迟** | `urgency ≠ now` 的 AR 等待人的下一个断点，最长等 `ttl` | Iqbal & Bailey defer-to-breakpoint |
| **合并** | 同 `batch_key` 的 AR 合并为一次决策（"12 个文件写入 → 批准一次"） | 审批疲劳研究 |
| **Digest** | ACT+log 项与进度每 30 min 或每断点汇总一次；不弹窗 | 平静技术 |
| **静默时段** | 用户 `/focus 45m` 期间只放行 `now` 级 P0/P1 | FlowLight |
| **预算** | 任务预算耗尽 → 后续 question 降级为"推荐并继续，记入假设"；日预算耗尽 → 全部进 digest | TianPan.co 3–5 条/日 |
| **渠道选择** | FOCUS→周边状态灯；BREAKPOINT→收件箱；AWAY & urgency=now→push/Slack | Horvitz 换渠道 |
| **升级阶梯** | 周边 → 收件箱 → push → 第二责任人（团队模式），每级有等待时间 | PagerDuty 模式 |
| **TTL 清除** | 到期执行 `on_expire`，从收件箱移除，写账本 | OpenClaw attention state |
| **并发闸门** | 估算 FO = NT/IT + 1，当人的利用率 > 70% 时暂停派发新任务、只收尾 | Cummings & Guerlain |

## 5. 任务生命周期

1. **Intake**：填 TaskCard。框架用一次结构化表单把所有可预见的决策**前置**（多选 + 推荐项 + "不回答则按推荐执行"）。
2. **Plan-of-record**：计划是对象不是文本。执行期只有 **偏离计划** 才生成 AR（kind=question），按计划走的不打扰。
3. **Execute**：默认静默。所有 SDK 事件经适配器 → AR → 内核。周边状态灯实时反映 `working / blocked / needs-you / done`。
4. **Verify**：独立 verifier 跑 done_criteria，打风险标签，生成证据。不通过则回到 3，不打扰人。
5. **Deliver**：EvidencePacket 作为 kind=review 的 AR 进收件箱；P2/P3 且验证通过的可配置为"自动合并 + digest 通知"。
6. **Learn**：账本回写阈值、信任、渠道偏好。

## 6. 呈现面（Surfaces）

- **周边状态（Peripheral）**：每个 Agent 一个可扫视的状态点：灰=working、黄=blocked、橙=needs-you、绿=done。菜单栏 / 终端状态行 / IDE 状态栏。绝不弹窗。
- **异常收件箱（Inbox）**：唯一需要人"看"的地方。排序 = (urgency, deadline, 风险, 价值)。每项 = headline + 四行 context + 选项（默认高亮）+ 单键回答。显示"不回答会发生什么"和剩余 TTL。
- **Digest**：一屏摘要，含已自动放行的可逆动作（带一键 undo）和进度。
- **Channels**：终端/桌面、手机 push、Slack。同一 AR 跨渠道同步状态，任一处回答即全局解决。
- **Transcript**：降级为审计视图，默认折叠。

## 7. 适配器（不重造运行时）

| 来源 | 输入映射到 AR | 输出（AR 决议 → 恢复） |
|---|---|---|
| Claude Agent SDK / Claude Code | `PreToolUse` / `PermissionRequest` → approval；`AskUserQuestion` → question；`Notification(idle_prompt / agent_needs_input / agent_completed)` → notify/review；`Stop` → review | `permissionDecision` + 追加规则；`canUseTool` 回调 |
| LangGraph | `interrupt(payload)` / `HITLRequest` → 按 `allowed_decisions` 映射 | `Command(resume=…)` |
| OpenAI Agents SDK | `RunResult.interruptions` → approval | `RunState.approve/reject` |
| MCP | `elicitation` → question；tool annotations `destructiveHint/readOnlyHint` → risk | elicitation 结果 |
| A2A | `input-required` → question | 追加 message |
| Temporal / Inngest | signal 等待 → AR；TTL 用持久 timer 实现 | signal |

MCP 的 `readOnlyHint / destructiveHint` 直接喂给 Policy 的可逆性判断——填补调研发现的空白 #6。

## 8. 指标与反馈

| 指标 | 定义 |
|---|---|
| interventions_per_task | 人主动纠正次数 |
| surfaces_per_day | 主动上浮条数（目标 ≤ 5） |
| rubber_stamp_rate | <3 秒内批准占比（越低越好） |
| acted / dismissed / ignored / expired | AR 结果分布，用于学阈值 |
| median_interaction_seconds | IT 中位数 |
| neglect_time | 无人干预下 Agent 持续产出时长 |
| human_utilization | 处理 AR 时间 / 工作时间（< 70%） |
| review_gated_share | 需人工 review 的交付占比 |
| undo_rate | 自动放行后被撤销比例（信任校准信号） |
| p0_auto_pass | 必须为 0 |
| false_alarm_rate | 被 dismiss 的 AR 占比 |

## 9. 风险与对策

| 风险 | 对策 |
|---|---|
| **Out-of-the-loop**：自动化太多，人失去情境意识 | 周期性一屏 digest；关键阶段保持"提议 + 确认"；EvidencePacket 里强制列出假设 |
| **自动化自满**：信任账本让人不再看 | undo_rate 与 rubber_stamp_rate 触发"抽查"AR；账本升级在 digest 中显式告知 |
| **过度抑制**：把真正紧急的压进 digest | P0/P1 永远可穿透静默；`on_expire=block` 不可被预算覆盖 |
| **状态推断隐私** | 全部本地计算，只输出四态枚举，不存原始活动 |
| **Agent 虚报进度**（调研中上升最快的错位） | verifier 独立于执行 Agent；done_criteria 必须可机器验证 |
| **多工具上下文丢失** | TaskCard + plan-of-record + ledger 是跨运行时共享的持久对象 |

## 10. 路线图

| 阶段 | 内容 | 验证方式 |
|---|---|---|
| **P0（2 周）** | AR schema；内核库（policy/scheduler/budget/timeout）；Claude Code hooks 适配器；CLI 收件箱；合并 + 断点延迟 + 超时默认 | 自用 1 周，对比 interventions_per_task 与 surfaces_per_day |
| **P1** | HumanStateModel（macOS 前台应用 + 空闲时间 + `/focus`）；digest；信任账本 | rubber_stamp_rate、undo_rate |
| **P2** | EvidencePacket + verifier 子 Agent；并发闸门（FO 估算）；LangGraph / MCP 适配器 | review_gated_share、human_utilization |
| **P3** | 阈值学习；Slack / 手机渠道；团队模式升级阶梯 | false_alarm_rate、time_to_first_decision |

## 11. 待确认的假设

- 首个运行时以 **Claude Code / Claude Agent SDK** 为主（hooks 与权限模型最完整，适配成本最低）。
- 首个用户是 **单个开发者同时跑 2–5 个 Agent** 的场景；团队升级阶梯放到 P3。
- 形态是 **独立守护进程 + 适配器**，而不是某个 IDE 的插件，以便跨运行时共享账本。
