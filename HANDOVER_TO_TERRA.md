# Handover to Terra — Chess AI Coach

Repository: `https://github.com/AnupamKhosla/chess-ai`

Current branch: `main`

Latest published commit before this handover: `12ebf66`

Local app: `http://127.0.0.1:8000`

GitHub Pages demo: `https://anupamkhosla.github.io/chess-ai/`

## Verbatim handover from GPT Luna

```text
You’re right. I’m not making fun of you, but I did give you confident progress updates while building something that contradicted the actual goal. I’m sorry.

  The hardcoded src/server/openings.py was the wrong solution. It should not be pretending to be the intelligence of a grandmaster coach. The current app is also still too dependent on
  Stockfish templates and is not yet the polished human-like coach you asked for.

  You were also right about OpenCode. The usable route is:

  POST https://opencode.ai/zen/v1/chat/completions
  model: big-pickle
  Authorization header: omitted

  I personally tested it and received HTTP 200 with cost: "0". It later returned 429, meaning its free anonymous allowance is temporary/rate-limited. I should have made this the primary
  free-provider path and shown the exact evidence clearly. OpenCode’s documented Zen models and pricing are here: OpenCode Zen (https://dev.opencode.ai/docs/zen/).

  The correct product architecture is:

  - OpenCode Big Pickle as the primary free conversational coach.
  - Codex, DeepSeek, Gemini, Groq, and Claude as optional providers.
  - Full move history/PGN sent to the AI every time.
  - Stockfish for evaluation, tactical verification, and multi-PV lines.
  - Maia-2/3 for human-like opponent moves and rating behavior.
  - An opening database for authoritative ECO/opening names—not a hand-written list.
  - The language model explains the ideas, plans, threats, pins, forks, gambits, and human thought process.
  - No fake local coach fallback when the real AI is unavailable.
  - A clear provider/source indicator for every response.
  - A genuinely polished UI built after the architecture is correct.

  I won’t ask you to trust me. I need to earn that by making the next work auditable and smaller. I’m pausing code changes here instead of making another patch on top of the wrong design.
```

— gpt luna work

## OpenCode Big Pickle: required integration

Terra must treat this as the primary no-key hosted provider for local development:

```text
Provider ID: opencode-free
Base URL: https://opencode.ai/zen
Chat endpoint: https://opencode.ai/zen/v1/chat/completions
Model: big-pickle
Authorization: omit the header entirely
API key: none
Protocol: OpenAI-compatible chat completions
```

Equivalent local configuration:

```dotenv
LLM_PROVIDER=opencode-free
LLM_BASE_URL=https://opencode.ai/zen
LLM_MODEL=big-pickle
LLM_API_KEY=
```

Minimal request shape:

```bash
curl https://opencode.ai/zen/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"big-pickle","messages":[{"role":"user","content":"Hello"}]}'
```

A live anonymous request was tested during this handover and returned HTTP 200,
`model: "big-pickle"`, and `cost: "0"`. Subsequent requests returned HTTP 429,
so the route must be treated as a temporary, rate-limited free trial. The
official OpenCode documentation lists Big Pickle as a free model for a limited
time, while also documenting that normal Zen usage can involve login and
billing: <https://dev.opencode.ai/docs/zen/>.

Implementation rules:

1. The local FastAPI backend should proxy the request. Do not put the provider
   call directly in the public GitHub Pages browser bundle.
2. Do not add a shared API key, fake key, or undocumented authentication header.
3. Preserve the complete conversation, PGN/SAN move history, current FEN,
   player side, opponent target rating, persona, and training objective.
4. If Big Pickle returns 429 or times out, show `OpenCode unavailable` with the
   actual provider status. Do not substitute the hand-written local coach.
5. For opponent moves, the selected AI must choose the move. Stockfish may
   provide evaluation, tactical checks, and legal candidates, but must not be
   mislabeled as the conversational AI.
6. Add a provider/source badge to every chat response, move review, and
   opponent move.
7. Keep Codex, DeepSeek, Gemini, Groq, and Claude as explicit alternatives.

## Required architecture reset

The existing hardcoded opening recognizer was added as a patch and must not be
treated as the coach's intelligence. Remove it or replace it with an
authoritative opening-data layer, for example an ECO/opening dataset or a
maintained open-source opening library. The language model may then explain
the opening, but the name should be grounded in move history/data.

The intended pipeline is:

```text
Browser board + continuous chat
              |
              v
FastAPI session: full PGN, FEN, persona, rating, training objective
              |
       +------+------+
       |             |
       v             v
Stockfish        Maia-2/3 + opening data
eval, tactics,   human-like move prediction
multi-PV, safety  at target rating
       |             |
       +------+------+
              v
OpenCode Big Pickle / selected LLM
              |
              v
Grounded explanation, plans, threats, lines, arrows, and teaching dialogue
```

Maia is a human-move prediction engine, not a language model. The official
Maia project is <https://github.com/CSSLab/maia-chess>. The official CSSLab
Chess MCP project exposes Stockfish and Maia-2 tools for MCP clients:
<https://github.com/CSSLab/chess-mcp>.

## Acceptance test that previously failed

Starting from a new game:

```text
1. e4 e5 2. f4
```

The coach must identify this as the King's Gambit, explain that `f4` offers a
pawn for initiative/rapid development/open lines, and then separately discuss
whether the concrete position has a tactical or engine-based issue. It must
not call `f4` a generic unexplained pawn blunder.

After `2...exf4`, the coach must identify the King's Gambit Accepted and explain
why Black accepts the pawn and what White receives in return.

The same opening recognition must work in the continuous chat and move-review
contexts from actual preserved PGN history. It must not rely on the user typing
the opening name.

## Product constraints

- This is a personal local coach first, not a multiplayer server.
- The chat is continuous and board-aware across refreshes and saved sessions.
- Real AI must be distinguishable from Stockfish and from deterministic UI text.
- No silent provider fallback.
- No claims that an LLM is literally a 2000-rated human or a grandmaster.
- GitHub Pages can host only the static browser demo; Python/FastAPI,
  Stockfish, Maia services, and private provider calls require a backend host
  or the user's local machine.

## Current verification context

The previous implementation passed 863 non-integration backend tests, six
browser tests, TypeScript checking, and the frontend build. Those checks prove
that the wiring runs; they do not prove that the product meets the human-like
grandmaster-coach goal. Terra should add behavior tests around provider
provenance, OpenCode 429 handling, actual PGN-based opening context, Maia
selection, and no-fallback behavior before declaring the reset complete.
