# Field Hockey Manager (static)

A static, client-side rebuild of the "Field Hockey Manager" Streamlit app — a
rolling-substitution rotation builder for field hockey coaches. Plain
HTML/CSS/JS (ES modules), no backend, no build step, no framework. Everything
runs in the browser and your roster/settings are saved to `localStorage` so
you don't lose data between sessions on the sideline.

## Why vanilla JS, no framework

The app is a handful of screens over one shared piece of client-side state
(squad, positions, match settings, a generated schedule) with no routing,
no server data, and no need for a component tree — a framework would add a
build step and dependencies for no real benefit here. Plain ES modules keep
it a true "clone the repo and open it" static site.

## Features

- **Roster management** — add/edit/remove players, custom position names
  (defaults: GK, Defence, Midfield, Attack), each position set to `roll`
  (frequent rotating subs) or `split` (evenly divided fixed blocks, e.g. two
  keepers each playing a half).
- **Priority weighting** — give any player a numeric weight (1 = normal,
  higher = a bigger share of playing time) that influences routine
  substitutions only.
- **Injury / availability caps** — mark a player unavailable, or give them a
  hard cap on total minutes; once they hit it they retire from the rotation
  for the rest of the match.
- **Lock** — mark an "iron player" who plays the entire match untouched by
  the rotation.
- **Auto-substitution scheduling** — generate a full-game sub sheet from
  periods, minutes/period, max bench time, and target break time.
- **Output view** — a Gantt-style timeline of who's on/off and when, a
  minutes-played summary, and a sub-by-sub timeline, all exportable as CSV or
  printable to PDF via the browser's print dialog.

## Algorithm

This is a faithful port of the original Streamlit app's scheduler
(`js/scheduler.js`), not a reimplementation. The key invariants carried over
exactly:

- **Max bench time is a hard guarantee** — enforced by a forced-return step
  that ignores priority weight entirely.
- **Priority weight** only ever influences *which* on-field player is
  substituted during routine rotation waves — it can never block a forced
  return or an injury cap-out.
- **Injury cap** is a hard ceiling: a capped-out player retires permanently,
  with an emergency fallback so a position slot is never left empty even if
  every eligible substitute is unavailable.
- **Lock** removes a player from the rotation maths completely (not just "low
  priority for subbing").
- **Split-mode positions** (e.g. keepers) ignore weight/cap/lock and simply
  divide the match into even blocks — this is inherited as-is from the
  source app, so an injury cap on a split-mode player is currently a no-op.
  Worth knowing if you use `split` mode for anything other than keepers.

One intentional behavior change from the source: the original only offered
three fixed priority tiers (Normal/More/Lots → 1×/2×/4×). This version lets
you enter any numeric weight.

## Running locally

Because the app uses ES modules (`<script type="module">`), you need to
serve it over `http://`, not open `index.html` directly via `file://`
(browsers block module imports from `file://` for security reasons). Any
static file server works:

```bash
python -m http.server 8000
```

or, if you have Node installed:

```bash
npx serve .
```

Then open `http://localhost:8000` (or whatever port your server prints).

## Deploying to GitHub Pages

1. Push this repo to GitHub (already done if you're reading this from the repo).
2. In the repo on GitHub: **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to `Deploy from a branch`.
4. Pick the `master` (or `main`) branch and `/ (root)` folder, then **Save**.
5. GitHub will publish the site at `https://<your-username>.github.io/<repo-name>/`
   within a minute or two — refresh the Pages settings page for the link.

No build step is needed — GitHub Pages serves the static files as-is.

## Project structure

```
index.html          # markup + tab structure
css/styles.css       # styling, mobile-first, print stylesheet for PDF export
js/scheduler.js      # the rotation algorithm (pure functions, no DOM)
js/storage.js        # localStorage persistence + defaults
js/export.js         # CSV export helper
js/main.js           # UI wiring: renders state, handles all user interaction
```

## Data & privacy

All data (squad, positions, match settings, generated schedule) lives only
in your browser's `localStorage`. Nothing is sent to a server. Clearing your
browser's site data for this page will reset it back to a blank squad.
