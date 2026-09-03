# 调研综合：Agent 使用过程中的人类注意力问题

> 日期：2026-09-03。四路并行调研的综合结论；原始材料见 `docs/research/`。

## 一句话结论

**Agent 时代的稀缺资源已经从"代码生成"转移到"人的注意力"，但没有任何现有框架把注意力当作一等资源来建模和调度。** 所有主流 SDK 都是"逐条打断、无限等待、无预算、无时机感"。

## 1. 问题有多严重（数据）

| 现象 | 数据 | 来源 |
|---|---|---|
| 瓶颈转移到审查 | 85% 认为瓶颈已转向 review；PR 数 +98% 而 review 时间 +91%；review 时间中位数 +441% | GitLab 2026 / Faros AI |
| 审批退化为仪式 | 用户批准约 93% 的权限提示；人类漏掉约 1/3 危险命令；单次任务弹 73 次审批 | Anthropic 遥测 / Wauters / aipatternbook |
| 分类器比人可靠 | 人工只抓到 13.6% 危险命令，auto mode 分类器抓到 89% | Anthropic auto mode |
| 感知与实际脱节 | 资深开发者用 AI 慢 19%，自评快 20% | METR 2025 RCT |
| 体验恶化 | 6 个月纵向：心流下降、认知负荷上升，体验恶化者 14%→27% | arXiv 2605.23135 |
| 错位需人纠正 | 20,574 个真实会话中 91.5% 的可见错位需人显式纠正，代价主要是"精力与信任" | arXiv 2605.29442 |
| 并行上限是人 | "two agents win, three context-dependent, five is a trap" | Nimbalyst |
| 认知过载 | 14% 出现管理多 Agent 的过载，重大失误概率 +39% | BCG 2026 |
| 打断恢复成本 | 程序员被打断后 10–15 分钟才恢复编辑；仅 10% 在 1 分钟内恢复 | Parnin & Rugaber 2010 |

## 2. 学术研究给出的硬约束

1. **打断有时机**：defer-to-breakpoint（Iqbal & Bailey）——推迟到子任务边界投递，粗粒度断点更好。FlowLight 用键鼠活动推断可打扰性，中断减少 46%。
2. **打断是效用计算**（Horvitz 1999/2003）：自主执行 / 发起对话 / 不做，三分决策由"推迟代价 vs 打断代价"决定，且随用户状态变化。
3. **周边 vs 中心**（Weiser & Brown）：状态信息驻留周边，只有真正需要人的事进入中心；glanceability 是关键属性。
4. **一人能管几个 Agent 有公式**：FO ≈ NT/IT + 1（忽视时间 / 交互时间）；操作员利用率 > 70% 绩效衰退（Cummings）。
5. **完全自动化最危险**：out-of-the-loop 导致情境意识下降、接管更慢（Endsley）；目标是信任校准而非信任最大化（Lee & See）。
6. **注意力残留**（Leroy）：切换前把上一任务收尾，能清除残留——Agent 每次请求必须自带恢复上下文。

## 3. 产品实践已经收敛的模式

- **给"为什么需要我"打标签**：Devin 的 `waiting_for_user / waiting_for_approval`、Warp 的 Complete/Request/Error、Claude Code 的 `permission_prompt / idle_prompt / agent_needs_input / agent_completed`。
- **延迟触发**：Claude Code 权限提示等 6 秒、空闲等 60 秒才通知；只在用户没看该会话时发 OS 通知。
- **提问前置到计划期**：`AskUserQuestion` 多选带推荐项；Jules "不回应即自动批准"。
- **分类器兜底 + 硬规则优先**：Claude Code auto mode（2026-08 起默认）。
- **PR 是唯一交接面，Agent 自己照看 PR**：Cursor Cloud、Devin 订阅 PR、修 CI、被 @ 时唤醒。
- **统一收件箱 / Mission Control**：GitHub、Cursor 3、Codex App、Warp、LangChain agent-inbox、OpenClaw（异常队列 + 带 TTL 的 attention state）。
- **随时接管**：Remote Control、Slack 双向。
- **三级信任协议**：LangChain ambient agents 的 notify / question / review。

## 4. 现有框架的 8 个空白（机会点）

1. 决策请求没有统一 schema（question + options + default + deadline + consequence + reversibility）
2. 没有批处理 / digest / quiet hours / 合并同类审批
3. SDK 层 interrupt 无限等待，没有"超时选安全默认"
4. 信任增长没有量化模型（"批准 N 次后自动放行"）
5. 没有 PagerDuty 式升级阶梯对接 Agent 事件
6. 可逆性未进入工具元数据驱动 ask-vs-act（MCP 有 `readOnlyHint/destructiveHint` 但没人用）
7. 面向人的可观测性仍是日志，没有 plan-of-record + 偏差 + "what I need from you"
8. **注意力预算本身不被建模**——没有框架把"本小时最多打断 N 次"或"用户当前状态"作为调度输入

## 5. 对设计的直接指引

