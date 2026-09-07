// LLM tool loop for one task. Every tool call goes through the kernel before it touches the sandbox.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const TOOL_DEFS = [
  { name: "list_files", description: "List files in the sandbox (recursive).", schema: { type: "object", properties: { path: { type: "string", description: "Directory, default ." } }, additionalProperties: false } },
  { name: "read_file", description: "Read a file.", schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } },
  { name: "write_file", description: "Create or overwrite a file. Files inside the task scope are applied immediately and logged for the human's digest; files outside scope are routed to the human as a Caution request and may return PENDING.", schema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"], additionalProperties: false } },
  { name: "delete_file", description: "Delete a file. Irreversible: always routed to the human. Usually returns PENDING; do other work and wait for the decision.", schema: { type: "object", properties: { path: { type: "string" }, reason: { type: "string" } }, required: ["path"], additionalProperties: false } },
  { name: "run_command", description: "Run a shell command in the sandbox. Allowed without asking: node, npm test, npm run, ls, cat, wc. Anything else is routed to the human.", schema: { type: "object", properties: { command: { type: "string" }, reason: { type: "string" } }, required: ["command"], additionalProperties: false } },
  { name: "ask_user", description: "Ask the human a structured question. Only for real decisions you cannot infer from the repo. Provide 2-3 options and a recommended_index when you have a sensible default; decision_class: goal (what to build), input (a value you need), constraint (a rule), taste (style/naming/design). input/constraint questions with a recommendation are answered by the default after 20 minutes if the human is away; goal/taste always wait for the human. Returns PENDING immediately in most cases: keep working on things that do not depend on it; the answer arrives in a later message.", schema: { type: "object", properties: { question: { type: "string" }, options: { type: "array", items: { type: "string" } }, recommended_index: { type: "integer" }, decision_class: { type: "string", enum: ["goal", "input", "constraint", "taste"] }, context: { type: "string", description: "One line: what you did that led to this" }, why: { type: "string", description: "One line: why you need it now" } }, required: ["question", "options", "decision_class"], additionalProperties: false } },
  { name: "send_message", description: "Send a message to an external destination (issue comment, email). Irreversible and public: always requires explicit human consent; this call blocks until the human decides.", schema: { type: "object", properties: { to: { type: "string" }, body: { type: "string" } }, required: ["to", "body"], additionalProperties: false } },
  { name: "finish", description: "Deliver the evidence packet when done. Call exactly once at the end.", schema: { type: "object", properties: { summary: { type: "string", description: "What you did and did not do, 1-2 sentences" }, verification: { type: "string", description: "How it was verified" }, assumptions: { type: "array", items: { type: "string" }, description: "Decisions you made without confirmation" }, what_would_prove_me_wrong: { type: "string" } }, required: ["summary", "verification", "assumptions"], additionalProperties: false } },
];

const SYSTEM = (task) => `You are a coding agent working alone in a small sandbox repository. Work autonomously and efficiently.

Task: ${task.goal}
Scope you may write to without asking: ${task.scope.include.join(", ")} (never: ${task.scope.exclude.join(", ")})
Constraints: ${task.constraints.join("; ")}
Done criteria: ${task.done.join("; ")}

Rules:
- Read README.md first; it may contain constraints that are not in the task text.
- Ask the human only for decisions you genuinely cannot infer (use ask_user with options and, when sensible, recommended_index). Goal-level questions should be asked before you start implementing.
- When a tool returns PENDING, do not wait or repeat the call: continue with work that does not depend on it. The decision will arrive in a later user message; then act on it.
- Keep changes small. Run the tests with run_command("npm test") before finishing.
- Finish with the finish tool: honest summary, how you verified, and every assumption you made without confirmation.`;

