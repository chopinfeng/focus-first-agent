# 调研八：第二批产品与开源工具（Round 1 未覆盖者）

## (a) 新增产品 × 注意力机制

| 产品 / 工具 | 类型 | 注意力相关机制 | 对 FFA 的映射 |
|---|---|---|---|
| **gotoHuman** | Agent 审批收件箱 SaaS | 统一 review inbox；表单模板；`assignTo` 路由；`autoApprove` 仅留痕；`updateForReviewId` 重试复用同一 review；MCP server；**无 TTL/提醒字段** | AR 的 form 化 + `supersedes_id` |
| **Permit.io Access Request MCP** | 授权层 | agent 只能"申请"敏感权限，人终审；可视化编辑器定义哪些 tool call 需 consent | policy 与 consent 屏分离 |
| **Zapier Human-in-the-Loop step** | 工作流审批 | Email/Slack；**显式 timeout + 超时动作二选一：跳过继续 / 终止**；编辑后批准；提醒延迟 | TTL + safe default 最直接商用先例 |
| **Relay.app HITL** | 工作流审批 | Approval / data-input 两类步骤 | 同上 |
| **Lindy** | 业务 agent | 有副作用动作可开确认开关；"超出范围"条件触发告警；**无超时/默认行为** | 条件化告警 |
| **Paperclip** | Agent 公司编排（开源 2026-03） | Board 审批；**预算 80% 软警告、100% 硬停**；heartbeat；每步进 ticket | 预算双阈值 |
| **OpenAI Symphony** | Codex 编排 spec（2026-05） | issue tracker 作控制面；人只做两件事：审批生成的 issue、审阅完成品；**人舒适管理 3-5 个并发 session** | 人从 session 管理员变 reviewer |
| **Gas Town / Beads** | 多 agent 编排 | Mayor 单一人机接口过滤所有通知；Witness 巡逻、Refinery 串行合并；"agents 写账本、人审计账本" | 单入口 + 账本审计 |
| **Google Antigravity** | Agent-first IDE | 跨 workspace 统一 Inbox；Artifact 审阅策略 Request Review / Always Proceed；Google Docs 式行内评论回流 | EvidencePacket + 行内评论 |
| **Cline** | IDE agent | 按类目 auto-approve；OS 通知：需审批时 + **自动批准的命令已跑 30 秒** | "静默过久"也是 AR |
| **Roo Code** | IDE agent | 8 类权限各标风险；allow/deny "最长前缀优先，同长 deny 胜" | 可执行 policy 匹配 |
| **Zed Agent Panel** | 编辑器 | `notify_when_agent_waiting`、`tool_permissions.default` | 基础 |
| **Amp Orbs** | 常驻 agent（2026） | 事件唤醒 + Slack digest；**无唤醒频率上限、无内建审批门** | 反例：没有 attention budget |
| **Omnara / Happy** | Claude Code 手机端 | 推送 + 一键批准；Watch 快捷回复；Happy #1383 远程会话不推送缺陷 | 推送可靠性需可观测 |
| **CCNotify / claude-push** | 社区工具 | 通知点击直达对应项目；ntfy 推送 | deep-link 回跳 |
| **Perplexity Computer** | 通用 agent | 后台任务**仅在值得注意时通知**；卡住进入 Needs attention 而非猜测 | noteworthy 阈值 + 卡住即上报 |
| **Manus / Replit Agent 3** | 云端 agent | 完成/出错推送；200 分钟自治 | 完成型通知 |
| **ChatGPT agent** | 通用 agent | 后果性动作前确认；Takeover；Watch mode | 三档介入强度 |
| **Claude for Chrome** | 浏览器 agent | Ask before acting / Act without asking；批准计划后独立执行，下载/敏感输入仍问；某些动作硬禁 | 计划级批准 + 敏感硬门 |
| **Agentforce** | 客服 agent | 情绪/置信度/法律敏感三类升级触发；先穷尽自动步骤再交接 | escalation 触发器分类 |

## (b) 值得直接复制的机制
1. 超时动作显式二选一（Zapier）：`on_expire` 强制枚举
2. 审批率作调参信号（waxell）：>90% 太宽，<70% 太窄；per-class approval rate
3. "静默过久"通知（Cline 30s）
4. Noteworthy-only + Needs-attention（Perplexity）
5. 重试复用同一 review（gotoHuman）→ `supersedes_id`
6. 预算双阈值 80%/100%（Paperclip）
7. 计划级批准 + 敏感动作硬门（Claude for Chrome）；不可逆边界做中间确认反而使完成时间 −13.54%
8. Priority 排序信号（Apple）：来源、时间敏感、历史互动频率
9. 同源强制分组 + 冷却（Android 16）
10. DND 只放优先联系人（Viva/Teams），focus time 读日历
11. 拒绝要带教训；批准请求展示来源证据、预期结果、错了的代价（getclaw）
12. 点击直达上下文（CCNotify）

