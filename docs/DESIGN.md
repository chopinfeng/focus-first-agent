# Focus-First Agent Framework（FFA）设计

> 把人的注意力当作最稀缺的调度资源。**版本 0.2，2026-09-03。** 相对 v0.1 的改动与证据见 `docs/CHANGELOG-v0.2.md`；调研依据见 `docs/RESEARCH.md` 与 `docs/research/`。

## 0. 核心命题

现有 Agent 框架优化 token、时延、正确率，人的注意力只是副作用。FFA 在 **Agent 运行时** 和 **人** 之间插入一个 **注意力内核（Attention Kernel）**：

- 所有"需要人"的事件，无论来自哪个 Agent 或 SDK，都先变成一个结构化的 **Attention Request（AR）**，且必须通过准入门槛；
- 内核用确定性策略决定 **要不要、什么时候、经什么渠道、以什么形态** 送到人面前，或者 **不送**（自主执行 + 事后可撤销，或 Advisory 级超时按默认执行）；
- 人只在一个 **异常收件箱** 里做决策，只看 **证据包** 不看 transcript；
- 每次交互都记账，用证据而非批准次数校准信任，并监测监督是否退化。

一句话：**Agent 的断点不是人的断点；FFA 负责把两者对齐，并且像告警工程那样治理打断的速率与分布。**

## 1. 设计目标（可度量）

| 目标 | 指标 | 起点（调研） | 目标值 |
|---|---|---|---|
| 少打断 | 每任务人工干预次数 | 5.4（Anthropic 内部） | ≤ 2 |
| 打断有节奏 | 上浮速率 | 无上限 | 稳态 ≤ 1 / 10 min，≤ 6 / h |
| 打断有意义 | 橡皮章率（< 3 秒批准占比） | ≈ 93% 一律批准 | < 50%（SRE signal-to-noise 线） |
| 升级率合理 | 进入人工决策的动作占比 | 100% 或 0% | 10–15% |
| 分布健康 | Warning / Caution / Advisory 占比 | 无 | ≈ 5 / 15 / 80 |
| 恢复快 | 每次请求交互时间 IT 中位数 | 需重建上下文 | ≤ 90 秒 |
| 人不过载 | 人的利用率；待处理线程数 | 未测 | < 70%；≤ 4 |
| 只审高风险 | 需人工 review 的交付占比 | 100% | ≈ 20% |
| 不失去理解 | 架构级变更"理解签字"覆盖率 | 0 | 100% |
| 不漏危险 | Warning 被自动放行的次数；陷阱阻止率 | 人漏 1/3 | 0；100% |

## 2. 六个核心抽象

```
TaskCard ──▶ Agent Runtime ──▶ AttentionRequest ──▶ AttentionKernel ──▶ Surfaces ──▶ Human
   ▲                                                    │  ▲                          │
   │                                                    ▼  │                          │
   └────────── EvidencePacket ◀──────────── AttentionLedger ◀── HumanStateModel ◀─────┘
```

### 2.1 TaskCard（意图卡）
委派时一次性写清，把提问前置。Intake 阶段有强制的 plan/interview 门：所有 **goal 类** 决策必须在这里问完。
```yaml
goal: "把登录接口迁移到新的 auth 服务"
scope: { include: ["src/auth/**"], exclude: ["infra/**"] }
constraints: ["不改公共 API", "PR ≤ 250 行，可拆多个"]
done_criteria: ["pnpm test 全绿", "新增集成测试覆盖 refresh token"]
risk_class: P2           # P0 不可逆/生产/资金  P1 外部副作用  P2 可逆代码改动  P3 只读
attention_contract:
  rate_limit: { per_10min: 1, per_hour: 6 }   # 本任务允许的 Advisory/Caution 上浮速率
  deadline: "2026-09-04T18:00+08:00"
  channels: [inbox, push]                     # 允许的渠道，按升级顺序
  when_unsure: "recommend_and_proceed"        # 或 "ask_and_wait"；对 goal/taste 类无效，必问
```

