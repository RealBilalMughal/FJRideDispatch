# FJ Ride Dispatch - Project Context

## Overview
Internal **ride-dispatch console**. Standalone project - **completely separate**
from GraphicSpark CRM (E:\GulbergSPA) and BlackDrivo (D:\BlackDrivoAdmin): its
own git repo, GitHub remote, Supabase project and Vercel project. Do not share
keys, tables or deploy targets with any other project.

- Folder: `E:\FJRideDispatch`
- GitHub: https://github.com/RealBilalMughal/FJRideDispatch  (remote `origin`, branch `main`)
- Supabase: https://dyjgrxeqdvnxwcbwzkql.supabase.co  (project ref `dyjgrxeqdvnxwcbwzkql`)
- Vercel: https://fjride.vercel.app  (project `fjride`, git-linked to
  `RealBilalMughal/FJRideDispatch` `main` - auto-deploys on push). **Build
  needs all three `VITE_*` env vars set in Vercel Project Settings ->
  Environment Variables** (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
  `VITE_ORS_API_KEY`) - Vite inlines them at build time, so a missing one
  = a blank white page (`src/lib/supabase.js` throws on module load, no
  error boundary). Adding/changing a var needs a fresh build (a new commit,
  or Redeploy with build cache OFF), not just a cache-reusing redeploy.

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
  with a heading + a `1px var(--border)` hairline. Modals are the only floating
  panels. (The one deliberate exception: the **Dashboard**'s metric cards -
  a dashboard genuinely reads better as scannable cards. Nowhere else.)
- **Left sidebar: LIGHT**, sectioned with uppercase labels + `#e6e6e6` brand strip.
  Active nav = accent text + a 3px accent bar on the left edge (no filled pill).
  lucide icons at `size={17}`. `src/components/Sidebar.jsx` + `layout.css`.
  Sections: Dispatch (Ride, Vehicle Board, Tracker), Roster (Crew, Flights), Fleet
  (Vendors, Drivers, Vehicles), Administration (Users, Role Access, Settings),
  Account.
- **No topbar** - a floating profile chip top-right (`src/components/Topbar.jsx`).
- **Modals** all use `src/components/Modal.jsx` (closes only via X / Esc, never a
  backdrop click). **Never `window.confirm` / `alert`** - use `ConfirmDialog.jsx`
  or `ConfirmDelete.jsx` (type-DELETE variant).
