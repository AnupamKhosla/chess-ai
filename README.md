# Chess Teacher

An interactive chess teaching system that coaches you during live play. Make moves against a pedagogically-motivated opponent while an AI coach watches — intervening at critical moments with explanations grounded in concrete analysis.

## What Makes This Different

Most chess tools fall into two camps:

- **Engines and puzzle trainers** tell you *what* to do (Stockfish says Nf6 is +0.3 better) but never *why*, or what principle you missed
- **Video courses and books** explain concepts beautifully, but when you sit down to play, the lesson was generic and your position is specific

Chess Teacher bridges this gap. You play a real game. The analysis targets *your position on the board* — not a canned lesson, not a raw engine number. The coach speaks in natural language, but every claim is backed by Stockfish evaluation and coded positional analysis. The system never hallucinates tactics because the LLM never evaluates positions itself — it reads structured facts and explains them.

**Target audience:** Chess players between 800-1800 Elo who want to understand what's happening in their games.

## How It Works

Chess Teacher combines three systems:

1. **Stockfish** provides ground-truth position evaluation — best moves, forcing lines, tactical detection
2. **Position Analyzer** (coded logic in Python) extracts structured tactical and positional facts — pins, forks, pawn weaknesses, king safety, material imbalances
3. **LLM** orchestrates the other two and speaks to the user — translating engine analysis and structured facts into natural-language coaching

**Core design principle:** The LLM is the teacher persona. It never evaluates positions itself.

This architectural constraint prevents hallucinations. LLMs confidently describe pins that don't exist and miss mates in two. By keeping the LLM out of evaluation, every coaching claim traces back to a specific detection function or engine line. The LLM adds the words, not the analysis.

### Architecture

```
Browser (chessground + stockfish.wasm)
    ↓
FastAPI server
    ↓
LLM orchestrator
    ↓                    ↓
Stockfish            RAG (ChromaDB + Ollama)
    ↓
Position analyzer → Game tree → Coaching report
```

**Stack:** Python 3.14, FastAPI/uvicorn, python-chess, Stockfish, ChromaDB, SQLite, modern JavaScript frontend (chessground, snabbdom, stockfish.wasm)

### AI connections

The browser has one continuous coach room, while the server adapts the
conversation to the selected connection. Open the menu and choose one of:

- DeepSeek, OpenAI, Anthropic, or OpenRouter with an API key
- Built-in local AI works immediately with no key; Ollama or LM Studio are also supported
- ChatGPT/Codex login through an installed, authenticated `codex` CLI
- Claude subscription through an installed, authenticated `claude` CLI

API keys entered in the menu are held in server memory for the current run;
they are not written to the repository, browser storage, or provider list.
ChatGPT and Claude subscriptions are distinct from their developer APIs, so
the two CLI choices use the local login rather than treating a subscription as
an API key. The chess board, Stockfish, and engine-backed move coaching stay
available if the selected language model is offline.

The browser runs its own Stockfish instance for the eval bar. The server performs deeper analysis for coaching. Stockfish is analysis-only: it can never make the opponent's move. A fresh install starts with the built-in local AI policy, which is instant and needs no key or login; connected language models can take over move selection and conversation.

For deep architectural details, see [guide/DESIGN.md](guide/DESIGN.md).

## Getting Started

### Prerequisites

- **Nix** (with flakes enabled) — for development environment
- **LLM access** — optional; the built-in local AI works with no key or login
- **Stockfish** (included in nix devshell)

### Local Development

1. **Clone and enter the development environment:**
   ```bash
   git clone https://github.com/AnupamKhosla/chess-ai.git
   cd chess-coach
   nix develop  # or use direnv if .envrc is configured
   ```

2. **Install dependencies:**
   ```bash
   uv sync
   npm install
   ```

3. **Configure environment:**
   ```bash
   cp .env.example .env.chess
   # Optional: edit .env.chess for a hosted provider. Built-in local AI is the no-login default.
   ```

   For local Ollama:
   ```bash
   LLM_BASE_URL=http://localhost:11434
   LLM_MODEL=qwen2.5:14b
   EMBED_MODEL=nomic-embed-text
   ```

   For a free hosted trial, choose **OpenRouter API key** in the browser menu,
   use the **OpenRouter Free Router** model, and paste your own OpenRouter key.
   The key is held in memory only; the app does not ship or share a public key.

4. **Build the frontend:**
   ```bash
   npm run build  # or 'npm run watch' for development
   ```

5. **Start the server:**
   ```bash
   uvicorn server.main:app --reload
   ```

6. **Open your browser:**
   ```
   http://localhost:8000
   ```

