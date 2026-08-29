# Chess Teacher Upstream Evaluation

Date: 2026-08-30

## Clone

- Repository: https://github.com/stvhay/chess-coach
- Local path: `/Users/anupamkhosla/Desktop/Projects/chess-teacher`
- Commit tested: `c4e5ef3`

## Installation

- Node.js: 22.22.2
- npm: 10.9.7
- Python 3.14.7 was installed because the project declares Python >=3.14.
- Python 3.13.12 was also used for compatibility testing.
- Stockfish 18 is available at `/opt/homebrew/bin/stockfish`.
- Frontend dependencies installed with `npm install`.
- Python dependencies installed with `uv sync` under Python 3.14 and separately with `uv pip` under Python 3.13.

## Build and tests

The frontend build passes:

```text
npm run build
static/app.js 198.4kb
```

The non-integration, non-live Python test suite passes under Python 3.13:

```text
851 passed, 22 deselected, 1 warning
```

## Runtime smoke test

The server runs on:

`http://127.0.0.1:8001`

Verified:

- `GET /api/health` -> HTTP 200
- `GET /api/status` -> HTTP 200
- `POST /api/game/new` -> HTTP 200
- `POST /api/game/move` with `e2e4` -> legal automatic reply `e5`
- frontend page, bundled JavaScript, Stockfish WASM and engine WebSocket all load

## Problems found

1. Running under Python 3.14 fails during ChromaDB import because ChromaDB 1.5.x currently reaches a Pydantic V1 field-inference error:

   `ConfigError: unable to infer type for attribute "chroma_server_nofile"`

2. Running under Python 3.13 starts successfully, but ChromaDB initialization fails because the smoke-test LLM endpoint (OpenRouter) does not accept the configured `nomic-embed-text` embedding request. The board and Stockfish continue working; RAG/theory retrieval is unavailable in this configuration.

3. Puzzles were disabled for this smoke test to avoid downloading the large Lichess puzzle database.

4. The first tested move returned a legal automatic reply but no coaching text. This needs a deeper test with a mistake position and a supported LLM configuration before judging coaching quality.

## Initial conclusion

Chess Teacher is a strong candidate for the chess/coach core and is much closer to the target than the current small ChessMCP browser prototype. It has good module boundaries and a substantial test suite. It is not yet a drop-in production application on this Mac: Python/ChromaDB compatibility and embedding configuration need to be resolved, and the live coaching quality must be tested with a proper provider.

Do not merge or publish upstream changes until Terra reviews the main plan in `CHESS_COACH_PLAN_FOR_TERRA.md`.
