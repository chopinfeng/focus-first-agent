# 调研四：多 Agent 监督、Ambient/Async Agent 与人类注意力成本

## 一、关键发现

### 1. 管理一支 Agent 舰队：状态呈现与人类瓶颈
- Anthropic 多 Agent 实践（Research 系统、Claude Code subagents / agent teams / worktrees）核心是 orchestrator-worker：子 agent 返回**蒸馏后的结论而非原始数据**；建议单独设一个 verification subagent，用明确成功判据对抗 "early victory"；多 agent 成本 3–10× tokens，"先单 agent，确有需求再拆"。Boris Cherny 建议同时开 3–5 个 worktree，社区经验是 4–8 个以上"瓶颈变成 review 而非模型"。
- Codex app 自称 "command center for agents"：threads + worktrees + diff view + "needs attention" 队列，automations 定时任务把结果丢进 review 队列。Conductor / Vibe Kanban / Claude Squad 本质相同：**每个 agent 一个隔离工作区 + 一个集中面板 + 以 PR/diff 为交接单位**。
- OpenClaw "Mission Control" 把面板从 transcript 查看器改造成 **intervention/exception queue**：agent 可声明短 TTL 的 attention state（≤120 字符 + hand/alert/hourglass 图标，读后或超时自动清除）；被 approval 阻塞的 run 显式显示 "Waiting for approval" 以区分"在思考"；建议操作员"围绕异常队列（blocked / approval-required / expiring）设计工作流"。
- Slack Code（2026-08）把 agent 工作放进团队频道：实时 diff、HTML 预览、审计日志，"代码不经频道内某人批准不得 ship"。

### 2. Ambient / Proactive Agent：何时主动才不烦人
- LangChain ambient agents：由事件流触发，"只在有理由时浮出水面"；三种 HITL 模式 **notify / question / review**（信任度递增）；Agent Inbox 集中所有 agent 请求。
- THUNLP *Proactive Agent*（ICLR 2025）：reward model 模拟用户是否接受主动提议（91.8% F1），ProactiveBench 6,790 事件；模型倾向"能帮就帮"而非"该帮才帮"，**false alarm 和漏报同为失败模式**；用户接受的条件是 agent "完全理解其当前行为"并给出具体帮助。ProAgentBench（2026-02）同时评估"何时帮"与"怎么帮"。
- *An Empirical Study of Proactive Coding Assistants*（2026-05）：主动建议在**自然任务切换点**受欢迎，专注期被打断则反感；接受率取决于相关性和评估成本；建议暴露置信度、允许用户控制频率与时机。
- *Help Without Being Asked*（2026-04）：以 precision 与"打扰度"为核心指标，反馈闭环调阈值。

### 3. Async-first 工作流
- GitHub 划分：IDE agent mode = 同步结对；coding agent = 异步委派。2026 主流"三层栈"：IDE 实时协作、CLI 本地执行、云 agent 异步委派。
- Anthropic *2026 Agentic Coding Trends*：开发者 60% 工作用 AI，但**能完全委派的只有 0–20%**；"verification bottleneck" 成核心工程技能；"intent as infrastructure"。
- Review 瓶颈数据：PR 数 +98% 而 review 时间 +91%；AI PR 等待 review 时间 4.6×；中位 review 时间 +441%；31% PR 零 review 合入。

### 4. 度量人类注意力成本
- Anthropic *Measuring agent autonomy*（2026）：Claude Code 中位 turn ≈45s，P99.9 从 <25min 增至 >45min；老用户 auto-approve 从 20% 升到 40%+，但**打断率从 5% 升到 9%**（从逐步审批转为"监控 + 选择性干预"）；agent 主动澄清的频率是人打断它的 2 倍以上；内部指标 "human interventions per session" 从 5.4 降到 3.3。
- METR：2025-07 RCT 资深开发者用 AI 慢 19%（自评快 20%）；2026-02 更新中观察到开发者"等 agent 时去干别的事"使时间计量失效——**并行监督的注意力成本被传统生产力指标遗漏**。
- Stack Overflow 2025：46% 不信任 AI 输出，66% "almost right, but not quite"，仅 31% 用 agent。DORA 2025：监督认知负荷随 agent 数量线性增长。
- *Overseeing Agents Without Constant Oversight*（2026-02）正式提出 **oversight cost** 与 **attention allocation**，主张风险分级 escalation 触发器。