- Full-pill radius for real CTA buttons (`.btn`); small radius for inline/form buttons.
- **Dates are `01-Aug-26`** everywhere (`fmtDate` in `src/lib/format.js`) - custom
  formatter, not `toLocaleDateString`, so it's exact regardless of locale.

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
  `20260904170000_rides.sql`, `20260904190000_vehicle_shifts.sql`,
  `20260905120000_ride_buffers.sql`, `20260906120000_return_leg_buffer.sql`,
  `20260906140000_return_leg_cascade.sql`, `20260906180000_duty_sheet_date.sql`,
  `20260906200000_deadhead_buffer.sql`, `20260906210000_disable_vehicle_window_excl.sql`,
  `20260906220000_route_geometry.sql`, `20260906230000_app_settings_tracker.sql`
  (superseded by the next one - dropped, no data ever depended on it),
  `20260906240000_tracker_per_city.sql`, `20260906250000_vehicle_tracker.sql`
  (all APPLIED).

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
  `useCity().reloadCities()` re-fetches the raw `cities` rows (id, name, sort,
  airport_*, checkin/checkout_buffer_min) on demand - used after a save on the
  Settings page so `allCities`/`allowedCities` refresh without a full page reload.

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
- `Dashboard` (`/`, always visible - the landing page) - ride analytics over
  a Today / Week / **This Month** / Month / All date range (**default This
  Month**; custom from/to inputs too - `.date-tabs` + `presetRange()`, same
  as the Rides filter bar but with the extra `this-month` preset =
  month-to-date, 1st → today, vs `month` = the full calendar month) and the
  global city filter. Borderless metric cards (`Dashboard.css`, an
  intentional exception to the no-cards rule; white with `--shadow-sm`, 14px
  radius, an icon chip each). Sections:
  - **Hero row**: Total rides (filled in the **Fly Jinnah brand red
    `#ff0041`**, `.dash-card-accent`), Total distance (Σ `distance_km`), Crew
    moved (Σ `displayCrewCount` so Deadhead/Return Leg contribute 0, matching
    the table), Deadhead ratio (deadhead km ÷ total km, %). Each shows a
    **trend** vs the equivalent previous period (`pctChange()` - a second
    query over `[prevFrom, prevTo]`, the same span immediately before
    `from`; skipped for the All range). Green up / red down / muted flat;
    white on the accent card.
  - **Rides per day** - a **recharts** `<AreaChart>` (monotone spline, soft
    `#3471b8` gradient fill, dots at each point for ≤14 days else none) in a
    `<ResponsiveContainer>` (`recharts` was already a dep; this + the heatmap
    are its only uses - adds ~107KB gzip to the lazy-loaded Dashboard chunk,
    nowhere else). Custom two-line `DayTick` (weekday over day-of-month;
    3-letter weekday for ≤14 points, single letter when denser), dashed
    horizontal grid, hover tooltip, no entry animation. Shown only when the
    range spans >1 day (hidden on the Today default), below the block/shift
    cards.
  - **Peak hours** - a compact weekday×hour heatmap (`PeakHeatmap`, plain
    CSS grid, no lib): 7 short rows (Sun–Sat) × 24 cells, each
    `rgba(52,113,184, α)` with α scaled to that cell's share of the busiest
    hour, `0h/6h/12h/18h` column labels, a Less–More swatch legend.
    Ride start times bucketed in **Pakistan time** via `pkHourWeekday()` in
    `lib/time.js` (same +5h-then-UTC-getters trick as `pkNow`). The range
    query's `RANGE_SELECT` gained `start_at` for this. Scrolls horizontally
    on narrow screens.
  - **Rides by block** | **Shift** - the two-column card split; divider is a
    `border-right` on the block *grid* so it's only card-tall, not `h2`-tall.
    2×2 blocks below 560px.
  - **By city** - only when the topbar filter is on All: a small table of
    each city's ride count + km (`r.city.name` from the range query's
    `city:cities(name)` join), busiest first.
  - **Today · live** - a strip of *today's* rides (its own always-`pkToday()`
    query, independent of the range) filtered to "ended <90 min ago, running,
    or upcoming", sorted by `start_at`, capped at 8: time · ref · block ·
    vehicle · first crew, plus a `liveStatus()` chip (done / running / in
    N min / later).
  A user without `rides` view just sees a welcome placeholder (RLS would
  return nothing anyway).
- `Crew` (`crew` perm, sidebar group "Roster") - table (ID / Name / Phone /
  Designation / City / Stop / Coordinates), advanced filters, CSV export + import
  (`crew-sample.csv`: name, phone, designation, city, stop_name, coordinates -
  one `"lat, lng"` cell, same format as the form). Coordinates cell has a copy
  button + a pin that opens Google Maps.
  Add/Edit modal: name, phone, designation (free text), city, stop name +
  **coordinates** ("31.9279, 74.9738" -> Leaflet / OpenStreetMap pin via
  `src/components/StopMap.jsx` - draggable, click-to-set, no key). One stop per
  crew. City-scoped. (Airport name/location editing lives on the **Settings**
  page now, not here - see Pages -> Settings.)
- `Vendors` / `Drivers` / `Vehicles` (`vendors`/`drivers`/`vehicles` perms, sidebar
  group **"Fleet"**) - Crew-style: city-scoped table, advanced filters, CSV
  export/import (`*-sample.csv`), View/Edit/Delete. All have a mandatory City.
  - **Vendor**: name, contact (PK phone), city.
  - **Driver**: name, contact, city, **vendor (required)** - `SearchSelect`
    filtered to the driver's city; shown as `(refNo) Vendor Name`.
  - **Vehicle**: vehicle_no (unique), company, model, year (4 digits), color, city,
    **Day driver + Night driver** (both optional) - a 24h vehicle with a 2-driver
    shift. `driver_id` = day, `night_driver_id` = night. A driver holds at most one
    day slot and one night slot (two partial unique indexes) and day != night on a
    vehicle (`vehicles_day_night_distinct`). Both FKs `on delete set null`.
    `drivers.vendor_id` is `on delete restrict`. Optional **Tracker link**
    (`vehicles.tracker_url`) - that vehicle's own AI Track sharing link,
    distinct from `cities.tracker_url` (the fleet map on the Tracker page,
    Pages -> Tracker) - powers the Ride view's Live Tracking card (see the
    Ride section below).
  - **Day/Night is a manual pick, no time-window auto-detection.** There used to
    be a global shift window (`public.dispatch_settings`, a "Shift times" button
    on the Vehicles header) that auto-computed Day vs Night from the ride's
    start time; removed - it auto-detected wrong in exactly the hours it
    mattered (see the timezone note under Ride below) and added a layer of
    "why did it pick that" the dispatcher had to second-guess. The pill toggle
    in the Ride form is now the only source of truth (`src/lib/shift.js` keeps
    just `shiftLabel()`); `dispatch_settings` the table still exists in the DB
    but nothing reads or writes it anymore.
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
  -> road km + duration + geometry (`{ distanceKm, durationMin, line }`, `line`
  = `[[lat,lng], ...]`) via `/v2/directions/driving-car/geojson` (`radiuses: -1`
  so airport/stop points snap to the nearest road). `gmapsRoute()` builds a
  keyless Google Maps directions URL for the "open route" action.
