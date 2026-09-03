# FFA 实验设计

> 版本 0.1，2026-09-03。目的有两个：（1）在动手实现之前，用最便宜的方式验证 v0.2 设计里最不确定的假设；（2）校准并验证 AttentionBench v0.3 的模拟人与主指标。每个实验写清假设、变量、设计、规模、指标与判定、失败后怎么改、成本。

## 0. 总览

| # | 实验 | 检验的假设 | 需要什么 | 形式 | 优先级 |
|---|---|---|---|---|---|
| E1 | 离线回放：准入门槛与三级策略 | 准入门槛能砍 30–60% 上浮而不丢真正需要人的决策 | 已有 Claude Code 会话日志 | 离线分析 | **P0，立即** |
| E2 | 审批游戏：提示密度 × 陷阱识别率 | 识别率随会话内提示数单调衰减；速率上限能保住识别率 | 一个网页游戏、20–40 人 | 真人，在线 | **P0，立即** |
| E3 | 信息形态：4 行上下文 vs 可展开证据 | 证据提高决策准确率，4 行只提高信心 | 静态 mock 收件箱、20–30 人 | 真人，在线 | **P0，立即** |
| E4 | 强制注入：标定 point of no return | goal 类前置、input 类到 50% 仍有价值 | 任务集 + Agent 运行时 | 仿真 | P0（benchmark 前置） |
| E5 | consent-only vs 三级 + exception | Advisory 超时默认把上浮减半且 bad_default ≤ 5% | P0 内核 + 模拟人 | 仿真 | P1 |
| E6 | 账本对比：批准计数 vs 证据计数 | 证据计数的 harmful auto-allow 更少、hit rate 相当 | P0 内核 + 模拟人 + 陷阱序列 | 仿真 | P1 |
| E7 | 速率预算与 flood 的代价 | 速率上限不降低 task_success，agent_stall 增加 < 20% | P0 内核 + 模拟人 | 仿真 | P1 |
| E8 | 模拟人效度 | 模拟轨迹与真人轨迹不可区分、失败分布相关 | E2/E3/E9 的真人数据 | 混合 | P1 |
| E9 | 断点投递 vs 立即投递 | 断点投递恢复更快、TLX 更低，stall 增加可接受 | P1 框架 + 8–12 人 | 真人，被试内 | P2 |
| E10 | dark cockpit + digest 对情境意识的影响 | 少打断不降低 SA，digest 提升 SA | P1 框架 + 8–12 人 | 真人，被试内 | P2 |
| E11 | Fan-out：一人管 3 / 5 / 8 个 Agent | FFA 把舒适并发从 3–5 提到 ≥ 5 | P2 框架 + 6–8 人 | 真人 | P2 |
| E12 | 四周 dogfood 纵向 | 信任账本与规则学习让上浮随周下降；无监督退化 | P1 框架 + 3–5 名日常用户 | 纵向 | P2 |
| E13 | APT / ROA 效度 | APT 与 NASA-TLX、真实人力分钟相关 ρ ≥ 0.6 | E9–E11 数据 | 相关分析 | P2 |
| E14 | 损失折算表敏感性 | 配置排名对折算表 ±50% 稳健 | benchmark 结果 | 分析 | P2 |

**建议的最小启动包**：E1 + E2 + E3，两周内完成，不需要写框架代码。三者分别回答"要不要做准入门槛""速率上限是否必要""证据字段是否必要"，结论直接决定 P0 的范围。

**统计约定**：所有实验预注册假设与主指标；效应量报 Cohen's d 或 Cliff's delta；置信区间用 bootstrap 95%；被试内设计用配对检验；多重比较用 Holm 校正；仿真实验每个条件 ≥ 5 个种子。

---

## E1 离线回放：准入门槛与三级策略

**假设**
- H1a：对真实会话的权限/提问事件应用 v0.2 准入门槛（`required_action`、`consequence_if_ignored`、`time_to_irreversible` 三项）与三级策略后，上浮到收件箱的事件数减少 30–60%。
- H1b：被过滤掉的事件里，"用户当时的回答与 Agent 默认不同"的比例 < 5%（即几乎没丢真正需要人的决策）。
- H1c：按效果分类的动作类数量 < 按命令字符串分类的 1/5，且同类批准率更一致。

