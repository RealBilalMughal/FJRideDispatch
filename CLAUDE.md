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
  `20260906140000_return_leg_cascade.sql`, `20260906180000_duty_sheet_date.sql`
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
- `Dashboard` - placeholder, always visible
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
    `drivers.vendor_id` is `on delete restrict`.
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
  (Week/Month bounds; `addDays()`, also in `lib/time.js`, shared by Vehicle
  Board's day nav and the Duty Sheet -1-day calc below) uses `Date.UTC(...)`
  on the already-correct date's Y/M/D, never local-timezone `Date`
  parsing/getters, for the same reason.
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
- Table: **Return Leg** action on dropoff rides -> ConfirmDialog -> creates a
  `return_leg` ride (last crew's stop -> Airport, same vehicle,
  `return_of_ride_id` set) - **no `ride_crew` row** on purpose (the return leg
  carries no passenger, just the vehicle running back empty, so its crew count
  is 0; the last crew's stop is still used as the physical route origin).
  **Ride Time = the dropoff ride's own ETA (arrival at the crew stop) + this
  city's Return Leg buffer** (`cities.return_leg_buffer_min`, default 10,
  edited at Settings -> Ride Buffer Time) - e.g. dropped off with a 3:00 PM
  ETA + 10 min -> return Ride Time 3:10 PM; its own ETA (to the airport) comes
  from the normal `duration_min` computation. Clicking Return Leg when one
  already exists opens `ReturnLegInfoPopup` instead of the create-confirm -
  "already created" + the return leg's ref, date, Ride Time, vehicle, and a
  "View return leg" shortcut. **A return leg displays as `<parent ref_no>-R`**
  everywhere (table ID, CSV export, view/note-popup titles, search) via a
  client-computed `display_ref` (`Rides.jsx`'s `list` memo joins each row to
  its parent via a `return_of_ride_id -> id` map built from the already-loaded
  `rows` - no extra query) - the underlying `ref_no` is still a real,
  independent value from the shared sequence, this is purely cosmetic.
  **Deleting a ride cascades to its return leg** - `return_of_ride_id` is
  `on delete cascade` (migration `20260906140000_return_leg_cascade.sql`,
  was `on delete set null`): the old behaviour orphaned the return leg but
  left it alive, still holding the vehicle's EXCLUDE-constrained window, so
  the vehicle kept showing "busy at that time on another ride" even after
  the dispatcher deleted the ride that supposedly freed it. The single-row
  delete confirm now says so upfront when it applies (`ride 1211 and its
  return leg 1211-R`).
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
  number, `crewNamesText()`/`crewCount()` in `Rides.jsx`) sits right **after**
  "Crew" (names only); the form/view still show a
  `<span className="badge badge-accent">N</span>` next to the label. In the
  **table** (not export/CSV, which stays a flat comma list), 2+ crew render
  stacked one name per line (`CrewCell`) instead of running sideways. The
  **Flight No** column/export label is now just **"Flight"**.
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
- **KM is a plain 2-decimal number** (`12.50`, no "km" suffix) in the KM table
  column and CSV export - the column header already says KM. It's positioned
  **after ETA** (table + export column order: … Ride Time, ETA, KM, Status).
  The "Distance" view row and the in-form route badge keep the "km" unit since
  their label doesn't.
- **Generate** (Rides header) - bulk-create rides from one flight over a date
  range + weekday picker + optional shared crew. Vehicles assigned per-ride after.
- **Vehicle Board** (`/vehicle-board`, gated on `rides` view) - day gantt of each
  vehicle's booked rides (bars by `start_at`/`end_at`, coloured by block, click ->
  ride detail) + a Map tab drawing every routed ride for the day.
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
    / `return_leg_buffer_min` (minutes) -> the three ride-time buffers Rides'
    auto-suggest, Generate and the Return Leg action use (see the Ride section
    above). Defaults (90 / 30 / 10) live in `rideRoute.js` as
    `DEFAULT_CHECKIN_BUFFER_MIN` / `DEFAULT_CHECKOUT_BUFFER_MIN` /
    `DEFAULT_RETURN_LEG_BUFFER_MIN`.
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
