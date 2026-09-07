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
- **Starting lineup** — tick exactly who kicks off on the field per
  position; a live summary flags if you've ticked too few or too many for a
  position's slot count. Unticked slots auto-fill from squad order.
- **Auto-substitution scheduling** — generate a full-game sub sheet from
  periods, minutes/period, max bench time, target break time, a minimum
  stint length (no routine sub — at kickoff, mid-match, or near full-time —
  creates a stint shorter than this; 3 minutes by default) and an optional
  maximum stint length (forces a sub once a player has been on that long;
  0 = no limit).
- **Output view** — an interactive Gantt-style timeline of who's on/off and
  when (hover or tap a bar for that stint's exact minutes, or a player's name
  for their total minutes/stint count), a minutes-played summary, and a
  sub-by-sub timeline, all exportable as CSV or printable to PDF via the
  browser's print dialog.
- **Drag to adjust** — drag a bar to move a stint, or drag either end to
  change when it starts or finishes; it snaps to whole minutes and works with
  touch. Overlapping stints for one player merge into one. Hand edits can
  legitimately break the on-field count, so the sheet reports that rather
  than silently correcting it.
- **Edit protection** — once a sheet has been hand-adjusted, regenerating
  asks before discarding the changes.
- **Test squad** — the 16-player sample squad is spread across your current
  positions automatically (each position gets its on-field count, spares go
  round-robin for depth), so it's ready to generate without a trip to the
  roster.

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
- **Minimum stint length** is a new addition on top of the source algorithm:
  no routine substitution wave will cut a player's current stint short before
  it reaches the configured minimum (measured from when they came on, so it
  applies every time a player is subbed on, not just at kickoff), and a wave
  won't bring a new player on at all once too little match time remains for
  them to get a full minimum-length stint. It never overrides the hard
  max-bench-time guarantee — if a coach sets `max bench` below the minimum
  stint length, the bench-time guarantee wins and a player can be subbed
  early to keep someone else from breaching their hard cap.
- **Maximum stint length** (optional, new) forces a player off once they have
  been on that long, taking the longest-benched substitute in return. Unlike
  max bench time it is *best-effort, not a hard guarantee*, and can overrun by
  a minute or two in two unavoidable cases: near full-time, where breaking the
  stint would create one shorter than the minimum; and when several on-field
  players in a position hit the cap in the same minute but the bench is too
  shallow to replace them all at once (e.g. 6 players for 4 slots). Both are
  bounded — the cap is applied as soon as a substitute is actually free. A max
  stint below the min stint is self-contradictory, so the minimum wins.
- **Starting lineup** is also new: the source algorithm always picked the
  starting XI implicitly (first N players in squad order per position).
  Ticking "Start on field" for specific players now controls this directly —
  ticked players fill the position's starting slots first (in squad order
  among themselves); any leftover slots still auto-fill from squad order.

One intentional behavior change from the source: the original only offered
three fixed priority tiers (Normal/More/Lots → 1×/2×/4×). This version lets
you enter any numeric weight.

## Position colours

The Gantt's categorical palette is validated, not chosen by eye — the slots
are assigned in fixed order and never cycled (a 9th position takes a neutral
grey rather than repeating slot 1). The previous ad-hoc palette failed the
checks: red vs orange measured ΔE 10.4, below the 15 normal-vision floor,
meaning two positions were hard to tell apart even with full colour vision,
and blue vs magenta sat at 5.3 under protanopia. If you change these hexes,
re-run the validator rather than trusting the preview.

Identity is carried by a colour swatch next to each position name, with the
label itself in ink — small coloured text is where contrast falls down.

## Printing / PDF export

"Print / Save as PDF" produces a two-page landscape sheet: page 1 is the full
Gantt chart, page 2 is the minutes summary and the complete sub timeline.

Four things the print stylesheet has to handle that are easy to miss:

- **Its own page gutter** — Chrome's print dialog can override `@page
  { margin }` (choosing "Margins: None" zeroes it), which pushes the Gantt
  flush to the paper edge where printers physically cannot print. The layout
  keeps its own padding so it survives any margin setting.
- **`white-space: nowrap` on table cells** — a custom position name like
  "Defending Mid" otherwise wraps onto a second line in a narrow print
  column, doubling every row's height and adding whole pages.

- **`print-color-adjust: exact`** — browsers drop background colours when
  printing by default, and the Gantt bars *are* backgrounds, so without this
  the whole chart prints as a blank grid.
- **Column flow** — the tables are narrow and landscape pages are wide, so
  the minutes table flows into 2 columns and the sub timeline into 4 rather
  than printing one very sparse row per line (that alone took it from 4
  pages to 2).
- **Unclipping** — the on-screen scroll boxes (`max-height`, `overflow`) and
  the two-column results grid are all undone for print, otherwise content is
  clipped or leaves a dead half-page column.

If you change the print CSS, verify it by actually rendering a PDF rather
than eyeballing the screen — headless Chrome can do it:

```bash
chrome --headless=new --no-pdf-header-footer --print-to-pdf=out.pdf http://localhost:8000
```

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

## Cache busting

GitHub Pages serves plain filenames with no cache busting, so browsers will
happily keep serving a stale `styles.css` / `main.js` after a deploy. The
stylesheet, the entry script and its module imports all carry a `?v=N` query
— **bump it whenever you change those files, and only once the edits are
finished** (bumping first, then editing, caches the new version string
against stale content).

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
