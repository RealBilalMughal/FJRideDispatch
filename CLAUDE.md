# FJ Ride Dispatch - Project Context

## Overview
Internal **ride-dispatch console**. Standalone project - **completely separate**
from GraphicSpark CRM (E:\GulbergSPA) and BlackDrivo (D:\BlackDrivoAdmin): its
own git repo, GitHub remote, Supabase project and Vercel project. Do not share
keys, tables or deploy targets with any other project.

- Folder: `E:\FJRideDispatch`
- GitHub: _(not created yet)_
- Supabase: _(not created yet)_
- Vercel: _(not created yet)_

## Stack
- React 19 + Vite (JavaScript / JSX)
- `react-router-dom` 7, `lucide-react`, `recharts`, `react-hot-toast`
- Supabase Auth + Postgres + RLS; client uses the anon key only
- Deploy: Vercel (separate project)

## Security
- `.env` holds only `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (public, gitignored)
- The `service_role` key must NEVER be in this frontend repo, never in a `VITE_`
  var, never committed. Server-only (Supabase Edge Function secrets) if ever needed.

## Current state (starter scaffold)
- `src/App.jsx` - routes: `/login` (public) -> `<ProtectedRoute>` -> `<Layout>` -> `/` Dashboard
- `src/context/AuthProvider.jsx` - Supabase session + optional `profiles` row.
  `can()` is a STUB (returns true for any authenticated active user) - the real
  page x action / role permission model is NOT built yet.
- `src/components/` - `Layout` (shell), `Sidebar` (light, sectioned, accent left-bar
  active state), `Topbar` (floating profile chip), `ProtectedRoute`, `FullLoader`
- `src/pages/` - `Login` (email/password, no public sign-up), `Dashboard` (placeholder)
- `src/index.css` - theme tokens (starter teal accent `#1f6f5c`) + shared classes

## UI conventions (to keep as pages are added)
- **FLAT - no card containers.** Content sits on the white page; separate blocks
  with a heading + a `1px var(--border)` hairline. Modals are the only floating panels.
- **Left sidebar: LIGHT**, sectioned with uppercase labels. Active nav = accent text
  + a 3px accent bar on the left edge (no filled pill). lucide icons at `size={17}`.
- Never use `window.confirm` / `alert` - use a dialog component.
- Full-pill radius for real CTA buttons (`.btn`); small radius for inline/form buttons.

## TODO
- [ ] Get the dispatch data model + workflow from the user, then design tables/RLS
- [ ] Create Supabase project; add URL + anon key to `.env`
- [ ] Decide the permission model (roles) and replace the `can()` stub
- [ ] `git init` done? create GitHub repo + push
- [ ] Create Vercel project, link repo
- [ ] Turn OFF public sign-up in Supabase Auth settings
