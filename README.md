# FJ Ride Dispatch

Internal ride-dispatch console. Standalone project - its own git repo, Supabase
project and Vercel project. Not connected to any other app.

## Stack
- React 19 + Vite (JavaScript / JSX)
- `react-router-dom` (routes), `lucide-react` (icons), `recharts` (charts),
  `react-hot-toast` (toasts)
- Supabase (Auth + Postgres + RLS); the client uses the anon key only
- Deploy target: Vercel

## Setup
```bash
npm install
cp .env.example .env   # fill in VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm run dev
```

## Layout
```
src/
  App.jsx              routes (login -> protected -> layout -> pages)
  main.jsx             entry: BrowserRouter + AuthProvider + Toaster
  index.css            theme tokens + shared component classes
  context/             AuthProvider (session + profile), useAuth hook
  components/          Layout, Sidebar, Topbar, ProtectedRoute, FullLoader
  lib/                 supabase.js (client)
  pages/               Login, Dashboard (placeholder)
```

## Status
Starter scaffold only. Auth, protected routing and the app shell work. The
permission model, data model and dispatch pages are still to be designed.

## Security
`.env` holds only the public Supabase URL + anon key (gitignored). The
`service_role` key must never live in this repo or in any `VITE_` variable.
