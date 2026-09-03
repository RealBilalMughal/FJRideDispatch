# FJ Ride Dispatch - Project Context

## Overview
Internal **ride-dispatch console**. Standalone project - **completely separate**
from GraphicSpark CRM (E:\GulbergSPA) and BlackDrivo (D:\BlackDrivoAdmin): its
own git repo, GitHub remote, Supabase project and Vercel project. Do not share
keys, tables or deploy targets with any other project.

- Folder: `E:\FJRideDispatch`
- GitHub: https://github.com/RealBilalMughal/FJRideDispatch  (remote `origin`, branch `main`)
- Supabase: https://dyjgrxeqdvnxwcbwzkql.supabase.co  (project ref `dyjgrxeqdvnxwcbwzkql`)
- Vercel: _(not created yet)_

## Stack
- React 19 + Vite (JavaScript / JSX)
- `react-router-dom` 7, `lucide-react`, `recharts`, `react-hot-toast`
- Supabase Auth + Postgres + RLS; client uses the anon key only
- Deploy: Vercel (separate project)

## Security
- `.env`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_GOOGLE_MAPS_API_KEY`
  (all public / browser keys, gitignored). Restrict the Maps key by HTTP referrer.
- The `service_role` key must NEVER be in this frontend repo, never in a `VITE_`
  var, never committed. Server-only (Supabase Edge Function secrets) if ever needed.

## Theme (ported from GraphicSpark - https://www.graphicspark.pk/)
- Fonts: **Space Grotesk** (headings) + **Inter** (body/UI), from Google Fonts
- Accent `#3471B8`, heading `#2D2C2B`, body `#727272`, border `#E4E4E4`
- Primary CTA buttons = full pill (`--r-pill`); form/inline buttons = small radius
- Tokens + shared classes in `src/index.css`

## UI conventions
- **FLAT - no card containers.** Content sits on the white page; separate blocks
  with a heading + a `1px var(--border)` hairline. Modals are the only floating panels.
- **Left sidebar: LIGHT**, sectioned with uppercase labels + `#e6e6e6` brand strip.
  Active nav = accent text + a 3px accent bar on the left edge (no filled pill).
  lucide icons at `size={17}`. `src/components/Sidebar.jsx` + `layout.css`.
- **No topbar** - a floating profile chip top-right (`src/components/Topbar.jsx`).
- **Modals** all use `src/components/Modal.jsx` (closes only via X / Esc, never a
  backdrop click). **Never `window.confirm` / `alert`** - use `ConfirmDialog.jsx`
  or `ConfirmDelete.jsx` (type-DELETE variant).
- Full-pill radius for real CTA buttons (`.btn`); small radius for inline/form buttons.

## Permission model (ported from GraphicSpark - page x action, role + user)
- `profiles` (1:1 auth.users; `role` = DERIVED primary system tier, trigger-synced),
  `roles` (4 system rows + Super-Admin custom rows), `user_roles` (multi; user gets
  the UNION), `role_permissions` (role text -> roles.key, page, action, allowed),
  `user_permissions` (per-user override, wins outright).
- `private.has_perm(page, action)` ORs `allowed` across the caller's `user_roles`;
  super_admin bypasses. Helpers: `is_admin()`, `current_user_role()`, `is_active_user()`.
- `AuthContext.can(page, action)` is the single client gate. Catalogue:
  `src/lib/permissions.js` `PERMISSION_PAGES` (currently `dashboard`, `crew`, `users`, `roles`).
- **RULE - EVERY new navigable page gets a Role Access row**: (1) add to
  `PERMISSION_PAGES` with its sidebar `group`, (2) gate the nav item + page with
  `can('<key>', ...)`, (3) point its table RLS at `has_perm('<key>', ...)`, (4) seed
  the built-in `admin` row in a migration so plain admins keep access.
- Migrations: `20260903120000_init_auth_permissions.sql`, `20260903130000_cities_crew.sql` (APPLIED).

## City scoping (a permission dimension)
- `cities` (Lahore / Karachi / Islamabad, extendable), `role_cities (role, city_id)`,
  `user_cities (user_id, city_id)`. **No rows anywhere = every city** (permissive);
  rows present = restricted to exactly those; `user_cities` overrides `role_cities`;
  super_admin = every city. RLS helper `private.has_city(city_id)`.
