# 调研二：现有 Agent 产品的注意力机制

## 一、对比表：产品 × 注意力机制

| 产品 | 中断/提问方式 | 审批/权限 | 进度展示 | 通知渠道 | 多会话管理 | 完成交付物 |
|---|---|---|---|---|---|---|
| **Claude Code** | `AskUserQuestion` 结构化多选（Plan mode 集中提问）；`permission_prompt` 等待约 6 秒才触发通知 | default / accept-edits / plan / bypass / **auto mode**（2026-08-14 起默认，独立分类器审查每个动作，deny/ask 规则优先） | 终端 TUI；Desktop 侧栏多会话 + 活动看板 | 终端 bell/桌面通知；`Notification` hook matcher：`permission_prompt`、`idle_prompt`(60s)、`agent_needs_input`、`agent_completed`；`Stop`/`SubagentStop`/`TaskCompleted` hooks；Desktop 未查看会话时发 OS 通知；手机 push | `--worktree` 隔离；Desktop 一窗多会话；Remote Control 手机接管（2026-02） | 会话文本回复；`/loop`、`/schedule` 云端 Routines（2026-04） |
| **Cursor** | Agents Window 统一列表；Slack 中可 "check back in an hour" | 本地逐步审批；Cloud Agents 隔离 VM | Cloud agent 产出 demo/截图；重设计 diff 视图 | Slack 线程回帖；PR 评论；Bugbot | Cursor 3 Agents Window（2026-04）汇聚 local/cloud/mobile/Slack/GitHub/Linear 发起的 agent | PR；Cloud agent 自动订阅自己开的 PR，修 CI、回应评论直到合并（2026-08） |
| **OpenAI Codex** | Cloud task 需输入时通过 `codex cloud wait/message` 回答 | CLI 沙箱等级；App 内逐块 approve/reject | 线程内 diff、review queue | GitHub `@codex`；App 通知 | Codex App（2026-02）每个 agent 独立 worktree，多 agent 并行 + 一处 review 队列；automations | PR |
| **GitHub Copilot coding agent** | 基本不主动打断；人靠 session log 主动介入 | Actions 沙箱，PR 需人 review | Mission Control（2025-10）实时 session log、mid-run steer/pause/restart | GitHub 通知 + PR | Agents panel 站内任意页面发任务；跨仓库看板 | PR（含 session log 作为 "reasoning artifact"） |
| **Devin** | 状态机：`working` / `waiting_for_user` / `waiting_for_approval` / `finished`；Slack 线程内提问 | Agency 开关（是否等 plan 批准）；safe mode | Slack 频道 live worklog | Slack 私信状态更新；PR 评论/CI 失败时从 sleep 唤醒 | Web 会话列表；Slack↔Web 双向同步 | PR；Slack 内 diff + Apply 按钮 |
| **Google Jules** | 先出计划，人 approve/edit；不响应自动批准 | Plan approval | 计划 + 影响文件列表 | 浏览器 tab 通知 | Web 任务列表 | PR |
| **Amazon Kiro** | proposed edits/PR，人保留合并权 | PR gating | GitHub backlog 领任务；Kiro Crew（2026-08）跨会话保留上下文、离线继续 | Jira/GitHub/Slack | 多日运行、多任务 | PR |
| **Warp** | 三类通知：Complete / Request（需输入）/ Error | 命令审批 | Tab 图标反映 working/blocked/completed/errored | Toast（最多 2 条）+ 通知邮箱（Unread/Errors 过滤）+ 后台原生桌面通知；支持第三方 agent 结构化状态 | 竖向 tabs；子 agent 不发通知只在父级；Warp Factories（2026-08）fleet 控制面 | 本地 diff / PR / summary |
| **OpenHands** | Slack `@openhands` 触发，完成回帖 | 本地/Docker/云 | 会话 UI | Slack 回帖 | Cloud 多会话 | PR |
| **Factory Droid** | Slack 频道内读写 | 终端权限 | Slack/IDE | Slack | 企业级 | PR |

（Windsurf、Replit、Amp、Cline、Aider 公开资料未见专门注意力机制。）

## 二、值得注意的模式
1. **"状态机 + 事件通知"替代轮询**：Devin、Warp、Claude Code 都给"为什么需要我"打标签，而非一律 "waiting for input"。
2. **延迟触发通知，避免抢占**：Claude Code `permission_prompt` 等约 6 秒、`idle_prompt` 等 60 秒；Desktop 仅在"没在看该会话"时发 OS 通知；Warp 子 agent 通知汇总到父会话。
3. **结构化提问 + 计划阶段集中提问**：`AskUserQuestion` 在 Plan mode 合并开放决策为多选题（带推荐项）；Jules "先审计划，不回应即自动批准"。
4. **审批分层 + 分类器兜底**：auto mode 硬规则优先于分类器；Anthropic 内测：人工只抓到 13.6% 危险命令，auto mode 抓到 89%。
5. **异步 PR 作为唯一交接面**：Cursor/Devin 更进一步——agent 自己订阅 PR，修 CI、回应评论、被 @ 时唤醒。
6. **统一收件箱/Mission Control**：GitHub Mission Control、Cursor Agents Window、Codex review queue、Warp 通知邮箱、Claude Desktop 侧栏；开源：LangChain `agent-inbox`、HumanLayer、mission-control 看板（三次失败自动升级到人）。
7. **随时随地接管**：Claude Code Remote Control、Slack 双向同步、Devin Apply 按钮。
8. **无人值守层**：`/loop` → scheduled tasks → 云端 Routines；Cursor 事件驱动 Cloud Agent；Kiro Crew 离线继续。