### 5. 信任与低成本验证
- **tests 作为注意力代理**："不 exit 0 就不算完成"（约降 80% 失败率）；PR ≤250 行；风险分层 P0–P3，"只 gate 最高风险 20% 的 PR 可覆盖 69% 的 review 工作量"；"review sandwich" 省 30–50% 人时。
- Slack Code HTML 预览、Codex diff-first、Anthropic "子 agent 只返回蒸馏结论"：**人看结论与证据，不看 transcript**。
- *Professional Developers Don't Vibe, They Control*（2025-12）：plan → checkpoint → review；负担来自"推理不透明"和"plan/monitor/review 间上下文切换"。

### 6. 显式的 attention / interrupt budget
- TianPan.co *Background Agents and the Notification Budget*（2026-05）：后台任务隐含三种预算 **money、time、attention**；用户每天只能吸收 **3–5 条**跨来源主动通知；五原则：硬性日预算上限、"价值 vs 注意力"评分、从 acted/dismissed/ignored 学习阈值、跨 agent 共享预算、渐进式 opt-out；组织需要单一 attention-policy owner。

## 二、可采纳的设计点子
1. Exception queue 作为主界面，transcript 降级为审计视图（OpenClaw、LangChain Agent Inbox）
2. 三级信任协议 notify / question / review，默认级别随历史表现自动升级
3. 显式 attention budget，超额合并进 digest
4. 打断时机对齐自然断点
5. Evidence packet 交付格式：结论 + 测试 + diff 摘要 + 预览 + 风险等级 + 未决问题
6. Verification subagent + 风险分层 gate，只有高风险 20% 进人工队列
7. Spec-first 委派 + 变更 ≤250 行
8. Attention state 带 TTL 自动清除；"等待审批"与"在思考"显式区分
9. Agent 主动澄清优先于事后返工，但澄清必须具体、可一键回答
10. 反馈闭环调阈值：acted / dismissed / ignored

## 三、指标建议
| 指标 | 定义 | 来源 |
|---|---|---|
| Interventions per task | 人主动纠正次数 | Anthropic（5.4→3.3） |
| Interrupt rate / Clarification rate | 人打断 agent 与 agent 请求澄清的频率 | Anthropic autonomy 报告 |
| Auto-approve ratio | 无需逐步批准的动作比例 | 同上 |
| Notifications acted / sent | 主动通知采纳率 | TianPan.co |
| Daily unsolicited surfaces | 每日主动上浮次数，目标 ≤3–5 | TianPan.co |
| Time-to-first-decision | 进入队列到人做决定的延迟 | review SLA |
| Human minutes per merged PR | spec + review + 修复总分钟数 | METR、review 研究 |
| Neglect time | 无人干预下 agent 可持续产出时长 | Anthropic turn 时长 |
| False-alarm rate | 无意义时提议的比例 | Proactive Agent |
| Full-delegation rate | 无需回收即完成的任务占比（当前 0–20%） | Anthropic Trends |
| Review-gated share | 需人工审的 PR 占比（目标 ~20%） | Codex review 文章 |
| Context-switch count | plan/monitor/review 间切换次数 | Don't Vibe, They Control |

## Sources
- https://claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them
- https://www.anthropic.com/research/measuring-agent-autonomy
- https://pathmode.io/blog/orchestration-era-needs-intent
- https://www.cloudzero.com/blog/claude-code-agents/
- https://devtoollab.com/blog/claude-code-git-worktrees-parallel-agents-guide
- https://intuitionlabs.ai/articles/openai-codex-app-ai-coding-agents
- https://rustman.org/wiki/conductor-parallel-agents/
- https://vibekanban.com/
- https://nimbalyst.com/blog/best-agent-management-tools-2026/
- https://openclaw.academy/blog/openclaw-control-ui-attention-workflow-main/
- https://allclaw.org/blog/openclaw-mission-control
- https://www.unite.ai/slack-code-puts-ai-coding-agents-in-dedicated-project-channels/
- https://www.langchain.com/blog/introducing-ambient-agents
- https://arxiv.org/html/2410.12361v3
- https://arxiv.org/html/2602.04482
- https://arxiv.org/pdf/2605.05700
- https://arxiv.org/pdf/2604.09579
- https://arxiv.org/pdf/2602.16844
- https://arxiv.org/pdf/2512.14012
- https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/
- https://metr.org/blog/2026-02-24-uplift-update/
- https://survey.stackoverflow.co/2025/ai
- https://www.faros.ai/blog/key-takeaways-from-the-dora-report-2025
- https://codex.danielvaughan.com/2026/05/24/human-review-bottleneck-code-review-strategies-agent-output/
- https://www.developersdigest.tech/blog/ai-coding-agents-review-queues
- https://tianpan.co/blog/2026-05-13-background-agents-notification-budget-attention-economy
- https://dev.to/battyterm/how-to-supervise-ai-coding-agents-without-losing-your-mind-53m4
- https://codepick.dev/en/guides/ai-coding-agents-2026-roadmap/