The first startup seeds the ChromaDB knowledge base automatically (takes ~30 seconds). For production deployment, see [DEPLOY.md](DEPLOY.md).

## Key Features

- **Live coaching during games** — play against a pedagogically-motivated opponent with real-time explanations
- **14 coaching personas** — choose your teaching style: from Anna Cramling's encouraging warmth to Ben Finegold's deadpan humor, Magnus Carlsen's understated precision to Mikhail Tal's poetic daring
- **Grounded analysis** — every coaching claim backed by Stockfish evaluation and coded tactical detection
- **Adjustable difficulty** — ELO-based profiles control opponent strength and coaching depth
- **Puzzle database** — 5.7M Lichess puzzles with full-text search
- **RAG-powered context** — retrieves relevant patterns, openings, and concepts from the knowledge base
- **AI-only move control** — the AI or no-key local policy makes opponent moves; Stockfish is never a move fallback
- **Continuous coach chat** — ask questions in natural English while the coach receives the current FEN, move list, level, and prior conversation
- **Local session archive** — games and chat transcripts are stored in ignored local SQLite data and can resume after a restart
- **Provider-neutral setup** — switch API-key providers, local models, Codex login, or Claude Code login without changing the board
- **CLI and MCP server** — analyze positions from the command line or integrate with other tools

## Coaching Personas

The LLM's personality and teaching style adapt to match 14 distinct coaching personas. Each persona shapes **how** the coach explains positions, delivers feedback, and encourages the student — without changing the underlying analysis.

**Popular personas:**
- **Anna Cramling** — Warm, enthusiastic, encouraging. Celebrates creative play and makes chess feel accessible. Prioritizes building confidence.
- **Daniel Naroditsky** — Methodical and patient. Emphasizes process over results. Breaks explanations into clear, structured steps. "Let's think about candidate moves."
- **GothamChess (Levy Rozman)** — High energy, dramatic reactions. Uses humor and pop-culture references. Makes even boring positions sound like thrillers.
- **GM Ben Finegold** — Dry, deadpan humor. Sardonic observations. "Never play f3." Teaches through gentle ridicule wrapped around deep insights.
- **Hikaru Nakamura** — Quick pattern reads, casual but sharp. Speed-chess energy. "Yeah, this is just winning."
- **Magnus Carlsen** — Understated, quietly confident. Moves are "obvious" or "natural." Dry Scandinavian humor. Focuses on positional subtlety and small edges.

**Legendary masters:**
- **Garry Kasparov** — Intense, passionate, demanding. Chess is war. Uses dramatic, forceful language. Demands excellence.
- **Mikhail Tal** — Poetic and daring. Celebrates sacrifices and complications. "The beauty of the move justifies the risk."
- **Jose Raul Capablanca** — Effortless clarity. Emphasizes simplicity and endgame mastery. Elegant and economical in language.
- **Judit Polgar** — Direct, no-nonsense, tactical fighter. Emphasizes fighting spirit and tactical precision. "Always check all forcing moves."
- **Mikhail Botvinnik** — Stern, systematic, scientific. Formal tone. Chess is a discipline that rewards method and preparation.
- **Paul Morphy** — Elegant, somewhat formal 19th-century style. Development and open lines above all.
- **Vishy Anand** — Warm, gentlemanly, eloquent. Patient with beginners, insightful with advanced players. Emphasizes intuition alongside calculation.

**Prodigy:**
- **Faustino Oro** — The 12-year-old Argentine prodigy ("The Messi of Chess"). Explains chess like a brilliant kid: matter-of-fact, slightly impatient with obvious mistakes, casually referencing ideas that took most players decades to learn. "I beat Magnus in bullet that one time."

Select your persona in the web UI. The persona system is composable — the behavioral prompt block injects into the coaching system prompt without changing the analysis pipeline. See `src/server/prompts/personas.py` for full persona definitions.

## Documentation

- **[guide/DESIGN.md](guide/DESIGN.md)** — Deep dive into design philosophy, architecture, and teaching approach
- **[DEPLOY.md](DEPLOY.md)** — Production deployment with Docker
- **[CLAUDE.md](CLAUDE.md)** — Project conventions and working style for development

## Testing

```bash
pytest                      # Run all tests
pytest -m "not integration" # Skip tests requiring external services
pytest -m live              # Run LLM integration tests
```

## Project Status

Active development (Sprint 6, Feb 2026). 673 tests passing. Game tree architecture, tactical detection, and coaching quality iterations complete. Next: model evaluation and teachability training data collection.

## License

MIT License. See [LICENSE](LICENSE).

## Contributing

This is a personal project, but issues and PRs are welcome. See [guide/DESIGN.md](guide/DESIGN.md) to understand the architecture before contributing.
