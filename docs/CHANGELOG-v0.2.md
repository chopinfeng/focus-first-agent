# v0.1 → v0.2：第二轮调研对比与调整决策

> 2026-09-03。第二轮四路调研（跨领域告警、业界观点与 HAI 指南、评测与用户模拟器、第二批产品）逐条对照 v0.1 方案。每条给出：证据、v0.1 的问题、决定（采纳 / 部分采纳 / 拒绝 / 延后）。原始材料见 `docs/research/05–08`。

## 总体判断

v0.1 的骨架（AR 统一 schema、内核四模块、异常收件箱、证据包、账本）没有被推翻，但四个地方被证据击中：

1. **信任账本"10 次批准即晋升"是错的。** 批准次数不是证据（Karpathy、Osmani、Beck）；批量审批六个月后退化为无人真看（waxell）；Anthropic 数据显示老用户自动批准升到 40% 的同时打断率反而从 5% 升到 9%。改为证据计数 + 不对称降级 + 双向监测。
2. **只按"风险 × 可逆性"决定问不问是不够的。** 低风险可逆但属于"品味/设计/目标"的决策必须问人（Appleton、Anthropic hard tradeoffs），且 goal 类决策必须在计划期问完，执行到 70% 再问已无用（Ask Early, Ask Late, Ask Right）。新增第三轴 decision_class。
3. **4 行恢复上下文提高的是信心不是准确率**（Grunde-McLaughlin 等 2026）。证据包和 AR 都要能展开到可验证证据，首屏改为"意图差异 + verifier 结论 + 什么能证明我错了"。
4. **预算按"每任务次数"太粗。** 告警工程 40 年的结论是速率型上限（ISA-18.2：稳态 < 1 条/10 分钟，≥ 10 条/10 分钟为 flood）+ 优先级分布治理（80/15/5）+ 阶段抑制而非丢弃。全部采纳。

另外确认了两个差异化点：市场上没有任何产品做 notification budget（Amp Orbs 无频率上限）；也没有产品用速率与分布做治理。

## 逐条决策

### A. AttentionRequest schema

| # | 证据 | v0.1 问题 | 决定 |
|---|---|---|---|
| A1 | ISA-18.2 "不需要动作的不是告警"；Ewaschuk 对症状不对原因；rationalization 通常删 30–60% | 任何事件都能成为 AR | **采纳**：新增必填 `required_action`、`consequence_if_ignored`、`time_to_irreversible`；缺任一项只能进 digest。headline 描述对人的影响，原因折叠进 context |
| A2 | Zapier HITL 超时动作强制二选一 | `on_expire` 可选 | **采纳**：`on_expire` 强制枚举 `apply_default / skip_and_continue / end_task / escalate`；P0 只允许 `escalate / end_task` |
| A3 | Ask Early, Ask Late, Ask Right：goal 类前置，input 类到 50% 仍有价值，constraint 类几乎无益；Appleton 品味决策 | 无决策类型 | **采纳**：新增 `decision_class: goal / input / constraint / taste`；taste 与 goal 无视风险等级必须问人；goal 必须在计划期问完 |
| A4 | Grunde-McLaughlin：trace 界面提高信心不提高准确率；getclaw 最小三字段 | context 只有 4 行 | **采纳**：`context` 保留 4 行作首屏，新增 `proof[]`（可展开的测试输出、diff、截图）和 `what_would_prove_me_wrong` |
| A5 | 医疗告警 delay 手法；Johns Hopkins 阈值微调 −63% | AR 立即生成 | **采纳**：`confirm_delay`（默认 30–120s），期间自愈即撤回 |
| A6 | gotoHuman `updateForReviewId` | 重试新建条目 | **采纳**：`supersedes_id`，重试更新原条目 |
| A7 | Happy #1383 推送未送达 | 无投递状态 | **采纳**：`delivery` 四态 sent / delivered / displayed / responded |
| A8 | CCNotify 点击直达 | 无 | **采纳**：`deep_link` |
| A9 | Amershi G11 "解释原因" | 无 | **采纳**：`why_now`（为何现在问）；被抑制/自动放行的项在 digest 带 `why_not_asked` |

### B. Policy（ask vs act）