### 2.2 AttentionRequest（AR）——统一 schema
框架的"系统调用"。任何 SDK 的 interrupt / approval / elicitation / notification 都先被适配器翻译成 AR。**准入门槛**：`required_action`、`consequence_if_ignored`、`time_to_irreversible` 三项缺一，就只能进 digest，不能成为收件箱条目。
```jsonc
{
  "id": "ar_01J…", "task_id": "t_42", "agent_id": "claude-code:worktree-3",
  "supersedes_id": null,           // 重试/更新时指向原 AR，复用同一收件箱条目
  "kind": "approval",              // notify | question | approval | review | escalation
  "decision_class": "input",       // goal | input | constraint | taste；goal/taste 无视风险必问人
  "headline": "要删除 3 个旧 migration 文件，不可逆",   // ≤ 120 字符，描述对人的影响（症状），不写原因
  "required_action": "选择删除或保留",                 // 准入必填：人要做什么
  "consequence_if_ignored": "30 分钟后按保留处理，CI 多跑 12 分钟",  // 准入必填
  "time_to_irreversible": "PT30M", // 准入必填：多久后失去选择权
  "point_of_no_return": "step-5",  // input 类：晚于此步再问已无价值
  "context": {                     // 首屏 4 行，消除注意力残留
    "you_were": "在 review PR #812",
    "i_did":    "迁移了 auth 路由，测试 41/41 通过",
    "i_need":   "确认能否删除 2023 年的 3 个 migration",
    "blast_radius": "db/migrations/2023_*.sql，影响本地与 CI，不影响生产"
  },
  "why_now": "下一步的 schema 变更依赖此决定",
  "proof": [                       // 可展开的可验证证据；信心≠准确率
    { "type": "test_log", "ref": "log://test-run-88", "summary": "41/41 passed" },
    { "type": "diff",     "ref": "diff://…", "summary": "6 files +212 −40" }
  ],
  "what_would_prove_me_wrong": "若任何环境仍引用 2023 schema 版本号",
  "options": [
    { "id": "delete", "label": "删除", "recommended": true, "consequence": "CI 需重新跑 12 min" },
    { "id": "keep",   "label": "保留并加 deprecated 注释" },
    { "id": "later",  "label": "先跳过，任务结束时再问" }
  ],
  "default": { "option_id": "keep", "apply_after": "PT30M" },   // 仅 Advisory 级允许
  "risk": { "level": "P1", "reversible": false, "effects": ["fs.delete"] },  // effects 按效果分类，非命令字符串
  "urgency": "soon",               // now | soon | whenever
  "confirm_delay": "PT60S",        // 发出前等待，期间自愈则撤回
  "cost_estimate": { "interaction_seconds": 40 },
  "confidence": 0.8,               // 只影响推荐项排序，不影响 ask/act
  "ttl": "PT4H",
  "on_expire": "apply_default",    // 强制枚举：apply_default | skip_and_continue | end_task | escalate；P0 仅后两者
  "batch_key": "fs.delete:db/migrations",
  "deep_link": "ffa://task/t_42/ar/ar_01J…",
  "delivery": { "state": "displayed", "channel": "inbox", "at": "…" }   // sent | delivered | displayed | responded
}
```

### 2.3 AttentionKernel（注意力内核）
四个子模块，按顺序处理每个 AR：

1. **Policy（要不要问、以什么级别）**：准入门槛 → 硬规则 → 决策类别 → 信任账本 → 效用计算 → 分类器兜底。输出告警级别 Warning / Caution / Advisory 与自治模式 consent / exception。
2. **Scheduler（何时、怎么问）**：confirm_delay、断点延迟（三粒度）、合并与冷却、flood 模式、阶段抑制与召回、chattering 检测、渠道选择、升级阶梯。
3. **Budget（还能问几次）**：速率型滚动窗口 + 线程数上限 + 软/硬阈值。
4. **Timeout & Fallback（没人回怎么办）**：TTL 到期按 `on_expire` 执行，Advisory 的自动决策进"已替你决定"审计队列；永远不无限阻塞。

