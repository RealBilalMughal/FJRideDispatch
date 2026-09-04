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
- `.env`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (public, gitignored).
  `VITE_ORS_API_KEY` is optional - only for routing/optimisation (OpenRouteService)
  once the trip feature exists. The map itself (Leaflet + OSM) needs no key.
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
  Sections: Dispatch (Ride, Vehicle Board), Roster (Crew, Flights), Fleet
  (Vendors, Drivers, Vehicles), Administration, Account.
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
  `src/lib/permissions.js` `PERMISSION_PAGES` (`dashboard`, `rides`, `crew`,
  `flights`, `vendors`, `drivers`, `vehicles`, `users`, `roles`).
- **RULE - EVERY new navigable page gets a Role Access row**: (1) add to
  `PERMISSION_PAGES` with its sidebar `group`, (2) gate the nav item + page with
  `can('<key>', ...)`, (3) point its table RLS at `has_perm('<key>', ...)`, (4) seed
  the built-in `admin` row in a migration so plain admins keep access.
- Migrations: `..._init_auth_permissions.sql`, `..._cities_crew.sql`,
  `..._fleet.sql`, `..._flights.sql`, `20260903160000_flight_block.sql`,
  `20260904170000_rides.sql` (all APPLIED).

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
  `Pagination`, `BulkBar`, `StatCards`. `SearchSelect` for type-to-search pickers.
- **RULE - one value per column.** No stacked sub-text under a cell; every field
  is its own column.
- City-scoped list pages share `src/lib/useEntityRows.js` (fetch by `ref_no` desc,
  scoped to `useCity().cityId`). Each has a View (eye, read-only) + Edit + Delete
  row action; the View modal has an Edit button.
- **Delete = type-`DELETE` confirm** (`ConfirmDelete.jsx`), single row or bulk.
  Every list page has select-all + `BulkDeleteBar` (shown when `canDelete`);
  `useSelection()` holds the row Set. Single + bulk share one `pending`
  `{ ids, label }` state -> one `ConfirmDelete`.

## Edge Function `admin-users` - DEPLOYED (dyjgrxeqdvnxwcbwzkql)
`supabase/functions/admin-users/index.ts`. The ONLY place the service_role key is
used (Supabase injects it). `verify_jwt` on. Actions: `create` (users.add),
`update` / `set_password` (users.edit), `set_active` (users.edit on / users.delete
off). `roles[]` validated against `public.roles`. Client wrapper: `src/lib/adminUsers.js`.
Deploy: `supabase functions deploy admin-users --use-api`.

## Pages
- `Dashboard` - placeholder, always visible
- `Crew` (`crew` perm, sidebar group "Roster") - table (ID / Name / Phone /
  Designation / City / Stop / Coordinates), advanced filters, CSV export + import
  (`crew-sample.csv`: name, phone, designation, city, stop_name, coordinates -
  one `"lat, lng"` cell, same format as the form). Coordinates cell has a copy
  button + a pin that opens Google Maps.
  Add/Edit modal: name, phone, designation (free text), city, stop name +
  **coordinates** ("31.9279, 74.9738" -> Leaflet / OpenStreetMap pin via
  `src/components/StopMap.jsx` - draggable, click-to-set, no key). One stop per
  crew. City-scoped.
- `Vendors` / `Drivers` / `Vehicles` (`vendors`/`drivers`/`vehicles` perms, sidebar
  group **"Fleet"**) - Crew-style: city-scoped table, advanced filters, CSV
  export/import (`*-sample.csv`), View/Edit/Delete. All have a mandatory City.
  - **Vendor**: name, contact (PK phone), city.
  - **Driver**: name, contact, city, **vendor (required)** - `SearchSelect`
    filtered to the driver's city; shown as `(refNo) Vendor Name`.
  - **Vehicle**: vehicle_no (unique), company, model, year (4 digits), color, city,
    **driver (optional)** - `SearchSelect` filtered to the vehicle's city. A driver
    can be on ONE vehicle only: `vehicles_driver_uniq` partial unique index +
    a pre-save check -> "already assigned to vehicle <no>". `drivers.vendor_id`
    is `on delete restrict`; `vehicles.driver_id` is `on delete set null`.
- `Flights` (`flights` perm, sidebar group "Roster") - city-scoped, CSV
  export/import. Fields: flight_no (`9P841`), flight_code (`LHE-DXB`), route
  (`Lahore - Dubai`), **block_type** (deadhead / pickup / dropoff / return_leg,
  CHECK-constrained), **flight_time** (`time`), city. Time is stored 24h but
  **displayed 12h with AM/PM** (`fmtTime12`); the `<input type="time">` uses 24h
  (`toTime24`); CSV import accepts either format (`parseTime`). The flight-time
  field's label is dynamic: "Check in time" for Pickup, "Check out time" for
  Drop Off, else "Flight time" (`timeLabel()` in `Flights.jsx`). No unique
  constraint (a flight recurs).
