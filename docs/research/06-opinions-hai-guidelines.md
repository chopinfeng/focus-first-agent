# 调研六：业界观点、批评与人机交互指南

## (a) 立场清单

### 实践者：如何监督 coding agents
1. **Andrej Karpathy**："keep AI on the leash"；autonomy slider 只能在 verifier 足够便宜可信时才右移。→ SUPPORTS ask-vs-act；REFINES trust ledger：晋升门槛应是 verifier 质量而非批准次数。
2. **Simon Willison**（2026-05）："as the coding agents get more reliable, I'm not reviewing every line of code that they write anymore"；"Claude Code does not have a professional reputation! It can't take accountability"。→ SUPPORTS EvidencePacket（跑通的证据替代读 diff）；"what else breaks?" SUPPORTS 人类利用率作核心指标。
3. **Steve Yegge**（Gas Town）："Code is a liquid. You spray it through hoses. You don't freaking look at it."→ SUPPORTS 例外管理；CONTRADICTS 以 diff 为单位的审批。
4. **Maggie Appleton**（gastown）："You can move so fast you never stop to think"；设计决策 "require your human context, taste, preferences, and vision"。→ CONTRADICTS 仅按 risk × reversibility 决定是否打扰：低风险可逆但"品味/设计"类决策也必须问人。
5. **Mitchell Hashimoto**（2026-02）："turn off agent desktop notifications. Context switching is very expensive"；"During natural breaks in your work, tab over and check on it"；夜间 agent 只出报告。→ SUPPORTS defer-to-breakpoint 与 digest；REFINES HumanStateModel：人主动 pull 而非系统推断 push。
6. **Armin Ronacher**（The Final Bottleneck 2026-02）："If the machine writes the code, the machine better review the code at the same time"；未来是 "for humans to rubber stamp in the morning"。→ SUPPORTS 独立 verifier；CONTRADICTS 把 digest 当审批通道；SUPPORTS rubber-stamp rate。
7. **Kent Beck**（Trust Factory）："We're accumulating code faster than we are accumulating trust"；"Trust accumulates slowly & evaporates in an instant"；agent 汇报只是 "the press release of what I did"。→ CONTRADICTS 10 次批准即晋升（信任不对称）；REFINES EvidencePacket 不能只是摘要。
8. **Addy Osmani**（Agentic Autonomy Levels 2026）：六级自治 L0–L5，L5 = managed-by-exception；三问 "How quickly will we know we're wrong? How cleanly can we undo? What would prove we're right?"→ SUPPORTS risk × reversibility；REFINES trust ledger 以证据计数。
9. **Anthropic**（Building effective human-agent teams 2026）："grant agents autonomy in proportion to demonstrated reliability, then expand it deliberately"；团队 batch agent questions。→ SUPPORTS merge、ledger、escalation。
10. **Boris Cherny**："Give Claude a way to verify its work — it will 2–3× the quality"；不用 skip-permissions，用 /permissions 显式白名单；先 plan mode 对齐。→ SUPPORTS verifier；REFINES ledger 应表现为可见可编辑的 allowlist。
11. **Dan Shipper / Kieran Klaassen**（Compound Engineering）：plan→work→review→compound；"13 AI agents reviewing in parallel caught a critical bug"。→ REFINES ledger：每次拒绝的原因沉淀为规则。
12. **Geoffrey Huntley**（Ralph）："Specs are the real asset"。→ SUPPORTS "多数 AttentionRequest 其实是 spec 缺口"。

### 设计/研究者与批评
13. **Burak Dede**（The Pull Request is Dead）："The human LGTM has become the single biggest liability"；人审 spec 与 intent。→ CONTRADICTS 以 PR 为单位的 inbox 条目；REFINES EvidencePacket 以 intent 为首。
14. **Margaret Storey 等**（Cognitive Debt, ACM Queue 2026）："the humans involved may have simply lost the plot"；"at least one human on the team fully understands each AI-generated change before it ships"。→ CONTRADICTS 只优化"少干预"：干预越少认知负债越高；REFINES 指标需加理解度。
15. **Charlie Guo**（The AI Manager's Schedule）：日程碎成 "five, ten, and fifteen-minute intervals"，"The five-minute intervals become exhausting"。→ REFINES 预算按"人 × 时段"而非"每任务"。
16. **Grunde-McLaughlin, Amershi, Fourney 等**（Overseeing Agents Without Constant Oversight 2026）：更好的 trace 界面减少了找错时间，但 "improved confidence didn't translate to better accuracy"。→ CONTRADICTS "4 行 resume context 足以支撑正确决策"；REFINES EvidencePacket 需要可展开的可验证证据。
17. **Luke Wroblewski**（Agent Management Interface Patterns 2025）：六动作 start/schedule/scrutinize/steer/stop/see；Inbox 与 Calendar 两种模式。→ SUPPORTS Exception Inbox；REFINES scheduler 接入日历。
18. **Sonar / Faros**（2026）："96% don't fully trust AI code, only 48% always verify"。→ SUPPORTS rubber-stamp rate。