**数据源**：本机 Claude Code 会话日志（`~/.claude/projects/*/*.jsonl`），含 tool_use、tool_result、用户回复；配合 `PermissionRequest` / `PreToolUse` hook 补录两周的权限事件。目标 ≥ 30 个会话、≥ 1,000 个工具调用、≥ 150 个权限/提问事件。

**流程**
1. 写解析器，把每个权限请求与 `AskUserQuestion` 抽成事件：工具、参数、时间戳、用户是否批准、是否改了参数、距上一次交互的间隔。
2. 人工标注每个事件（两名标注者，Cohen's κ ≥ 0.7）：`decision_class`、`reversible`、`effects`、Agent 默认项是否正确（看后续轨迹）。
3. 用脚本模拟 v0.2 Policy：准入门槛 → 硬规则 → decision_class → 三级判定。输出每个事件的去向：收件箱 / digest / 已替你决定 / 自动放行。
4. 对比"实际打断次数"与"FFA 会打断的次数"，并核对被过滤事件的 H1b。

**指标与判定**：上浮减少比例、被过滤事件中默认错误的比例、动作类数量、每类批准率方差。H1a 与 H1b 同时成立 → 准入门槛进 P0；H1b 不成立 → 放宽门槛（缺一项也可进收件箱）或加 decision_class 例外。

**成本**：3–4 人日。副产品：E4 与 benchmark 任务集的真实事件分布、模拟人参数的初值。

## E2 审批游戏：提示密度 × 陷阱识别率

**假设**
- H2a：陷阱识别率随会话内累计提示数 n 单调下降，形状接近指数衰减（v0.3 假设 p(n) = 0.9·exp(−n/12)）。
- H2b：在同样的总提示数下，把提示按速率上限（≤ 6/h）分散投递比密集投递识别率高 ≥ 15 个百分点。
- H2c：给每条提示加 `consequence_if_ignored` 一行，识别率提高。

**设计**：在线被试间 + 被试内混合。被试做一个 25 分钟的"代码审批"游戏：屏幕上是简化的 diff 与命令，需批准或拒绝；其中 10% 是陷阱（破坏性命令、越权路径、外发消息、注入指令，四类平均）。三个条件：
- 密集：60 条提示连续投递；
- 限速：60 条按 ≤ 6 条/5 分钟投递，其间做一个填充任务（读代码答题）；
- 限速 + 后果行。

**规模**：每条件 12–15 人，共 40 人；平台 Prolific 或内部招募，要求有 Agent 使用经验。

**指标**：识别率随 n 的曲线（拟合衰减常数）、总识别率、平均停留时间、橡皮章率、主观疲劳（单题 7 点）。

**判定**：H2a 成立 → 用拟合曲线替换模拟人的 p(n)；H2b 成立 → 速率预算保留为 P0 功能；H2b 不成立 → 速率预算降为可选，把资源转向合并与准入门槛。

**成本**：游戏 2 人日，招募费用约 40 × 15 美元，分析 1 人日。这同时复现了 Wauters 与 Anthropic 报道的"人漏掉 1/3 陷阱"，可核实那个 13.6%。

## E3 信息形态：4 行上下文 vs 可展开证据

**假设**
- H3a：4 行上下文相对"只有 headline"提高决策信心但不提高准确率（复现 Grunde-McLaughlin）。
- H3b：加可展开 proof 与 `what_would_prove_me_wrong` 提高准确率 ≥ 15 个百分点。
- H3c：proof 使停留时间增加，但增加量 < 30 秒/条。

**设计**：在线被试内，三种形态拉丁方平衡。材料：从 E1 抽 24 条真实事件改写为静态收件箱条目，每条有 ground truth 正确选项（由后续轨迹与人工标注确定），其中 8 条 Agent 推荐项是错的。三种形态：只有 headline + 选项；加 4 行 context；加 proof 展开与"什么能证明我错了"。

**规模**：24–30 人，每人 24 条。

**指标**：准确率、信心（每条 5 点）、信心-准确率校准（Brier）、停留时间、proof 展开率。

**判定**：H3b 成立 → proof 字段进 P0 的 AR schema 且收件箱首屏带展开入口；不成立 → proof 降为 P2，节省 P0 工作量。

**成本**：材料 2 人日，招募约 30 × 12 美元，分析 1 人日。

## E4 强制注入：标定 point of no return

