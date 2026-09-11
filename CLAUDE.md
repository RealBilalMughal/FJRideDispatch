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
- **Login** (`src/pages/Login.jsx`) shows the BusCaro logo (`public/logo.png`),
  a show/hide-password toggle, and a **Remember me** checkbox (default on). The
  Supabase client (`src/lib/supabase.js`) uses a custom `storage` adapter +
  `setRemember()`: remember-on -> session in `localStorage` (survives a browser
  restart); remember-off -> `sessionStorage` (gone on close). Favicon is
  `public/favicon.png`.

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
  `20260906240000_tracker_per_city.sql`, `20260906250000_vehicle_tracker.sql`,
  `20260907120000_crew_wait_buffer.sql`, `20260908120000_vehicle_vendor.sql`,
  `20260908130000_ride_extra_km.sql`, `20260908140000_ride_track_points.sql`,
  `20260908140100_ride_track_cron.sql`, `20260908150000_ride_notifications.sql`,
  `20260910120000_ride_cancel.sql`, `20260911120000_crew_phone_unique.sql`,
  `20260911140000_ride_plan.sql`, `20260911160000_ride_plan_seq.sql`,
  `20260911180000_ride_plan_via_no.sql` (all APPLIED).

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
  airport_*, the *_buffer_min columns, tracker_url) on demand - used after a save on the
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

## Edge Functions - DEPLOYED (dyjgrxeqdvnxwcbwzkql)
- **`admin-users`** (`supabase/functions/admin-users/index.ts`) - profile
  mutations for OTHER users. Service_role key (Supabase injects it). `verify_jwt`
  on. Actions: `create` (users.add), `update` / `set_password` (users.edit),
  `set_active` (users.edit on / users.delete off). `roles[]` validated against
  `public.roles`. Client wrapper: `src/lib/adminUsers.js`.
  Deploy: `supabase functions deploy admin-users --use-api`.