export async function runAgent({ task, dir, kernel, provider, log }) {
  const agent = task.agent;
  kernel.addAgent({ id: task.id, name: agent, state: "working" });
  const safe = (p) => { const abs = path.resolve(dir, p || "."); if (!abs.startsWith(path.resolve(dir))) throw new Error("path escapes sandbox"); return abs; };
  let finished = null, turns = 0, archLevel = false;
  const snapshots = new Map();
  const listFiles = (d) => { const out = []; (function walk(p, rel) { for (const e of fs.readdirSync(p, { withFileTypes: true })) { if (e.name === "node_modules" || e.name === ".git") continue; const r2 = rel ? rel + "/" + e.name : e.name; if (e.isDirectory()) walk(path.join(p, e.name), r2); else out.push(r2); } })(d, ""); return out; };
  const snapshotFiles = (d) => new Map(listFiles(d).map((p) => [p, fs.readFileSync(path.join(d, p))]));

  async function execTool(name, args) {
    const c = kernel.classify(task, name, args);
    const r = kernel.route(c);
    if (r.status === "pending") return `PENDING (${r.id}): 已交给人决定「${c.headline}」。请先做不依赖它的工作；结果会在后续消息里告诉你。`;
    if (r.status === "blocked") { const d = await r.promise; if (d.k !== 0) return `人的决定：${d.option}。消息未发送。`; return `已发送到 ${args.to}。`; }
    try {
      switch (name) {
        case "list_files": { const out = []; (function walk(p, rel) { for (const e of fs.readdirSync(p, { withFileTypes: true })) { if (e.name === "node_modules") continue; const r2 = rel ? rel + "/" + e.name : e.name; if (e.isDirectory()) walk(path.join(p, e.name), r2); else out.push(r2); } })(safe(args.path), ""); return out.join("\n") || "(empty)"; }
        case "read_file": return fs.readFileSync(safe(args.path), "utf8").slice(0, 20000);
        case "write_file": { const p = safe(args.path); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, args.content); if (/package\.json$/.test(args.path)) archLevel = true; return `wrote ${args.path} (${args.content.length} chars)`; }
        case "delete_file": fs.rmSync(safe(args.path), { force: true }); return `deleted ${args.path}`;
        case "run_command": {
          const before = snapshotFiles(dir); const out = await sh(args.command, dir); const after = new Set(listFiles(dir));
          const removed = [...before.keys()].filter((p) => !after.has(p));
          if (removed.length) {   // an allowlisted command deleted files: irreversible effect the tool name did not declare → surface it, keep a snapshot for undo
            const key = "cmd.delete:" + Date.now(); snapshots.set(key, new Map(removed.map((p) => [p, before.get(p)])));
            kernel.route({ agent, born: kernel.now(), kind: "ar", level: "advisory", urg: "soon", cls: "constraint", effect: "fs.delete.byCmd", key,
              headline: `已放行的命令删除了 ${removed.length} 个文件（事后审计）`, ctx: { i_did: `命令：${args.command}`, i_need: `删除了 ${removed.slice(0, 4).join(", ")}${removed.length > 4 ? " …" : ""}；已存快照` },
              opts: [{ l: "接受", rec: 1 }, { l: "从快照恢复" }], fallback: "接受", ttl: 20, applyAfter: 20 });
          }
          return out; }
        case "finish": finished = args; return "delivered";
        default: return "unknown tool";
      }
    } catch (e) { return `ERROR: ${e.message}`; }
  }
  // decisions that resolved while we were working, applied to the sandbox here
  async function applyResolved(items) {
    const lines = [];
    for (const d of items) {
      lines.push(`- ${d.headline} → ${d.option}${d.how === "default" ? "（超时按默认）" : d.how === "undo" ? "（撤销）" : ""}`);
    }
    return lines.length ? `人的决定已到：\n${lines.join("\n")}\n据此继续。若某个决定是「删除」或「允许」，现在重新调用对应工具执行（这次会直接放行）。` : "";
  }
  // once the human approved a delete/out-of-scope write, the retry must pass: remember approvals
  const approved = new Set();
  const origClassify = kernel.classify;
  const classifyWithApprovals = (t, name, args) => { const c = origClassify(t, name, args); const key = name + ":" + (args.path || args.command || ""); if (c.kind === "ar" && approved.has(key)) return { ...c, kind: "act", label: `（已批准）${name} ${args.path || args.command}`, key }; return c; };
  kernel.classify = classifyWithApprovals;
  const restored = new Set();
  kernel.ev.on("change", () => { for (const [id, k] of Object.entries(kernel.S.answered)) { const ar = kernel.S.inbox.find((x) => x.id === id) || kernel.S.decided.find((d) => d.ar.id === id)?.ar; if (!ar || ar.agent !== agent || !ar.key) continue;
    if (k === 0 && ["fs.delete", "fs.write.out", "proc.exec.other"].includes(ar.effect)) approved.add(ar.key);
    if (k === 1 && ar.effect === "fs.delete.byCmd" && snapshots.has(ar.key) && !restored.has(ar.key)) { restored.add(ar.key); for (const [p, buf] of snapshots.get(ar.key)) { const abs = path.join(dir, p); fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, buf); } log(`[${agent}] restored ${snapshots.get(ar.key).size} files from snapshot`); } } });

  const messages = [{ role: "user", content: `开始任务。先 list_files 和 read README.md。` }];
  while (turns++ < 40 && !finished) {
    let resp;
    try { resp = await provider.call({ system: SYSTEM(task), tools: TOOL_DEFS, messages }); }
    catch (e) { log(`[${agent}] LLM error: ${e.message}`); kernel.setAgent(task.id, { state: "error", error: e.message }); return; }
    messages.push(resp.assistant);
    if (resp.text) log(`[${agent}] ${resp.text.slice(0, 200)}`);
    if (resp.toolCalls.length) {
      const results = [];
      for (const tc of resp.toolCalls) { log(`[${agent}] ${tc.name} ${JSON.stringify(tc.input).slice(0, 120)}`); results.push({ id: tc.id, name: tc.name, output: await execTool(tc.name, tc.input) }); }
      // decisions that resolved meanwhile ride along with the tool results, so the agent never has to stop to receive them
      const note = await applyResolved(kernel.takeResolved(agent));
      messages.push(...provider.toolResults(results, note));
      continue;
    }
    // no tool calls: either waiting on decisions or done without finish
    if (kernel.hasOpen(agent)) { kernel.setAgent(task.id, { state: "waiting" }); await kernel.waitAny(agent); kernel.setAgent(task.id, { state: "working" }); }
    const note = await applyResolved(kernel.takeResolved(agent));
    messages.push({ role: "user", content: note || "如果任务已完成，请调用 finish 交付证据包；否则继续。" });
  }
  if (!finished) { kernel.setAgent(task.id, { state: "stopped" }); return; }
  // independent verification before the evidence packet reaches the human
  let verification = finished.verification, verified = true;
  if (task.verify) { const out = await sh(task.verify, dir); verified = /\[exit 0\]\s*$/.test(out); verification = (verified ? "verifier 通过：" : "verifier 失败：") + task.verify + "\n" + out.slice(-400); }
  kernel.deliverEvidence(task, { ...finished, verification }, archLevel, verified);
  kernel.setAgent(task.id, { state: "done" });
}