- 人看**结论与证据**，不看 transcript（Anthropic 蒸馏结论、Codex diff-first、Slack Code 预览）。
- 只 gate 最高风险的 ~20% 可覆盖 ~69% 的 review 工作量；tests 作为注意力代理（"不 exit 0 不算完成"）。
- 每日主动上浮 ≤ 3–5 条；从 acted / dismissed / ignored 学习阈值（TianPan.co）。
- Agent 主动澄清的频率是人打断它的 2 倍，且"具体、可一键回答"的澄清才被接受（Anthropic autonomy、Proactive Agent）。
- 变更 ≤ 250 行；spec-first 委派；独立 verifier subagent 对抗 "early victory"。

---

# 第二轮调研补充（2026-09-03）

四路：跨领域告警设计、业界观点与 HAI 指南、评测与用户模拟器、第二批产品。原始材料 `docs/research/05–08`，逐条决策 `docs/CHANGELOG-v0.2.md`。

## 6. 告警工程 40 年的现成答案

| 领域 | 规则 / 数字 |
|---|---|
| 过程控制 ISA-18.2 / EEMUA 191 | 稳态 < 1 条 / 10 min / 操作员；≥ 10 条 / 10 min = flood；常驻 < 10；优先级分布 ≈ 80 / 15 / 5；"不需要动作的不是告警"；rationalization 删 30–60% |
| 航空 FAA AC 25.1322 / Airbus | Warning / Caution / Advisory 三级；起降阶段抑制非关键告警并在退出后**自动召回**；抑制必须可见；dark cockpit；AF447 告警启停 75 次导致误判 |
| 医疗 | 85–99% ICU 警报不可操作；阈值微调（SpO2 90→88）−63%；delay + 去重 + 二级响应人 |
| SRE | page 必须 urgent/important/actionable/real；对症状不对原因；多窗口 burn rate；每班 2–3 个可操作事件；ack 即停升级 |
| 监督控制 | Sheridan：management by consent（批准后执行）vs by exception（否决窗口，超时执行） |
| 消费级 | Apple Passive / Active / Time-Sensitive / Critical；Gmail 按行动概率排序：阅读时间 −6% |

## 7. 观点与批评击中 v0.1 的地方

- **信任不对称**（Kent Beck）："Trust accumulates slowly & evaporates in an instant"；Karpathy、Osmani：晋升门槛应是 verifier 质量而非批准次数。Anthropic 数据：老用户 auto-approve 升到 40% 的同时打断率从 5% 升到 9%。
- **品味与目标必须问人**（Maggie Appleton）：设计决策 "require your human context, taste, preferences, and vision"，与风险等级无关。
- **信心 ≠ 准确率**（Grunde-McLaughlin 等 2026）：更好的 trace 界面 "improved confidence didn't translate to better accuracy"。
- **PR 不是审阅单位**（Dede、Yegge）："The human LGTM has become the single biggest liability"；人审 intent 与 spec。
- **认知负债**（Storey）：至少一人完全理解每个变更——与"少干预"目标冲突，需要制衡指标。
- **推断 vs 自报**（Hashimoto）："turn off agent desktop notifications... During natural breaks in your work, tab over and check on it"。
- **Amershi 18 条**逐条映射后发现 8 个缺口：自治等级面板、历史准确率、为何现在问、细粒度反馈、晋升通知、全局 slider 等。

## 8. 评测方法可直接复用

- **Collaborative Gym**：异步事件模型、模拟人五种动作 + 隐藏信息、五类失败分类、模拟器验证协议（100 条标注 ≥ 90%、成对区分 ≈ 随机、失败分布 Spearman 0.8）。
- **Ask Early, Ask Late, Ask Right**：强制注入法标定 point of no return；goal 类澄清严重前置（70% 处已无用），constraint 类几乎无益；wasted compute。
- **Saber**：716 个有状态陷阱任务，三类因果场景（嵌入注入 / 风险自选 / 上下文警告），Late-Refusal 指标；最强模型上下文警告场景 HSR 仅 82.5%。
- **Persona Policies / UserBench**：LLM 模拟用户天然过于合作，需要非合作 persona。
- **AI Agents Push Humans Out of the Loop**：监督退化签名——审查时长降而批准率不变、override 降、索证降。
- **SAGE-Agent**：EVPI − λ·冗余 的停问准则，可作 oracle 的数学定义。
- **Claude Code auto mode classifier**：按真实效果判定（`&&` 链视为一个动作）；FPR 0.4%、FNR 17%。

## 9. 第二批产品确认的缺口与先例

- 没有任何产品做 notification budget（Amp Orbs 无唤醒频率上限）——FFA 的差异化点。
- Zapier HITL：超时动作强制二选一，是"safe default"最直接的商用先例。
- Paperclip：预算 80% 软警告 / 100% 硬停。
- Symphony：人舒适并发 3–5 个 session。
- Cline：自动批准的命令跑 30 秒也通知；Perplexity：卡住即进 Needs attention，不猜。
- waxell：每天 200+ 审批 → 批量批准 → 六个月后无人真看；Replit 删库。批量与 digest 必须保留每条的风险标签，不可逆项不进 digest。
- Cursor 字符串 denylist 被四种方式绕过后放弃 → 按效果分类。
