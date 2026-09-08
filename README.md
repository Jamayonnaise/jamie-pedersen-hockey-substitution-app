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
- **Injury / availability caps** — mark a player unavailable, or give them a
  hard cap on total minutes; once they hit it they retire from the rotation
  for the rest of the match.
- **Lock** — mark an "iron player" who plays the entire match untouched by
  the rotation.
- **Starting lineup** — tick exactly who kicks off on the field per
  position; a live summary flags if you've ticked too few or too many for a
  position's slot count. Unticked slots auto-fill from squad order.
- **Auto-substitution scheduling** — generate a full-game sub sheet from
  periods, minutes/period and a break window (min/max). Stint length is not
  set directly: it is solved from the break and the squad size, so the two
  can never contradict each other. Everyone in a position gets the same
  stint, the same break and equal minutes.
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
- **Pinning** — pin a player on the sub sheet and a regenerate keeps their
  stints exactly, scheduling the rest of the position around them. This is
  how you give someone more (or less) than the even share.
- **Edit protection** — once a sheet has been hand-adjusted, regenerating
  asks before discarding the changes.
- **Test squad** — the 16-player sample squad is spread across your current
  positions automatically (each position gets its on-field count, spares go
  round-robin for depth), so it's ready to generate without a trip to the
  roster.

## Algorithm

The rotation is **solved, not searched**. A position's arithmetic already fixes
the relationship between a stint and a break: with `n` players and `s` on the
field, each player is on `s/n` of the match, so

```
break = stint x (n - s) / s
```

Setting a stint length and a break length independently therefore
over-determines the system — which is exactly what the earlier version did, and
why its caps fought each other and produced 21-minute stints under a 9-minute
cap. Only the **break** is configured now (it is the injury-relevant one), and
the substitution cadence is solved from it; stint length falls out.

Time is then cut into windows of that cadence. In each window the players on the
field are the `s` consecutive players in the rotation order, wrapping round, so
every window takes exactly one player off and brings exactly one on. The
consequences are structural rather than the result of a fairness heuristic:

- every player in a position gets the **same stint length and the same break**;
- **equal minutes**, exact when the match length divides by the cycle and within
  a few minutes otherwise (the remainder has to land somewhere);
- the **on-field count is exact** at every minute;
- **one substitution at a time**, never a mass change.

Positions are not given a staggered substitution clock. Offsetting one knocks
its cycle out of alignment with the match length, which measurably cost the
equal-minutes guarantee and produced 1-minute stints at the whistle. Positions
still rarely change together, because each derives its own cadence from its own
squad size.

Two things follow from the arithmetic and are worth knowing:

- **The opening stints ramp up.** At kickoff the players on the field are spread
  across the rotation, so the first player off has had one cadence, the next
  two, and so on until the cycle settles. Any staggered rotation has this; the
  alternative is substituting the whole line at once.
- **Some break windows are unreachable.** With 8 substitutes for 4 places,
  breaks can only be multiples of 8 minutes, so a 3-6 minute window cannot be
  hit. The sheet reports the closest achievable fit rather than missing quietly.

Carried over from the original Streamlit app: **injury caps** (a hard ceiling on
total minutes, after which a player retires for the match), **split-mode
positions** (keepers taking a half each, outside the rotation rules), and the
guarantee that a position slot is never left empty.

**Pinning** replaces the old priority weighting. Drag a player's stints to what
you want and pin them, and a regenerate holds those stints exactly while
scheduling everyone else around them. That covers "give this player more time"
without a weighting dial that could argue with the break rules. An "iron player"
lock is just a pin covering the whole match.

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
