# Nxtpath

> Your next ride is already on the road.

Nxtpath is a real-time, mobile-first web application (PWA) that helps rural students reach school when government buses fail, run late, or fill up. Passing rural vehicles—milk vans, ration trucks, school vans, tractors, autos, and private buses—offer spare seats in real time, match students waiting along their route, and recover automatically during disruptions.

## Core Principles
- **Real Data Only**: Every vehicle, position, route, ETA, seat request, and admin metric comes directly from device GPS, user input, OSRM/Photon APIs, or Firestore. Empty collections display honest empty states (`?debug=1` provides a clearly labeled `SIMULATED` developer GPS bar for testing).
- **Offline-First & Rural Network Ready**: Firestore persistent local cache (`persistentLocalCache` + multi-tab manager), Workbox PWA caching, and a visible `Offline · Local-only` indicator whenever connectivity drops.
- **Multilingual Roadside Signage UI**: Full interface translated into **English**, **ಕನ್ನಡ (Kannada)**, and **हिन्दी (Hindi)**, designed for 360px+ viewports with high contrast and 56px touch targets.
- **Free, Key-less Maps & Routing**: Leaflet with OpenStreetMap standard tiles (`tile.openstreetmap.org`), OSRM (`router.project-osrm.org`) driving routes + `/nearest` road snapping with client-side caching, and Photon (`photon.komoot.io`) location-biased place search.

---

## Architecture & Modules

```
server.ts                     Express server + Vite middleware + Gemini API proxy routes (/api/gemini/*)
firestore.rules               Hardened Firestore RBAC & field-level security rules
firebase-blueprint.json       Firestore collection & document schemas
src/
  auth/                       Firebase Auth (Google + Anonymous) & offline/connectivity state + admin check
  firebase/                   Firebase initialization, persistent IndexedDB cache, connectivity probe
  map/                        Leaflet map (OpenStreetMap tiles), OSRM router + nearest snap + cache, Photon search + cache, GPS + ?debug=1 simulator
  trips/                      Driver trip lifecycle, 5s livePositions heartbeat, Wake Lock, demand pin clustering
  matching/                   Deterministic student-to-vehicle route matching, ETA countdown, & Disruption Mode triggers
  crisis/                     Exam Day Crisis priority solver, blocked-zone routing, Admin Crisis Board, & Crisis Drill engine
  student/                    Student bottom sheet, exam priority badge, urgent Plan B + voice playback, ticket-stub code pass
  driver/                     3-step trip wizard, route preview, live trip strip, seat request & crisis reallocation Accept/Decline
  parent/                     Public parent live-share tracker (?track=<tripId>) with verification warning
  admin/                      Pure Firestore metric computation & admin driver verification batch mutations
  ai/                         Strict JSON schemas, validators, and deterministic fallbacks for Gemini proxy endpoints
  notifications/              WhatsApp (wa.me) parent share composer & live tracker URL builder
  i18n/                       Complete en / kn / hi translations and unit checks
  screens/                    MapScreen, TripsScreen, RequestsScreen, ProfileScreen, AdminScreen
  ui/                         WelcomeScreen, BottomNav, BottomSheet, OfflineBadge, LoadingSkeleton, PWAInstallButton, VehicleIcons
```

---

## Crisis Mode ("The Exam Day Crisis")

Nxtpath includes a full deterministic Exam Day Crisis coordination layer designed for breakdowns, demand surges, and flooded roads:

