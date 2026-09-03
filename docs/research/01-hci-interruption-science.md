# 调研一：注意力、打断科学与人-自动化交互（HCI/人因学）

## 1. 中断科学：中断成本与任务恢复
- **Gloria Mark (UC Irvine)**："中断后需 23 分 15 秒才能恢复"来自 Mark 的访谈而非论文原文；正式论文 *The Cost of Interrupted Work: More Speed and Stress*（Mark, Gudith & Klocke, CHI 2008）的结论是：被中断者反而更快完成任务（20.3 vs 22.8 min），但压力、挫败感与时间压力显著更高。2005 年 *No Task Left Behind*：知识工作者平均每 3 分钟切换一次任务，57% 的任务被打断。
- **Czerwinski, Horvitz & Wilhite (CHI 2004)**：知识工作者每周切换约 50 次任务；复杂任务恢复最难，"回忆上下文"是最大代价。
- **Iqbal & Bailey (CHI 2008, TOCHI 2010 "Oasis")**：defer-to-breakpoint——把通知推迟到子任务边界投递，显著降低恢复延迟、反应时间与挫败感；粗粒度断点（任务完成）比细粒度断点效果更好。
- **Sophie Leroy (2009) 注意力残留**：前一任务未完成就切换会残留注意力，降低后续表现；把前任务收尾能清除残留。
- **Chris Parnin "Programmer, Interrupted"（Parnin & Rugaber 2010）**：86 名程序员 10,000 个会话 + 414 份问卷：中断后平均需 **10–15 分钟**才重新开始编辑代码；只有 10% 的会话在 1 分钟内恢复；程序员一天通常只有一段不被打断的 2 小时；被中断任务错误率翻倍。最糟的中断时机：正在多处并行编辑、导航/搜索、理解数据流/控制流时。
- **FlowLight（Züger, Fritz et al., CHI 2017）**：449 人、12 国实地研究，基于键鼠活动推断"可打扰性"并显示红/绿灯，中断减少 46%。

**设计含义**：Agent 的"需要你"信号必须在人的断点投递，而非 Agent 的断点；恢复时由 Agent 主动重建上下文（"你刚才在做 X，我做了 Y，现在需要 Z"）。

## 2. 混合主动交互与注意力敏感通知（Horvitz）
- **Principles of Mixed-Initiative UI (CHI 1999)** 相关原则：考虑用户目标的不确定性；根据用户注意力状态决定服务时机；按代价/收益/不确定性推断最优动作；用对话解决关键不确定性；把猜错的代价降到最低；维护近期交互的工作记忆；持续观察学习。核心是三分决策：**自主执行 / 发起对话 / 什么都不做**，由期望效用决定，存在"行动阈值"与"询问阈值"。
- **Attention-Sensitive Alerting (UAI 1999) / Models of Attention (CACM 2003)**：通知投递 = 比较"推迟的期望代价"与"打断的期望代价"；Priorities/Notification Platform 用贝叶斯模型推断注意力状态，对每条信息选择投递方式（立即/推迟/换渠道/静默）。

**设计含义**：每一次"问人"都应是显式效用计算：P(需要人) × 错误代价 vs 打断代价；低风险高置信 → 自主做并可撤销；高风险 → 先做无副作用的准备再问。

## 3. 平静技术与周边感知
- **Weiser & Brown (1996)**：技术应"告知而不索求注意"，信息驻留在注意力**周边**，需要时才移到中心，且能自由往返。
- **Ambient / peripheral displays**（Ishii 1998；Matthews et al. UIST 2004；Pousman & Stasko 2006）：关键属性 **glanceability**——一眼即懂；用抽象/渐变编码状态而非文字。

**设计含义**：运行状态（进行中/卡住/需批准/完成）以周边形式呈现；只有"需要人"这一种状态允许跨入注意中心。

## 4. 人-自动化交互：监督控制
- **Parasuraman, Sheridan & Wickens 2000**：自动化拆成信息获取/分析/决策/执行四阶段各选等级；**完全自动化下 out-of-the-loop 最严重**（Endsley & Kiris 1995）：人从主动处理转为被动监视，理解层 SA 下降，接管更慢；中等自动化能保留 SA。
- **自动化自满（Parasuraman, Molloy & Singh 1993）与信任校准（Lee & See 2004）**：目标不是"更多信任"而是**校准**——信任与真实能力匹配，避免 misuse 与 disuse。
- **Fan-out 与忽视容忍度（Olsen & Goodrich 2003 / Crandall & Cummings 2007）**：一人可监督的 Agent 数 **FO ≈ NT/IT + 1**（NT = 忽视时间；IT = 交互时间）。提高 fan-out：延长 NT（更自主）或缩短 IT（更好的请求界面、更少上下文重建）。
- **Cummings & Guerlain (2007)**：操作员**利用率 > 70%** 后绩效显著衰退。