### 2.4 HumanStateModel（人的状态）
**默认 pull 与自报，推断是 opt-in。**
- 一级信号（默认开启）：显式 `/focus`、日历 focus block 与会议、上次打开收件箱的时间、正在查看的任务。
- 二级信号（opt-in）：IDE/终端键鼠活跃度、前台应用。本地计算，只输出枚举。
- 状态：`FOCUS` → `BREAKPOINT(fine | medium | coarse)` → `IDLE` → `AWAY`。粗断点（commit、测试结束、PR 打开、会议结束、打开收件箱）成本最低；Advisory 只在 coarse 断点投递，Caution 可用 medium。

### 2.5 EvidencePacket（证据包）
任务收尾唯一交付物。**首屏不是 diff。**
```
首屏：意图/spec 差异（做了什么、没做什么、为什么）| verifier 结论与该 agent 该动作类的历史通过率
      | 什么能证明我错了 | 风险标签（P0–P3）与理由 | 回滚方式
展开：变更摘要（文件 × 行数）| 测试/截图/预览 | 我做的假设（未经确认的决定）| 未决问题 | diff
```
由**独立 verifier 子 Agent** 生成风险标签与验证证据。架构级变更（新依赖、公共 API、数据模型）需要人的**理解签字**，其余不需要。

### 2.6 AttentionLedger（注意力账本）
记录每个 AR 的生命周期：发出 → 投递（渠道、时机、当时状态、投递四态）→ 结果（acted / dismissed / ignored / expired / undone / overridden）→ 停留时长。同时是信任账本、监督退化监测器和指标源。

## 3. 决策策略：ask-vs-act

### 3.1 评估顺序
```
准入门槛 → 硬 deny → 硬 ask → decision_class（goal/taste 必问） → 信任账本（auto_allow / auto_deny）
        → 效用计算 → 分类器兜底 → 默认 ask
```
Agent 不自评是否需要打扰人；`confidence` 只排序推荐项。

### 3.2 动作分类按效果，不按字符串
动作类 = (效果类型, 目标范围)，效果类型取自：`fs.read / fs.write / fs.delete / net.out / proc.exec / cred / git.push / infra / money / message.out`。`&&` 链、子 shell、脚本拼装按**最终效果**合成一个动作。MCP 的 `readOnlyHint / destructiveHint` 直接映射为可逆性。字符串规则只作补充。

### 3.3 三轴矩阵与告警级别
| | 可逆 | 不可逆 |
|---|---|---|
| **范围内、低爆炸半径** | ACT + 回滚点 → digest | Caution（soon）：ASK 带默认，延迟到断点，可合并 |
| **范围外或外部副作用** | ACT + Advisory notify | Caution（now）：ASK，阻塞，超时升级 |
| **P0：生产、资金、删除、对外发消息** | Caution（now） | **Warning**：consent + push + 第二人；不可设默认；超时 = end_task 或 escalate |
| **decision_class = goal 或 taste** | 无视上两轴 → 至少 Caution；goal 应在计划期问完，执行期出现计为 spec 缺陷 | |

### 3.4 自治模式绑定（Sheridan × FAA）
| 级别 | 触发 | 自治模式 | 渠道 | OS 打断等级 |
|---|---|---|---|---|
| **Warning** | now + P0，或不可逆 + 外部 | **consent**：必须批准 | push + 收件箱 + 第二人 | Time-Sensitive；Critical 需预授权 |
| **Caution** | now + P1；soon + P0/不可逆；goal/taste | **consent** | 收件箱 + 周边 | Active |
| **Advisory** | 其余 | **exception**：TTL 内可否决，超时按默认执行，进审计队列 | 周边 / digest | Passive |

