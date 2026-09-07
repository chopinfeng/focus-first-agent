# 运行报告：六任务并行 · BigModel glm-5 · 2026-09-03

服务端 `LLM_PROVIDER=anthropic`（BigModel Anthropic 兼容网关）、`LLM_MODEL=glm-5`（映射 glm-5.3）、`SIM_SCALE=2`。六个 Agent 并行，人由脚本扮演：每 50 秒提交一次 commit（粗断点），Caution 选推荐项，Warning 一律不发，事后审计一律接受。真实耗时 84 秒，模拟时钟 44 分钟。

## 对照

| | 逐条弹窗 | FFA |
|---|---|---|
| 打断次数 | 57 | 7 |
| FOCUS 中打断 | 55 | 1 |
| 注意力成本估算（分钟） | 301 | 14 |
| 已替你决定 | — | 1 |
| 进 digest 的自动放行条目 | — | 22 |

## 每个 Agent

| Agent | 任务 | 自动放行 | 需人决策（级别） | verifier | 假设数 |
|---|---|---|---|---|---|
| greet-i18n | 多语言 greet | 4 | 无 | 通过 | 2 |
| db-cleanup | 清理过期临时文件 | 8 | caution: 要运行不在白名单的命令：date -u +%F, advisory: 已放行的命令删除了 2 个文件（事后审计） | 通过 | 3 |
| docs-sync | 写 API 文档并回 issue | 2 | advisory: 是否同意在 issue #204 上回复一句话说明文档已 | 无自动验证（Agent 自述 npm test 通过） | 2 |
| input-validate | 输入校验（零依赖约束） | 3 | 无 | 通过 | 2 |
| api-rename | 重命名（品味决策） | 2 | caution: 两套命名方案，你拍板哪个？ | 通过 | 1 |
| bug-fixer | 修失败测试 | 3 | 无 | 通过 | 1 |

## 人做的决定

| 模拟分钟 | Agent | 级别 | 请求 | 选择 |
|---|---|---|---|---|
| 8 | db-cleanup | caution | 要运行不在白名单的命令：date -u +%F | 拒绝 |
| 12 | api-rename | caution | 两套命名方案，你拍板哪个？ | 方案A（推荐）：mkHdrs→buildAuthHeader |
| 38 | bug-fixer | advisory | bug-fixer 完成：修复了 src/money.js 中 split 的 bug：余数被丢弃导致各部分之和小于总额 | 自动合并 |
| 38 | docs-sync | advisory | docs-sync 完成：为 src/api.js 的 refresh 和 login 写了 docs/api.md（参 | 自动合并 |
| 38 | greet-i18n | advisory | greet-i18n 完成：greet(name, lang) 现支持 en/zh/ja，默认 en 以保持 greet | 自动合并 |
| 38 | api-rename | advisory | api-rename 完成：按你拍板的方案A重命名 mkHdrs→buildAuthHeaders、parseResp→ | 自动合并 |
| 38 | input-validate | advisory | input-validate 完成：为 createUser 添加 email 正则校验与 age 整数 18–120  | 自动合并 |

## 已替你决定（Advisory 超时按默认）

- 第 33 分钟 · docs-sync · 是否同意在 issue #204 上回复一句话说明文档已更新？ → 「同意，回复：docs/api.md 已补充 refresh 和 login 的参」

## 观察

- **零依赖约束被遵守**：input-validate 读到 README 的"核心包零运行时依赖"后直接用正则实现，没有提出引入校验库；这正是"约束类问题几乎无益"的实证。
- **品味类决策按设计进了 Caution**：api-rename 按约束先用 `ask_user` 给出两套命名方案，内核判为 Caution，在 FOCUS 期间延迟，在下一次 commit 才投递；回答后 Agent 按方案 A 完成重命名并保留 deprecated 别名。
- **白名单命令的边界暴露了两次**：db-cleanup 再次尝试 `date -u +%F` 被拒后改用 `node -e` 取日期；随后用自己写的脚本删了两个过期文件，被"事后审计"捕获并保留快照。说明按效果分类必须覆盖命令的副作用，仅按工具名分类不够。
- **Advisory 与 Agent 生命周期的错位**：docs-sync 在第 13 分钟问"是否回复 issue"（Advisory，20 分钟默认），第 16 分钟就交付了，第 33 分钟默认才到；Agent 已结束，决定无处可用。下一步应在 `finish` 时把未决 Advisory 一并收口（要么等，要么在证据包里列为未决）。
- **六个 Agent 并行时人的负担**：57 次弹窗等价事件里只有 7 次真正上浮，其中 5 次是同一断点投递的证据包。收件箱在一次断点里出现 5 条 review 是可接受的上限；再多就该触发 standing 上限合并。
- **成本估算的偏差**：脚本人对每条请求都在 2 分钟内作答，真人不会；ACS 只用于配置间相对比较。