**设计含义**：显式建模每个 Agent 的 NT/IT，把人的总利用率控制在 70% 以下；关键决策阶段维持中等自动化；周期性给"摘要式"接触点。

## 5. 2024–2026：开发者与 AI 编程 Agent
- **METR RCT（2025, arXiv 2507.09089）**：16 名资深开源开发者、246 个任务，使用 AI 反而**慢 19%**，但自评快 20%。
- **纵向研究（arXiv 2605.23135，95 人 6 个月）**：工作转向"**监督性工程**"；产出感稳定（84% 报告提升），但**心流下降、认知负荷上升**，体验恶化者从 14% 升到 27%。
- **How Coding Agents Fail Their Users（arXiv 2605.29442，20,574 个真实会话）**：7 类人-Agent 错位；**91.5% 的可见错位需要人显式纠正**，90.5% 的代价是"精力与信任"；"违反约束"和"不准确的自我汇报"占比上升。
- **Professional Developers Don't Vibe, They Control（arXiv 2512.14012）**：专业开发者按任务风险分配监督强度；要求细粒度介入点与可见推理。
- **审批疲劳**：Anthropic 遥测显示用户批准约 93% 的权限提示；Wauters 4 万局审批游戏中人类**漏掉约 1/3 危险命令**；auto mode 分类器拦截约 83% 越界行为。"等待间隙"问题："长到会分心，短到干不了别的"。BCG 2026 "AI brain fry"：14% 出现管理多 Agent 的认知过载，重大失误概率高 39%。

**设计含义**：批准请求要少而重；等待期要么足够短要么可预期（ETA + 允许离开），返回时提供恢复摘要。

## 研究推导的 12 条设计原则
1. **断点投递**：仅在人的子任务边界投递非紧急请求。
2. **每次打断都做效用核算**：P(需要人)×错误代价 vs 打断代价 + 恢复代价（≥10 min）。
3. **可撤销优先于可批准**：低风险直接做并记录回滚点，事后审计替代事前审批。
4. **批准合并与分级**：把 93% 的"橡皮章"降为少量真实决策。
5. **恢复上下文由 Agent 提供**："你之前在做什么 / 我做了什么 / 现在要你决定什么 / 影响范围"。
6. **周边化状态，中心化决策**。
7. **可预期的等待**：ETA 与完成通知。
8. **保留情境意识**：关键阶段中等自动化 + 周期性一屏摘要。
9. **建模 NT/IT 与利用率上限（<70%）**。
10. **信任校准而非信任最大化**：暴露置信度与不确定性。
11. **减少错位源头**：把"违反约束"和"虚报进度"当头号注意力税。
12. **测量体验而非仅测产出**：心流、认知负荷、被打断次数。

## Sources
- https://blog.oberien.de/2023/11/05/23-minutes-15-seconds.html
- https://addyo.substack.com/p/it-takes-23-mins-to-recover-after
- https://erichorvitz.com/taskdiary.pdf
- https://interruptions.net/literature/Iqbal-CHI08.pdf
- https://dl.acm.org/doi/abs/10.1145/1879831.1879833
- https://ideas.repec.org/a/eee/jobhdp/v109y2009i2p168-181.html
- https://blog.ninlabs.com/blog/programmer-interrupted/
- https://link.springer.com/article/10.1007/s11219-010-9104-9
- https://dl.acm.org/doi/10.1145/3025453.3025662
- https://erichorvitz.com/chi99horvitz.pdf
- https://arxiv.org/abs/1301.6707
- https://www.interruptions.net/literature/Horvitz-CACM03-full.pdf
- https://calmtech.com/papers/coming-age-calm-technology
- https://dl.acm.org/doi/10.1145/1133265.1133277
- https://www.academia.edu/36874333/A_Model_for_Types_and_Levels_of_Human_Interaction_with_Automation
- https://journals.sagepub.com/doi/10.1518/001872095779064555
- https://journals.sagepub.com/doi/10.1518/hfes.46.1.50_30392
- https://scholarsarchive.byu.edu/facpub/1052/
- https://faculty.cs.byu.edu/~crandall/papers/CrandallCummingsTRO2007_Final.pdf
- https://journals.sagepub.com/doi/10.1518/001872007779598109
- https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/
- https://arxiv.org/abs/2605.23135
- https://arxiv.org/abs/2605.29442
- https://arxiv.org/abs/2512.14012
- https://arxiv.org/pdf/2509.12491
- https://www.theregister.com/ai-and-ml/2026/08/06/humans-in-the-loop-miss-a-third-of-dangerous-ai-coding-agent-requests/5284236
- https://scalex.dev/blog/ai-agent-permissions/
- https://builtin.com/articles/ai-brain-fry-software-developers
- https://fullscale.io/blog/developer-flow-state/
