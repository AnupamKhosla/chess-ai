# Changelog (recent)

## 2026-09-06 — overnight ships

- **Native expo app**: Play / Coach / Idea / Settings, offline demo + backend
  modes, neural voice, web-matched cburnett board, iPad support. Verified on
  iPhone 16 + iPad Pro simulators. EAS profiles for device builds.
- **Coach memory**: third repeat of a tactical habit gets named
  ("pattern, not accident").
- **Move grades**: instant Noctie-style tints in the move list.
- **AI↔Stockfish loop**: one-round `chesstool` protocol (4 ops) +
  deterministic what-if grounding with real engine numbers.
- **HumanTime pacing**: instant opponents pause like humans (0.6–4s);
  LLM turns untouched.
- **Conversation modes**: review / plan / prepare / checkin shape replies.
- **Orb coach + takeover**: canvas orb with 4 states, ghost-hand autoplay
  with speed + narration, barge-in Talk, initiative dial, CoachCast skin.
- **Trap-first lines**: tempting-move detection with refutations, Best/Trap
  tabs, human-story prompt contract (both hosts).
- **Truth layer**: win% classification, missed-mate rule, persona honesty
  guards, CLI hardening, Codex thread resume.
- **Neural voice** (local app): Piper endpoint + engine pill + fallback.
- **Trust**: footer nav, privacy policy + page, public sandbox source,
  build badge in footer.

## Still open (needs a human or heavy lift)

- Vercel one-shot can't persist login (needs KV provisioning).
- Maia humanlike opponent (weights download, phase 2).
- Mistake-drills from own blunders (designed, not built).
- Model never emitted a `chesstool` fence live (answers directly instead);
  loop is wired + tested, fires if it ever asks.
- Pre-existing test failures on clean HEAD: `test_config` embed fallbacks
  (`.env.chess` interference), `test_game` 503s, `test_rag` ChromaDB.