### 3.5 效用计算（仅用于 Advisory 与 Caution-soon 的投递时机）
```
surface_now  if  P(need_human) × Cost(wrong)  >  Cost(interrupt | state) + Cost(resume)
defer        否则，等待下一个符合级别的断点，最长到 ttl 或 point_of_no_return
```
`Cost(interrupt | FOCUS)` 取 12 分钟量级；`coarse` 断点 1 分钟；`medium` 2 分钟；`fine` 5 分钟；`AWAY` 取渠道成本。

### 3.6 校准信号
Kernel 按动作类持续输出批准率：> 90% 建议放宽为 auto_allow 候选，< 70% 建议收紧或改进 spec；系统级升级率目标 10–15%。

## 4. 调度器行为

| 行为 | 规则 | 依据 |
|---|---|---|
| **确认延迟** | AR 发出前等待 `confirm_delay`（默认 30–120s），期间自愈即撤回 | 医疗告警 delay |
| **断点延迟** | Advisory 等 coarse 断点，Caution-soon 等 medium 以上；最长到 ttl 或 point_of_no_return | Iqbal & Bailey 三粒度 |
| **合并与冷却** | 同 `batch_key` 合并；无 key 但同 agent 同 risk 的 5 分钟内合并；同源 cooldown。**不可逆项不合并进 digest** | PagerDuty、Android 16、waxell |
| **速率预算** | 滚动窗口 ≤ 1 / 10 min、≤ 6 / h；短窗口（10 min）与长窗口（1 h）双判定。软阈 80%：Advisory 降级为 digest；硬阈 100%：只放行 Warning/Caution | ISA-18.2、SRE burn rate、Paperclip |
| **Flood 模式** | 10 分钟内 ≥ 10 条 → 折叠为单条 flood 项，只透出 Warning；窗口新增 < 5 条退出 | ISA-18.2 |
| **Standing 上限** | 未处理 > 10 条 → 停止新增 Advisory，强制合并/过期 | EEMUA 191 |
| **线程上限** | 待处理线程数 > 4 → 暂停派发新任务 | Symphony |
| **阶段抑制** | `/focus` 或日历 focus block 期间抑制 Advisory 与 Caution-soon；**抑制而非丢弃**，退出后自动重现；状态面显示"N 条已抑制"；穿透白名单 | Airbus INHIBIT、AC 25.1322、Teams |
| **Chattering** | 同一 AR（同 batch_key 同 effects）24h 内 ≥ 3 次 → 转为单条"修此规则"AR | AF447、ISA |
| **升级阶梯** | 周边 → 收件箱 → push → 第二人；ack 即停；snooze 只压当前 AR，不压同 key 新 Warning | PagerDuty |
| **Auto-resolve** | TTL 到期按 `on_expire` 执行；Advisory 自动决策进"已替你决定"队列带 undo | PagerDuty、Ronacher |
| **静默过久** | 自动放行动作无进展 > 5 分钟 → Advisory；agent 卡住必须进 needs-attention，不猜 | Cline、Perplexity |
| **并发闸门** | 估算 FO = NT/IT + 1；利用率 > 70% 暂停派发，< 60% 恢复 | Cummings |

## 5. 信任账本（v0.2 重做）

- **计数单位是证据，不是批准**：某动作类累计 N 次"verifier 通过 + 可撤销 + 未被 undo"才晋升；默认 N = 10。
- **不对称**：一次 undo、override 或 verifier 失败即降两级并重置。
- **双向监测**：晋升后该类的打断率或回滚率上升 → 自动降级。
- **晋升可见可撤回**：晋升在收件箱以 Advisory 通知（Amershi G18），一键撤回；账本本身是可编辑的 allowlist。
- **拒绝带教训**：每次 reject 要求一句原因，沉淀为规则喂回 agent 与 Policy。
- **治理**：阈值、静默时段、风险标定的修改记录责任人；agent 不能自改。
- **P0 类永不 auto_allow。**

