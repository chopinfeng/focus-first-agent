# Focus First Agent

一个把**人的注意力**当作一等调度资源的 Agent 框架设计。可分享的页面：https://claude.ai/code/artifact/3618782c-3b93-4014-b88f-22361b492531

当前版本 **v0.2**（2026-09-03）：两轮共八路调研后的设计。

- `docs/RESEARCH.md` — 调研综合（两轮）：问题数据、学术约束、产品模式、告警工程、观点批评、评测方法
- `docs/DESIGN.md` — Focus-First Agent Framework（FFA）设计 v0.2
- `docs/CHANGELOG-v0.2.md` — v0.1 → v0.2 逐条对比与调整决策，末尾附 v0.3 价值层增补
- `docs/USE-CASES.md` — 20 个最终 use case，每个带可验收的注意力行为
- `docs/TESTING.md` — 四层测试方案：内核单元、适配器集成、场景回放与 17 条不变量、真人评估与模拟器验证
- `docs/demo.html` — 动态演示：75 分钟压缩时段里三个 Agent 的事件如何被路由（合并、延迟到断点、超时默认、洪水折叠、Warning 穿透），与逐条弹窗并排计数（在线：https://claude.ai/code/artifact/3b2a08cc-af50-4794-994a-82feb8b1782b）
- `docs/UI-UX.md` — 界面规范：以保护注意力为唯一目标的十条原则、界面注意力预算、逐个呈现面的规则与反模式清单；可点原型 `docs/ui-prototype.html`（在线：https://claude.ai/code/artifact/e388218d-e893-48f4-bf95-9824704f05f2）
- `docs/EXPERIMENTS.md` — 14 个实验：三个不需要写框架就能做的启动实验（离线回放、审批游戏、信息形态）、仿真对比、真人被试内实验、纵向 dogfood、benchmark 效度
- `docs/BENCHMARK.md` — AttentionBench v0.3：**Attention per Task** 主指标（对齐 Artificial Analysis 的 cost per task）、反事实回放的价值层（ROA、ask precision/recall、情境意识探针、接管测试）、任务集与时机标注、模拟人类与非合作 persona、监督退化指标、协议与目标值
- `docs/research/` — 八路原始调研
  - 01 HCI 打断科学 · 02 Agent 产品实践 · 03 HITL 框架与协议 · 04 多 Agent 监督与 ambient agents
  - 05 跨领域告警设计 · 06 业界观点与 HAI 指南 · 07 Benchmarks 与用户模拟器 · 08 第二批产品与工具
