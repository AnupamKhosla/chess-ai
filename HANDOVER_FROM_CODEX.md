# Handover from Codex — Repository Correction and Next Work

Date: 2026-08-30

## Canonical repository

This is the real project. Work only from this directory:

```text
/Users/anupamkhosla/Desktop/Projects/chess-ai
```

Expected Git configuration:

```text
origin: https://github.com/AnupamKhosla/chess-ai.git
branch: main
HEAD at handover: 31f9ed8 docs: align local project name with chess-ai
GitHub Pages: https://anupamkhosla.github.io/chess-ai/
```

Read [HANDOVER_TO_TERRA.md](./HANDOVER_TO_TERRA.md) before changing code. It
contains the prior Luna handover and the product contract.

## Important incident

An additional checkout exists at:

```text
/Users/anupamkhosla/.Trash/chessAI
```

That checkout was cloned from `jerelvelarde/ChessMCP`, not from this project.
It contains a different Vite/FastAPI prototype and its own
`HANDOFF_FOR_LUNA.md`. It is not the canonical project and must not be used
for future work.

During the previous Codex run, work was incorrectly performed in that Trash
checkout. Two commits were created there:

```text
7a088fc chore: checkpoint legacy chess coach prototype
ebc9527 feat: add engine-grounded coaching core
```

Those commits were pushed to the separate GitHub repository
`https://github.com/AnupamKhosla/ChessMCP.git`. They were not pushed to or
merged into `chess-ai`. The `chess-ai` checkout was inspected and remained
clean at `31f9ed8`; its existing work was not reset, overwritten, or deleted.

Do not cherry-pick `7a088fc` or `ebc9527` automatically. The Trash prototype
has a different architecture and provider contract from this repository. Use
it only as reference after proving a particular piece is missing from
`chess-ai`. Do not delete or force-push the `ChessMCP` repository without an
explicit user decision.

## Product priority from the user

The public/browser experience comes first. The static GitHub Pages URL must
load and be usable without a local Python process, Stockfish binary, SQLite
file, or private API key. Local-only capabilities may be added as optional
enhancements behind a local backend, but they must not become prerequisites for
the browser demo.

The real project already has the browser/frontend, static assets, local server,
Stockfish, provider, opening, tactical-analysis, and test structure described
in its README and `HANDOVER_TO_TERRA.md`. Preserve that architecture while
auditing the remaining requirements.

## Requirements to verify in this repository

Audit these against the actual current code and tests before declaring them
complete:

1. GitHub Pages/static browser mode works at the published URL and does not
   assume `/api` or a local FastAPI server.
2. Browser-side board state and Stockfish/WASM behavior remain usable in the
   no-backend demo.
3. Local mode persists sessions and chat separately on the user’s machine.
4. Stockfish supplies evaluation, tactical verification, and MultiPV lines.
5. The selected conversational AI is visibly distinct from Stockfish.
6. OpenCode Big Pickle uses the handover’s required provider contract:
   `LLM_PROVIDER=opencode-free`, base `https://opencode.ai/zen`, model
   `big-pickle`, no shared browser key, and no undocumented authentication.
   A 429/timeout must display provider unavailability; it must not silently
   substitute a hand-written local coach.
7. Full PGN/move history, current position, player side, persona, target
   rating, and training objective reach the local backend/provider where
   supported.
8. The LLM never evaluates a position or controls an opponent move. Any
   engine/AI boundary must be explicit in the UI.
9. Maia or another human-move model is used only when actually configured and
   must not be mislabeled as Stockfish or as a human rating claim.
10. Opening names come from authoritative move-history/data logic, not a
    brittle hand-written recognizer.
11. The acceptance line `1. e4 e5 2. f4` identifies the King’s Gambit, and
    `2...exf4` identifies the King’s Gambit Accepted in both move review and
    continuous chat.
12. Provider provenance, OpenCode 429 handling, PGN-based opening context,
    Maia selection, and no-fallback behavior have behavior tests.

## Safe startup checklist for the next Codex

Run these commands first and show their output in the work log:

```bash
cd /Users/anupamkhosla/Desktop/Projects/chess-ai
git status --short --branch
git remote -v
git log -1 --oneline --decorate
sed -n '1,280p' HANDOVER_TO_TERRA.md
sed -n '1,260p' HANDOVER_FROM_CODEX.md
```

Do not change remotes, branches, or history until the user explicitly asks.
Do not run from `/Users/anupamkhosla/.Trash/chessAI`.

## Current truth about the previous implementation

The incorrect Trash implementation did provide a useful experimental
engine-grounded slice: server-side python-chess legality, SQLite sessions,
Stockfish MultiPV, replay-validated lines, deterministic facts, and a strict
explainer schema. However, it required a local FastAPI/SQLite/Stockfish server
and therefore was not suitable as the first public GitHub Pages experience.
Its OpenCode adapter also used a different tokenized endpoint contract than
the canonical handover. Treat both as non-canonical experiments.

The next Codex should first audit and improve the existing `chess-ai` browser
application, then add optional local/backend capabilities without replacing
the static browser path. Every change should be tested in this repository and
committed here only.
