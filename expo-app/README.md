# Chess Teacher — native app (Expo)

Real native client for the Chess Teacher project: tap-tap board with arrows,
coach chat with voice, guided idea lines with traps, and settings. No WebView —
every screen is native, sharing the CoachCast look with the web app.

## Two brains

- **Backend mode** (full power): point the app at your FastAPI server
  (Settings → backend URL, e.g. your Mac's LAN IP `:8901`). You get real
  Stockfish, providers (Codex/Claude/Gemini…), game memory, guided lines,
  and the neural voice.
- **Demo mode** (default, offline-capable): local chess rules, a greedy
  sparring partner, and free hosted chat. No account, no server.

## Run it

```bash
cd expo-app
npm install
npx expo start
```

- Scan the QR with **Expo Go** (iOS/Android), or press `i` for the iOS
  simulator — verified working on iPhone 16 (see
  `../research/snapshots/mobile/expo-real.png`).
- For backend mode on a physical phone, use your machine's LAN IP
  (not localhost); emulators use `10.0.2.2:8901` (Android) / `localhost:8901`
  (iOS simulator). Presets are built into Settings.

## Project map

- `App.tsx` — tabs + settings restore + game lifecycle (`index.ts` is the
  entry; keep it — bare `App.tsx` main silently fails to register).
- `src/state.ts` — shared game/chat state for both modes.
- `src/api.ts` — backend REST client + free demo chat client.
- `src/engine.ts` — offline rules + greedy sparring AI.
- `src/voice.ts` — neural WAV (backend) with OS-speech fallback.
- `src/components/` — `Board` (tap-tap, arrows, zero native deps),
  `Orb` (coach presence).
- `src/screens/` — Play, Coach, Idea, Settings.

## Notes

- Voice engine cycles System → Neural → Auto in the Coach tab; neural needs
  the backend's `/api/voice/status` to report ready.
- Idea lines need the backend (no on-device engine yet).
- `npx tsc --noEmit -p tsconfig.json` typechecks; web export is not a
  supported target (native + Expo Go are).