- **`rides.route_geometry`** (`jsonb`, nullable) persists that `line` at
  creation/edit time (every insert/update that calls `routeInfo()` - the main
  Ride form, `GenerateRidesModal`, and `CreateRideModal`'s Return Leg/Deadhead/
  companion Pickup - saves `info?.line ?? null` alongside `distance_km`/
  `duration_min`, which is all that used to be kept). `RouteMap`'s `line` prop
  (already supported - the Ride form's own live preview always passed it) is
  now also wired up for the **read-only View** (`row.route_geometry`) and the
  **Vehicle Board's Map tab** (`r.route_geometry`, preferred over the straight
  `waypoints` line, which is now only a fallback for rows saved before this
  column existed or where ORS had no key/failed) - both used to draw straight
  segments between stops instead of the actual road route because only the
  stop points were ever saved. This also means opening/reopening either view
  makes **no ORS call** - the geometry was fetched once, at creation/edit
  time, never on read.
- **Live Tracking card** (Ride view -> read-only detail, `Rides.jsx`'s
  `LiveTrackingCard`) - shown instead of the plain `RouteMap` whenever the
  ride's own vehicle has a Tracker link (`vehicles.tracker_url`, see the
  Vehicle bullet above). Polls `fetchLiveTracker()` (`src/lib/tracker.js`)
  every 8s while the modal is open (stops on close) - this hits the AI Track
  sharing link's own `/items` endpoint directly from the browser (confirmed
  CORS-open, `Access-Control-Allow-Origin: *`; it's an internal,
  undocumented endpoint of a third-party service, not a published API, so
  every field is read defensively and the shape could change without
  notice), giving `{ lat, lng, speed, course, status, address }` for that one
  vehicle. Renders as a coloured dot on the same `RouteMap` via its new
  `liveMarker` prop (bounds-fit includes the live point too, so an
  off-route vehicle still stays in view), plus badges derived purely
  client-side from that one fix (`src/lib/geo.js`'s new `distanceMeters()` /
  `distanceToLineMeters()` - no extra ORS calls):
  - **Moving / Stopped / Offline / Engine on** + live speed, from the
    tracker's own `icon_color`.
  - **Arrived** - within 300m of `dest_lat`/`dest_lng`.
  - **Running late** - past the ride's own ETA (`start_at + duration_min`)
    and not yet Arrived.
  - **Off route** - the live fix is more than 500m from `route_geometry`.
  - **Over speed** - live speed over a flat 100 kph (`SPEED_LIMIT_KPH` in
    `Rides.jsx` - the tracker's sharing link doesn't expose a per-vehicle
    speed-limit/geofence config, only the live fix, so this is our own
    threshold, not theirs).
  **Not implemented**: a full "actual route driven vs planned route"
  historical comparison - the sharing link's `/items` response only carries
  a short recent `tail` (a handful of breadcrumb points), not the vehicle's
  whole trip history, so there's nothing to diff against after the fact.
  Building that would mean our own backend polling and logging positions
  continuously while a ride is active (a scheduled Edge Function, not
  something the browser can do reliably) - a bigger follow-up, not attempted
  here.

