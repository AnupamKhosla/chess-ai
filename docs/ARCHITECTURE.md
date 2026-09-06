# Architecture — Chess Teacher

One-page map of the whole system: web app, local server, login sandbox,
mobile app, and research. See `ULTIMATE_CHESS_COACH_GOALS.md` for the product
contract and `research/FINDINGS.md` (local, gitignored) for the competitive
scorecard.

## Pieces

| Piece | What | Where | Deploys to |
|---|---|---|---|
| Web app | TypeScript + chessground + Stockfish WASM, coach room, explorer, orb | `src/frontend/`, `static/` | GitHub Pages (`.github/workflows/pages.yml`) |
| Local server | FastAPI: game sessions (SQLite), providers, engine, lines, tools loop, neural voice | `src/server/` | Your machine / Docker |
| Login sandbox | One-shot ChatGPT device-code → single Codex turn, then wipes itself | `chess-ai-codex-sandbox` repo | Vercel |
| Mobile app | Native Expo client (board, coach, idea, settings), backend or demo mode | `expo-app/` | Expo Go / simulators |
| Research | Competitor clones (gitignored), snapshots, gallery, findings | `research/` (never committed) | Nowhere |

## Request flows

**Local chat (login-free, persistent):**
browser → `POST /api/game/chat` → `GameManager.chat` → what-if grounding →
mode routing → `ChessTeacher.chat_conversation` → provider (Codex CLI with
`exec resume` thread continuity, or API providers) → optional one-round
`chesstool` loop (`server/toolsloop.py`, 4 whitelisted ops, depth ≤18) →
SQLite history.

**Move + coaching:**
browser → `POST /api/game/move` → engine evals before/after → `coach.py`
classifies by **win% drop** (20/10/5, Lichess curve) + missed-mate override →
template message + arrows → browser tints move list, orb offers tours.

**AI move:** `select_opponent_move` (LLM picks from screened candidates, or
local engine) → `human_think_delay` paces instant opponents like a human
(Maia3-HumanTime curve, 0.6–4s; LLM turns need no padding).

**Line explorer:** `POST /api/analysis/line` → MultiPV-5 → best line +
trap lines (naturalness × win% drop, refutation in PV tail) → frontend steps
with arrows, narration, ghost hand, autoplay.

**Voice:** `POST /api/voice/speak` → Piper neural WAV (local only) →
`expo-av`/Audio playback with orb beats; OS speech fallback everywhere.

**Pages demo:** static build, browser Stockfish facts + trap mirror in
`api.ts`, Free Weak AI chat, one-shot Codex via Vercel sandbox.

## Prompt contracts

- `src/server/prompts/`: personas + `guard_block` rails (style never
  overrides honesty) + universal identity guards, assembled by
  `build_coaching_system_prompt`.
- `AGENTS.md` (sandbox repo): the 20–50 word grounded-turn contract.
- `game.py` `_CONVERSATION_MODE_NOTES`: review/plan/prepare/checkin shapes.
- Fast chat defaults: Luna-tier model + low effort unless the user overrides.

## Truth rules (never break these)

1. Stockfish facts are authoritative; models word, never evaluate.
2. No silent substitution: unavailable provider says so, engine never moves.
3. Secrets: API keys live in server memory only; ChatGPT login only on
   OpenAI's page; tokens never touch the browser.
4. Every coaching claim must trace to an engine line or coded analysis.