### 5.1 反橡皮章机制
- 记录每个决策的停留时间；< 3 秒计入 rubber_stamp_rate。
- 随机 5% 的 Caution 标记为"深审"，要求展开 proof 才能批准。
- digest 禁止"全部已读"；每条保留独立 risk 标签。
- 监测四个监督退化信号：审查时长下降而批准率不变、override 率下降、展开 proof 的比例下降、反馈"不该问我"减少。任一触发 → rationalization 审计，列出过去 7 天最常被秒批的动作类，建议放宽或删除规则。

## 6. 任务生命周期

1. **Intake（强制 plan/interview 门）**：填 TaskCard。框架用一次结构化表单把所有可预见的决策前置；**goal 类决策必须在此答完**，input 类可带推荐项与 point_of_no_return，constraint 类默认按推荐。
2. **Plan-of-record**：计划是对象。**计划批准后不逐步问**，只有偏离计划或触及不可逆边界才生成 AR。
3. **Execute**：默认静默。SDK 事件经适配器 → AR → 准入门槛 → 内核。周边只在 blocked / needs-you / done 点亮。
4. **Verify**：独立 verifier 跑 done_criteria，打风险标签，生成 proof。不通过则回到 3，不打扰人；三轮失败 → escalation。
5. **Deliver**：EvidencePacket 作为 review 类 AR。P2/P3 且验证通过 → Advisory + digest（可自动合并）；P1 或架构级 → Caution 进收件箱，架构级需理解签字；P0 → Warning。
6. **Learn**：账本回写阈值、信任、渠道偏好；per-request 反馈（"不该问我 / 该早点问 / 该问但没问"）回流。

## 7. 呈现面（Surfaces）

- **周边状态（dark cockpit）**：默认全灭。黄 = blocked，橙 = needs-you，绿 = done，灰点 = shelved/已抑制（独立可见态）。绝不弹窗。
- **异常收件箱**：唯一需要人"看"的地方。排序 = (级别, deadline/point_of_no_return, 历史行动概率)。每项 = headline + 4 行 context + `why_now` + 选项（推荐高亮）+ 单键回答 + "不答会怎样" + 剩余 TTL + 展开 proof。
- **已替你决定队列**：Advisory 超时自动决策的独立审计视图，每条带 undo 与 `why_not_asked`。
- **Digest**：按历史行动概率排序，禁止全部已读，不含不可逆项。
- **自治面板**：全局 autonomy slider（L0–L5）、当前各动作类等级、速率与分布仪表、"N 条已抑制"。
- **渠道**：对齐 OS 打断等级；同一 AR 跨渠道同步；投递四态可观测；deep link 回跳。
- **Transcript**：审计视图，默认折叠。

## 8. 适配器

| 来源 | 输入映射到 AR | 决议映射回运行时 |
|---|---|---|
| Claude Agent SDK / Claude Code | `PreToolUse` / `PermissionRequest` → approval；`AskUserQuestion` → question（计划期合并）；`Notification` → notify/review；`Stop` → review | `permissionDecision` + 追加规则；`canUseTool` |
| LangGraph | `interrupt(payload)` / `HITLRequest` | `Command(resume=…)` |
| OpenAI Agents SDK | `RunResult.interruptions` | `RunState.approve/reject` |
| MCP | `elicitation` → question；`destructiveHint / readOnlyHint` → risk.reversible | elicitation 结果 |
| A2A | `input-required` → question | 追加 message |
| Temporal / Inngest | signal 等待 → AR；TTL 用持久 timer | signal |
| gotoHuman / Zapier HITL | 作为外部渠道：AR → review form；`updateForReviewId` ↔ `supersedes_id` | webhook |

## 9. 指标

