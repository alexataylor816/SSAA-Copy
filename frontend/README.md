# SSAA frontend

Expo + React Native (web-first) client for SSAA. See the repo root [README.md](../README.md) for how to run the full stack (backend + frontend).

```bash
npm install
npx expo start --web
```

Routes live in `src/app/` (Expo Router file-based routing); components, hooks, and store code live outside it.

## Checks

```bash
npm run lint
npx tsc --noEmit
```
