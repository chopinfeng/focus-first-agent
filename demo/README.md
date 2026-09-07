# FFA Demo · 接入真实 LLM

把 `docs/demo.html` 从脚本演示变成真实运行：两到三个 Agent 在各自的沙箱里做真实任务，每一次工具调用都经过 FFA 注意力内核路由，页面通过 SSE 实时渲染，你的回答回传给 Agent。

```
浏览器 docs/demo.html ──SSE /events──▶ server.mjs ──▶ kernel.mjs（路由、断点、合并、flood、超时默认）
        ▲                                  │
        └── POST /answer /human /undo ─────┘──▶ agent.mjs（LLM 工具循环）──▶ sandbox/<task>/（真实文件与命令）
```

## 运行

```bash
cd demo
npm install
export ANTHROPIC_API_KEY=sk-ant-...        # 或先 `ant auth login`
npm start
# 打开 http://localhost:8765
```

默认用 Anthropic SDK 与 `claude-opus-5`。改模型：`LLM_MODEL=claude-sonnet-5`。

### 用 BigModel（智谱 GLM Coding Plan）等 Anthropic 兼容网关（已实测）

BigModel 提供 Anthropic 兼容端点，走 Anthropic SDK 即可，只需两个环境变量；服务端检测到非 api.anthropic.com 的 base URL 会自动进入兼容模式（不发 adaptive thinking 与 beta fallback 参数）：

```bash
export ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic
export ANTHROPIC_AUTH_TOKEN=<你的 Coding Plan key>
LLM_MODEL=glm-5 npm start        # glm-5 映射到 glm-5.3；其他名字会映射到 glm-5.3-flash
```

2026-09-03 用 glm-5 跑通了全部三个任务：Agent 真实读写沙箱、跑 `npm test`、提出结构化问题、尝试对外发消息被 Warning 拦住；一次任务的对照计数为逐条弹窗 39 次打断 / 289 分钟，FFA 6 次 / 27 分钟。Kimi、MiniMax 等提供 Anthropic 兼容端点的服务同理。

### 用其他 OpenAI 兼容接口（火山方舟、DeepSeek、本地模型等）

```bash
export LLM_PROVIDER=openai
export LLM_BASE_URL=https://ark.cn-beijing.volces.com/api/v3   # 以你的提供商为准
export LLM_API_KEY=...
export LLM_MODEL=...
npm start
```

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `LLM_PROVIDER` | `anthropic` | `anthropic` 或 `openai`（任意 OpenAI 兼容 chat/completions） |
| `LLM_MODEL` | `claude-opus-5` | 模型 ID |
| `LLM_BASE_URL` / `LLM_API_KEY` | — | 仅 `openai` 提供商需要 |
| `LLM_FALLBACKS` | `1` | Anthropic 上启用服务端 refusal fallback（`fallbacks: "default"`）；接口报 400 时设为 `0` |
| `PORT` | `8765` | 服务端口 |
| `SIM_SCALE` | `2` | 1 个"模拟分钟" = 多少真实秒。Advisory 的超时默认、断点日程都按模拟分钟算 |
| `TASKS` | `greet,cleanup,docs` | 启动哪些任务（逗号分隔）。可选：`greet,cleanup,docs,validate,rename,bugfix` |
| `AUTO_START` | `1` | 服务启动即开跑；设 0 则在页面按"播放"再开始 |

## 它真实做了什么

- **沙箱**：`sandbox/<task>/` 是从 `tasks.mjs` 模板生成的小型 Node 项目，Agent 用 `read_file / write_file / delete_file / list_files / run_command` 真实读写并跑 `npm test`。
- **路由**：`kernel.mjs` 按效果分类每个工具调用：范围内可逆写入直接放行进 digest；范围外或删除为 Caution，你在 FOCUS 时延迟到断点；`ask_user` 按 `decision_class` 分级，input/constraint 类带推荐项的为 Advisory，超时按推荐执行并进"已替你决定"；`send_message` 为 Warning，即使你离开也推送并阻塞；同一 Agent 10 模拟分钟内 ≥ 10 次事件触发 flood 折叠。
- **不阻塞**：Caution 与 Advisory 的工具调用立刻返回"待定"，Agent 先做不依赖它的工作，你的决定在下一轮以消息形式送回；只有 Warning 阻塞。
- **证据包**：Agent 调 `finish` 交付结论、验证证据与假设列表；内核用 `npm test` 独立验证：通过则 Advisory（可自动合并），失败则 Caution 且默认不合并。
- **事后审计**：白名单命令（如 `node scripts/cleanup.js`）若删除了文件，内核会在命令前后比对沙箱文件，生成"已放行的命令删除了 N 个文件"的 Advisory，并保留快照，选"从快照恢复"即可还原。这是实测中真实发生的情况：Agent 绕过 `delete_file` 工具用脚本删了文件。

## 安全

- 命令只允许 `node`、`npm test`、`npm run`、`ls`、`cat`、`wc`，且 cwd 锁在沙箱内；路径穿越被拒绝。
- `send_message` 不会真的对外发送，只模拟。
- API key 只在服务端；页面不接触密钥。