## Ride (`rides` page, sidebar label "Ride", group "Dispatch")
- `rides` + `ride_crew` (ordered by `seq`) + `cities.airport_*` (per-city airport).
  Vehicle double-booking is still blocked at the DB level by an
  `EXCLUDE USING gist` on `(vehicle_id, tstzrange(start_at, end_at))` (a save
  that truly overlaps still fails with the `23P01` -> "already booked for an
  overlapping time" mapped error, `mapRideError()`). **The client-side
  pre-check/warning is temporarily disabled** - the `RideModal` conflict
  `useEffect` (was: query `rides` for an overlapping `start_at`/`end_at` on
  the same vehicle, driving the "Busy on Ride N till <time>" field hint and
  blocking Save) now just does `setConflict(null)` with the real query
  commented out directly below it, per an explicit request to turn it off
  for now and rework it properly later - re-enable by uncommenting that block
  (restores its own local `NIL` placeholder-uuid constant too). Ride logic
  lives in `src/lib/rideRoute.js`.
- **Block -> route** (`buildRoutePoints`): pickup `crew1..crewN -> Airport`;
  dropoff `Airport -> crew1..crewN`; deadhead `airport` mode `Airport -> 1 crew`
  / `crew` mode `crew1 -> crew2` (exactly 2); return_leg `1 crew -> Airport`.
  Crew order = selection order. `crewRule()` enforces min/max crew per block.
- Flight pick -> snapshot flight_no/code, auto block_type + city, and the
  flight_time fills check-in (pickup) or check-out (dropoff). check-in/out each
  keep an `_old` (scheduled, from the flight) + `_new` (as dispatched) value;
  labelled **"Check-in" / "Actual"** (and "Check-out" / "Actual") - export and
  the view modal keep these as two separate columns/rows per pair. **The
  table doesn't**: `CheckCell` stacks Actual (if set) below the scheduled
  time inside the single "Check-in"/"Check-out" column (muted `.secondary`
  second line, like `CrewCell`'s 2+-crew stacking) rather than a second
  column - table-only, a deliberate exception to the one-value-per-column rule.
  Route point labels are the **stop name** (not the crew name); the Vehicle
  column/field shows `vehicle_no` only; the Starts column is **"Ride Time"**.
- **Shift + driver**: when a vehicle is picked, a **manual** Day/Night pill toggle
  (defaults to the row's saved `shift`, else Day - no auto-detection from the
  ride's time) picks that vehicle's day or night driver. The ride snapshots
  `shift` + `driver_id`. Table and view show Shift + Driver; export too. A
  **Return Leg** copies its parent dropoff ride's own `shift` rather than
  computing one.
- **Duty Sheet date** (`rides.duty_sheet_date`, nullable - falls back to the
  row's own `ride_date` on display for pre-existing rows). A night duty is
  physically dispatched on `ride_date` but rostered against the day the shift
  *started*, not necessarily the calendar day the ride landed on - when
  **Night** is picked in the Ride form, a "Duty Sheet: previous day" checkbox
  appears next to the toggle; checking it sets Duty Sheet = `ride_date - 1`
  (e.g. ride_date 5 Sep -> Duty Sheet 4 Sep), otherwise Duty Sheet =
  `ride_date`. Switching back to Day clears the checkbox. The form shows the
  live result in a hint ("Duty Sheet: 04-Sep-26"); on edit, the checkbox
  restores by comparing the saved `duty_sheet_date` to `ride_date`. New table
  column **"Duty Sheet"** sits right after **"Date"** (also in the view modal
  and CSV export). Generate (bulk) and Return Leg both just set it equal to
  their own `ride_date` - the previous-day pick is a manual, one-ride-at-a-
  time dispatcher call, not something either of those infers.
- **Pakistan-time date helpers** (`pkNow()` / `pkToday()` in `lib/time.js`):
  everywhere "today" needs computing (default Ride date, the Today/Week/Month
  filter presets, Vehicle Board's date nav, CSV export filename stamps) goes
  through these, never a raw `new Date().toISOString().slice(0, 10)`. Pakistan
  is a fixed UTC+5 with no DST, so shifting `Date.now()` by that offset and
  reading it with the UTC getters gives the correct Pakistan calendar date
  regardless of the browser's own timezone - plain `.toISOString()` is always
  UTC, so during Pakistan's 12:00–4:59 AM it silently reports the *previous*
  calendar day, which is exactly the bug this fixed (a ride dated "today"
  wouldn't show up under the default Today filter). Date-string arithmetic
  (`presetRange(preset)` -> `{ from, to }` for the Today/Week/Month/All tabs,
  shared by the Rides filter bar and the Dashboard; `addDays()`; both in
  `lib/time.js`) uses `Date.UTC(...)` on the already-correct date's Y/M/D,
  never local-timezone `Date` parsing/getters, for the same reason.
- The form's check-in/out fields are **block-conditional**: Pickup shows
  Check-in (scheduled, disabled) + Actual (editable); Drop Off shows Check-out
  + Actual; deadhead/return_leg show neither.
- The start-time field is labelled **"Pickup Time"** (pickup), **"Drop Time"**
  (dropoff) or **"Ride Time"** (else) - `rideTimeLabel()` in `rideRoute.js`.
  Auto-suggested from the anchor time (Actual if set, else scheduled) and
  **this ride's city's own buffer** (`cities.checkin_buffer_min` /
  `checkout_buffer_min`, defaults 90 / 30): pickup = check-in − checkin buffer
  − drive time, so the vehicle is AT the airport that long before check-in;
  dropoff = check-out **+** checkout buffer. Editable. **ETA** (= start + ORS
  drive time) and the internal `end_at` (= start + drive + 30-min turnaround
  buffer, for the vehicle conflict - a separate, fixed `BUFFER_MIN`) are
  computed, never typed. `status` still defaults to `dispatched` on every
  insert but is no longer shown as a table/export column (see below);
  completion waits on a future driver app.
  (Check-in/Check-out buffer minutes are edited on the **Settings** page now,
  not here - see Pages -> Settings.) `GenerateRidesModal` (bulk/recurring)
  applies the same per-city formula.
- **Optimise stop order** button (pickup/dropoff, 3+ crew): ORS `/optimization`
  reorders the crew stops for the shortest drive (`optimizeCrewOrder` in ors.js).
- Table: **"Create Ride"** action on dropoff rides (was "Create Return Leg")
  opens `CreateRideModal` - a mode switch (flat underline tabs, `.date-tabs`)
  between two ways to auto-create a follow-on ride from the last crew this
  dropoff ride dropped off at. **A dropoff ride may have AT MOST ONE
  follow-on ride, Return Leg OR Deadhead - not both, and not a second of
  either.** Once either exists (`Rides.jsx`'s `followOnByParent` map, built
  off `rows` the same way `byId`/`rootRefNo` are - any direct child with
  `block_type` `return_leg` or `deadhead` and a matching `return_of_ride_id`),
  the whole modal replaces its tab switcher with a single details panel for
  whichever one exists - its ref (`<dropoff ref>-R`/`-D`), date, Ride Time,
  vehicle, and a "View return leg"/"View deadhead" shortcut - neither create
  form is reachable any more from that dropoff. The row action's icon title
  and the delete-confirm label (`ride 1211 and its return leg 1211-R` /
  `...and its deadhead 1211-D`) reflect whichever type exists too. Before
  that limit exists (no follow-on yet), the two tabs work as follows:
  - **Return Leg** - last crew's stop -> Airport, same vehicle. It's an empty
    repositioning (no passenger), so its **Count always displays 0** - forced
    in the `list` memo/view modal by `block_type === 'return_leg'`, not
    derived from `ride_crew.length`. It still gets a single `ride_crew` row
    (that same last crew, `seq: 0`) purely so the **Crew** column/export/view
    can still show whose stop it originated from.
  - **Deadhead** (`block_type: 'deadhead'`, `deadhead_mode: 'crew'`) - last
    crew's stop -> a newly picked crew's stop (`SearchSelect`, both ends as
    `ride_crew` this time - a real repositioning move, not empty like Return
    Leg, but still not a real passenger pickup/dropoff, so its **Count also
    always displays 0** in the table/export/view, same forced-zero treatment
    as Return Leg - see `displayCrewCount()`). A Flight is required
    (`SearchSelect`) purely as a snapshot/reference ("which flight this
    deadhead was for") - no Check-in/Check-out/Actual fields are shown for
    it (a Deadhead has no dispatch-vs-scheduled distinction of its own); the
    Route field's hint line is the only timing shown, auto-computed and
    never manually entered: **"Ride Time HH:MM (dropoff arrival + N min
    Deadhead buffer) · <destination crew>'s ETA HH:MM"**. Live KM/duration
    preview (`ride-km-badge`) as soon as a destination is picked. An optional
    **"Also create a Pickup ride"** checkbox additionally creates a companion
    Pickup ride for that same new crew (crew -> Airport, its own
    separately-picked flight - this one DOES keep its own Check-in/Actual
    fields, since it's a real pickup with its own dispatch - its Ride Time
    via the normal Check-in-buffer auto-suggest formula) - only shown/
    required when checked.
  Both Return Leg and Deadhead: **Ride Time = the dropoff ride's own ETA
  (arrival at the crew stop) + that city's buffer** (`cities.return_leg_buffer_min`
  / `deadhead_buffer_min`, defaults 10 / 15, edited at Settings -> Ride Buffer
  Time) - e.g. dropped off with a 3:00 PM ETA + 10 min -> Return Leg Ride Time
  3:10 PM; the leg's own ETA (to its destination) comes from the normal
  `duration_min` computation - no manual time entry either way. Both, and the
  companion Pickup, chain via `return_of_ride_id` (Deadhead's parent = the
  dropoff ride; the companion Pickup's parent = the *Deadhead* ride, so the
  DB relation is still 2 hops for it - this is what the cascade-delete below
  walks) and **display with a suffix over their real, independent `ref_no`** -
  purely cosmetic, computed client-side in `Rides.jsx`'s `list` memo
  (`suffixFor()` + `rootRefNo()`, which walks `return_of_ride_id` up to the
  TOP-most ancestor regardless of how many hops, off a `return_of_ride_id ->
  id` map built from the already-loaded `rows`, no extra query): Return Leg
  `"<dropoff ref>-R"`, Deadhead `"<dropoff ref>-D"`, and the companion Pickup
  **also `"<dropoff ref>-P"`** (walks Pickup -> Deadhead -> dropoff for the
  ref_no, even though its own `return_of_ride_id` only points at the
  Deadhead one hop up) - NOT the Deadhead's own real `ref_no`, which was an
  earlier bug (`"<deadhead's own ref>-P"` showed as an unrelated-looking
  number since a ref_no is assigned in creation order off the one shared
  sequence, not to the dropoff's own value).
  **Deleting a ride cascades to whatever was auto-created from it** -
  `return_of_ride_id` is `on delete cascade` (migration
  `20260906140000_return_leg_cascade.sql`, was `on delete set null`, later
  reused unchanged for Deadhead/Pickup): the old behaviour orphaned the
  return leg but left it alive, still holding the vehicle's
  EXCLUDE-constrained window, so the vehicle kept showing "busy at that time
  on another ride" even after the dispatcher deleted the ride that supposedly
  freed it. Cascade also chains transitively (delete a dropoff -> its
  Deadhead goes -> that Deadhead's companion Pickup goes too). The single-row
  delete confirm says so upfront when a return leg applies (`ride 1211 and
  its return leg 1211-R`).
  Also a route icon (Google Maps), View, Delete - actions header is
  **"Action"**. **No inline Edit button** - open View then use the Edit button
  inside the modal. **No Status column on the table/export for now** (still
  shown in the read-only view row, which also gained a **Notes** row) - Status
  revisit later. A **note icon** (`MessageSquare`, after View) only renders
  when `ride.notes` is set, always accent-highlighted (like an unread chat
  bubble - visibility itself is the signal) - click opens `NotePopup`, a
  deliberately tiny modal (title = `Ride <ref_no>`, same as the full view's
  header but without the block suffix, then just Flight and Note) - not the
  full View modal. CSV export gained a matching **Note** column (last).
- Airports seeded for the 3 cities (`LHE Airport`, `KHI Airport`, `ISB Airport`);
  edit per-city on the **Settings** page (see Pages -> Settings), or directly
  on `cities.airport_*`.
- **Crew count is its own column** - table/export column **"Count"** (just the
  number; `displayCrewCount(ride_crew, block_type)` lives in `lib/rideRoute.js`
  now so the Dashboard can reuse it - it forces 0 for `ZERO_COUNT_BLOCKS`
  = `{return_leg, deadhead}`, else `ride_crew.length`) sits right **after**
  "Crew" (names only, `crewNamesText()` in `Rides.jsx`); the form/view still
  show a `<span className="badge badge-accent">N</span>` next to the label.
  In the **table** (not export/CSV, which stays a flat comma list), 2+ crew
  render stacked one name per line (`CrewCell`) instead of running sideways.
  The **Flight No** column/export label is now just **"Flight"**.
- **Filters**: Block, Flight, Vehicle, Shift, Driver are all always-visible
  in the filter bar's `inline` row (no collapsible "Filters" panel - one
  click). Block/Shift are small fixed enums so they stay plain `<select>`s;
  **Flight, Vehicle and Driver are `SearchSelect`** (type-to-search, same
  component as the Ride form's pickers - these lists can get long), each
  wrapped in a fixed-width `.filter-searchselect` div, with an "All ..."
  option value `''` at the top of their option list. Matched against the
  ride's `flight_id`/`vehicle_id`/`shift`/`driver_id` (the SELECT carries
  `driver_id` alongside the joined `driver` object for this).
- **Date range**: always-visible **Today / Week / Month / All** tabs (flat
  underline style, like `RoleAccess`'s mode switch) drive a `dateFrom`/`dateTo`
  range - Week = Monday-Sunday of the current week, Month = the calendar
  month, All = no bound. Two `<input type="date">`s next to the tabs allow a
  custom range (typing one clears the active tab - `datePreset` becomes `''`).
  **Today is the default on every load** (`useState('today')`), and is the
  neutral state `activeCount`/Clear resets back to, not an empty filter.
- **Summary** button (Rides header, `Sigma` icon, toggles `.rides-summary`) -
  a panel over the **currently filtered** rides: a total (count + Σ KM) and
  a per-**Duty-Sheet-date** breakdown (newest first, each date's ride count +
  KM sum). Off by default.
- **KM is a plain 2-decimal number** (`12.50`, no "km" suffix) in the KM table
  column and CSV export - the column header already says KM. It's positioned
  **after ETA** (table + export column order: … Ride Time, ETA, KM, Status).
  The "Distance" view row and the in-form route badge keep the "km" unit since
  their label doesn't.
- **Generate** (Rides header) - bulk-create rides from one flight over a date
  range + weekday picker + optional shared crew. Vehicles assigned per-ride after.
- **Vehicle Board** (`/vehicle-board`, gated on `rides` view) - day gantt of each
  vehicle's booked rides (bars by `start_at`/`end_at`, coloured by block, click ->
  ride detail) + a Map tab drawing every routed ride for the day (`r.route_geometry`
  if saved, else a straight-line fallback - see `rides.route_geometry` above; no
  ORS call happens on this page). The Board/Map toggle is `.vb-modeswitch`, a
  self-contained copy of the flat-underline mode-switch pattern kept in
  `VehicleBoard.css` (it used to borrow `RoleAccess.css`'s `.ra-modeswitch`,
  which this page's own lazily-loaded chunk never pulls in, so the buttons
  rendered as plain unstyled `<button>`s). The Map tab's Leaflet container is
  640px tall (`BoardMap`'s `.stop-map` - this page also now imports
  `components/stop-map.css` directly for the same reason, rather than relying
  on some other page's chunk to have pulled it in first). No Tracker tab here
  any more - it's its own page (below).
- **Tracker** (`/tracker`, sidebar label "Tracker", group "Dispatch", gated
  on `rides` view like Vehicle Board - reuses that permission, no separate
  `PERMISSION_PAGES` entry) - a full page for live GPS tracking. Left
  `.tk-list` (Settings `.set-list` look - flat, a hairline `border-right`, no
  card box; rows hover/select like the **sidebar nav**: accent text + a 3px
  accent left bar, no fill) with a "Vehicles" head, a search box, and the
  list; the AI Track view fills the rest (`.tk-layout`, `min-height:
  max(440px, calc(100vh - 200px))`; stacks on ≤720px).
  - The map is **AI Track's own** (a plain `<iframe>`, its map/trails/UI) -
    reverted from a short-lived custom Leaflet map. Default: the city's
    fleet `<iframe src={cities.tracker_url}>` (single city, or one per city
    stacked when the topbar filter is All).
  - Clicking a vehicle whose `vehicles.tracker_url` is set swaps the iframe
    to that **per-vehicle** sharing link - AI Track's own view focused on
    that one vehicle - with a "← All vehicles" bar to go back. A vehicle
    with no per-vehicle link shows a hint to add one on the Vehicles page.
  **The vehicle roster is our own `vehicles` table** (city-scoped, active
  only) so the list never flickers - live status/speed just decorates the
  rows, matched by plate (`vehicle_no` ↔ AI Track's `name`, both
  normalised). Rows with no fix show "No signal" + a grey dot, sorted after
  the live ones. Those live dots come from `fetchFleetTracker()`
  (`src/lib/tracker.js`, returns *every* vehicle a link exposes, vs
  `fetchLiveTracker`'s first-only) polling every city's `tracker_url` every
  15s; AI Track's `/items?time=0` only returns recently-pinged vehicles, so
  fixes **accumulate** by plate and are dropped only after 60 min unseen
  (reset on a city switch).
- `Users` (`users` perm) - list / filter / add / edit / password / activate / bulk.
  Add/edit go through the `admin-users` EF. No commission fields (GraphicSpark-only).
- `RoleAccess` (super_admin, or `roles.view`) - By Role / By User matrix + custom-role
  CRUD. Uses `ConfirmDialog` for role delete (not window.confirm).
- `Settings` (`/settings`, sidebar group "Administration", **super_admin only** -
  gated directly on `isSuperAdmin` in `Sidebar.jsx`/`Settings.jsx`, NOT part of
  the `PERMISSION_PAGES` catalogue, since every write here hits `cities` whose
  RLS (`cities_super`) is hard-coded to `current_user_role() = 'super_admin'`
  regardless of any page-permission row - granting a role "view" here would be
  misleading). Same left-list-plus-panel shell as Role Access (`.set-layout` in
  `Settings.css`, sized down from `.ra-layout`), two sections, no nested
  routes - a local `section` state swaps the panel, like Role Access's mode
  switch:
  - **Airport Locations** - pick a city -> edit its `airport_name` + coordinates
    (`StopMap` pin, same UI as a Crew stop) -> writes `cities.airport_name/
    airport_lat/airport_lng`, the columns Ride Dispatch routing already reads.
    No routing logic lives here.
  - **Ride Buffer Time** - edit a city's `checkin_buffer_min` / `checkout_buffer_min`
    / `return_leg_buffer_min` / `deadhead_buffer_min` (minutes) -> the four
    ride-time buffers Rides' auto-suggest, Generate and Create Ride
    (Return Leg / Deadhead) use (see the Ride section above). Defaults
    (90 / 30 / 10 / 15) live in `rideRoute.js` as `DEFAULT_CHECKIN_BUFFER_MIN`
    / `DEFAULT_CHECKOUT_BUFFER_MIN` / `DEFAULT_RETURN_LEG_BUFFER_MIN` /
    `DEFAULT_DEADHEAD_BUFFER_MIN`.
  - Both panels: **read-only view by default, "Edit" reveals the form** (same
    pattern as Profile), with an Edit button top-right of the panel head.
    Editing disables the City field (finish or Cancel first) and has
    Cancel/**Save** buttons - Save is plain text, no icon. Saving calls
    `useCity().reloadCities()` so open/new Ride forms and the Crew page pick
    the change up live.
  - **The City field mirrors the global topbar filter**: one city selected
    there -> **locked** here too (a disabled field showing just that city,
    same as the old modals' behaviour) - a Lahore-filtered view only ever
    touches Lahore; "All" -> a live `<select>` over every city this admin
    page can see (`useCity().allowedCities`, never `allCities`), defaulting
    to the first city, switching shows that city's values immediately (view
    or edit mode). An effect re-syncs the selection if the topbar filter
    changes while the page stays mounted.
  - **Live Tracker** - each city keeps its **own** GPS tracker sharing link
    (`cities.tracker_url`, e.g. one AI Track link per city) - same
    City-field-mirrors-the-topbar-filter + read-only-until-Edit pattern as
    the two panels above (an earlier version tried one global link on a
    one-row `app_settings` singleton table, but the real fleet has a
    separate link per city, so that table was dropped in the very next
    migration - never had real data). Shown on the standalone **Tracker**
    page (`/tracker`, see Pages -> Tracker below), not a Vehicle Board tab.
    Links are written straight into `cities.tracker_url` through this panel's
    own save, never committed
    to a migration or the repo.
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
- [x] Vercel project `fjride` created + git-linked, all three `VITE_*` env
      vars set, deploying at https://fjride.vercel.app