- **Phone** = PK mobile only, EVERYWHERE there's a phone field (`src/lib/phone.js`
  + `PkPhoneInput.jsx`): Crew / Vendors / Drivers (`contact` col), Users + Profile
  (`profiles.phone`). Stored `+92XXXXXXXXXX`, shown `+92 3XX XXXXXXX`. Input = fixed
  `+92` prefix + 10-digit local starting with 3, clipboard-paste button.

## Maps & routing
- Map display: **Leaflet + react-leaflet + OpenStreetMap tiles** - free, no key.
  `src/components/StopMap.jsx` (single pin), `src/components/RouteMap.jsx`
  (multi-point + polyline, read-only). (Google Maps dropped - key/billing friction.)
- **OpenRouteService** (`src/lib/ors.js`, `VITE_ORS_API_KEY`): `routeInfo(coords)`
  -> road km + duration + geometry via `/v2/directions/driving-car/geojson`
  (`radiuses: -1` so airport/stop points snap to the nearest road). `gmapsRoute()`
  builds a keyless Google Maps directions URL for the "open route" action.

## Ride (`rides` page, sidebar label "Ride", group "Dispatch")
- `rides` + `ride_crew` (ordered by `seq`) + `cities.airport_*` (per-city airport).
  Vehicle double-booking is blocked by an `EXCLUDE USING gist` on
  `(vehicle_id, tstzrange(start_at, end_at))` - client pre-checks and shows
  "busy on Ride N till <time>". Ride logic lives in `src/lib/rideRoute.js`.
- **Block -> route** (`buildRoutePoints`): pickup `crew1..crewN -> Airport`;
  dropoff `Airport -> crew1..crewN`; deadhead `airport` mode `Airport -> 1 crew`
  / `crew` mode `crew1 -> crew2` (exactly 2); return_leg `1 crew -> Airport`.
  Crew order = selection order. `crewRule()` enforces min/max crew per block.
- Flight pick -> snapshot flight_no/code, auto block_type + city, and the
  flight_time fills check-in (pickup) or check-out (dropoff). check-in/out each
  keep an `_old` (scheduled, from the flight) + `_new` (as dispatched) value;
  labelled **"Check-in" / "Check-in Actual"** (and check-out) in the table,
  export and view. Route point labels are the **stop name** (not the crew name);
  the Vehicle column/field shows `vehicle_no` only; the Starts column is
  **"Ride Time"**.
- The form asks only for **Ride starts** (auto-suggested: pickup = check-in -
  drive time, dropoff = check-out; editable). **ETA** (= start + ORS drive time)
  and the internal `end_at` (= start + drive + 30-min buffer, for the vehicle
  conflict) are computed, never typed. No status field - rides land as
  `dispatched`; completion waits on a future driver app.
- **Optimise stop order** button (pickup/dropoff, 3+ crew): ORS `/optimization`
  reorders the crew stops for the shortest drive (`optimizeCrewOrder` in ors.js).
- Table: **Return Leg** action on dropoff rides -> ConfirmDialog -> creates a
  `return_leg` ride (last crew -> Airport, same vehicle, `return_of_ride_id` set).
  Also a route icon (Google Maps), View/Edit/Delete, status inline-select.
- Airports seeded for the 3 cities; change them by editing `cities.airport_*`.
- **Generate** (Rides header) - bulk-create rides from one flight over a date
  range + weekday picker + optional shared crew. Vehicles assigned per-ride after.
- **Vehicle Board** (`/vehicle-board`, gated on `rides` view) - day gantt of each
  vehicle's booked rides (bars by `start_at`/`end_at`, coloured by block, click ->
  ride detail) + a Map tab drawing every routed ride for the day.
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
- [x] Crew stop map on Leaflet + OpenStreetMap (no key)
- [x] Fleet: Vendors, Drivers, Vehicles (`..._fleet.sql`)
- [x] Flights page (`20260903150000_flights.sql`)
- [x] `VITE_ORS_API_KEY` set + verified (directions + optimization)
- [x] Ride Dispatch page (`20260904170000_rides.sql`) - block-wise route, ORS km,
      vehicle time-window conflict, return-leg, old/new check-in/out
- [x] Rides phase 2: optimise-order button, Generate (recurring), Vehicle Board
- [ ] Create Vercel project, link repo (env: the two `VITE_SUPABASE_*` vars)
