# Ultimate Chess Coach Goals

This document is the product contract for the local Chess Teacher. The goal is
not a chat box that happens to mention chess. It is a strong chess training
room with a conversational grandmaster-style teacher beside a real board.

## Product promise

The player can type or speak naturally:

> “I am weak against a delayed f-pawn attack. Play like a strong human,
> pressure me with gambits, and teach me what I should check before every move.”

The application understands that intent, configures a lesson, plays legal
moves automatically, explains plans in plain English, and lets the player
review the position visually.

## Non-negotiable experience

- One browser page contains the board, evaluation, move list, coach chat, and
  controls.
- Player moves are answered automatically; no “press reply” step.
- Chat is continuous within each game and resumes after browser or server
  restart from the local session archive.
- Back, Forward, first-position, and latest-position navigation sits directly
  below the board. Keyboard arrows remain available.
- Premoves are supported without allowing illegal moves.
- A visible evaluation bar sits to the left of the board and has an explicit
  Enable/Disable control.
- Text is comfortable to read, high contrast, and the chat scrolls inside its
  panel without covering the board.
- The visual language is an original, polished chess training room inspired by
  familiar chess products—not a copied brand interface.

## Intelligence contract

### Stockfish is the chess authority

Stockfish and coded analysis decide legality, evaluation, tactics, candidate
moves, and concrete variations. The language model must not invent a pin,
fork, evaluation, or legal move.

Every coach intervention should make its source clear:

- **Stockfish facts · local analysis** — deterministic engine and position
  analyzer output.
- **AI explanation · Stockfish facts** — language model wording grounded in
  those facts.
- **AI unavailable** — the conversation provider could not answer; the board
  and engine still work.

### Human-like teaching

The opponent should not always play the top engine move. At a selected rating,
it should choose legal moves from a controlled engine candidate set, weighted
for human plans, thematic pressure, and teachability. It should be able to:

- attack with gambits without making random blunders;
- delay or prepare an f-pawn push and build Stonewall structures;
- exploit typical novice oversights while remaining fair;
- explain the threat, purpose, and likely continuation after each critical move;
- switch between practice, hints, and full explanations on request.

### “Show me the idea” mode

An AI lesson action should:

1. Ask Stockfish for a multi-principal-variation position analysis.
2. Select a teachable line rather than blindly showing only PV1.
3. Play or preview up to ten half-moves with Back/Forward controls.
4. Draw arrows and highlights for checks, captures, threats, pins, forks,
   pawn breaks, weak squares, and king-safety ideas.
5. Explain what a human is planning at each step and where the student could
   go wrong.

## Provider choices

The UI should support the most practical local setups behind one adapter:

- DeepSeek, OpenAI, Anthropic, and OpenRouter API keys;
- Ollama and LM Studio local OpenAI-compatible servers;
- ChatGPT/Codex login through an installed authenticated Codex CLI;
- Claude subscription through an installed authenticated Claude Code CLI.

API keys are session/process secrets only. They must never be returned by a
status endpoint, stored in browser localStorage, committed to Git, or written
to the game/session database. Subscription login is distinct from developer
API access.

## Architecture direction

```text
Browser
  chessground + chess.js + Stockfish WASM + coach room
       │
       ▼
FastAPI local server
  session archive + chat memory + provider adapter
       │
       ├── Stockfish UCI + coded tactical/positional analysis
       ├── optional RAG knowledge and opening/puzzle data
       └── selected language model or authenticated local CLI
```

The server remains useful with no language model: moves, engine evaluation,
local analysis, navigation, and deterministic coaching continue to work.

## Delivery sequence

1. **Foundation:** provider-neutral continuous chat, durable sessions, visible
   source labels, readable responsive shell, evaluation toggle, and board
   navigation.
2. **Playing quality:** opponent rating calibration, candidate-move sampling,
   Maia-style human move profiles, gambit/Stonewall lesson presets, and legal
   premoves.
3. **Coach visuals:** lesson button, ten-move teachable lines, arrows,
   highlights, synchronized variation board, and “why this plan?” explanations.
4. **Voice:** push-to-talk and optional realtime speech, with typed transcript
   and the same session memory.
5. **Training memory:** searchable local games, recurring weakness detection,
   spaced review, puzzle generation, and progress reports.
6. **Quality:** latency budgets, provider fallback, prompt/evaluation tests,
   engine-grounding checks, accessibility review, and open-source release.

## Acceptance test for every feature

- Can a novice understand what to do next without reading engine jargon?
- Is every displayed move legal in the shown position?
- Is the source of the claim visible?
- Does the board remain completely visible at the supported desktop viewport?
- Does refresh preserve the game and transcript?
- Does it work with no API key and degrade clearly?
- Can a user remove or replace their provider credentials without touching
  source files?