- **Blocked-Zone Routing (`src/crisis/blockedRouting.ts`)**: Checks OSRM routes (`alternatives=true`) against active flooded/blocked zones (`radius + 50m` safety buffer), computes bypass waypoints automatically when corridors intersect blocked roads, or explicitly flags `no_road_path`.
- **Priority & Slack Solver (`src/crisis/crisisEngine.ts`)**: Computes each student's fastest detour-aware travel time and `slack = examAt - minTravel - 10 min - now`. Schedules Tier 1 exam students (exams within 2 hours) in ascending slack order first, inserts Level 2 pickups along existing routes when detour <= 10 minutes without causing any assigned rider to miss a deadline, proposes idle/scheduled-later/Tier-2 vehicle reallocations, and reports real-time KPIs side-by-side against an FCFS baseline.
- **Admin Crisis Board & Crisis Drill (`src/crisis/CrisisBoard.tsx`)**: Split desktop map + live console at `>= 1024px` (and map + bottom sheet on 360px+ phones). Includes `"Start crisis drill"` to configure exam time, break up to 2 real vehicles (`unavailable`), tap the map to place hatched-red flooded road zones, simulate a `+40%` (minimum 8) OSRM road-snapped demand surge (~60% exam within 2h), optionally add backup drill vehicles, and clean up every `isDrill: true` record cleanly via `"End drill"`.
- **Grounded Gemini Crisis Briefings & Notices**: `/api/gemini/crisis-briefing` summarizes headline + 3 actions in `<= 60` words; `/api/gemini/cannot-reach-message` drafts multilingual late-entry school/parent WhatsApp notices; `/api/gemini/voice-plan-b` powers one-tap Web Speech playback (`en-IN`, `kn-IN`, `hi-IN`) for exam students.

---

## Environment Setup

1. Copy `.env.example` to `.env` (never commit `.env`):
   ```bash
   cp .env.example .env
   ```
2. Set `GEMINI_API_KEY` in `.env` (server-side only — never prefixed with `VITE_` and never bundled into client JS):
   ```env
   GEMINI_API_KEY="your-gemini-api-key"
   APP_URL="http://localhost:3000"
   ```
   If `GEMINI_API_KEY` is unset, `/api/gemini/*` endpoints gracefully fall back to deterministic rule-based parsing and message templates while keeping strict JSON validation.

3. Ensure `firebase-applet-config.json` contains your Firebase project configuration (`apiKey`, `authDomain`, `projectId`, `firestoreDatabaseId`, etc.).

---

## Local Development & Verification

```bash
npm install
npm run dev
```

- **App URL**: `http://localhost:3000`
- **Developer GPS Simulator**: `http://localhost:3000/?debug=1`
- **Parent Live Tracker**: `http://localhost:3000/?track=<tripId>`

### Tests, Typechecking & Production Build
```bash
# Run unit tests (i18n, Photon, OSRM, matching, disruption, Gemini schemas, admin stats)
npx tsx --test src/**/*.test.ts

# Typecheck & lint
npm run lint

# Build client bundle + PWA service worker
npm run build

# Run production server (serves /api/* + dist/)
npm start
```

---

## Firebase & GitHub Deployment

1. **Firebase Console Setup**:
   - Enable **Google** and **Anonymous** sign-in providers under **Authentication → Sign-in method**.
   - Add your production domain to **Authentication → Settings → Authorized domains**.
   - Deploy `firestore.rules`:
     ```bash
     firebase deploy --only firestore:rules
     ```
2. **Admin Verification Role**:
   - Admins are authenticated with a verified email matching the bootstrapped admin account or listed in `/admins/{uid}`.
   - Only verified admins can toggle driver verification (`users/{uid}.verifiedDriver` and active `trips/{tripId}.driverVerified`) or view the Admin Dashboard. Unverified drivers display an explicit safety warning across all student and parent views.
3. **Deploying from GitHub**:
   - Push the repository to GitHub (`.gitignore` excludes `node_modules/`, `dist/`, `.env`, and Playwright artifacts).
   - Deploy the Node + Express service (`npm run build` followed by `npm start`) to **Cloud Run**, **Render**, **Railway**, or **Fly.io**, setting `GEMINI_API_KEY` and `NODE_ENV=production` in your host's environment variables.
   - Note: Serve over **HTTPS** in production so browser Geolocation, Wake Lock, Web Speech API voice input, and PWA installation work across mobile devices.