| 指标 | 定义 | 目标 |
|---|---|---|
| interventions_per_task | 人主动纠正次数 | ≤ 2 |
| surface_rate | 上浮速率（10 min / 1 h 滚动） | ≤ 1 / ≤ 6 |
| priority_distribution | Warning / Caution / Advisory 占比 | ≈ 5 / 15 / 80 |
| escalation_rate | 进入人工决策的动作占比 | 10–15% |
| rubber_stamp_rate | < 3 秒批准占比 | < 50% |
| approval_rate_by_class | 每动作类批准率 | 70–90% |
| median_interaction_seconds | IT 中位数 | ≤ 90 |
| standing_count | 未处理 AR 数 | ≤ 10 |
| concurrent_high | 同时未处理 Warning+Caution 数 | ≤ 3 |
| chattering_count | 被标 chattering 的规则数 | → 0 |
| flood_events | flood 模式触发次数 | → 0 |
| neglect_time / fan_out | NT，FO = NT/IT + 1 | ↑ |
| human_utilization | 处理 AR 时间 / 工作时间 | < 70% |
| pending_threads | 待处理线程数 | ≤ 4 |
| review_gated_share | 需人工 review 的交付占比 | ≈ 20% |
| understanding_signoff_rate | 架构级变更有理解签字的比例 | 100% |
| undo_rate / override_rate | 自动放行被撤销、Advisory 被否决比例 | 信任校准信号 |
| supervision_decay | 四个退化信号 | 任一触发审计 |
| spec_gap_rate | 执行期出现的 goal 类 AR 占比 | → 0 |
| delivery_funnel | sent → delivered → displayed → responded | 可观测 |
| p0_auto_pass | 必须为 0 | 0 |
| false_alarm_rate | 被 dismiss 或反馈"不该问我"的占比 | ↓ |

## 10. 风险与对策

| 风险 | 对策 |
|---|---|
| **Out-of-the-loop** | 周期性 digest；架构级理解签字；EvidencePacket 首屏是意图差异；自治面板可见 |
| **自动化自满 / 橡皮章** | 证据计数 + 不对称降级 + 双向监测；5% 深审抽样；退化信号审计；不可逆项不进 digest |
| **过度抑制** | Warning 永远穿透；抑制而非丢弃；穿透白名单；`on_expire=end_task/escalate` 不可被预算覆盖 |
| **静默错误决策** | Advisory 自动决策进独立审计队列带 undo 与 `why_not_asked` |
| **状态推断隐私 / 不可靠** | 默认 pull + 自报 + 日历；推断 opt-in、本地、只出枚举 |
| **Agent 虚报 / 自评** | verifier 独立；agent 不自评是否打扰人 |
| **策略被绕过** | 按效果分类，不按字符串 |
| **多工具上下文丢失** | TaskCard、plan-of-record、ledger 跨运行时共享 |
| **认知负债** | understanding_signoff_rate 与 utilization < 70% 互为制衡 |

## 11. 路线图

| 阶段 | 内容 | 验证 |
|---|---|---|
| **P0（2–3 周）** | AR schema v0.2 含准入门槛；内核（policy 三级、scheduler 速率/flood/合并/抑制召回/chattering、timeout 强制枚举）；Claude Code hooks 适配器；CLI 收件箱 + 已替你决定队列 | 自用 1 周：surface_rate、priority_distribution、interventions_per_task |
| **P1** | HumanState（自报 + 日历 + opt-in 推断，三级断点）；digest 排序；账本 v0.2（证据计数、不对称、双向、可撤回）；反橡皮章 | rubber_stamp_rate、undo_rate、supervision_decay |
| **P2** | EvidencePacket 首屏改版 + verifier + 理解签字；并发闸门；LangGraph / MCP / gotoHuman 适配；行内评论回流 | review_gated_share、understanding_signoff_rate |
| **P3** | 阈值学习；Slack / 手机渠道对齐 OS 等级；团队模式升级阶梯与第二人；Symphony 式"人只审 issue 与成品" | false_alarm_rate、time_to_first_decision |

## 12. 待确认的假设
- 首个运行时以 Claude Code / Claude Agent SDK 为主。
- 首个用户是单个开发者同时跑 2–5 个 Agent；团队模式放 P3。
- 形态是独立守护进程 + 适配器。
- 速率默认值（1/10min、6/h）、flood 阈值（10/10min）、晋升证据数（10）直接沿用告警工程与 v0.1，首轮 benchmark 后校准。