| # | 证据 | v0.1 问题 | 决定 |
|---|---|---|---|
| B1 | Sheridan consent vs exception；FAA AC 25.1322 Warning/Caution/Advisory | "safe default" 语义模糊 | **采纳**：三级绑定。**Warning**（now + P0）= consent + push + 第二人；**Caution**（now+P1 或 soon+P0/不可逆）= consent + inbox；**Advisory**（其余）= exception：TTL 内可否决，超时按默认执行。"safe default" 只存在于 Advisory |
| B2 | Cursor 字符串 denylist 被四种方式绕过后放弃；auto mode 分类器按真实影响判定 | 动作类按命令字符串 | **采纳**：按效果分类（写入路径、网络出口、进程/凭据、不可逆性）；`&&` 链与脚本拼装按最终效果算一个动作；字符串规则只作补充 |
| B3 | Antigravity "Agent Decides" 争议；COMPASS 开放模型 denied-edge 失败 80–83% | 允许 agent 的 confidence 影响门控 | **采纳**：agent 不自评是否打扰人。Kernel 确定性策略先行，`confidence` 只影响推荐项排序，不影响 ask/act |
| B4 | Galileo 升级率 10–15%；waxell 批准率 >90% 太宽 <70% 太窄 | 无校准目标 | **采纳**：Kernel 按 action class 输出批准率，>90% 建议放宽、<70% 建议收紧；系统级升级率目标 10–15% |
| B5 | Claude for Chrome 计划级批准 + 敏感硬门；中间确认在不可逆边界反而 −13.5% 完成时间 | 已有类似 | **确认**：计划批准后不逐步问，不可逆边界仍拦 |

### C. Scheduler 与 Budget

| # | 证据 | v0.1 问题 | 决定 |
|---|---|---|---|
| C1 | ISA-18.2 / EEMUA 191 速率；SRE 多窗口 burn rate；Paperclip 80/100 | 预算按每任务次数 + 每日总量 | **采纳**：速率型预算，滚动窗口 ≤ 1/10min、≤ 6/h；软阈 80% 降级为 digest，硬阈 100% 只放行 Warning/Caution |
| C2 | ISA-18.2 flood 定义 | 无 | **采纳**：10 分钟 ≥ 10 条 → flood 模式，折叠为单条，只透 Warning；窗口新增 < 5 条退出 |
| C3 | EEMUA standing < 10 | 无 | **采纳**：未处理 > 10 条 → 停止新增 Advisory，强制合并/过期 |
| C4 | Airbus T.O./LDG INHIBIT + 自动召回；AC 25.1322 抑制必须可见；Teams priority contacts | 静默时段直接压进 digest | **采纳**：抑制而非丢弃，退出阶段自动重现；状态面显示"N 条已抑制"；穿透白名单 |
| C5 | AF447 启停 75 次；ISA chattering | 无 | **采纳**：同一 AR 24h ≥ 3 次 → 标 chattering，转为单条"修此规则"AR |
| C6 | PagerDuty ack/snooze/auto-resolve；Android 16 同源分组 + 冷却 | 升级阶梯语义不全 | **采纳**：ack 停梯子；snooze 只压当前 AR 不压同 batch_key 新 Warning；TTL 到期 auto-resolve 进 digest；无 batch_key 但同 agent 同 risk 5 分钟合并 + 同源冷却 |
| C7 | Symphony 舒适并发 3–5；Guo 五分钟碎片 | 预算无线程维度 | **采纳**：预算增加"待处理线程数 ≤ 4"维度；预算按"人 × 时段"而非每任务 |
| C8 | Iqbal & Bailey 断点三粒度 | BREAKPOINT 单一 | **采纳**：fine / medium / coarse，成本递减；Caution 可用 medium，Advisory 只用 coarse |
| C9 | Hashimoto 关掉通知、自然间隙主动看；LukeW 日历模式；Viva focus block | 系统推断 FOCUS 为默认 | **采纳**：默认 pull + 自报 + 日历 focus block；键鼠推断改为 opt-in 信号 |
| C10 | Cline 30 秒静默通知；Perplexity "卡住即上报不猜" | 无 | **采纳**：自动放行动作无进展 > N 分钟 → Advisory "静默过久"；agent 卡住必须进 needs-attention 而非猜 |
| C11 | Gmail 行动概率排序；waxell 批量审批退化；Replit 删库 | digest 是打包 | **采纳**：digest 按历史行动概率排序；每条保留独立 risk 标签；**不可逆项禁止进 digest** |

### D. Trust ledger（重做）

| # | 证据 | v0.1 问题 | 决定 |
|---|---|---|---|
| D1 | Karpathy verifier 决定 slider；Osmani 以证据升级；Beck 信任不对称 | 10 次批准即晋升 | **采纳**：计数单位改为"verifier 通过 + 可撤销 + 未被 undo"的证据；一次 undo / override / verifier 失败即降两级 |
| D2 | Anthropic auto-approve 升、打断率也升 | 单向 | **采纳**：晋升后监测该类的打断率与回滚率，上升即自动降级 |
| D3 | Amershi G18；Cherny 可见 allowlist；NPSG 谁有权改 | 晋升静默 | **采纳**：晋升强制通知且可一键撤回；账本即可编辑 allowlist；阈值修改记录责任人，agent 不能自改 |
| D4 | Compound engineering；getclaw 拒绝带教训 | 只计数 | **采纳**：每次拒绝要求一句原因，沉淀为规则喂给 agent |
| D5 | Ronacher 早晨橡皮章；Push Humans Out of the Loop 退化签名 | rubber_stamp_rate 只是指标 | **采纳**：记录决策停留时间；随机 5% 强制深审抽样；禁止"全部已读"；Advisory 超时自动决策进独立"已替你决定"审计队列带 undo；监测"审查时长降、批准率不变、override 降、索证降"四个退化信号，触发 rationalization 审计 |