function sh(cmd, cwd) {
  return new Promise((res) => { const p = spawn("sh", ["-c", cmd], { cwd, env: { ...process.env, CI: "1" } }); let out = ""; const t = setTimeout(() => { p.kill(); out += "\n[timeout 60s]"; }, 60000);
    p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d)); p.on("close", (code) => { clearTimeout(t); res((out || "(no output)").slice(0, 4000) + `\n[exit ${code}]`); }); });
}

// ---------- providers ----------
export async function makeProvider({ provider = "anthropic", model, baseUrl, apiKey, fallbacks = true }) {
  if (provider === "mock") return makeMockProvider();
  if (provider === "anthropic") {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic();
    const tools = TOOL_DEFS.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema }));
    // Anthropic-compatible gateways (BigModel/GLM, Kimi, MiniMax…) via ANTHROPIC_BASE_URL: no adaptive-thinking param, no beta fallbacks
    const compat = provider === "anthropic-compat" || (process.env.ANTHROPIC_BASE_URL && !/api\.anthropic\.com/.test(process.env.ANTHROPIC_BASE_URL));
    return {
      async call({ system, messages }) {
        const params = compat
          ? { model, max_tokens: 8000, system, tools, messages }
          : { model, max_tokens: 16000, thinking: { type: "adaptive" }, system, tools, messages };
        const resp = fallbacks && !compat
          ? await client.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
          : await client.messages.create(params);
        if (resp.stop_reason === "refusal") return { assistant: { role: "assistant", content: resp.content }, text: "(refusal)", toolCalls: [] };
        const text = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
        const toolCalls = resp.content.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id, name: b.name, input: b.input }));
        return { assistant: { role: "assistant", content: resp.content }, text, toolCalls };
      },
      toolResults(results, note) { const content = results.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: r.output })); if (note) content.push({ type: "text", text: note }); return [{ role: "user", content }]; },
    };
  }
  // Generic OpenAI-compatible chat/completions (for non-Anthropic providers only)
  const url = baseUrl.replace(/\/$/, "") + "/chat/completions";
  const tools = TOOL_DEFS.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.schema } }));
  return {
    async call({ system, messages }) {
      const body = { model, messages: [{ role: "system", content: system }, ...messages], tools, tool_choice: "auto" };
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
      const j = await r.json(); const msg = j.choices[0].message;
      const toolCalls = (msg.tool_calls || []).map((c) => ({ id: c.id, name: c.function.name, input: safeJSON(c.function.arguments) }));
      return { assistant: { role: "assistant", content: msg.content || "", tool_calls: msg.tool_calls }, text: msg.content || "", toolCalls };
    },
    toolResults(results, note) { const msgs = results.map((r) => ({ role: "tool", tool_call_id: r.id, content: r.output })); if (note) msgs.push({ role: "user", content: note }); return msgs; },
  };
}
function safeJSON(s) { try { return JSON.parse(s || "{}"); } catch { return {}; } }

