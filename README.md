# SSAA — Sprint Scheduling Suite

Monorepo for the SSAA web app. Browser-first; mobile packaging is deferred.

## Layout

```
backend/    Node/Express API + Socket.IO (TypeScript; SQLite locally, MySQL/RDS on prod)
frontend/   Expo + React Native web app (react-native-web, Redux Toolkit, RTK Query)
SSAA/       Original Lovable app, kept as a read-only reference/spec
```

- `backend/app/blueprints/` — one file per API area (health, uploads, + upcoming auth, scheduling, chat)
- `frontend/src/app/` — screens (expo-router file-based routing)
- `frontend/src/store/` — Redux store + RTK Query API slices
- `backend/app/realtime/events.py` — Socket.IO room map (mirrors the old Supabase channels)

## Run locally

Requirements: Node 22.

```powershell
# Terminal 1 — backend (API + realtime)
cd backend
npm install                            # first time only
npm run dev                            # http://localhost:8000/health

# Terminal 2 — frontend (website)
cd frontend
npx expo start --web                   # http://localhost:8081
```

Or run both with one command from the repo root:

```powershell
.\dev.ps1
```

The frontend home screen shows a live "Backend status" tile polling `GET /health` — it turns green when the API is reachable.

## Checks

```powershell
cd backend;  npm test
cd frontend; npm run lint;  npx tsc --noEmit;  npx expo export --platform web
```

## Status

Phase 0 (running skeleton: both apps up on localhost). Next: auth + onboarding (Phase 1).