# Privacy Policy — Chess Teacher

Short version: **no accounts, no analytics, no tracking.** Your chess stays yours.

## What lives where

- **In your browser (localStorage only):** game session id, chat history on the
  public demo, theme, voice and panel preferences.
- **On your machine (local app only):** game sessions and chat in a local
  SQLite file (`data/sessions.db`). Nothing leaves the machine except the
  requests described below.
- **Nowhere:** we have no user database, no cookies for tracking, no
  third-party analytics.

## AI requests

- **Free Weak AI (public demo chat):** your question plus the board position
  (FEN + move history) is sent to the hosted model endpoint. No name, email,
  or identifier is attached.
- **ChatGPT / Codex login:** login happens only on the official OpenAI page
  (`auth.openai.com`). Our pages and backend never see your password. The
  temporary login backend (source:
  `https://github.com/AnupamKhosla/chess-ai-codex-sandbox`) holds the login
  only inside one function run and deletes it after one reply. In the local
  app, authentication lives in your own installed Codex/Claude CLI config
  (`~/.codex`, `~/.claude.json`) and the browser never touches it.
- **API keys:** if you enter a provider key in the local app, it stays in
  server memory for that run. It is never written to disk, localStorage, the
  session database, logs, or git.

## Browser engine

Stockfish runs locally in your browser (WebAssembly) for the eval bar and
position facts. Evaluations never leave your device.

## Questions

Open an issue at `https://github.com/AnupamKhosla/chess-ai` — the code is
public so every claim above is checkable.