## (c) 与当前设计冲突或需修正的证据
- **批量审批退化为橡皮章**（waxell：每天 200+ 审批 → 批量批准 → 六个月后无人真看；Replit 2025-07 删库）→ digest 内每条保留独立 risk 标签，**不可逆项禁止进 digest**
- **自动晋升信任无成功案例，且有反向数据**（Anthropic：auto-approve 20%→40%，打断率 5%→9%）→ 双向 ledger：晋升后打断率/回滚率上升即降级
- **舒适并发 3-5 session**（Symphony）→ 预算含"待处理线程数"维度
- **升级率目标 10-15%**（Galileo）作 ask-vs-act 校准目标
- **字符串 denylist 被绕过**（Cursor 放弃）→ policy 基于效果分类
- **Apple 优先通知在缺元数据的 app 上失效** → AR 必须携带结构化 risk/reversibility，不能靠内容推断
- **"Agent Decides" 置信度自判有争议**（COMPASS：开放模型 denied-edge 失败率 80-83%）→ agent 不自评是否打扰人，Kernel 确定性策略先行
- **Amp Orbs 无频率上限**是市场缺口 → notification budget 是差异化点
- **推送可靠性需监控**（Happy #1383）→ AR 记录 sent/delivered/displayed/responded

## (d) Sources
- https://docs.gotohuman.com/send-requests · https://github.com/gotohuman/gotohuman-mcp-server
- https://docs.permit.io/ai-security/access-request-mcp/overview/ · https://www.permit.io/blog/human-in-the-loop-for-ai-agents-best-practices-frameworks-use-cases-and-demo
- https://help.zapier.com/hc/en-us/articles/38731463206029-Request-approval-to-keep-your-workflow-running-with-Human-in-the-Loop · https://docs.relay.app/human-in-the-loop/human-in-the-loop-steps · https://docs.lindy.ai/testing/human-in-the-loop
- https://paperclipai-paperclip.mintlify.app/ · https://contabo.com/blog/what-is-paperclip-ai/
- https://www.infoq.com/news/2026/05/openai-symphony-agents/ · https://openai.com/index/open-source-codex-orchestration-symphony/
- https://maggieappleton.com/gastown · https://yegge.ai/gastown
- https://arjankc.com.np/blog/google-antigravity-agent-manager-explained/ · https://antigravity.google/docs/artifact-review/
- https://docs.cline.bot/features/auto-approve · https://roocodeinc.github.io/Roo-Code/features/auto-approving-actions · https://github.com/zed-industries/zed/discussions/54722
- https://www.digitalapplied.com/blog/amp-event-driven-orbs-self-scheduling-agents-2026
- https://remote.omnara.com/ · https://happy.engineering/ · https://github.com/slopus/happy/issues/1383 · https://github.com/dazuiba/CCNotify · https://github.com/coa00/claude-push
- https://www.perplexity.ai/help-center/en/articles/11521526-perplexity-tasks · https://blog.replit.com/introducing-agent-3-our-most-autonomous-agent-yet · https://manus.im/docs/features/scheduled-tasks
- https://help.openai.com/en/articles/11752874-chatgpt-agent · https://support.claude.com/en/articles/12902446-claude-in-chrome-permissions-guide
- https://www.salesforce.com/blog/agent-handoff/ · https://www.eesel.ai/blog/salesforce-ai-escalation
- https://www.anthropic.com/research/measuring-agent-autonomy
- https://changkun.de/blog/ideas/human-in-the-loop-agents/ · https://waxell.ai/blog/ai-agent-approval-workflows · https://getclaw.sh/blog/human-in-the-loop-ai-agents-approvals-2026 · https://www.developersdigest.tech/blog/approval-fatigue-agent-security-bug · https://nhimg.org/community/agentic-ai-and-nhis/ai-agent-approvals-and-alert-fatigue-what-teams-are-missing/
- https://support.apple.com/guide/iphone/summarize-notifications-reduce-interruptions-iph1fbe7d2b9/ios · https://www.technerdiness.com/iphone/priority-notifications-on-iphone/
- https://www.androidauthority.com/android-16-force-group-notifications-3565400/ · https://www.androidpolice.com/android-16-ai-powered-notification-organizer/
- https://www.magicbell.com/blog/slack-notifications-flowchart · https://raw.studio/blog/slack-catch-up-swiping-right-for-productivity/
- https://support.microsoft.com/en-us/viva/insights/focus-plan-for-viva-insights · https://help.superhuman.com/hc/en-us/articles/46005619081101-Default-Split-Inbox
