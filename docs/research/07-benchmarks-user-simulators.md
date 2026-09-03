# 调研七：Benchmarks、Evals、用户模拟器与"何时该问"研究

## (a) 分主题发现

### 1. 基于用户模拟器的 Agent Benchmark
- **τ²-bench**（Sierra/Princeton 2025）：用户模拟器升级为 **dual-control**（用户也能调工具改共享状态）；任务组合式生成可验证；pass^k 衡量一致性。
- **Collaborative Gym**（Stanford, Shao et al. 2025）：最接近 AttentionBench。**非回合制、异步**（四类事件：共享观测更新 / 私有观测 / 新消息 / 空闲超时），`WaitTeammateContinue` 元动作；模拟用户 5 种动作（回答 / 反馈 / 直接操作环境 / 什么都不做 / 结束）并持有 agent 看不到的**隐藏信息**。指标：Delivery Rate、Task Performance、**Initiative Entropy**、**UserEnvActRatio**、满意度。失败分类学：Communication 65%（含不更新状态）、Situational Awareness 40%（含重复提问）、Planning 39%、Environment Awareness 28%、Personalization 16%。**模拟器验证**：100 条轨迹 accuracy 93% / consistency 92% / plausibility 90.3%，真人-模拟成对区分 56.9%（≈随机），失败分布 Spearman 0.803。
- **CollabSkill**（2026）：加入模拟 HITL 审批门；指标 W_human、M_team、Initiative Entropy；无协调结构时多加人反而拉低表现（0.63 vs 0.71）。
- **UserBench**：模拟用户 underspecified / incremental / indirect 逐步透露偏好；最强模型只挖出 <30% 偏好。
- **Persona Policies**（2026）：LLM 模拟用户天然"过于合作"；进化生成非合作 persona，人类判其为真人 80.4%；训练可 +17%。**VISTA** 用 tokens/turn 与 actions/turn 代理金钱与时间成本。
- **TheAgentCompany**（175 任务，模拟同事）；**MINT**（586 实例，每轮反馈 +2–17%，说明人类反馈是有价值资源，ACS 需同时计价值）。
- **InteractiveRAG bench**（2026）：交互成本拆为 **turns / question tokens（人要读）/ response tokens（人要写）**，与收益做 Pareto 前沿。**CostBench** 区分 budget-awareness 与 cost-optimality。

### 2. "何时该问"研究
- **Ask Early, Ask Late, Ask Right**（2026）：84 个变体上做**强制注入实验**（轨迹 10/30/50/70/90% 处注入真值），解耦"是否该问"与"何时问"。**goal 类澄清严重前置**（pass@3 0.78 → 70% 处 0.40），input 类到 50% 仍有价值，constraint 类几乎无益；定义 **wasted compute**（晚问可达 21.7%）与 **point of no return**。自然提问率：GPT-5.2 52%，Claude 23%，Gemini 0。
- **Calibrate-Then-Act**：探索/提问成本形式化为折扣因子；RL 单独学不会成本敏感策略。
- **SAGE-Agent / Structured Uncertainty**（2025）：EVPI − λ·冗余 选问题，停止准则 max[EVPI−Cost] < α·max_p；ClarifyBench 716 样本；每任务问题数降到 1.39。
- **Learning to Ask / AskToAct / IN3 / ClarifyGPT / ClarifyCodeBench / ClarEval**：自动构造需澄清数据；over-asking penalty；确定性规则模拟用户。
- **Anthropic Measuring agent autonomy**：批准 93%；新用户打断率 5%/turn，老用户 9%；auto-approve 20% → 40%+；最复杂任务 Claude 主动澄清 16.4% turns vs 人打断 7.1%。

### 3. 陷阱型安全 Benchmark
- **Saber**（2026，最可复用）：Docker 内 **716 个有状态工作区任务**，三类因果场景：289 嵌入式注入、186 风险自选（良性请求存在危险捷径）、241 **上下文警告**（README/注释表明不安全）；8 类风险；指标 HSR、Safe-Refusal、**Late-Refusal**、Propagating Harm。最强模型 HSR 54.7%，上下文警告场景 82.5%。
- **OS-Harm**：150 任务，6 种注入载体（含桌面通知）；标注 **first unsafe step**。
- **AgentDojo** 97×629；**Agent-SafetyBench** 876；**SafeArena** 250；**ToolEmu**；**InjecAgent**；**AgentHarm**。
- **Claude Code auto mode classifier**：评测集三份（真实流量、52 例真实 overeager、合成外泄）；FPR 0.4%，FNR 17%；按**真实影响**判定（`&&` 链视为一个动作）。媒体：1,053 测试者人类捕获 13.6%，分类器 89%。
- **AI Agents Push Humans Out of the Loop**（2026）：监督退化签名——**审查时长下降而批准率不变、override 率下降、索证减少**。

### 4. 打断/注意力仿真
- Horvitz Bounded Deferral / BusyBody：最小化期望总成本，三策略（立即、延迟到 t*、等到可用）。
- Iqbal & Bailey：断点 **Fine/Medium/Coarse 三粒度，越粗成本越低**。
- Attelia / InterruptMe：断点投递认知负荷 −46%；Attelia II 打断过载 −71.8%。
- HRI 指标（Steinfeld/Fong 2006）：Neglect Tolerance、Interaction Effort、Fan-out、Robot Attention Demand、Free Time。
- **Stochastic Gap**（2026）：C(π) = c_A·E[T] + (c_H − c_A)·Σ D_π(s)G(s)，分离升级到人的单位成本。METR time horizon 以人类耗时为横轴。

