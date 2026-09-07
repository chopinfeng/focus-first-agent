import test from "node:test";
import assert from "node:assert/strict";
import { createKernel } from "../kernel.mjs";

const task = { id: "t", agent: "a1", scope: { include: ["src/**"], exclude: ["package.json"] } };
function mk(mode = "ffa") {
  let t = 0; const clock = () => t;
  const k = createKernel({ scale: 1, mode, clock, autoTick: false });
  return { k, advance(min) { t += min * 1000; k.tick(); } };
}

test("in-scope reversible write is ACT and lands in the digest, not the inbox", () => {
  const { k } = mk();
  const r = k.route(k.classify(task, "write_file", { path: "src/a.js", content: "x" }));
  assert.equal(r.status, "act");
  assert.equal(k.S.inbox.length, 0);
  assert.equal(k.S.digest.length, 1);
});

test("irreversible delete during FOCUS is a Caution that waits for a breakpoint", () => {
  const { k } = mk();
  const c = k.classify(task, "delete_file", { path: "src/old.js" });
  assert.equal(c.level, "caution"); assert.equal(c.irreversible, true);
  const r = k.route(c);
  assert.equal(r.status, "pending");
  assert.equal(k.S.inbox.length, 0, "not delivered in FOCUS");
  k.human("commit");
  assert.equal(k.S.inbox.length, 1, "delivered at the breakpoint");
  assert.equal(k.S.inbox[0].delivered !== undefined, true);
});

test("Warning is delivered immediately, blocks, and needs a second press", async () => {
  const { k } = mk();
  const r = k.route(k.classify(task, "send_message", { to: "issue #1", body: "hi" }));
  assert.equal(r.status, "blocked");
  assert.equal(k.S.inbox.length, 1);
  assert.equal(k.answer(r.id, 0), "armed");
  assert.equal(k.answer(r.id, 0), true);
  const d = await r.promise; assert.equal(d.k, 0);
});

test("Advisory applies its default after applyAfter and appears in decided[]", () => {
  const { k, advance } = mk();
  const c = k.classify(task, "ask_user", { question: "camelCase?", options: ["camelCase", "snake_case"], recommended_index: 0, decision_class: "input" });
  assert.equal(c.level, "advisory");
  const r = k.route(c);
  assert.equal(r.status, "pending");
  advance(19); assert.equal(k.S.decided.length, 0);
  advance(1); assert.equal(k.S.decided.length, 1);
  assert.equal(k.S.answered[r.id], 0);
  assert.equal(k.S.review.silent.length, 1);
});

test("an answered Advisory does not time out a second time", () => {
  const { k, advance } = mk();
  const r = k.route(k.classify(task, "ask_user", { question: "q", options: ["a", "b"], recommended_index: 0, decision_class: "input" }));
  k.human("commit");                       // delivered at breakpoint, still pending for timeout
  assert.equal(k.S.inbox.length, 1);
  k.answer(r.id, 1);
  advance(25);
  assert.equal(k.S.decided.length, 0);
  assert.equal(k.S.answered[r.id], 1);
});

test("goal and taste questions are never Advisory, even with a recommendation", () => {
  const { k } = mk();
  for (const cls of ["goal", "taste"]) {
    const c = k.classify(task, "ask_user", { question: "?", options: ["x", "y"], recommended_index: 0, decision_class: cls });
    assert.equal(c.level, "caution"); assert.equal(c.applyAfter, undefined);
  }
});

test("same batch_key merges into one digest line", () => {
  const { k } = mk();
  for (let i = 0; i < 5; i++) k.route(k.classify(task, "write_file", { path: `src/f${i}.js`, content: "" }));
  assert.equal(k.S.digest.length, 1);
  assert.equal(k.S.digest[0].n, 5);
  assert.equal(k.S.base.i, 5, "popups would have interrupted five times");
});

test("ten events in ten minutes fold into a single flood item", () => {
  const { k } = mk();
  for (let i = 0; i < 12; i++) k.route(k.classify(task, "run_command", { command: "ls" }));
  const flood = k.S.pending.filter((a) => a.flood);
  assert.equal(flood.length, 1);
});

test("non-allowlisted command is a Caution delivered now; allowlisted is ACT", () => {
  const { k } = mk();
  assert.equal(k.classify(task, "run_command", { command: "npm test" }).kind, "act");
  const c = k.classify(task, "run_command", { command: "rm -rf data" });
  assert.equal(c.level, "caution"); assert.equal(c.urg, "now");
  k.route(c); assert.equal(k.S.inbox.length, 1);
});

test("approval memory: after a human approves an exact effect, the retry passes as ACT", () => {
  const { k } = mk();
  const c = k.classify(task, "delete_file", { path: "src/old.js" });
  const r = k.route(c); k.human("commit"); k.answer(r.id, 0);
  assert.equal(k.isApproved("a1", c.key), true);
  assert.equal(k.isApproved("a1", "delete_file:src/other.js"), false);
});

test("bypass mode asks nobody, executes defaults, and records silent + irreversible", () => {
  const { k } = mk("bypass");
  const r1 = k.route(k.classify(task, "ask_user", { question: "q", options: ["a", "b"], recommended_index: 1, decision_class: "goal" }));
  const r2 = k.route(k.classify(task, "send_message", { to: "issue #1", body: "hi" }));
  assert.equal(r1.status, "bypassed"); assert.equal(r1.k, 1);
  assert.equal(r2.status, "bypassed"); assert.equal(r2.k, 0, "bypass sends the message");
  assert.equal(k.S.inbox.length, 0);
  assert.equal(k.S.review.silent.length, 2);
  assert.equal(k.S.review.irreversible.length, 1);
  assert.equal(k.S.ffa.i, 0, "nobody was interrupted");
});

test("evidence: verifier failure or architecture-level change is a Caution with no auto-merge", () => {
  const { k } = mk();
  const ok = k.deliverEvidence(task, { summary: "s", verification: "v" }, false, true);
  assert.equal(ok.level, "advisory"); assert.equal(ok.applyAfter, 30);
  const bad = k.deliverEvidence(task, { summary: "s", verification: "v" }, false, false);
  assert.equal(bad.level, "caution"); assert.equal(bad.applyAfter, undefined); assert.equal(bad.fallback, "不合并");
  const arch = k.deliverEvidence(task, { summary: "s", verification: "v" }, true, true);
  assert.equal(arch.level, "caution");
});

test("undo of a decided-for-you default informs the agent", () => {
  const { k, advance } = mk();
  const r = k.route(k.classify(task, "ask_user", { question: "q", options: ["a", "b"], recommended_index: 0, decision_class: "input" }));
  advance(20); assert.equal(k.S.decided.length, 1);
  assert.equal(k.undo(r.id), true);
  const q = k.takeResolved("a1");
  assert.equal(q.some((x) => x.how === "undo"), true);
});