**假设**：goal 类澄清在轨迹 30% 后价值急剧衰减，input 类到 50% 仍有价值，constraint 类近乎平坦（复现 Ask Early, Ask Late, Ask Right 在我们任务集上的结论）。

**设计**：对任务集 30 个任务的 42 个 ground-truth 决策，在参考轨迹 10 / 30 / 50 / 70 / 90% 处强制注入正确答案，每点 3 次运行，测 pass@3 与 wasted compute。

**规模**：42 × 5 × 3 = 630 次运行，Agent 侧成本约数百美元。

**产出**：每个决策的 `value_curve` 与 `point_of_no_return`，直接写入任务标注；按 decision_class 汇总曲线，用于 Scheduler 的"最晚投递时间"默认值。

**判定**：若某类曲线与预期相反（例如 constraint 类晚问价值高），修改 Policy 里 decision_class 的处理。

## E5 consent-only vs 三级 + exception

**假设**：相比全部 consent（每条都等人），Advisory 用 exception 模式（TTL 内可否决，超时默认执行）把上浮减少 ≥ 50%，agent_stall 减少 ≥ 60%，而 bad_default_rate ≤ 5%、task_success 不下降。

**设计**：仿真，四配置 × 30 任务 × 3 模拟人策略 × 5 种子：
- consent-all；
- 三级 + exception（v0.2）；
- 三级 + exception 但 Advisory 默认项由 Agent 随机选（对照，检验默认项质量的作用）；
- oracle。

**指标**：surfaces_total、agent_stall_min、bad_default_rate、task_success、ROA、"已替你决定"队列 undo 率。

**判定**：bad_default_rate > 5% → 收紧 Advisory 判定（把 input 类也提到 Caution）或延长 `apply_after`。

## E6 账本对比：批准计数 vs 证据计数

**假设**：在含陷阱的任务序列上，证据计数账本（v0.2）的 harmful auto-allow 次数比批准计数账本（v0.1）少 ≥ 80%，ledger_hit_rate 差距 < 10 个百分点；不对称降级使陷阱后的恢复更快。

**设计**：仿真，连续 20 个任务的序列（同一动作类反复出现），第 8、14 个任务植入该动作类的陷阱。四配置：无账本；批准计数（10 次晋升，对称）；证据计数 + 不对称 + 双向；证据计数但无双向监测。模拟人用 `default_dev` 与 `overrider`。

**指标**：harmful_auto_allow、p0_auto_pass、ledger_hit_rate、晋升后 undo_rate、陷阱后重新晋升所需任务数、序列末的 surfaces_per_task。

**判定**：证据计数 hit rate 显著更低 → 把晋升证据数从 10 降到 6 并重跑。

## E7 速率预算与 flood 的代价

**假设**：速率上限（1/10min、6/h）与 flood 模式使 surfaces_in_focus 降 ≥ 70%，task_success 不降，agent_stall 增加 < 20%；被降级进 digest 的请求中默认错误的比例 < 5%。

**设计**：仿真，三配置（无预算 / 速率预算 / 速率预算 + flood）× 单任务 30 个 + 并行包 6 个 × 3 策略 × 5 种子。另做参数扫描：每小时上限 ∈ {3, 6, 12}。

**指标**：surface_rate、surfaces_in_focus、agent_stall_min、task_success、digest 中错误默认比例、flood_events。

**判定**：stall 增加 > 20% → 把 Caution-soon 从预算中豁免；6/h 与 12/h 无差异 → 默认放宽到 12/h。

## E8 模拟人效度

**假设**：模拟人轨迹与真人轨迹（来自 E2、E3、E9）在 Co-Gym 协议下不可区分，失败分布相关 ≥ 0.7。

**流程**：100 条模拟轨迹 + 100 条真人轨迹；2 名标注者评 accuracy / consistency / plausibility；第三人做成对区分；五类失败分类后算 Spearman。

**判定**：未通过则调整对应参数（响应延迟、橡皮章曲线、persona 比例）并重跑；通过后冻结为 calibration v2 并写入 benchmark 报告。

## E9 断点投递 vs 立即投递（真人）

**假设**：同样的请求集合，断点投递使恢复到编辑的时间中位数缩短 ≥ 50%（Parnin 方法），NASA-TLX 心理需求分降 ≥ 1，任务完成时间不增加，agent_stall 增加 < 25%。

