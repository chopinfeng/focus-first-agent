# @focus-first/ffa · Attention Kernel

The framework half of Focus-First Agent: a small, dependency-free kernel that sits between any agent runtime and the person supervising it. Every event that might need a human becomes an **AttentionRequest** (`schema/attention_request.json`), and the kernel decides whether, when, and how it reaches the person, or whether it never should.

Design and evidence: `../docs/DESIGN.md`. Live demo that drives it with real LLM agents: `../demo/`.

## What it does

| Concern | Behaviour |
|---|---|
| Classification | By **effect**, not tool name: `fs.read / fs.write / fs.delete / net.out / proc.exec / message.out`; scope-aware; MCP-style reversibility |
| Levels | **Warning** (consent, push, blocks) · **Caution** (consent, inbox, deferred to a breakpoint) · **Advisory** (exception: applies a safe default after `applyAfter`, lands in the "decided for you" queue with undo) |
| Human state | `FOCUS / BREAKPOINT / AWAY`; Cautions wait for the next breakpoint, Warnings never wait |
| Merging | Same `batch_key` within 5 sim-minutes collapses into one digest line |
| Flood | ≥ 10 events from one agent in 10 sim-minutes fold into a single item |
| Timeouts | Advisory → default → `decided[]`; answered items are dropped before timeouts |
| Approval memory | A human (or bypass) approval of an exact effect lets the retry pass as ACT |
| Evidence | `deliverEvidence(task, packet, archLevel, verified)`: verifier failure or architecture-level change → Caution, never auto-merge |
| Two counters | `base` (what per-event popups would cost) and `ffa` (what actually reached the person), priced by state: FOCUS 12, BREAKPOINT 1, AWAY push 3 min |
| Review data | `review.{transcript, files, summaries, silent, irreversible}`: what a person would have to read in bypass mode |
| Modes | `ffa` (default) or `bypass` (nobody is asked; defaults execute; silent decisions and irreversible actions are recorded for the comparison) |

## API

```js
import { createKernel } from "@focus-first/ffa";

const k = createKernel({ scale: 2, mode: "ffa" });        // 1 sim-minute = 2 s
k.ev.on("change", () => render(k.S));                      // S is the full state snapshot

const c = k.classify(task, "delete_file", { path: "db/old.sql" });   // → { kind: "ar", level: "caution", irreversible: true, ... }
const r = k.route(c);                                                 // { status: "act" | "pending" | "blocked" | "bypassed", id, promise }

k.human("commit");           // coarse breakpoint: pending Cautions are delivered now
k.human("away"); k.human("back"); k.human("focus");
k.answer(id, optionIndex);   // Warning option 0 needs a second press (returns "armed" first)
k.undo(id);                  // revert a decided-for-you default; the agent is told
k.takeResolved(agentId);     // decisions that resolved while the agent worked
k.hasOpen(agentId); await k.waitAny(agentId);
k.deliverEvidence(task, packet, archLevel, verified);
k.record(agentId, entry); k.recordFiles(agentId, files); k.recordSummary(agentId, packet);
k.stop();
```

`task` needs `{ id, agent, scope: { include, exclude } }`. For deterministic tests pass `clock` and `autoTick: false` and call `k.tick()` yourself (see `test/`).

## Invariants covered by tests

- Warning and irreversible requests are never auto-applied (`p0_auto_pass = 0`).
- Cautions raised during FOCUS are not delivered until a breakpoint; Warnings are delivered immediately.
- Advisory with a default applies after `applyAfter` and appears in `decided[]`; an answered Advisory does not time out afterwards.
- Same `batch_key` merges; ten events in ten minutes fold into one flood item.
- Bypass mode records every silent decision and irreversible action, and approval memory lets retried effects pass.

```bash
cd ffa && npm test
```
