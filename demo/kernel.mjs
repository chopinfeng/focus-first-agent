// FFA Attention Kernel (demo-scale). Routes every agent event to ACT / Advisory / Caution / Warning,
// defers to human breakpoints, merges, folds floods, applies safe defaults on timeout, and keeps the
// two counters (per-event popups vs FFA) the page displays.
import { EventEmitter } from "node:events";

const PRICE = { FOCUS: 12, BREAKPOINT: 1, AWAY: 3 };
const ALLOW_CMD = /^(node|npm (test|run)\b|ls|cat|wc)\b/;

export function createKernel({ scale = 2 } = {}) {
  const ev = new EventEmitter();
  const t0 = Date.now();
  const S = {
    live: true, m: 0, hs: "FOCUS", stream: [], inbox: [], pending: [], decided: [], digest: [],
    answered: {}, base: { i: 0, f: 0, c: 0, last: -9 }, ffa: { i: 0, f: 0, c: 0, last: -9 },
    phone: null, done: false, agents: [], started: false, routed: {},
  };
  const over = { focus: false, away: false, bpUntil: -1 };
  const ars = new Map();          // id -> ar (with resolver)
  const resolvedQ = new Map();    // agent -> [{id, headline, option}]
  const waiters = new Map();      // agent -> [resolve]
  const recent = new Map();       // agent -> [minute,...] for flood
  const flooded = new Map();      // agent -> flood ar id
  let seq = 0;

  const now = () => Math.floor((Date.now() - t0) / 1000 / scale);
  function hs(m = now()) {
    if (over.bpUntil >= m) return "BREAKPOINT";
    if (over.away) return "AWAY";
    return "FOCUS";
  }
  function cost(which, m, st, push) {
    const w = S[which]; w.i++; if (st === "FOCUS") w.f++;
    if (m - w.last >= 1) { w.c += push ? PRICE.AWAY : (PRICE[st] || 1); w.last = m; }
  }
  const log = (m, agent, text, chips) => { S.stream.unshift({ m, agent, text, chips }); if (S.stream.length > 80) S.stream.pop(); };
  const changed = () => { S.m = now(); S.hs = hs(); ev.emit("change"); };

  // ---------- classification (by effect, not by string) ----------
  function classify(task, tool, args) {
    const inScope = (p) => task.scope.include.some((g) => matchGlob(g, p)) && !task.scope.exclude.some((g) => matchGlob(g, p));
    const base = { agent: task.agent, born: now(), ttl: 240, cls: "constraint" };
    switch (tool) {
      case "read_file": case "list_files":
        return { ...base, kind: "act", effect: "fs.read", label: `${tool} ${args.path || ""}`.trim(), key: "fs.read" };
      case "write_file": {
        const ok = inScope(args.path);
        if (ok) return { ...base, kind: "act", effect: "fs.write", label: `写入 ${args.path}`, key: "fs.write:" + task.id };
        return { ...base, kind: "ar", level: "caution", urg: "soon", cls: "input", headline: `要写入 scope 外的 ${args.path}`,
          ctx: { i_did: `任务 scope 是 ${task.scope.include.join(", ")}`, i_need: `允许这一处例外，或拒绝` },
          opts: [{ l: "允许，仅此文件", rec: 1 }, { l: "拒绝" }], fallback: "拒绝", ttl: 120, effect: "fs.write.out", key: "write_file:" + args.path };
      }
      case "delete_file":
        return { ...base, kind: "ar", level: "caution", urg: "soon", cls: "input", irreversible: true, headline: `要删除 ${args.path}，不可逆`,
          ctx: { i_did: args.reason || "", i_need: `确认能否删除` }, opts: [{ l: "删除", rec: 1 }, { l: "保留" }], fallback: "保留", ttl: 240, effect: "fs.delete", key: "delete_file:" + args.path };
      case "run_command": {
        const cmd = String(args.command || "");
        if (ALLOW_CMD.test(cmd)) return { ...base, kind: "act", effect: "proc.exec", label: `运行 ${cmd}`, key: "proc.exec:" + cmd.split(" ")[0] };
        return { ...base, kind: "ar", level: "caution", urg: "now", cls: "constraint", headline: `要运行不在白名单的命令：${cmd}`,
          ctx: { i_did: args.reason || "", i_need: "允许这一次，或拒绝" }, opts: [{ l: "允许一次" }, { l: "拒绝", rec: 1 }], fallback: "拒绝", ttl: 60, effect: "proc.exec.other", key: "run_command:" + cmd };
      }
      case "ask_user": {
        const cls = ["goal", "input", "constraint", "taste"].includes(args.decision_class) ? args.decision_class : "input";
        const opts = (args.options || []).slice(0, 3).map((o, i) => ({ l: String(o), rec: i === (args.recommended_index ?? -1) ? 1 : 0 }));
        if (!opts.length) opts.push({ l: "好" }, { l: "不" });
        const hasRec = opts.some((o) => o.rec);
        const advisory = hasRec && (cls === "input" || cls === "constraint");
        return { ...base, kind: "ar", level: advisory ? "advisory" : "caution", urg: advisory ? "whenever" : "soon", cls,
          headline: String(args.question || "").slice(0, 120), ctx: { i_did: args.context || "", i_need: args.why || "需要你的决定" },
          opts, fallback: advisory ? opts.find((o) => o.rec).l : "等待", ttl: advisory ? 20 : 240, applyAfter: advisory ? 20 : undefined, effect: "ask" };
      }
      case "send_message":
        return { ...base, kind: "ar", level: "warning", urg: "now", cls: "constraint", headline: `要对外发送消息到 ${args.to}`,
          ctx: { i_did: `正文："${String(args.body || "").slice(0, 140)}"`, i_need: "逐字确认后才发；不可撤回" },
          opts: [{ l: "发送（再按一次）", danger: 1 }, { l: "改后发" }, { l: "不发", rec: 1 }], fallback: "不发", ttl: 0, effect: "message.out" };
      case "finish":
        return { ...base, kind: "finish" };
      default:
        return { ...base, kind: "act", effect: "unknown", label: tool, key: tool };
    }
  }
  function matchGlob(g, p) {
    const re = new RegExp("^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "§").replace(/\*/g, "[^/]*").replace(/§/g, ".*") + "$");
    return re.test(p);
  }

  // ---------- routing ----------
  function floodCheck(agent, m) {
    const arr = (recent.get(agent) || []).filter((x) => m - x < 10); arr.push(m); recent.set(agent, arr);
    if (arr.length >= 10 && !flooded.has(agent)) {
      const ar = mkAR({ agent, level: "advisory", urg: "soon", cls: "constraint", headline: `${agent} 10 分钟内产生 ${arr.length} 条事件，已折叠`,
        ctx: { i_did: "多为重复的读写与命令", i_need: "暂停它自检，还是让它继续" }, opts: [{ l: "暂停并让它自检", rec: 1 }, { l: "继续" }], fallback: "继续", ttl: 60, born: m, flood: true });
      flooded.set(agent, ar.id); S.pending.push(ar);
      log(m, agent, ar.headline, [["warn", "flood"], ["merge", "折叠为 1 条"], ["defer", "等断点"]]);
      return true;
    }
    if (flooded.has(agent) && arr.length < 5) flooded.delete(agent);
    return flooded.has(agent);
  }
  function mkAR(x) { const id = "ar_" + (++seq); const ar = { id, born: now(), ...x }; ars.set(id, ar); return ar; }
  function deliver(ar, m, push) {
    const st = hs(m); ar.delivered = m; S.inbox.push(ar); cost("ffa", m, st, push && st === "AWAY");
    if (push) { S.phone = { ar, m }; log(m, ar.agent, ar.headline, [["warn", "Warning · 立即"], ["warn", st === "AWAY" ? "推送到手机" : "收件箱 + 提示"], ["base", "弹窗"]]); }
    else log(m, ar.agent, ar.headline, [["defer", `投递（${st}）`]]);
  }

  /** Route a classified event. Returns {status:'act'} | {status:'pending', id} | {status:'blocked', id, promise}. */
  function route(c) {
    const m = now(), st = hs(m);
    if (c.kind === "act") {
      cost("base", m, st);
      if (floodCheck(c.agent, m)) { changed(); return { status: "act" }; }
      const last = S.digest[S.digest.length - 1];
      if (last && last.key === c.key && m - last.m <= 5) { last.n++; last.t = `已放行：${c.label}（合并 ${last.n} 条，可撤销）`; }
      else { S.digest.push({ m, a: c.agent, key: c.key, n: 1, t: `已放行：${c.label}（可撤销）` }); log(m, c.agent, c.label, [["act", "ACT · 回滚点"], ["merge", "进 digest"], ["base", "弹窗"]]); }
      changed(); return { status: "act" };
    }
    if (c.kind === "finish") return { status: "act" };
    cost("base", m, st);
    floodCheck(c.agent, m);
    const ar = mkAR(c);
    const promise = new Promise((res) => { ar.resolver = res; });
    ar.promise = promise;
    if (ar.level === "warning") { deliver(ar, m, true); changed(); return { status: "blocked", id: ar.id, promise }; }
    if (ar.level === "advisory") { log(m, ar.agent, ar.headline, [["sup", "Advisory · exception"], ["defer", ar.applyAfter ? `${ar.applyAfter} 分钟后按默认` : "等断点"], ["base", "弹窗"]]); S.pending.push(ar); changed(); return { status: "pending", id: ar.id, promise }; }
    if (st === "BREAKPOINT" || ar.urg === "now") deliver(ar, m, false);
    else { log(m, ar.agent, ar.headline, [["defer", `Caution · 延迟到断点（你在 ${st}）`], ["base", "弹窗"]]); S.pending.push(ar); }
    changed(); return { status: "pending", id: ar.id, promise };
  }
  function resolve(ar, k, how) {
    if (S.answered[ar.id] !== undefined) return;
    S.answered[ar.id] = k; const opt = ar.opts[k] || ar.opts[0];
    const q = resolvedQ.get(ar.agent) || []; q.push({ id: ar.id, headline: ar.headline, option: opt.l, how }); resolvedQ.set(ar.agent, q);
    ar.resolver && ar.resolver({ k, option: opt.l, how });
    (waiters.get(ar.agent) || []).splice(0).forEach((w) => w());
    if (S.phone && S.phone.ar.id === ar.id) S.phone = null;
  }
  function tick() {
    const m = now(), st = hs(m);
    S.pending = S.pending.filter((ar) => S.answered[ar.id] === undefined);   // answered while delivered: drop before timeouts
    if (st === "BREAKPOINT") { const keep = []; for (const ar of S.pending) { if (ar.delivered !== undefined) { keep.push(ar); continue; } if (ar.level === "caution" || (ar.level === "advisory" && !ar.applyAfter)) deliver(ar, m, false); else { deliver(ar, m, false); keep.push(ar); } } S.pending = keep; }
    const keep = [];
    for (const ar of S.pending) {
      if (ar.applyAfter && m - ar.born >= ar.applyAfter) { const k = ar.opts.findIndex((o) => o.rec); S.decided.push({ m, ar }); log(m, ar.agent, ar.headline, [["sup", `超时 → 按默认「${ar.fallback}」`], ["act", "进已替你决定"]]); resolve(ar, k < 0 ? 0 : k, "default"); }
      else keep.push(ar);
    }
    S.pending = keep; changed();
  }
  const timer = setInterval(tick, scale * 1000);

  return {
    S, ev, now, hs, classify, route, tick,
    answer(id, k) { const ar = ars.get(id); if (!ar) return false; if (ar.level === "warning" && k === 0 && !ar.armed) { ar.armed = true; changed(); return "armed"; }
      log(now(), ar.agent, ar.headline, [["act", `你选了「${ar.opts[k]?.l}」`], ["sup", `停留 ${Math.max(1, now() - (ar.delivered ?? ar.born))} min`]]); resolve(ar, k, "human"); changed(); return true; },
    undo(id) { const i = S.decided.findIndex((d) => d.ar.id === id); if (i < 0) return false; const d = S.decided.splice(i, 1)[0];
      const q = resolvedQ.get(d.ar.agent) || []; q.push({ id, headline: d.ar.headline, option: "（用户撤销了默认决定：" + d.ar.fallback + "，请改用另一个选项或询问）", how: "undo" }); resolvedQ.set(d.ar.agent, q);
      (waiters.get(d.ar.agent) || []).splice(0).forEach((w) => w()); log(now(), d.ar.agent, d.ar.headline, [["act", "已撤销，Agent 收到通知"]]); changed(); return true; },
    human(action) { const m = now();
      if (action === "commit") { over.bpUntil = m + 1; over.away = false; log(m, "you", "提交 commit（粗断点）", [["act", "延迟中的 Caution 现在投递"]]); tick(); }
      else if (action === "focus") { over.focus = !over.focus; over.away = false; log(m, "you", over.focus ? "进入专注" : "退出专注", []); }
      else if (action === "away") { over.away = true; over.focus = false; log(m, "you", "离开（开会）", [["sup", "Advisory 超时按默认；Warning 推送手机"]]); }
      else if (action === "back") { over.away = false; over.bpUntil = m + 1; log(m, "you", "回来了（粗断点）", []); tick(); }
      changed(); },
    takeResolved(agent) { const q = resolvedQ.get(agent) || []; resolvedQ.set(agent, []); return q; },
    hasOpen(agent) { return [...ars.values()].some((a) => a.agent === agent && S.answered[a.id] === undefined && a.kind === "ar"); },
    waitAny(agent) { return new Promise((res) => { const w = waiters.get(agent) || []; w.push(res); waiters.set(agent, w); }); },
    addAgent(a) { S.agents.push(a); changed(); },
    setAgent(id, patch) { const a = S.agents.find((x) => x.id === id); if (a) Object.assign(a, patch); changed(); },
    deliverEvidence(task, packet, archLevel, verified = true) {
      const needsHuman = archLevel || !verified;
      const ar = mkAR({ agent: task.agent, level: needsHuman ? "caution" : "advisory", urg: "soon", cls: "constraint",
        headline: `${verified ? "" : "verifier 失败 · "}${task.agent} 完成：${packet.summary?.slice(0, 80) || task.goal}`,
        ctx: { i_did: `验证：${String(packet.verification).slice(0, 160)}${packet.assumptions?.length ? `；假设 ${packet.assumptions.length} 条` : ""}`, i_need: !verified ? "独立验证未通过，Agent 自称完成；退回或亲自看" : archLevel ? "含架构级变更（依赖/公共接口），需要你的理解签字后合并" : "看一眼意图差异，或让它自动合并" },
        opts: !verified ? [{ l: "退回修改", rec: 1 }, { l: "仍然合并" }, { l: "稍后" }] : [{ l: archLevel ? "合并（我理解这些变更）" : "自动合并", rec: 1 }, { l: "退回修改" }, { l: "稍后" }],
        fallback: needsHuman ? "不合并" : "自动合并", ttl: 600, applyAfter: needsHuman ? undefined : 30, evidence: packet });
      const m = now(); cost("base", m, hs(m));
      if (hs(m) === "BREAKPOINT") deliver(ar, m, false); else { S.pending.push(ar); log(m, task.agent, ar.headline, [["defer", needsHuman ? "Caution · 等断点" : "Advisory · 等断点或 30 分钟后自动合并"]]); }
      changed(); return ar; },
    stop() { clearInterval(timer); },
  };
}