### E. EvidencePacket 与审阅单位

| # | 证据 | v0.1 问题 | 决定 |
|---|---|---|---|
| E1 | Dede PR 已死；Yegge 别看代码；Osmani 三问 | 首屏含 diff 摘要 | **采纳**：首屏 = 意图/spec 差异 + verifier 结论 + "什么能证明我错了" + 回滚；diff 折叠为次级 |
| E2 | Storey cognitive debt："至少一人完全理解" | 只优化少干预 | **部分采纳**：架构级（新依赖、公共 API、数据模型）变更要求"理解签字"，其余不要求。作为利用率 < 70% 的制衡指标 |
| E3 | Antigravity 行内评论回流 | 无 | **延后**到 P2 |
| E4 | Amershi G2 | 无历史准确率 | **采纳**：EvidencePacket 显示该 agent/该动作类的 verifier 历史通过率 |

### F. Surfaces

| # | 证据 | 决定 |
|---|---|---|
| F1 | Airbus dark cockpit | **采纳**：working 不亮；shelved/snoozed 独立可见态 |
| F2 | Amershi G1/G17；Osmani L0–L5 | **采纳**：全局 autonomy slider + 当前自治等级面板 |
| F3 | Amershi G15 | **采纳**：每个 AR 可反馈"不该问我 / 该早点问 / 该问但没问"，回流阈值 |
| F4 | Apple 四级打断等级 | **采纳**：whenever→Passive、soon→Active、now→Time-Sensitive；Critical 仅 Warning 且需预授权，交给 OS 执行 |

### G. Lifecycle

| # | 证据 | 决定 |
|---|---|---|
| G1 | Cherny plan mode；Huntley specs；Ask Early goal 前置 | **采纳**：Intake 强制 plan/interview 门，goal 类决策在此问完；执行期出现 goal 类 AR 视为 spec 缺陷并计入指标 |
| G2 | Ask Early wasted compute | **采纳**：input 类 AR 带 `point_of_no_return`，Scheduler 保证在此之前投递 |

### H. 拒绝或延后的建议

| 建议 | 来源 | 决定与理由 |
|---|---|---|
| 人应审每一行 | Storey 派 | **拒绝**，改为 E2 的架构级签字。全审与 utilization < 70% 不可兼得 |
| 完全不看代码 | Yegge | **拒绝**作为默认，仅对 P3 且 verifier 通过的交付允许 |
| agent 按自身置信度决定是否暂停 | Antigravity 第三方描述 | **拒绝**（B3） |
| 键鼠推断 FOCUS 作默认 | v0.1 自身 | **降级**为 opt-in（C9） |
| Critical 级穿透静音 | Apple | **限制**：仅 Warning 且需人预授权 |
| Symphony "人只做两件事" | OpenAI | **部分**：作为 P3 团队模式的形态，单人场景保留收件箱 |

## Benchmark 调整摘要（详见 BENCHMARK.md v0.2）

1. ACS 拆三项（交互次数 / 人要读的 tokens / 人要写的 tokens）并报 Pareto 前沿；保留合成分作排序
2. 引入 Fan-out = NT / IE 与 Neglect Tolerance
3. 时机维度：强制注入法标定每个 ground-truth 决策的 point of no return，按 goal/input/constraint 三种衰减曲线；晚问按 wasted compute 计罚；执行期 goal 类提问计入 spec 缺陷
4. 断点三级
5. 模拟人橡皮章参数改为实证：基线批准 93%，人类中途捕获植入危险命令 13.6%，识别率随会话内提示数单调衰减；按新手/老手分层
6. 新增监督退化过程指标
7. 陷阱集改用 Saber 三类因果场景（嵌入注入 / 风险自选 / 上下文警告）+ Late-Refusal + first unsafe step + 按真实影响判定；规模从 12 扩到 ≥ 30
8. 模拟人加 ≥ 3 种非合作 persona、隐藏信息、直接改环境（dual-control）
9. 模拟器验证协议：100 条轨迹 accuracy/consistency/plausibility 标注 + 真人/模拟失败分布相关 + 成对可区分性
10. Co-Gym 五类失败分类，重复提问计双倍
11. "问"计正向价值 + over-asking penalty；oracle 用 EVPI 停问准则定义
12. Harness 复用 Collaborative Gym 的异步事件框架
13. 新增指标：优先级分布（目标 80/15/5）、standing 数、并发未处理 Warning/Caution（> 3 视为缺陷）、chattering 数、理解签字数、per-class 批准率、投递漏斗
