# 调研三：人机协同框架 / 协议 / SDK 原语（注意力视角）

## 一、各框架的具体原语

### LangGraph / LangChain
- `interrupt(payload)` 暂停并把 payload 交给调用方；`Command(resume=...)` 恢复；需 `checkpointer` + `thread_id` 持久化。
- `HumanInTheLoopMiddleware(interrupt_on={tool: True|False|InterruptOnConfig})`；`InterruptOnConfig` 有 `allowed_decisions`、`description`、`when`（按参数决定是否打断，是"风险门控"雏形）。
- 决策四种：`approve / edit / reject / respond`。打断 payload 是 `HITLRequest{action_requests, review_configs}`。
- Ambient agents：三种人机模式 **notify / question / review**；**Agent Inbox** 类邮箱 UI。

### HumanLayer
- `@hl.require_approval()`、`hl.human_as_tool()`；contact channels：Slack / Email / Discord。
- 12-Factor Agents：Factor 7 "Contact humans with tool calls"——结构化 intent（`request_human_input`、`done_for_now`），带 **urgency (low/medium/high)** 和 **format (free text / yes-no / multiple choice)**；Factor 6 pause/resume；Factor 11 trigger from anywhere；Factor 10 small focused agents。

### 协议层
- **AG-UI (CopilotKit)**：HITL 是"前端工具调用"；`RUN_FINISHED` 的 `outcome.type === "interrupt"` 携带 `interrupts[]`；`useInterrupt / useHumanInTheLoop`。
- **A2A**：Task 状态机 `submitted → working → input-required / auth-required → completed / failed / canceled / rejected`。
- **MCP elicitation**（2025-11-25 规范）：form mode（JSON Schema 表单）和 URL mode（带外流程）。**MCP sampling**：规范要求 "SHOULD always be a human in the loop"。MCP tool annotations：`readOnlyHint / destructiveHint`。

### SDK 层
- **OpenAI Agents SDK**：`needs_approval=True | async callable(ctx, params, call_id)`；`RunResult.interruptions` → `ToolApprovalItem`；`RunState` `approve(item, always_approve=True)` / `reject(...)`；`to_json/from_json`；`Runner.run(agent, state)` 恢复。
- **Claude Agent SDK / Claude Code**：权限评估顺序 **Hooks → deny → ask → mode → allow → `canUseTool`**。模式：`default / acceptEdits / plan / dontAsk / bypassPermissions / auto`；`set_permission_mode()` 运行中切换。Hooks：`PreToolUse`（`permissionDecision: allow/deny/ask`）、`PermissionRequest`（可预先决定并**追加常驻规则**）、`Notification`（`permission_prompt / idle_prompt / auth_success / elicitation_dialog`）、`Stop`。MCP 工具可标注 `_meta["anthropic/requiresUserInteraction"]`。**auto mode**：分类器只阻止"越权、触及未知基础设施、被敌对内容驱动"三类。**Bash sandbox** 与 mode 正交。
- **Vercel AI SDK v6**：`toolApproval`（可为按输入判断的 async 函数）；`useChat().addToolApprovalResponse`。
- **Microsoft Agent Framework**：审批以 `FunctionApprovalRequestContent` 通过消息通道流转，可跨进程/重启挂起-恢复；`RequestPort / ctx.request_info()`。
- **CrewAI**：`@human_feedback`；webhook-based HITL；Enterprise 提供 responder assignment、escalation policies、SLA。
- **Temporal / Inngest**：`workflow.wait_condition(timeout=...)` + `@workflow.signal`；`step.waitForEvent`。持久化计时器让"4 小时无人则升级、24 小时自动拒绝"变成 timeout + 分支。

### 权限 / 自治模型
- 风险分层：四层（read-only / reversible / external / high-risk-irreversible）；五级 ladder（Read → Suggest → Draft → Act with confirmation → Autonomous）。Anthropic 生产数据仅 0.8% 动作不可逆——"可逆性"是最有杠杆的门控维度。
- 信任随时间增长："bike method"；Claude SDK 的 `set_permission_mode` 与 `PermissionRequest` hook 的"allow + 追加规则"最接近"记忆化信任"。
- 角色：operator / collaborator / consultant / approver / observer；HITL vs HOTL vs HIC。