## (b) Amershi 18 条 → FFA 映射与缺口

| G# | 指南 | FFA 组件 | 缺口 |
|---|---|---|---|
| G1 能做什么 | trust ledger 等级 | 缺"当前自治等级"面板（Osmani L0–L5） |
| G2 做得多好 | EvidencePacket | 缺 verifier 通过率/历史准确率 |
| G3 按情境择时 | HumanStateModel | 推断不可靠；需 pull 模式与日历信号 |
| G4 情境相关信息 | 4 行 context | 无法展开到证据 |
| G5 社交规范 | — | headline 语气/紧急度校准 |
| G7 高效调用 | — | Inbox 缺"我要看进度"入口 |
| G8 高效驳回 | options/超时 | 缺一键 snooze/降级 |
| G9 高效纠错 | options | 纠错未回流为规则 |
| G10 存疑时收缩 | safe default | 静默决策需显式审计 |
| G11 解释原因 | i_did | 缺"为何现在问你/为何没问" |
| G12 记住近期 | batch_key | 会话间上下文未持久 |
| G13 从行为学习 | ledger | 只计数不学拒绝原因 |
| G14 谨慎更新 | 10 次晋升 | 与不对称信任冲突，缺降级 |
| G15 细粒度反馈 | 无 | 需 per-request "这不该问我/该早点问" |
| G16 说明后果 | blast_radius | 缺撤销按钮 |
| G17 全局控制 | quiet hours、预算 | 缺全局 autonomy slider |
| G18 通知变更 | 无 | 自动晋升必须通知 |

## (c) 最重要的设计变更
1. 重做 trust ledger：以"verifier 通过 + 可撤销"计证据；不对称降级；晋升强制通知并可撤回；拒绝原因沉淀为规则
2. ask-vs-act 加第三轴"品味/设计决策"
3. 审阅单位改为 intent/spec 差异 + verifier 结论 + "什么能证明我错了"，diff 折叠
4. 预算按"人 × 时段"并接入日历；HumanState 默认 pull/自报，推断 opt-in
5. 反 rubber-stamp：记录停留时间、随机深审抽样、禁止"全部已读"、safe-default 决策进独立审计队列带 undo
6. 前置 spec 门：强制 plan/interview 阶段
7. 理解度指标：架构级变更要求"至少一人完全理解"签字
8. 升级阶梯对齐 OS 打断等级

## (d) Sources
- https://www.ai21.com/blog/karpathys-leash/
- https://buttondown.com/verified/archive/the-end-of-vibe-coding-andrej-karpathys-shift-to/
- https://simonwillison.net/2026/May/6/vibe-coding-and-agentic-engineering/
- https://simonw.substack.com/p/vibe-engineering
- https://oreillyradar.substack.com/p/steve-yegge-wants-you-to-stop-looking
- https://steve-yegge.medium.com/welcome-to-gas-town-4f25ee16dd04
- https://maggieappleton.com/gastown
- https://mitchellh.com/writing/my-ai-adoption-journey
- https://lucumr.pocoo.org/2026/2/13/the-final-bottleneck/
- https://newsletter.kentbeck.com/p/trust-factory
- https://newsletter.kentbeck.com/p/augmented-coding-beyond-the-vibes
- https://addyo.substack.com/p/agentic-autonomy-levels
- https://addyo.substack.com/p/own-the-outer-loop
- https://claude.com/blog/building-effective-human-agent-teams
- https://www.anthropic.com/research/building-effective-agents
- https://paddo.dev/blog/how-boris-uses-claude-code/
- https://www.anthropic.com/engineering/claude-code-best-practices
- https://every.to/c/compounding-engineering
- https://www.codecentric.de/en/knowledge-hub/blog/the-ralph-wiggum-loop-autonomous-code-generation-with-a-fresh-context
- https://burakdede.com/blog/the-pull-request-is-dead-surviving-the-ai-code-avalanche/
- https://margaretstorey.com/blog/2026/02/09/cognitive-debt/
- https://queue.acm.org/detail.cfm?id=3807966
- https://www.ignorance.ai/p/the-ai-managers-schedule
- https://arxiv.org/abs/2602.16844
- https://lukew.com/ff/entry.asp?2106=
- https://www.microsoft.com/en-us/research/group/customer-insights-research/articles/guidelines-for-human-ai-interaction-eighteen-best-practices-for-human-centered-ai-design/
- https://www.sonarsource.com/company/press-releases/sonar-data-reveals-critical-verification-gap-in-ai-coding/
- https://pair.withgoogle.com/guidebook-v2/chapter/explainability-trust/
