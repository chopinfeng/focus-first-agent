# Focus First Agent

一个把**人的注意力**当作一等调度资源的 Agent 框架设计。可分享的页面：https://claude.ai/code/artifact/3618782c-3b93-4014-b88f-22361b492531

当前版本 **v0.2**（2026-09-03）：两轮共八路调研后的设计。

- `docs/RESEARCH.md` — 调研综合（两轮）：问题数据、学术约束、产品模式、告警工程、观点批评、评测方法
- `docs/DESIGN.md` — Focus-First Agent Framework（FFA）设计 v0.2
- `docs/CHANGELOG-v0.2.md` — v0.1 → v0.2 逐条对比与调整决策（采纳 / 部分 / 拒绝 / 延后）
- `docs/USE-CASES.md` — 20 个最终 use case，每个带可验收的注意力行为
- `docs/TESTING.md` — 四层测试方案：内核单元、适配器集成、场景回放与 17 条不变量、真人评估与模拟器验证
- `docs/BENCHMARK.md` — AttentionBench v0.2：任务集与时机标注、模拟人类与非合作 persona、拆分的注意力成本、监督退化指标、协议与目标值
- `docs/research/` — 八路原始调研
  - 01 HCI 打断科学 · 02 Agent 产品实践 · 03 HITL 框架与协议 · 04 多 Agent 监督与 ambient agents
  - 05 跨领域告警设计 · 06 业界观点与 HAI 指南 · 07 Benchmarks 与用户模拟器 · 08 第二批产品与工具
