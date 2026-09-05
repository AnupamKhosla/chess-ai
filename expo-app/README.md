# Chess Teacher — Expo hybrid starter (local only, not yet installed)

Thin native shell around the web app. The chess board, engine, and coach
stay exactly the web build you already use — this wrapper just gives you an
installable app with a Live / Local-server switch.

## Run it

```bash
cd expo-app
npm install
npx expo start
```

- Press `a` (Android emulator) or `i` (iOS simulator), or scan the QR with
  Expo Go on your phone.
- **Live** tab loads `https://anupamkhosla.github.io/chess-ai/`.
- **Local server** tab loads your dev machine (`10.0.2.2:8901` from the
  Android emulator; change `DEV_URL` in `App.tsx` for a physical device to
  your machine's LAN IP). Start it with:

```bash
cd /Users/anupamkhosla/Desktop/Projects/chess-ai/src
/Users/anupamkhosla/Desktop/Projects/chess-ai/.venv/bin/python -m uvicorn server.main:app --host 0.0.0.0 --port 8901
```

## Roadmap (not built yet)

- Native share/export of games, push reminders for spaced review.
- Offline bundle of the static demo via `expo-asset` + local WebView server.
- Native speech alignment with the web coach voice settings.