- **`track-rides`** (`supabase/functions/track-rides/index.ts`) - the AI Tracker
  poll (see the Ride section's "AI Tracker" bullet). `verify_jwt = false`,
  `x-track-cron-key` guarded. Called by pg_cron every minute.
  Deploy: `supabase functions deploy track-rides --no-verify-jwt --use-api`.
- **`notify-ride`** (`supabase/functions/notify-ride/index.ts`) - ride
  notification (see the Ride section's "Notify" bullet). `verify_jwt` on (the
  caller's token scopes the ride read + sets `sent_by`). Renders the city's
  `notify_template` and POSTs `{ event, ride, message, recipients }` to that
  city's `notify_webhook_url`; logs to `ride_notifications`.
  Deploy: `supabase functions deploy notify-ride --use-api`.

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
    the table), Deadhead ratio ((deadhead km + Σ `rides.extra_km`, i.e. the
    Pickup/Drop Off Block KM Buffer counted as empty running) ÷ total km, %;
    the card sub notes "incl. buffer" when any extra_km is present). Each shows a
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
  **`crew.contact` (phone) is the de-dupe key** - a partial unique index
  (`crew_contact_uniq`, migration `20260911120000_crew_phone_unique.sql`,
  `where contact is not null and contact <> ''` since phone is optional).
  The Add/Edit form maps a `23505` violation to "This phone number is
  already used by another crew member." **CSV import matches by phone
  first**: a row whose phone already belongs to a crew member **updates**
  that record (name/designation/city/stop - not `is_active`/`created_by`/
  `ref_no`) instead of inserting a duplicate; a new/blank phone inserts.
  The import preview splits **New** vs **Update (matched by phone)** counts.
  This is what makes an export -> rename in Excel -> re-import round trip
  safe (e.g. reconciling against an external roster). Also has an optional
  **Employee No** field (form/table/CSV) - see Pages -> RidePlan, which
  matches its plan sheet's crew cells against this.
- `Vendors` / `Drivers` / `Vehicles` (`vendors`/`drivers`/`vehicles` perms, sidebar
  group **"Fleet"**) - Crew-style: city-scoped table, advanced filters, CSV
  export/import (`*-sample.csv`), View/Edit/Delete. All have a mandatory City.
  - **Vendor**: name, contact (PK phone), city.
  - **Driver**: name, contact, city, **vendor (required)** - `SearchSelect`
    filtered to the driver's city; shown as `(refNo) Vendor Name`.
  - **Vehicle**: vehicle_no (unique), company, model, year (4 digits), color, city,
    optional **Vendor** (`vehicles.vendor_id`, nullable, `on delete set null`,
    migration `20260908120000_vehicle_vendor.sql` - same vendor pool as drivers,
    `SearchSelect` filtered to the vehicle's city; column / view / CSV
    export+import (`vendor` col, matched by name in the city) / filter). Once a
    Vendor is picked the **Day / Night driver** pickers narrow to that vendor's
    drivers (and a vendor / city change clears a driver that no longer fits; CSV
    import applies the same constraint). The list filter bar also has a
    **tracker filter** (Any / Has tracker link / No tracker link, off
    `vehicles.tracker_url`). Stat cards are **Total / Active / Inactive**
    (no "With driver"). Activate/deactivate is a **clickable `.status-toggle`
    pill** (table + View modal) that opens a `ConfirmDialog` first, not an
    instant inline `<select>`.
    **Day driver + Night driver** (both optional) - a 24h vehicle with a 2-driver
    shift. `driver_id` = day, `night_driver_id` = night. A driver holds at most one
    day slot and one night slot (two partial unique indexes) and day != night on a
    vehicle (`vehicles_day_night_distinct`). Both driver FKs `on delete set null`.
    `drivers.vendor_id` (distinct from the vehicle's) is required / `on delete
    restrict`. Optional **Tracker link**
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
  **Credit protection** (the ORS free tier is small): `routeInfo()` keeps a
  **session cache** keyed on the coords rounded to ~1 m - the same ordered
  route only ever hits the API once per page load (in-flight requests are
  shared, failures aren't cached). On top of that the **Ride form's route
  effect never calls ORS in view mode**, and on **edit** it skips the call
  when the ordered points still match `row.waypoints` (a `routeSig()` compare)
  - so opening / re-opening a ride, or editing without touching the route,
  costs nothing. Only a genuinely new/changed route, or the Generate / Create
  Ride / "also create a deadhead" flows, spend a credit.
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
  vehicle. **The Ride View modal is always full-screen** (`Modal` `size="full"`
  - fixed `height: calc(100vh - 28px)`, pinned header + scrolling body + a
  pinned `footer` prop so Close/Edit always show, `width: min(1600px, 97vw)`)
  with a two-column `.ride-view--split` layout - a ~440px left column (its own
  scroll) and the route / live map filling the right; stacks under 860px. The
  left column pairs fields two-per-row (`.rv-grid` / the `RvField` helper,
  label stacked over value): Flight|Block, Date|Duty Sheet, Check-in|Actual,
  Check-out|Actual, then Crew (`.rv-crew` - count badge by the label, names
  stacked when >1), Vehicle|Driver, Ride/Pickup/Drop Time|ETA; Origin /
  Destination / Distance / Shift / Status / Notes stay single `.view-row`s
  below. Renders a pulsing coloured dot on the same `RouteMap` via its
  `liveMarker` prop (bounds-fit includes the live point). `RouteMap` also now
  colours the stop pins by role - **origin green / mid amber / destination
  red** - and labels each with the running distance from the origin (rough
  crow-flies legs scaled so the last equals the ride's real `distance_km`,
  passed as `totalKm`). Signals derived client-side from the one fix
  (`src/lib/geo.js` - `distanceMeters()` / `distanceToLineMeters()` /
  `routeProgress()`, no ORS calls):
  - **Moving / Stopped / Offline / Engine on** + live speed, from the
    tracker's own `icon_color`.
  - **Arrives ~HH:MM · in N min · X km left** - a live ETA: `routeProgress()`
    gives the distance still ahead along `route_geometry`, divided by the live
    speed while genuinely moving (else the ride's planned average). Replaced by
    **Arrived** within 300m of `dest_lat`/`dest_lng`.
  - **Behind planned ETA** - past the ride's own ETA (`start_at +
    duration_min`) and not yet Arrived.
  - **Off route** - the live fix is more than 500m from `route_geometry`.
  - **Over speed** - live speed over a flat 100 kph (`SPEED_LIMIT_KPH` in
    `Rides.jsx` - the tracker's sharing link doesn't expose a per-vehicle
    speed-limit/geofence config, only the live fix, so this is our own
    threshold, not theirs).
  - **Seen at stops (this session)** - while the card is open, each time the
    live fix comes within 300m of a waypoint it records the time (the tracker
    fix's own `timestamp` via `parseTrackerTs()`, else the client clock).
    Session-only - not persisted.
- **AI Tracker** (the persisted "actual route driven vs planned" playback) -
  `public.ride_track_points` (`ride_id` -> rides `on delete cascade`, `city_id`,
  `at`, `lat`, `lng`, `speed`, `status`; migration
  `20260908140000_ride_track_points.sql`; RLS select mirrors `rides` -
  `has_perm('rides','view')` + `has_city`; only service_role writes; 45-day
  retention via `private.purge_old_track_points()`). Filled by the
  **`track-rides` Edge Function** (`supabase/functions/track-rides/index.ts`,
  `verify_jwt = false`, guarded by `x-track-cron-key` == the `TRACK_CRON_KEY`
  secret): finds active rides (status dispatched/enroute, vehicle assigned,
  window straddles now), polls each ride's **city** fleet link
  (`cities.tracker_url` - one call = every vehicle), matches by plate, appends
  a point; loops 6× with a 10s gap per invocation. **pg_cron**
  (`20260908140100_ride_track_cron.sql`): `track-rides-poll` every minute
  (key from vault secret `track_cron_key`), `track-rides-purge` at 03:30
  daily. Setup once: `supabase functions deploy track-rides --no-verify-jwt
  --use-api`, then `supabase secrets set TRACK_CRON_KEY=<x>` and
  `select vault.create_secret('<x>','track_cron_key')` with the same value
  (both done 2026-09-08). **UI**: a "Trip playback" toggle in the Ride View's
  map column (`TripPlayback` in `Rides.jsx`) - draws the recorded path (dashed
  purple, `RouteMap`'s `actualPath` prop) over the planned `route_geometry`,
  with a play/scrub control (`playMarker` prop) and Actual km / Planned km /
  minutes / point-count badges.
  **Still session-only**: per-stop arrival timestamps (the live card's "Seen
  at stops" list) - a possible follow-up is persisting those + an "on-time %"
  report.
- **Notify** (WhatsApp / SMS, provider-agnostic) - a `Send` row action (and a
  footer button in the Ride View), shown when the ride has a vehicle and the
  caller has `rides.edit`. Calls the **`notify-ride` Edge Function** with
  `{ ride_id }`; it renders the city's message template
  (`cities.notify_template`, default in the function) with `{{ref}} {{block}}
  {{date}} {{flight}} {{time}} {{time_label}} {{origin}} {{dest}} {{vehicle}}
  {{driver}}` and POSTs `{ event: 'ride_notify', ride, message, recipients }`
  (recipients = the driver + every crew member that has a `contact` phone) to
  `cities.notify_webhook_url`. Whatever sits behind that URL (Zapier / Make / a
  gateway script / the WhatsApp Business API) does the actual sending; every
  attempt is logged in `public.ride_notifications` (`ok`, `recipients`,
  `detail`, `sent_by`; RLS select mirrors `rides`). Set the URL + template per
  city at **Settings -> Notifications**. Migration
  `20260908150000_ride_notifications.sql`; `src/lib/notify.js` is the client
  wrapper.

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
  − trip time, so the vehicle is AT the airport that long before check-in;
  dropoff = check-out **+** checkout buffer. Editable. **ETA** (= start + trip
  time) and the internal `end_at` (= start + trip + 30-min turnaround buffer,
  for the vehicle conflict - a separate, fixed `BUFFER_MIN`) are computed,
  never typed. **"Trip time" = the stored `duration_min` = ORS road minutes +
  the multi-crew wait** (`crewWaitMinutes()`, Settings → Ride Buffer Time →
  Crew wait buffer): a pickup / dropoff carrying >1 crew waits
  `crew_wait_buffer_min` at every crew stop, `crewCount * buffer`, folded into
  `duration_min` at save (KM stays pure road distance). `status` still defaults to `dispatched` on every
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
- **Cancel a ride** - a `Ban` row action (needs `rides.edit`; hidden on an
  already-cancelled ride, which shows an `Undo2` "reinstate" action instead).
  `CancelRideModal` takes a **required reason** + a checkbox *"count this
  ride's KM in reports anyway"* (default off). On confirm: `status =
  'cancelled'`, `cancel_reason`, `cancelled_at`, `cancelled_by`, `count_km`
  (migration `20260910120000_ride_cancel.sql`). **`billableKm(r)`** in
  `Rides.jsx` (`= 0` for a cancelled ride unless `count_km`) is what the
  **Rides Summary** and **Dashboard** (`kmCounts()` / `km()` / `extraKmOf()`
  in `Dashboard.jsx`, incl. the deadhead ratio) sum - the per-row **KM
  column** still shows the ride's own `distance_km` but **struck through** for
  a not-counted cancelled ride. CSV export gained **Billable KM**, **Status**,
  **Cancel reason** columns; the table ID cell shows a red **Cancelled**
  badge; the Vehicle Board fades + strikes cancelled bars and drops cancelled
  rides from the Unassigned strip / conflict checks. Reinstate clears every
  cancel field and sets `count_km` back to true.
- **Pickup + "Also create a Deadhead"** - a checkbox under the crew list on
  the **main Ride form** (Add only, `block_type === 'pickup'`, >=1 crew). On
  submit it creates the Pickup ride PLUS a second ride the same moment: a
  **Deadhead** (`deadhead_mode: 'airport'`), route **Airport -> the first
  crew stop**, same vehicle/shift/driver/city/`ride_date`/`duty_sheet_date`
  as the Pickup, `return_of_ride_id` = the Pickup. Timed to arrive
  `cities.deadhead_buffer_min` before the Pickup starts: `start_at` =
  Pickup `start_at` - ORS drive - that buffer, `end_at` = Pickup `start_at`.
  Checking the box shows a live hint with that deadhead's own **Ride Time**
  (when the driver must leave the airport), the drive minutes and the arrival
  time - a separate debounced ORS call for the Airport→crew leg (`dhRoute`),
  reused at submit. Displays as **`<pickup ref>-PD`** (`suffixFor()` now takes the parent - a
  deadhead child of a *pickup* is `-PD`, of a *dropoff* still `-D`), gets one
  `ride_crew` row (that crew, seq 0) for the Crew column, cascades on delete
  with the Pickup. Fails soft - if the deadhead insert errors, the Pickup
  still stands (toast warns).
- **Dropoff + "Also create a Return Leg"** - the mirror image, same pattern
  reversed: a checkbox under the crew list (Add only, `block_type ===
  'dropoff'`, >=1 crew). On submit it creates the Dropoff ride PLUS a
  **Return Leg**, route **the last crew stop -> Airport**, same vehicle/
  shift/driver/city/`ride_date`/`duty_sheet_date`/flight as the Dropoff,
  `return_of_ride_id` = the Dropoff. Timed to LEAVE `cities.return_leg_buffer_min`
  after the Dropoff's own arrival at that crew stop: `start_at` = Dropoff's
  ETA (`start_at + duration_min`) + that buffer, `end_at` = `start_at` + ORS
  drive + the fixed vehicle-conflict `BUFFER_MIN`. Checking the box shows a
  live hint the same way (`rlRoute`, debounced ORS for the crew→Airport
  leg). Displays as **`<dropoff ref>-R`** (the same shape `CreateRideModal`'s
  Return Leg tab already produces, so `suffixFor()`/`followOnByParent`
  needed no changes), one `ride_crew` row (last crew, seq 0), cascades with
  the Dropoff, fails soft. Both this and the Deadhead checkbox key off
  `crewList[0]` / `crewList[crewList.length - 1]` - the LIVE form state at
  submit, not the original plan's crew count - so if a dispatcher started
  from a 3-crew planned Pickup/Dropoff (via Ride Plan's Follow/No) but
  removed one before saving, the deadhead/return leg automatically follows
  whichever crew member is actually first/last in the 2 that remain.
  Ride Plan's Follow/No auto-ticks this checkbox too, mirroring the Deadhead
  case, when a pending Return Leg plan row sits at the followed Dropoff's
  `seq + 1` (`Rides.jsx`'s prefill effect, `initial.alsoReturnLeg` - see the
  Ride Plan section's "Pairing is by adjacent seq, NOT Trip ID" for why) -
  and its own reconciliation effect still catches this the same way regardless of
  whether the Return Leg arrived via this checkbox or `CreateRideModal`,
  since both produce the identical `return_of_ride_id`-linked shape.
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
  This KM is the **total** = ORS road distance + the per-block extra
  (see Settings → Block KM Buffer); CSV export
  also carries an **Extra KM** column, and the "Distance" view row spells out
  `road + extra = total` when `extra_km > 0`. The in-form route badge shows the
  same split. Both the view row and badge keep the "km" unit since their label
  doesn't.
- **Generate** (Rides header) - bulk-create rides from one flight over a date
  range + weekday picker + optional shared crew. Vehicles assigned per-ride after.
- **Vehicle Board** (`/vehicle-board`, gated on `rides` view) - day gantt of each
  vehicle's booked rides (bars by `start_at`/`end_at`, coloured by block, click ->
  ride detail). The board's ride query now loads **all** the day's rides (not
  just vehicle-assigned ones). **Bulk vehicle assign** (needs `rides.edit`):
  an **Unassigned** strip above the grid holds the day's rides with no
  `vehicle_id` as draggable chips - drag a chip onto a vehicle's track to
  assign (`vehicle_id` + `shift` (kept, else `'day'`) + that vehicle's day
  `driver_id`), drag an assigned bar back to the strip to unassign. A clash
  with an existing ride in that window warns (toast) but still applies -
  dispatcher's call. An **Auto** checkbox in the header enables an
  **Auto-assign** button: walks the unassigned rides earliest-first and drops
  each on the first same-city vehicle with no time overlap (seeded from
  what's already booked + what it places this run), reports placed / couldn't
  place. + a Map tab drawing every routed ride for the day (`r.route_geometry`
  if saved, else a straight-line fallback - see `rides.route_geometry` above; no
  ORS call happens on this page). The Board/Map toggle is `.vb-modeswitch`, a
  self-contained copy of the flat-underline mode-switch pattern kept in
  `VehicleBoard.css` (it used to borrow `RoleAccess.css`'s `.ra-modeswitch`,
  which this page's own lazily-loaded chunk never pulls in, so the buttons
  rendered as plain unstyled `<button>`s). The Map tab's Leaflet container is
  640px tall (`BoardMap`'s `.stop-map` - this page also now imports
  `components/stop-map.css` directly for the same reason, rather than relying
  on some other page's chunk to have pulled it in first). No Tracker tab here
  any more - it's its own page (below). The vehicle-roster query embeds the
  day driver as `driver:drivers!driver_id(name)` - the FK hint is **required**
  because `vehicles` has two FKs to `drivers` (`driver_id` + `night_driver_id`),
  so a bare `drivers(name)` embed 300s with `PGRST201` and the whole query
  returns nothing ("No vehicles in this city." even when rides exist). The
  Vehicles page sidesteps this by fetching `drivers` separately.
- **Tracker** (`/tracker`, sidebar label "Tracker", group "Dispatch", gated
  on `rides` view like Vehicle Board - reuses that permission, no separate
  `PERMISSION_PAGES` entry) - a full page for live GPS tracking. Left
  `.tk-list` (Settings `.set-list` look - flat, a hairline `border-right`, no
  card box; rows hover/select like the **sidebar nav**: accent text + a 3px
  accent left bar, no fill) with a "Vehicles" head, a search box, and the
  list; the AI Track view fills the rest (`.tk-layout`, `min-height:
  max(440px, calc(100vh - 148px))`; stacks on ≤720px). The chrome around it is
  deliberately minimal so the map gets as much height as possible:
  `.app-content:has(.tk-page)` pulls the page's own *bottom* padding in to 14px
  (top padding stays the app default), `.tk-page` overrides `.page`'s 20px
  `gap` to 4px, and `.tk-view`'s column gap is 4px. `.tk-list` carries
  `margin-top: 32px` (≈ the `.tk-bar` row + the gap) so its `border-right`
  divider starts level with the map top and runs exactly the map's height;
  `.tk-map` height is `max(408px, calc(100vh - 180px))`, the matching figure.
  - A **`.tk-bar` row above the map, outside it**: the selected-vehicle
    breadcrumb (`.tk-selbar` - a borderless "‹ All vehicles" text link, then
    `/ <vehicle_no> · status · kph`) on the left, the **AI Track / Map** switch
    (`.tk-viewswitch`, `margin-left: auto`) on the right. **Default AI Track.**
  - **AI Track** - a plain `<iframe>` of AI Track's own map/trails/UI.
    Default is the city's fleet `<iframe src={cities.tracker_url}>` (single
    city, or one per city stacked when the topbar filter is All); picking a
    vehicle whose `vehicles.tracker_url` is set swaps to that per-vehicle
    link (AI Track focused on it). Can't be panned from outside (confirmed:
    the sharing page takes no focus URL param), hence the Map view for that.
  - **Map** - our own Leaflet map, a coloured dot per live vehicle. Clicking
    a list row **or** a marker `map.flyTo()`s to it, enlarges its dot, pins
    a tooltip and raises its `zIndexOffset`. This is the click-to-zoom view.
  - `.tk-map` needs an explicit `height` (not just `min-height`) or the
    Leaflet container / iframe inside collapses to 0.
  **The vehicle roster is our own `vehicles` table** (city-scoped, active
  only, `vendor:vendors(name)` joined) so the list never flickers - live
  status/speed just decorates the rows, matched by plate (`vehicle_no` ↔ AI
  Track's `name`, both normalised). Rows with no fix show "No signal" + a grey
  dot, sorted after the live ones. **The list is grouped by vendor** -
  collapsible `.tk-group` sections (`Vendor name` head + `live/total` count +
  a rotating caret), "No vendor" last, all collapsed by default; a search or
  picking a vehicle (list row or map marker) opens the relevant group. Those live dots come from `fetchFleetTracker()`
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
  `Settings.css`, sized down from `.ra-layout`), five sections, no nested
  routes - a local `section` state swaps the panel, like Role Access's mode
  switch:
  - **Airport Locations** - pick a city -> edit its `airport_name` + coordinates
    (`StopMap` pin, same UI as a Crew stop) -> writes `cities.airport_name/
    airport_lat/airport_lng`, the columns Ride Dispatch routing already reads.
    No routing logic lives here.
  - **Ride Buffer Time** - edit a city's `checkin_buffer_min` /
    `checkout_buffer_min` / `return_leg_buffer_min` / `deadhead_buffer_min` /
    `crew_wait_buffer_min` (minutes) -> the five ride-time buffers Rides'
    auto-suggest, Generate and Create Ride (Return Leg / Deadhead) use (see the
    Ride section above). Defaults (90 / 30 / 10 / 15 / 5) live in `rideRoute.js`
    as `DEFAULT_CHECKIN_BUFFER_MIN` / `DEFAULT_CHECKOUT_BUFFER_MIN` /
    `DEFAULT_RETURN_LEG_BUFFER_MIN` / `DEFAULT_DEADHEAD_BUFFER_MIN` /
    `DEFAULT_CREW_WAIT_BUFFER_MIN`. **Crew wait** = a pickup / dropoff carrying
    more than one crew waits at every crew stop for them to board / alight:
    `crewWaitMinutes(block, crewCount, buffer)` = `crewCount * buffer` for
    pickup/dropoff with `crewCount > 1`, else 0. It folds into the ride's
    stored `duration_min` (road time from ORS + this wait), so every ETA /
    `end_at` / Pickup-Time auto-suggest / table / export / Vehicle Board
    figure accounts for it with no separate column.
  - **Block KM Buffer** - edit a city's **Pickup KM** / **Drop Off KM**
    (`cities.pickup_extra_km` / `dropoff_extra_km`, default 0, migration
    `20260908130000_ride_extra_km.sql`) - a flat distance added to those
    blocks' rides: `blockExtraKm(block, city)` in `rideRoute.js` folds into
    the stored `distance_km` at save (Ride form, Generate, companion Pickup),
    so the KM column, CSV export, Rides Summary and Dashboard KM sums show the
    total; `rides.extra_km` keeps the amount so the Ride View's Distance row
    shows `road km + N km <block> extra = total km` and the CSV export gains
    an **Extra KM** column.
  - All panels: **read-only view by default, "Edit" reveals the form** (same
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
  - **Notifications** - per city: `cities.notify_webhook_url` + a
    `notify_template` (placeholder text area). Same mirrors-filter +
    read-only-until-Edit shell. Powers the ride **Notify** action (see the Ride
    section). Webhook URLs are written straight into `cities` through this
    panel, never committed.
  (SECTIONS list is now five: Airport Locations, Ride Buffer Time, Block KM
  Buffer, Live Tracker, Notifications.)
- `RidePlan` (`/ride-plan`, sidebar label "Ride Plan", group "Dispatch",
  `ride_plan` perm - migration `20260911140000_ride_plan.sql`) - upload the
  planning team's daily dispatch plan (an Excel sheet, **exported as CSV**
  same as every other import in this app: Date/Base/Car/Ad-hoc Car/Block
  Type/Trip ID/Flight No/Origin/Destination/Start Time/End Time/Distance
  (km)/Crew Count/Crew) and work each row through to a real ride, then
  compare planned vs actual KM.
  - **Schema**: one `ride_plan_imports` row per upload (`city_id` = the
    dominant Base among its rows, or the topbar-filtered city), many
    `ride_plan_rows` (`plan_date`, `trip_id`, `block_type`, `car`/
    `is_adhoc_car`, `flight_no`, `origin`/`destination`, `start_time`/
    `end_time`, `planned_km`, `crew_raw` + resolved `crew_matches` jsonb,
    `matched_flight_id`, `matched_vehicle_id`, `status` pending/followed/
    skipped, `ride_id` once dispatched, **`seq`** - migration
    `20260911160000_ride_plan_seq.sql`). **`seq` is just the CSV row number
    at import time** (`buildPlanRows`' `line`, renamed at insert) - the page
    orders by it, not `trip_id` (lexicographic sort puts `"_10"` before
    `"_2"`, and even a numeric sort doesn't reproduce the sheet's actual row
    order - the sheet interleaves a vehicle's Deadhead/Pickup/Dropoff/Return
    Leg legs by when they're planned, not by Trip ID). No pagination on this
    table - the whole day's plan renders as one page (a day is ~50-100
    rows), matching "ek page mein aaye, next wala scene na ho".
  - **Re-uploading a file that covers already-imported dates** - `ImportModal`
    checks this up front (`onFile`, after parsing: queries `ride_plan_rows`
    for the parsed dates + city ids) rather than letting a second upload
    silently ADD a duplicate copy of every row (which is exactly what
    happened once in practice - the same file got uploaded three times,
    `seq` collided across the three imports since each one's own numbering
    restarts at 2, and the table's "as in the sheet" order broke). If any
    exist, the modal shows the count (and how many were already Followed/
    No) and requires an explicit "Yes, delete and replace" checkbox before
    Import re-enables - `runImport()` then deletes those rows first (by
    `plan_date` + `city_id`, not by `import_id` - an import can't assume it
    owns every row for its own dates if an earlier duplicate import also
    touched them) before inserting the fresh batch. **`crew.employee_no`** (optional,
    unique like `contact`) was added alongside - the sheet's Crew cells are
    `"<employee_no> <name> (<designation>)"`, comma-separated for a combined
    pickup/drop. Exposed in the Crew Add/Edit form, table and CSV import/
    export the same as every other field.
  - **`src/lib/planImport.js`** does the parsing/matching (pure functions,
    no I/O): `normalizeBlockType` (the sheet spells it "returnleg", no
    underscore; also maps `pickup-dhd-passenger`/`dropoff-dhd-passenger` - a
    deadheading crew member with no Flight No, riding a pickup/dropoff-shaped
    leg - onto `deadhead`), `parsePlanDate` (real sheet format is
    `"01-09-26"`, dash, DAY first, 2-digit year - matching this app's own
    `01-Aug-26` display convention; ISO and US-slash also accepted),
    `matchCityByBase` (a city's Base code is its airport's first 3 letters -
    `cities.airport_name` - with a LHE/KHI/ISB fallback map), `parseCrewCell`
    + `matchCrewEntry` (tiers, best first: exact `employee_no` -> exact name
    -> "every word of one name is in the other" fuzzy -> unmatched, picked by
    hand later), `matchVehicle` (skipped when Ad-hoc Car = Yes), `matchFlight`
    (the sheet writes the airline code on it, `"9P841"`; the Flights registry
    stores just `"841"` - and Fly Jinnah's own IATA code starts with a
    *digit* (`9P`), so matching compares the **trailing digit run** on both
    sides, not a stripped-leading-letters prefix, which would've missed this
    exact case), and `buildPlanRows` which ties it together per CSV row and
    returns `{ ok, skipped }` (mirrors `Crew.jsx`'s `ImportModal` parse/skip/
    tag shape) - each `ok` row also carries a transient `line` (CSV line
    number, for the import preview's unmatched-crew list; stripped before the
    real insert, `ride_plan_rows` has no such column).
  - **Pairing is by adjacent `seq`, NOT Trip ID** - a Deadhead row is always
    the row immediately BEFORE its Pickup, a Return Leg always immediately
    AFTER its Dropoff (confirmed against real data: 182/192 Deadheads and
    171/175 Return Legs hold this exactly; the handful of misses are all the
    `pickup-dhd-passenger`/`dropoff-dhd-passenger` rows normalised to plain
    `deadhead`, see above). Trip ID looked like the pairing key at first
    (a Deadhead does share its Pickup's Trip ID) but that was a coincidence
    of the sheet's own numbering (each Trip ID names "the next trip number
    this vehicle will run", not a stable FK) - it does NOT hold for Return
    Leg/Dropoff, which routinely carry *different* Trip IDs despite being
    physically adjacent (the Return Leg's number belongs to whatever dropoff
    that vehicle runs hours later, not the one it just came from). Both the
    Follow/No auto-tick (`Rides.jsx`, below) and the reconciliation effect
    match on `city_id` + adjacent `seq` (+ `car` when set), never Trip ID.
    Deadhead/Return Leg rows most commonly get satisfied for free - a
    reconciliation effect (runs on every row-list refresh, `canEdit` gated)
    auto-marks one **followed** the moment it finds a `rides` row with
    `return_of_ride_id` = its followed sibling's `ride_id` and a matching
    `block_type`, riding along on the ALREADY-BUILT "Also create a Deadhead"
    (Pickup) / "Also create a Return Leg" (Dropoff) features (see the Ride
    section). But **every block type gets its own Follow action too**
    (`canFollow(r) = r.status === 'pending'`,
    no block_type filter) - for a standalone Deadhead/Return Leg with no
    plan-paired Pickup/Dropoff (13/53 trips in the sample had no pair), or
    for positioning a vehicle ahead of its pickup on purpose. Since these
    plan rows carry no Flight No or crew at all, `RideModal`'s `submit()`
    only requires a flight for `pickup`/`dropoff`/`deadhead`-via-checkbox
    now, not `deadhead`/`return_leg` reached this way - the dispatcher picks
    the crew stop by hand in the form same as building either manually.
  - **Follow** navigates to **`/rides?planRow=<id>`**. `Rides.jsx` reads that
    param (an effect gated on `flights`/`crew` being loaded), fetches the
    plan row, builds a prefill via its own `buildPlanInitial()` (resolves the
    matched flight/vehicle/crew against the arrays the Ride page already has
    loaded, and auto-ticks **"Also create a Deadhead"/"Also create a Return
    Leg"** when a pending Deadhead/Return Leg plan row sits at the adjacent
    `seq`), and opens the normal Add Ride
    modal already pre-filled - **not a separate creation path**. `RideModal`
    gained an `initial` prop for exactly this (every `useState` fallback is
    `row?.x ?? initial?.x ?? ...`) - the very first prefill capability it's
    had; `startTouched` seeds `true` when `initial.start_time` is set so the
    Pickup/Drop-time auto-suggest effect doesn't overwrite the planned time.
    On save, `submit()`'s `onDone` now carries back `{ rideId, rideRefNo,
    deadheadRideId, returnLegRideId }` (harmless for every other caller,
    which ignored the argument already) so the Rides page can mark that plan
    row **followed** + `ride_id` (and the paired Deadhead/Return Leg row
    too, if one was auto-created) before closing the modal and clearing the
    query param. Both plan-row updates check their own result now (`.select
    ('id')`, error or an empty array both toast - a silent 0-row update,
    e.g. from an RLS policy quietly blocking it, used to look like nothing
    happened at all) - and on success, **navigates back to `/ride-plan`**
    itself rather than leaving the dispatcher on Rides looking at an
    unchanged-looking plan page in another tab/window.
  - **No** (any pending row) - opens the exact same Add Ride flow as
    **Follow** (`/rides?planRow=<id>&plan_no=1`) - a dispatcher clicking "No"
    still usually means "dispatch it anyway, just not quite per the plan",
    not "there's no ride". The `plan_no=1` flag changes the prefilled ride's
    `notes` (`buildPlanInitial()`'s `viaNo` param - `'...  - dispatched
    despite "No"'` instead of the plain `'Plan trip X'` Follow uses) AND gets
    carried into `planPrefill.viaNo`, persisted onto the plan row as
    **`ride_plan_rows.via_no`** (migration `20260911180000_ride_plan_via_no
    .sql`) when `onDone` links it back - so `StatusCell` can show **"No
    Follow"** (flat red) instead of plain "Followed" (flat green) for a row
    dispatched this way, distinct at a glance in the table. The "Not
    happening" modal's Ride-ID-link path sets `via_no: true` too (same
    reasoning - a ride exists, but not via the primary flow); `Reopen` always
    resets it back to `false` alongside `status`/`ride_id`/`skip_reason`.
  - **Not happening** (any pending row) - an icon-only action (`Ban`, the
    same "circle with a line through it" icon `Rides.jsx` already uses for
    Cancel ride) rather than a text button like Follow/No, since it's the
    least-common path. Opens the ACTUAL "there is no ride" case, a separate
    small `Modal` (no `window.prompt`) with a Note (optional reason) **and
    an optional Ride ID** field. Left blank, it's a plain `status:
    'skipped'`. Given a ride's `ref_no` instead (e.g. the dispatcher already
    created that trip manually on the Rides page), it looks that ride up and
    **links** it instead - `status: 'followed'`, `ride_id` set, the Note
    saved alongside - so the row counts as followed and its Actual KM feeds
    the report exactly like a Followed row. **Reopen** (any No/Not-
    happening/linked row, back to pending) always clears `ride_id` too now,
    not just `status`/`skip_reason`. Follow/No are `.rp-follow-btn`/
    `.rp-no-btn` (RidePlan.css) - a plain flat text button each, tinted
    light green / light red only on hover.
  - **Actual Crew** - its own column, next to the planned Crew column: the
    linked ride's real crew names (`ride_crew` joined to `crew(name)`,
    ordered by `seq`, one extra query per refresh keyed by ride id) - blank
    for a pending/No row, "—" for a followed one with none.
  - **Crew mismatch** - every followed Pickup/Dropoff also gets its linked
    ride's real crew count (from the Actual Crew fetch above). When it
    doesn't equal the plan's own crew count (`crew_matches.length` - e.g. the
    plan wanted 2, only 1 was actually added to the ride), the Crew column
    shows a flat red "Actual: 1 of 2 planned" line under the names
    (`hasCrewMismatch()`).
  - **Vehicle mismatch** - the Vehicle column shows the linked ride's real
    vehicle (looked up against this page's own `vehicles` array by the
    ride's `vehicle_id`) as a second flat red line under the planned `car`
    whenever they differ and the row is followed.
  - **Difference** - a table column right after Actual KM: that row's own
    `billableKm(ride) - planned_km`, flat red when positive (ran over), flat
    green otherwise - the Report panel's per-block delta, but per-row. The
    same total (`summary.total.actualKm - plannedKm`) gets its own top
    summary card too, right after Total - a plain inline `color` (not
    `.status-text`, which would shrink the number to 12px against its 20px
    siblings) keyed the same red-over/green-under way.
  - **Top KM summary** - always-visible `StatCards` row (the shared
    Crew/Vehicles-page component, flat - not the Dashboard's boxed cards): a
    **Total** card first (`active`, accent-coloured value), then one per
    block type in a **fixed Deadhead/Pickup/Dropoff/Return Leg order**
    (`SUMMARY_BLOCKS`, not row insertion order). Each card's value is that
    block's **Planned KM summed over every row of the day's plan** (Total =
    all four blocks summed; regardless of status - this is the whole plan,
    not just what's been dispatched), its hint line the **Actual KM so far**
    (followed rows only, via `billableKm()`) plus a followed count. Two more
    cards close the row: **Followed** and **No**, each just a plain count of
    that day's rows in that status (hint = how many are still pending).
  - **Delete plan** (`Trash2`, needs `ride_plan.delete`, hidden when there's
    nothing to delete) - a type-`DELETE` `ConfirmDelete` (never
    `window.confirm`) that removes every `ride_plan_rows` row for the
    currently-viewed `plan_date` (+ the topbar city filter, if one is set).
    Deletes the PLAN rows only, never the `rides` they may have been
    followed/linked into - `ride_plan_rows.ride_id` is a nullable pointer
    FROM the plan row TO the ride (`on delete set null` runs the other way,
    if the ride itself is ever deleted), so removing plan rows has no effect
    on the `rides` table at all.
  - **The page itself never scrolls - only the table does**, in its own
    fixed-height box with its header frozen inside it (`.rp-plan-table .data-
    table-scroll`, `overflow-y: auto`, `max-height: var(--rp-table-max-h)`).
    That height isn't a guess: a `getBoundingClientRect()` measurement of
    where the table box starts (`window.innerHeight - top - 24`), recomputed
    on window resize and whenever the fixed area above it changes size (the
    Report panel opening/closing, text wrapping on a narrow screen -
    triggered off a `ResizeObserver`'d `topBarH` on the title/KM-summary/
    date-bar block, `.rp-frozen-top`, which also keeps its own
    `position: sticky; top: 0` as a safety net for a few px of calc error on
    some screen). The DataTable's own optional title/subtitle bar is left
    unset here specifically so `.rp-plan-table`'s top edge IS the table's
    scroll box top, keeping that measurement exact. Both `.rp-frozen-top` and
    the table's sticky `<thead>` are painted `var(--surface)` (what `.page`
    actually sits on, having no background of its own) rather than `--bg`
    (white), which would visibly recolour those sections; the table also
    gets `border-collapse: separate` (data.css's shared `collapse` default
    has a real cross-browser bug where `position: sticky` on a `<th>`
    silently does nothing).
  - **Report** (`Sigma` toggle, like the Rides Summary panel) - a second,
    more detailed panel below the date bar: per block type, for the selected
    `plan_date`, followed-row count, Σ planned KM, Σ actual KM (**followed
    rows only** here too - this panel is about comparing plan vs actual only
    where the plan WAS followed), the delta, and a **Crew mismatch** count
    (how many of that block's followed rows have one).
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
