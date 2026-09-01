# Handover for Tomorrow’s New Agent

Date: 2026-09-01
Prepared: 2026-09-01
Canonical project: /Users/anupamkhosla/Desktop/Projects/chess-ai
Canonical remote: https://github.com/AnupamKhosla/chess-ai.git
Canonical branch: main
Canonical HEAD: ad34965 feat: enable anonymous live browser coach

## Read first

Read these files before inspecting or changing application code:

1. [HANDOVER_FROM_CODEX.md](./HANDOVER_FROM_CODEX.md)
2. [HANDOVER_TO_TERRA.md](./HANDOVER_TO_TERRA.md)
3. [CODEX_SESSION_01a05378_VERBATIM.md](./CODEX_SESSION_01a05378_VERBATIM.md)

The third file is the verbatim export of the prior mixed-repository session.

## Non-negotiable repository boundary

Work only in:

```text
/Users/anupamkhosla/Desktop/Projects/chess-ai
```

Do not run commands from or modify:

```text
/Users/anupamkhosla/.Trash/chessAI
```

That Trash checkout is a separate ChessMCP prototype. It currently has:

- HEAD: `ebc9527 feat: add engine-grounded coaching core`
- origin: `https://github.com/AnupamKhosla/ChessMCP.git`
- parent remote history beginning at `53fd06d`

Do not cherry-pick, merge, delete, force-push, change remotes, change branches,
or rewrite history until the user explicitly directs it.

## What happened

The prior session was thread `01a05378-b5df-77e2-addc-382003d7d9e0`.
It mistakenly treated the Trash checkout as the real project, implemented an
engine/coach prototype there, created commits `7a088fc` and `ebc9527`, then
pushed `ebc9527` to `AnupamKhosla/ChessMCP`.

The canonical `chess-ai` checkout was not reset or overwritten. Its existing
work remains in place. The handover file documents the incident in detail.

## Safe first commands

Run these from the canonical directory and show the output before any write:

```bash
cd /Users/anupamkhosla/Desktop/Projects/chess-ai
git status --short --branch
git remote -v
git log -1 --oneline --decorate
sed -n '1,280p' HANDOVER_TO_TERRA.md
sed -n '1,260p' HANDOVER_FROM_CODEX.md
sed -n '1,240p' HANDOVER_FOR_TOMORROW.md
```

The two export files created for tomorrow are intentional documentation files.
Do not discard them as unexplained untracked changes. The application changes
through `ad34965` are already pushed; continue from `main` and do not reset or
switch repositories.

## Current implementation (2026-09-01)

The canonical `main` branch now contains the browser-first live coach work:

- Live URL: https://anupamkhosla.github.io/chess-ai/
- GitHub Pages detects `*.github.io` and does not require FastAPI, SQLite,
  Stockfish binaries, an account, or an API key.
- Browser Stockfish handles local evaluation and the practice opponent move.
- Chat sends the current FEN, SAN history, and student question directly to
  LLM7's anonymous OpenAI-compatible endpoint:
  `https://api.llm7.io/v1`, using its faster non-reasoning
  `mistral-Nemo-Instruct-2407` model.
- No `Authorization` header is sent. The UI deliberately calls this provider
  **Free Weak AI** and hides the provider/model implementation details.
- The public coach prompt asks for a legal, concise 3–5 half-move continuation
  and human reasoning. The client strips model tool/thinking tags and shows
  rate-limit or outage errors instead of fabricating an answer.
- A seven-second browser cooldown plus the provider's anonymous limits protect
  the public endpoint. Do not send private or sensitive information through it.
- Non-GitHub `?demo=1` remains a deterministic local browser demo. The local
  FastAPI app retains its configurable provider architecture.

## Verification already run

From the canonical directory:

```text
npm run build                  PASS
npx tsc --noEmit               PASS
LLM_PROVIDER=local RAG_TOP_K=0 AUTO_INIT_PUZZLES=false uv run python -m pytest tests/test_config.py tests/test_chat_provider.py -q
12 passed
```

No browser/Playwright test was run because the user will test the live page.
GitHub Pages deployment is triggered by the push and may take a short time to
publish the new bundle.

## Immediate next-agent guidance

1. Start in `/Users/anupamkhosla/Desktop/Projects/chess-ai`.
2. Confirm `git status --short --branch`, `git remote -v`, and `git log -1`.
3. Do not touch `/Users/anupamkhosla/.Trash/chessAI` or the separate
   `AnupamKhosla/ChessMCP` repository.
4. Ask the user what browser behavior they observed before changing the live
   endpoint. Anonymous free endpoints can rate-limit, change, or disappear.
5. Preserve the student-facing name **Free Weak AI**; do not expose OpenCode,
   Big Pickle, LLM7, or the model name in the normal UI.

## Product priority

The public/browser experience comes first. GitHub Pages must work without a
local Python process, Stockfish binary, SQLite database, or private API key.
Any local/backend capability is optional and must not replace the static browser
path.

Preserve the architecture and requirements in `HANDOVER_TO_TERRA.md` and
`HANDOVER_FROM_CODEX.md`. Treat the Trash implementation as reference only
after proving a specific behavior is missing from the canonical project.

## Session provenance

- Local Codex thread: `01a05378-b5df-77e2-addc-382003d7d9e0`
- Source database: `/Users/anupamkhosla/.codex/thread_history_1.sqlite`
- Recorded user messages: 12
- Recorded assistant messages: 38
- Key wrong-repo commits: `7a088fc`, `ebc9527`
- Wrong-repo push target: `AnupamKhosla/ChessMCP`

## Handoff rule

Start by reporting the canonical path, branch, remote, HEAD, and status. Ask
before making any change that could affect remotes, branches, commits, deployment,
or the separate ChessMCP repository.