## (b) AttentionBench 应做的调整
1. ACS 拆成三项可读成本（turns / 人要读的 tokens / 人要写的 tokens）并报 Pareto 前沿
2. 引入 Neglect Tolerance / Fan-out 作现成指标
3. 解耦"是否问"与"何时问"：强制注入法标定每个决策的 point of no return，按 goal/input/constraint 给不同衰减；晚问按 wasted compute 计罚
4. 断点分 fine/medium/coarse 三级，成本递减；oracle 偏好粗断点
5. rubber-stamp 参数用实证校准：基线批准 93%，人类捕获植入危险命令仅 13.6%；"67%" 过于乐观，改为随提示数单调衰减曲线，按新手/老手分层
6. 增加"监督退化"过程指标：审查时长、override 率、索证行为随时间变化
7. 陷阱集扩到 Saber 三类因果场景（尤其上下文警告型）+ Late-Refusal
8. judge 记录 first unsafe step，按真实影响判定
9. 模拟人加非合作 persona（≥3 种）+ 隐藏信息 + 直接改环境动作
10. 模拟器验证：100 条轨迹标注 + 真人/模拟失败分布相关 + 成对可区分性
11. 采用 Co-Gym 五类失败分类，重复提问计双倍
12. 给"问"计正向价值 + over-asking penalty
13. oracle 用 EVPI 停问准则定义
14. 报告借鉴 METR：以人类耗时为横轴的 ACS 曲线

## (c) 可复用数据集 / 工具
| 资源 | 用途 | URL |
|---|---|---|
| Saber | 716 有状态安全任务 | https://github.com/sssr-lab/saber |
| OS-Harm | 150 任务 6 种注入载体 | https://arxiv.org/abs/2506.14866 |
| AgentDojo | 97 任务/629 用例 | https://github.com/ethz-spylab/agentdojo |
| Agent-SafetyBench | 876 用例 | https://github.com/thu-coai/Agent-SafetyBench |
| Collaborative Gym | 异步协作框架 + 模拟器 | https://github.com/SALT-NLP/collaborative-gym |
| τ²-bench | dual-control 模拟器 | https://github.com/sierra-research/tau2-bench |
| UserBench | 隐式偏好 | https://arxiv.org/abs/2507.22034 |
| Persona Policies | 非合作 persona | https://harshita-chopra.github.io/persona-policies/ |
| VISTA | 用户模拟工具包 | https://arxiv.org/abs/2606.11079 |
| ClarifyBench (SAGE) | 716 澄清样本 | https://arxiv.org/abs/2511.08798 |
| ClarEval / ClarifyCodeBench | 代码 agent 澄清 | https://arxiv.org/abs/2603.00187 / https://arxiv.org/abs/2607.00711 |
| IN3 / Tell Me More | 隐式意图 | https://github.com/OpenBMB/Tell_Me_More |
| TheAgentCompany | 175 任务 | https://github.com/TheAgentCompany/TheAgentCompany |
| MINT | 多轮反馈 | https://github.com/xingyaoww/mint-bench |
| METR time horizons | 人类耗时标定 | https://metr.org/time-horizons/ |

## (d) Sources
- https://arxiv.org/abs/2506.07982 · https://arxiv.org/html/2412.15701 · https://arxiv.org/html/2606.18413 · https://arxiv.org/abs/2507.22034 · https://arxiv.org/abs/2605.12894 · https://arxiv.org/abs/2606.11079 · https://arxiv.org/pdf/2412.14161 · https://arxiv.org/abs/2309.10691 · https://arxiv.org/pdf/2601.06676 · https://arxiv.org/pdf/2511.02734
- https://arxiv.org/html/2605.07937 · https://arxiv.org/html/2602.16699v1 · https://arxiv.org/html/2511.08798v2 · https://arxiv.org/abs/2409.00557 · https://arxiv.org/abs/2503.01940 · https://arxiv.org/abs/2402.09205 · https://dl.acm.org/doi/10.1145/3660810 · https://arxiv.org/pdf/2607.00711 · https://arxiv.org/pdf/2603.00187
- https://arxiv.org/html/2606.01317 · https://arxiv.org/html/2506.14866 · https://www.anthropic.com/engineering/claude-code-auto-mode · https://www.theregister.com/ai-and-ml/2026/08/10/claude-code-puts-auto-mode-in-the-drivers-seat/5285326
- https://www.anthropic.com/research/measuring-agent-autonomy · https://arxiv.org/html/2608.23642 · https://arxiv.org/pdf/2603.24582 · https://metr.org/blog/2025-03-19-measuring-ai-ability-to-complete-long-tasks/ · https://tianpan.co/blog/2026/06/25/approval-fatigue-how-human-in-the-loop-gates-decay-into-rubber-stamps
- https://www.nist.gov/publications/common-metrics-human-robot-interaction · https://erichorvitz.com/bdef_studies.htm · http://erichorvitz.com/busybody_cscw.htm · https://arxiv.org/pdf/1711.10171

注：13.6% 人类捕获率来自媒体转述；引用前核对 Anthropic 原文。