## 三、痛点与引用
1. **瓶颈从生成转到注意力/审查**：WorkOS："The scarce resource stops being code and becomes attention." GitLab 2026：85% 认为瓶颈转向 review；LinearB：agent PR pickup time 是人工 PR 的 5.3 倍；Faros AI（2.2 万开发者）review 时间中位数 +441.5%。
2. **决策密度与疲劳**：Stack Overflow（2026-05）："The hours haven't changed, but the density of work has... The amount of decisions we're making in a day has changed." "agentic fatigue"。
3. **审批疲劳变成安全问题**：一次任务弹 73 次审批；"flow state 大约在第 50 次审批时死掉"；"人类无法以所需吞吐量运作"。
4. **通知无上下文**：cmux 作者："Claude Code's notification body is always just 'Claude is waiting for your input' with no context." 官方文档承认终端 bell "无法告诉你多个会话中是哪个需要注意"。
5. **并行上限是人而非 agent**："two agents is almost always a win, three is context-dependent, five is a trap... The ceiling is human review bandwidth."（Nimbalyst）
6. **Babysitting 税**：Addy Osmani 引用："I spend most of my time babysitting agents... the micromanagement tax." 38% 认为审 AI 逻辑比审人写代码更费力；PR 合并 +98% 但 review 时间 +91%。
7. **审查缺少"决策轨迹"**：reviewer 拿到完成的 diff，"必须从 ticket、PR 描述和代码重建意图"；GitHub 把 session log 当 reasoning artifact 附在 PR 上。
8. **跨工具上下文丢失**：切换工具"每个工具都从零开始"，重复探索使 token 翻 2-3 倍。

## Sources
- https://claude.com/blog/auto-mode
- https://dev.to/rulestack/auto-mode-is-now-claude-codes-default-what-the-classifier-approves-and-how-to-switch-back-4j2j
- https://code.claude.com/docs/en/hooks-guide
- https://code.claude.com/docs/en/remote-control
- https://code.claude.com/docs/en/desktop
- https://code.claude.com/docs/en/worktrees
- https://code.claude.com/docs/en/agent-sdk/user-input
- https://makerkit.dev/blog/tutorials/claude-code-routines-guide
- https://www.d12frosted.io/posts/2026-01-05-claude-code-notifications
- https://cursor.com/changelog/08-19-26
- https://www.digitalapplied.com/blog/cursor-3-agents-window-complete-guide
- https://openai.com/index/introducing-the-codex-app/
- https://github.com/openai/codex/issues/24777
- https://github.blog/changelog/2025-10-28-a-mission-control-to-assign-steer-and-track-copilot-coding-agent-tasks/
- https://github.blog/ai-and-ml/github-copilot/how-to-orchestrate-agents-using-mission-control/
- https://github.blog/news-insights/product-news/agents-panel-launch-copilot-coding-agent-tasks-anywhere-on-github/
- https://docs.devin.ai/integrations/slack
- https://docs.devin.ai/api-reference/v3/sessions/post-organizations-sessions
- https://docs.devin.ai/release-notes
- https://blog.google/innovation-and-ai/models-and-research/google-labs/jules/
- https://www.infoworld.com/article/4086269/agentic-coding-with-google-jules.html
- https://www.aboutamazon.com/news/aws/amazon-ai-frontier-agents-autonomous-kiro
- https://dev.to/aws-builders/introducing-kiro-crew-awss-open-source-ai-agent-orchestrator-1e63
- https://docs.warp.dev/agents/capabilities/agent-notifications/
- https://docs.warp.dev/guides/agent-workflows/how-to-run-multiple-ai-coding-agents/
- https://www.openhands.dev/
- https://docs.factory.ai/software-factory/slack
- https://github.com/langchain-ai/agent-inbox
- https://docs.langchain.com/oss/python/langchain/human-in-the-loop
- https://ycombinator.com/launches/M8e-humanlayer-human-in-the-loop-for-ai-agents-and-beyond
- https://github.com/mateuszruszkowski/mission-control2
- https://workos.com/blog/agents-babysitting-agents
- https://stackoverflow.blog/2026/05/21/coding-agents-are-giving-everyone-decision-fatigue/
- https://addyo.substack.com/p/the-80-problem-in-agentic-coding
- https://aipatternbook.com/approval-fatigue
- https://www.buildmvpfast.com/blog/approval-fatigue-agent-permission-ux-2026
- https://grith.ai/blog/permission-fatigue-security-failure
- https://thenewstack.io/merge-gate-coding-agents/
- https://thenewstack.io/ai-code-bottleneck-myth/
- https://www.flowverify.co/blog/ai-code-review-bottleneck-2026-data
- https://explainx.ai/blog/cmux-terminal-ai-coding-agents-2026
- https://nimbalyst.com/blog/best-tools-for-running-parallel-ai-coding-agents/
- https://explainx.ai/blog/agentic-fatigue-vibe-coding-ai-developer-productivity-paradox
- https://vexp.dev/blog/cross-agent-context-share-memory-cursor-claude-code-codex