// ---------- mock provider: scripted tool sequences so the pipeline can run without an API key ----------
function makeMockProvider() {
  const scripts = {
    greet: [
      [{ name: "list_files", input: {} }, { name: "read_file", input: { path: "README.md" } }],
      [{ name: "ask_user", input: { question: "默认语言按浏览器语言还是固定英文？", options: ["固定英文", "按浏览器语言"], decision_class: "goal", context: "README 说产品尚未定", why: "决定 greet 的签名" } }],
      [{ name: "ask_user", input: { question: "语言代码用 zh 还是 zh-CN？", options: ["zh", "zh-CN"], recommended_index: 0, decision_class: "input", context: "现有测试只用短代码", why: "影响 3 个测试用例" } }],
      [{ name: "write_file", input: { path: "src/greet.js", content: "const T={en:(n)=>`Hello, ${n}!`,zh:(n)=>`你好，${n}！`,ja:(n)=>`こんにちは、${n}さん！`};\nexport function greet(name, lang='en'){ return (T[lang]||T.en)(name); }\n" } },
       { name: "write_file", input: { path: "test/greet.test.js", content: "import test from 'node:test';import assert from 'node:assert/strict';import { greet } from '../src/greet.js';\ntest('en', () => assert.equal(greet('Ada'), 'Hello, Ada!'));\ntest('zh', () => assert.equal(greet('Ada','zh'), '你好，Ada！'));\ntest('ja', () => assert.equal(greet('Ada','ja'), 'こんにちは、Adaさん！'));\n" } },
       { name: "run_command", input: { command: "npm test" } }],
      [{ name: "write_file", input: { path: "package.json", content: "{\"name\":\"greet\",\"version\":\"1.0.1\",\"private\":true,\"type\":\"module\",\"scripts\":{\"test\":\"node --test\"}}\n" } }],
      [],
      [{ name: "finish", input: { summary: "greet 支持 en/zh/ja，默认 en，兼容旧调用；未改 package.json。", verification: "npm test 3/3", assumptions: ["语言代码用短代码 zh"], what_would_prove_me_wrong: "若产品要求按浏览器语言" } }],
    ],
    cleanup: [
      [{ name: "list_files", input: {} }, { name: "read_file", input: { path: "README.md" } }],
      [{ name: "write_file", input: { path: "scripts/cleanup.js", content: "import fs from 'node:fs';const now=new Date('2026-09-03');export function expired(name){const m=name.match(/(\\d{4}-\\d{2}-\\d{2})/);return m&&(now-new Date(m[1]))/864e5>7;}\n" } },
       { name: "write_file", input: { path: "test/cleanup.test.js", content: "import test from 'node:test';import assert from 'node:assert/strict';import { expired } from '../scripts/cleanup.js';\ntest('old', () => assert.equal(expired('report-2026-08-01.json'), true));\ntest('new', () => assert.equal(expired('report-2026-09-02.json'), false));\n" } },
       { name: "run_command", input: { command: "npm test" } }],
      [{ name: "delete_file", input: { path: "data/tmp/report-2026-08-01.json", reason: "超过 7 天" } }, { name: "delete_file", input: { path: "data/tmp/report-2026-08-10.json", reason: "超过 7 天" } }],
      ...Array.from({ length: 11 }, () => [{ name: "run_command", input: { command: "ls data/tmp" } }]),
      [{ name: "run_command", input: { command: "rm -rf data/keep", reason: "顺便清理" } }],
      [],
      [{ name: "finish", input: { summary: "写了 scripts/cleanup.js 与测试；过期文件按你的决定处理。", verification: "npm test 2/2", assumptions: ["以 2026-09-03 为今天"], what_would_prove_me_wrong: "文件名日期不代表创建时间" } }],
    ],
    docs: [
      [{ name: "list_files", input: {} }, { name: "read_file", input: { path: "src/api.js" } }],
      [{ name: "write_file", input: { path: "docs/api.md", content: "# API\n\n## refresh(token)\n返回 { status }；过期返回 401。\n\n## login(email, password)\n返回 { status, token }。\n" } }],
      [{ name: "send_message", input: { to: "github issue #204", body: "文档已更新：docs/api.md 现在覆盖 refresh 与 login。" } }],
      [{ name: "finish", input: { summary: "写了 docs/api.md；issue 回复按你的决定处理。", verification: "人工核对两个函数签名", assumptions: [], what_would_prove_me_wrong: "若 src/api.js 还有未导出的函数" } }],
    ],
  };
  const cursor = {};
  return {
    async call({ system, messages }) {
      const task = /Task: (.+)/.exec(system)?.[1] || ""; const id = task.includes("greet") ? "greet" : task.includes("cleanup") ? "cleanup" : "docs";
      await new Promise((r) => setTimeout(r, 1500));
      const i = cursor[id] = (cursor[id] || 0);
      // decision-aware: if the human's decisions just arrived, act on them first (retry approved deletes / out-of-scope writes)
      const last = messages[messages.length - 1]; const txt = typeof last?.content === "string" ? last.content : "";
      const retries = [];
      if (txt.includes("人的决定已到")) {
        for (const m of txt.matchAll(/要删除 (\S+)，不可逆 → 删除/g)) retries.push({ name: "delete_file", input: { path: m[1], reason: "已批准" } });
        for (const m of txt.matchAll(/要写入 scope 外的 (\S+) → 允许/g)) retries.push({ name: "write_file", input: { path: m[1], content: JSON.stringify({ name: id, version: "1.0.1", private: true, type: "module", scripts: { test: "node --test" } }, null, 2) + "\n" } });
      }
      const step = retries.length ? retries : (scripts[id][i] || null); if (step && !retries.length) cursor[id] = i + 1;
      const toolCalls = (step || []).map((t, k) => ({ id: `${id}_${i}_${k}_${retries.length ? "r" : ""}`, name: t.name, input: t.input }));
      return { assistant: { role: "assistant", content: toolCalls.length ? "(mock) 调用工具" : "(mock) 等待决定" }, text: "", toolCalls };
    },
    toolResults(results, note) { return [{ role: "user", content: results.map((r) => `[${r.name}] ${r.output}`).join("\n") + (note ? "\n\n" + note : "") }]; },
  };
}
