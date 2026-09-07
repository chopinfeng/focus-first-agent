// FFA live demo server: serves the demo page, streams kernel state over SSE, runs real LLM agents.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createKernel } from "./kernel.mjs";
import { TASKS, setupSandbox } from "./tasks.mjs";
import { runAgent, makeProvider } from "./agent.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = +(process.env.PORT || 8765);
const SCALE = +(process.env.SIM_SCALE || 2);
const cfg = { provider: process.env.LLM_PROVIDER || "anthropic", model: process.env.LLM_MODEL || "claude-opus-5", baseUrl: process.env.LLM_BASE_URL, apiKey: process.env.LLM_API_KEY, fallbacks: process.env.LLM_FALLBACKS !== "0" };
const taskIds = (process.env.TASKS || "greet,cleanup,docs").split(",").map((s) => s.trim()).filter((s) => TASKS[s]);

const MODE = process.env.MODE === "bypass" ? "bypass" : "ffa";
const kernel = createKernel({ scale: SCALE, mode: MODE });
const clients = new Set();
const log = (s) => console.log(new Date().toISOString().slice(11, 19), s);
kernel.ev.on("change", broadcast);
function snapshot() { const { S } = kernel; return JSON.stringify({ ...S, m: kernel.now(), hs: kernel.hs(), inbox: S.inbox.map(strip), pending: S.pending.map(strip), decided: S.decided.map((d) => ({ m: d.m, ar: strip(d.ar) })), phone: S.phone ? { m: S.phone.m, ar: strip(S.phone.ar) } : null, cfg: { provider: cfg.provider, model: cfg.model, scale: SCALE, mode: MODE } }); }
function strip(ar) { const { resolver, promise, ...rest } = ar; return rest; }
function broadcast() { const data = `data: ${snapshot()}\n\n`; for (const res of clients) res.write(data); }

let started = false;
async function start() {
  if (started) return; started = true; kernel.S.started = true;
  let provider;
  try { provider = await makeProvider(cfg); } catch (e) { log("provider error: " + e.message); kernel.S.error = e.message; broadcast(); return; }
  const root = path.join(here, "sandbox");
  await Promise.all(taskIds.map(async (id) => { const task = TASKS[id]; const dir = setupSandbox(root, task); log(`[${task.agent}] sandbox ${dir}`); await runAgent({ task, dir, kernel, provider, log }); }));
  log("all agents finished"); kernel.S.done = true; broadcast();
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/" || u.pathname === "/demo.html") { const html = fs.readFileSync(path.join(here, "..", "docs", "demo.html"), "utf8"); res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(html); }
  if (u.pathname === "/events") { res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "access-control-allow-origin": "*" }); res.write(`data: ${snapshot()}\n\n`); clients.add(res); req.on("close", () => clients.delete(res)); return; }
  if (u.pathname === "/state") { res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" }); return res.end(snapshot()); }
  if (req.method === "OPTIONS") { res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST" }); return res.end(); }
  if (req.method === "POST") {
    let body = ""; for await (const ch of req) body += ch; let j = {}; try { j = JSON.parse(body || "{}"); } catch {}
    const ok = (v) => { res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" }); res.end(JSON.stringify({ ok: v })); };
    if (u.pathname === "/start") { start(); return ok(true); }
    if (u.pathname === "/answer") return ok(kernel.answer(j.id, +j.k));
    if (u.pathname === "/undo") return ok(kernel.undo(j.id));
    if (u.pathname === "/human") { kernel.human(j.action); return ok(true); }
  }
  res.writeHead(404); res.end("not found");
});
server.listen(PORT, () => { log(`FFA live demo on http://localhost:${PORT}  mode=${MODE} provider=${cfg.provider} model=${cfg.model} tasks=${taskIds.join(",")}`); if (process.env.AUTO_START !== "0") start(); });