- **RULE - every city-scoped table's RLS ANDs `has_city(city_id)`** on top of
  `has_perm(...)` (see `public.crew`). The row's `city_id` is checked on
  insert/update too, so a Lahore-only user can only write Lahore rows.
- Client: `src/context/CityProvider.jsx` + `useCity()`. `<CityFilter>` sits in the
  topbar - a dropdown of "All + the user's cities", or a **locked** label when the
  user can see exactly one city. `useCity().cityId` (null = All) -> list pages add
  `.eq('city_id', cityId)`; add-forms default to it. Role Access has a "City access"
  panel (By Role + By User) that writes `role_cities` / `user_cities`.

## Shared display-ID series
- ONE sequence `public.ref_no_seq` (starts 1001) feeds every entity table's
  `ref_no bigint not null unique default nextval('public.ref_no_seq')`. Whatever
  record is created next gets the next number regardless of type (crew 1001 ->
  vendor 1002 -> ...). Shown as a **plain number** - no prefix, no `#`.
- `grant usage, select on sequence public.ref_no_seq to authenticated, service_role`
  in the migration that first uses it (already granted).

## List-page conventions
- Every list page has an **Export CSV** button - dumps the currently filtered rows
  as a report (`src/lib/csv.js` `toCsv` + `downloadCsv`). Import (where it makes
  sense) uses `parseCsvObjects` + a "Download sample" button.
- `src/components/data/` kit: `DataTable`, `FilterBar` (search + `advanced` grid),
  `Pagination`, `BulkBar`, `StatCards`.

## Edge Function `admin-users` - DEPLOYED (dyjgrxeqdvnxwcbwzkql)
`supabase/functions/admin-users/index.ts`. The ONLY place the service_role key is
used (Supabase injects it). `verify_jwt` on. Actions: `create` (users.add),
`update` / `set_password` (users.edit), `set_active` (users.edit on / users.delete
off). `roles[]` validated against `public.roles`. Client wrapper: `src/lib/adminUsers.js`.
Deploy: `supabase functions deploy admin-users --use-api`.

## Pages
- `Dashboard` - placeholder, always visible
- `Crew` (`crew` perm, sidebar group "Dispatch") - table + advanced filters, CSV
  export/import (`crew-sample.csv`). Add/Edit modal: name, contact, designation
  (free text), city, stop name + **coordinates** ("31.9279, 74.9738" -> Google map
  pin via `src/components/StopMap.jsx`, draggable). One stop per crew. City-scoped.
- `Users` (`users` perm) - list / filter / add / edit / password / activate / bulk.
  Add/edit go through the `admin-users` EF. No commission fields (GraphicSpark-only).
- `RoleAccess` (super_admin, or `roles.view`) - By Role / By User matrix + custom-role
  CRUD. Uses `ConfirmDialog` for role delete (not window.confirm).
- `Profile` - **read-only view by default**; "Edit" reveals the details form,
  "Change" reveals the password form. Nothing is editable until you click in.

## Supabase CLI
Linked to `dyjgrxeqdvnxwcbwzkql` (the MCP connector only reaches Blackdrivo, so use
the CLI): `supabase db push`, `supabase functions deploy <name> --use-api`.

## TODO
- [x] Theme + Login + permission model + User Management + Role Access + Profile
- [x] DB schema migration applied; `admin-users` EF deployed
- [x] First super_admin: `bilal.mughal@buscaro.com`
      (auth id `5e8fba49-b6f5-4acc-8c70-b4c7ca126886`, `user_roles` -> super_admin)
- [x] Public sign-up turned OFF
- [x] City scoping + shared ref series + Crew page (migration `..._cities_crew.sql`)
- [x] `VITE_GOOGLE_MAPS_API_KEY` set in `.env` (restrict it by HTTP referrer in
      Google Cloud - key was shared in plain text and ships in the client bundle)
- [ ] Next dispatch tables (vendor, ...) - each uses `ref_no_seq` + `has_city`
- [ ] Create Vercel project, link repo (env: `VITE_SUPABASE_*` + `VITE_GOOGLE_MAPS_API_KEY`)
