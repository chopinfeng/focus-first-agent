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