**设计**：被试内，两个半天，顺序平衡。被试在自己的仓库做真实任务，同时一个 Agent 跑 benchmark 任务并产生请求。条件 A：立即弹窗（模拟 baseline）；条件 B：FFA 断点投递（自报 + 日历 + opt-in 键鼠信号）。

**规模**：8–12 人。

**采集**：IDE 活动流（本地）、请求投递时间、恢复到编辑时间、TLX、Flow Short Scale、事后访谈。

**判定**：恢复时间无差异 → 断点检测信号不足，先做 E9b（只用自报 `/focus`）。

## E10 dark cockpit + digest 对情境意识的影响（真人）

**假设**：dark cockpit（working 不亮）+ digest 相比持续通知，SAGAT 探针分不低，且打断数减少 ≥ 60%；去掉 digest 后 SA 分下降 ≥ 2（证明 digest 的价值）。

**设计**：被试内三条件：持续通知；dark cockpit + digest；dark cockpit 无 digest。每条件 60 分钟，3 次随机冻结问 SA 三题；末尾做一次接管测试（终止 Agent，测正确接续时间）。

**规模**：8–12 人。

**判定**：无 digest 时 SA 不降 → digest 的价值假设不成立，降低其优先级；有 digest 仍降 → digest 内容需要改为"计划偏差"而非"进度"。

## E11 Fan-out：一人管 3 / 5 / 8 个 Agent（真人）

**假设**：baseline 下舒适并发 3–5（复现 Symphony 观察），FFA 把 task_success 不降的并发上限提到 ≥ 5；利用率 > 70% 时绩效衰退（复现 Cummings）。

**设计**：被试内，两配置 × 三并发（3/5/8），每格 45 分钟，用并行任务包。

**指标**：task_success、human_utilization（实测）、pending_threads、TLX、每任务人力分钟、错误率。

**判定**：得到 FO 实测值与利用率-绩效曲线，写回并发闸门的阈值。

## E12 四周 dogfood 纵向

**假设**：连续使用 4 周，同一动作类的上浮次数每周下降；rubber_stamp_rate 不随周上升（无监督退化）；退化审计至少触发一次且被认为有用。

**设计**：3–5 名日常使用 Claude Code 的开发者，装 FFA P1，正常工作。每周导出账本与指标，周末 15 分钟访谈。

**指标**：surfaces_per_task 周趋势、ledger_hit_rate、rubber_stamp_rate、undo_rate、supervision_decay 触发次数、"不该问我 / 该早点问"反馈数、SUS 可用性量表。

**判定**：橡皮章率随周上升 → 反橡皮章机制不够，提高深审抽样比例或改晋升通知形式。

## E13 APT / ROA 效度

**假设**：APT 与 NASA-TLX 总分 Spearman ρ ≥ 0.6；APT_raw 与真实人力分钟 ρ ≥ 0.8；ROA 高的配置在事后访谈中被评为"打断更值得"。

**数据**：E9–E11 的真人会话同时计算 APT/ROA（用真人的实际回答做反事实回放），与量表对照。

**判定**：ρ < 0.6 → 调整状态单价（可能 FOCUS 的 12 分钟过高或过低）；检查读分钟的 token 估计是否偏差。

## E14 损失折算表敏感性

**假设**：配置的 ROA 排名对折算表每项 ±50% 的扰动稳健（Kendall τ ≥ 0.8）。

**方法**：对 benchmark 结果做 1,000 次随机扰动重算 ROA 排名。

**判定**：不稳健 → 报告只给 ROA 区间不给点估计，并把折算表拆成"保守 / 中性 / 激进"三档。

---

## 附：E1 与 E2 的最小实现清单

**E1**
- `experiments/e1/parse_sessions.py`：读 `~/.claude/projects/*/*.jsonl`，输出事件 CSV。
- `experiments/e1/label.csv`：标注模板（decision_class、reversible、effects、default_correct）。
- `experiments/e1/policy_sim.py`：v0.2 Policy 的纯函数实现，输入事件输出去向。
- `experiments/e1/report.ipynb`：上浮减少比例、H1b、动作类统计。

**E2**
- 单页网页（静态 + 本地存储），60 条提示（含 6 条陷阱）随机顺序，三条件由 URL 参数控制；记录每条的决定、停留时间、时间戳；结束后导出 JSON。
- 填充任务：读一段代码回答 3 道题。
- 分析脚本：按 n 分箱拟合识别率曲线。