## 二、跨框架"注意力原语"对照表

| 原语 | LangGraph | HumanLayer | OpenAI SDK | Claude SDK/Code | AG-UI / A2A / MCP | Temporal/Inngest |
|---|---|---|---|---|---|---|
| 暂停/恢复 | `interrupt`/`Command(resume)` | webhook 回调 | `RunState` | session/`canUseTool` | `input-required`、`interrupts[]` | signal / `waitForEvent` |
| 决策类型 | approve/edit/reject/respond | approve/reject/free-text | approve/reject(+always) | allow/deny(+updatedInput/规则) | tool result 回传 | 任意 payload |
| 按参数门控 | `InterruptOnConfig.when` | — | `needs_approval` callable | ask/deny 规则、hooks、分类器 | — | 代码逻辑 |
| 粘性/学习式信任 | — | — | `always_approve` | `PermissionRequest` 追加规则 | — | — |
| 紧急度/格式 | — | urgency + format | — | Notification 类型 | elicitation schema | — |
| 通道路由 | Agent Inbox | Slack/Email/Discord | — | Notification hook | client 渲染 | 外部 UI |
| 超时与安全默认 | — | — | — | — | — | 持久 timer + 分支 |
| notify（无需回复） | notify 模式 | — | — | `Notification` 事件 | — | — |
| 结构化 ask-user | `respond` | `human_as_tool` | — | `AskUserQuestion` | `elicitation` | — |

## 三、空白（尚无人系统化解决）
1. **决策请求缺乏统一 schema**：没有框架把 `question + options + default + deadline + consequence_of_no_answer + reversibility` 作为一等对象。
2. **批处理 / 摘要 / 静默时段**：所有 SDK 都是逐条打断；无 digest、quiet hours、合并同类审批。
3. **超时安全默认在 SDK 层缺席**：interrupt 会无限等待，无"无人回应则选保守选项"语义。
4. **信任增长没有量化模型**：无 SDK 记录"某类动作被批准 N 次后自动升级"。
5. **升级阶梯（PagerDuty 式）未与 agent 事件模型对接**。
6. **可逆性没有进入 tool 元数据驱动 ask-vs-act**：MCP 有 `readOnlyHint/destructiveHint`，但没有框架用它。
7. **面向人的可观测性仍是日志而非 plan-of-record**：无"计划对象 + 偏差 diff + what-I-need-from-you"结构化事件。
8. **注意力预算本身不被建模**。

## Sources
- https://docs.langchain.com/oss/python/langchain/human-in-the-loop
- https://www.langchain.com/blog/introducing-ambient-agents
- https://github.com/humanlayer/12-factor-agents/blob/main/content/factor-07-contact-humans-with-tools.md
- https://www.humanlayer.dev/docs/channels/introduction
- https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation
- https://modelcontextprotocol.io/specification/2025-11-25/client/sampling
- https://a2a-protocol.org/v0.3.0/specification/
- https://docs.ag-ui.com/drafts/interrupts
- https://docs.copilotkit.ai/agent-spec/human-in-the-loop
- https://openai.github.io/openai-agents-python/human_in_the_loop/
- https://code.claude.com/docs/en/agent-sdk/permissions
- https://code.claude.com/docs/en/permission-modes
- https://platform.claude.com/docs/en/agent-sdk/hooks
- https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling
- https://learn.microsoft.com/en-us/agent-framework/agents/tools/tool-approval
- https://docs.crewai.com/en/learn/human-in-the-loop
- https://docs.temporal.io/ai-cookbook/human-in-the-loop-python
- https://www.inngest.com/blog/durable-execution-key-to-harnessing-ai-agents
- https://www.mindstudio.ai/blog/classify-ai-agent-actions-by-risk
- https://www.mindstudio.ai/blog/bike-method-ai-agent-permissions-phased-trust
- https://knightcolumbia.org/content/levels-of-autonomy-for-ai-agents-1
- https://www.aidonenow.com/blog/claude-code-notification-when-waiting-for-input
- https://www.markdown.engineering/blog/2026-04-12-agent-engineering-2026
