import { getState, updateState, newId, PALETTE, PALETTE_OTHER, TEST_SQUAD_NAMES } from "./storage.js?v=15";
import { buildSchedule, subEvents, onFieldCounts, mergeSegs, qClock, firstName, positionPlan } from "./scheduler.js?v=15";
import { downloadCsv } from "./export.js?v=15";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ─────────────────────────── Tabs ───────────────────────────
function initTabs() {
  $$(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".tab-btn").forEach((b) => { b.classList.remove("active"); b.setAttribute("aria-selected", "false"); });
      $$(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");
      $(`#tab-${btn.dataset.tab}`).classList.add("active");
    });
  });
}

// ─────────────────────────── Helpers ───────────────────────────
function activePositions() {
  return getState().positions.filter((p) => p.name && p.name.trim());
}

/**
 * Drop roster rows whose player is gone. Replacing the squad (loading the test
 * squad, clearing it) mints fresh ids, so without this the old rows linger in
 * localStorage forever and pile up on every reload of the sample squad.
 */
function pruneRoster() {
  const s = getState();
  const ids = new Set(s.squad.map((p) => p.id));
  const stale = Object.keys(s.roster).filter((id) => !ids.has(id));
  if (!stale.length) return;
  updateState((st) => { stale.forEach((id) => delete st.roster[id]); });
}

/** Make sure every roster entry points at a position that still exists. */
function fixRosterPositions() {
  const names = activePositions().map((p) => p.name);
  if (!names.length) return;
  updateState((s) => {
    for (const p of s.squad) {
      const r = s.roster[p.id];
      if (r && !names.includes(r.position)) r.position = names[0];
    }
  });
}

function rosterFor(playerId) {
  const s = getState();
  const names = activePositions().map((p) => p.name);
  const defaults = {
    available: true,
    position: names[0] || "",
    maxMin: null,
    lock: false,
    starter: false,
  };
  return { ...defaults, ...(s.roster[playerId] || {}) };
}

/**
 * Spread the squad across the current positions so a freshly loaded test squad
 * is ready to generate without visiting the roster first. Each position gets
 * its on-field count, then the spare players go round-robin for rotation
 * depth — except split positions (keepers), which only need one extra to make
 * a sensible half-and-half.
 */
function autoAssignPositions() {
  const positions = activePositions();
  if (!positions.length) return;

  const quota = positions.map((p) => Math.max(1, Number(p.onField) || 1));
  const capOf = positions.map((p, i) => (p.mode === "split" ? quota[i] + 1 : Infinity));

  const squadSize = getState().squad.length;
  let assigned = quota.reduce((a, b) => a + b, 0);
  for (let guard = 0; assigned < squadSize && guard < 200; guard++) {
    let placedThisRound = false;
    for (let i = 0; i < positions.length && assigned < squadSize; i++) {
      if (quota[i] >= capOf[i]) continue;
      quota[i] += 1;
      assigned += 1;
      placedThisRound = true;
    }
    if (!placedThisRound) break; // every position is capped
  }

  const order = [];
  positions.forEach((p, i) => {
    for (let n = 0; n < quota[i]; n++) order.push(p.name);
  });

  updateState((s) => {
    s.squad.forEach((p, i) => {
      const base = s.roster[p.id] || {};
      s.roster[p.id] = {
        available: true,
        maxMin: null,
        lock: false,
        starter: false,
        ...base,
        position: order[i] ?? order[order.length - 1] ?? positions[0].name,
      };
    });
  });
}

// ─────────────────────────── Squad tab ───────────────────────────
function renderSquad() {
  const s = getState();
  $("#squad-empty-msg").hidden = s.squad.length > 0;
  $("#squad-count").textContent = s.squad.length ? `${s.squad.length} players` : "";

  const list = $("#squad-list");
  list.innerHTML = s.squad
    .map(
      (p) => `
    <div class="squad-row" data-id="${p.id}">
      <input type="text" class="squad-number" value="${escapeHtml(p.number)}" aria-label="Number" />
      <input type="text" class="squad-name" value="${escapeHtml(p.name)}" aria-label="Name" />
      <button class="btn danger-outline icon-btn squad-delete" title="Remove">✕</button>
    </div>`
    )
    .join("");

  list.querySelectorAll(".squad-row").forEach((row) => {
    const id = row.dataset.id;
    row.querySelector(".squad-number").addEventListener("input", (e) => {
      updateState((s) => { s.squad.find((p) => p.id === id).number = e.target.value; });
    });
    row.querySelector(".squad-name").addEventListener("input", (e) => {
      updateState((s) => { s.squad.find((p) => p.id === id).name = e.target.value; });
      renderRoster();
    });
    row.querySelector(".squad-delete").addEventListener("click", () => {
      updateState((s) => {
        s.squad = s.squad.filter((p) => p.id !== id);
        delete s.roster[id];
        s.schedule = null;
        s.assign = null;
      });
      renderAll();
    });
  });
}

function initSquadTab() {
  $("#add-player-btn").addEventListener("click", () => {
    const input = $("#new-player-name");
    const name = input.value.trim();
    if (!name) return;
    updateState((s) => {
      s.squad.push({ id: newId(), name, number: String(s.squad.length + 1) });
    });
    input.value = "";
    renderSquad();
    renderRoster();
  });
  $("#new-player-name").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("#add-player-btn").click();
  });

  $("#load-test-squad-btn").addEventListener("click", () => {
    updateState((s) => {
      s.squad = TEST_SQUAD_NAMES.map((n, i) => ({ id: newId(), name: n, number: String(i + 1) }));
      s.schedule = null;
      s.assign = null;
      s.scheduleEdited = false;
    });
    autoAssignPositions();
    renderAll();
  });

  $("#clear-squad-btn").addEventListener("click", () => {
    updateState((s) => {
      s.squad = [];
      s.schedule = null;
      s.assign = null;
    });
    renderAll();
  });
}

// ─────────────────────────── Match setup tab ───────────────────────────
function initMatchInputs() {
  const s = getState();
  $("#periods-input").value = s.match.periods;
  $("#perlen-input").value = s.match.perLen;
  $("#minbreak-input").value = s.match.minBreak;
  $("#maxbreak-input").value = s.match.maxBreak;
  updateMatchCaption();

  const bind = (id, key, parser = Number) => {
    $(id).addEventListener("input", (e) => {
      const v = parser(e.target.value);
      if (Number.isFinite(v)) {
        updateState((s) => { s.match[key] = v; });
        updateMatchCaption();
      }
    });
  };
  bind("#periods-input", "periods", (v) => parseInt(v, 10));
  bind("#perlen-input", "perLen", (v) => parseInt(v, 10));
  bind("#minbreak-input", "minBreak", (v) => parseInt(v, 10));
  bind("#maxbreak-input", "maxBreak", (v) => parseInt(v, 10));
}

function updateMatchCaption() {
  const s = getState();
  const total = s.match.periods * s.match.perLen;
  $("#match-length-caption").textContent =
    `Match length: ${total} min (${s.match.periods} × ${s.match.perLen})`;
}

function renderPositions() {
  const s = getState();
  const table = $("#positions-table");
  table.innerHTML = s.positions
    .map(
      (p, i) => `
    <div class="row-item" data-idx="${i}">
      <label>Position
        <input type="text" class="pos-name" value="${escapeHtml(p.name)}" placeholder="e.g. Defence" />
      </label>
      <label>On field
        <input type="number" class="pos-onfield" min="1" max="11" step="1" value="${p.onField}" />
      </label>
      <label>Mode
        <select class="pos-mode">
          <option value="roll" ${p.mode === "roll" ? "selected" : ""}>roll</option>
          <option value="split" ${p.mode === "split" ? "selected" : ""}>split</option>
        </select>
      </label>
      <button class="btn danger-outline icon-btn pos-delete" title="Remove">✕</button>
    </div>`
    )
    .join("");

  table.querySelectorAll(".row-item").forEach((row) => {
    const idx = Number(row.dataset.idx);
    row.querySelector(".pos-name").addEventListener("input", (e) => {
      updateState((s) => { s.positions[idx].name = e.target.value; });
      renderRoster();
      updateTotalOnFieldCaption();
    });
    row.querySelector(".pos-onfield").addEventListener("input", (e) => {
      const v = parseInt(e.target.value, 10);
      if (Number.isFinite(v)) {
        updateState((s) => { s.positions[idx].onField = v; });
        updateTotalOnFieldCaption();
      }
    });
    row.querySelector(".pos-mode").addEventListener("change", (e) => {
      updateState((s) => { s.positions[idx].mode = e.target.value; });
    });
    row.querySelector(".pos-delete").addEventListener("click", () => {
      updateState((s) => { s.positions.splice(idx, 1); });
      renderPositions();
      renderRoster();
      updateTotalOnFieldCaption();
    });
  });

  updateTotalOnFieldCaption();
}

function updateTotalOnFieldCaption() {
  const total = activePositions().reduce((sum, p) => sum + (Number(p.onField) || 0), 0);
  $("#total-on-field-caption").textContent = `Total on field: ${total}  (11-a-side hockey = 11)`;
}

function renderStarterSummary() {
  const s = getState();
  const positions = activePositions();
  const el = $("#starter-summary");
  if (!s.squad.length || !positions.length) {
    el.innerHTML = "";
    return;
  }
  const rows = positions.map((pos) => {
    const inPos = s.squad.filter((p) => {
      const r = rosterFor(p.id);
      return r.available && r.position === pos.name;
    });
    const starters = inPos.filter((p) => rosterFor(p.id).starter);
    const need = Number(pos.onField) || 0;
    let status = "ok";
    let note = `${starters.length} / ${need} starters ticked`;
    if (starters.length < need) { status = "warn"; note += " — rest auto-filled from squad order"; }
    else if (starters.length > need) { status = "warn"; note += ` — only the first ${need} (squad order) will kick off`; }
    return { name: pos.name, status, note };
  });
  el.innerHTML = rows
    .map((r) => `<span class="starter-chip ${r.status === "ok" ? "chip-ok" : "chip-warn"}">${escapeHtml(r.name)}: ${escapeHtml(r.note)}</span>`)
    .join("");
}

function initPositionsTab() {
  $("#add-position-btn").addEventListener("click", () => {
    updateState((s) => { s.positions.push({ name: "New position", onField: 1, mode: "roll" }); });
    renderPositions();
  });
}

function renderRoster() {
  pruneRoster();
  fixRosterPositions();
  const s = getState();
  $("#roster-empty-msg").hidden = s.squad.length > 0;
  const posNames = activePositions().map((p) => p.name);
  const table = $("#roster-table");

  if (!s.squad.length) {
    table.innerHTML = "";
    return;
  }

  table.innerHTML = s.squad
    .map((p) => {
      const r = rosterFor(p.id);
      return `
    <div class="row-item" data-id="${p.id}">
      <div class="roster-head">
        <span class="player-name"><span class="player-num">${escapeHtml(p.number)}</span>${escapeHtml(p.name)}</span>
        <label class="checkbox-field"><input type="checkbox" class="r-available" ${r.available ? "checked" : ""} /> In squad</label>
      </div>
      <div class="roster-fields">
        <label>Position
          <select class="r-position">
            ${posNames.map((n) => `<option value="${escapeHtml(n)}" ${n === r.position ? "selected" : ""}>${escapeHtml(n)}</option>`).join("")}
          </select>
        </label>
        <label>Max min
          <input type="number" class="r-maxmin" min="0" max="120" step="1" value="${r.maxMin ?? ""}" placeholder="none" />
        </label>
      </div>
      <div class="roster-toggles">
        <label class="checkbox-field starter-toggle"><input type="checkbox" class="r-starter" ${r.starter ? "checked" : ""} /> Start on field</label>
        <label class="checkbox-field"><input type="checkbox" class="r-lock" ${r.lock ? "checked" : ""} /> Lock on (never subbed off)</label>
      </div>
    </div>`;
    })
    .join("");

  table.querySelectorAll(".row-item").forEach((row) => {
    const id = row.dataset.id;
    const save = (mutator) => {
      updateState((s) => {
        s.roster[id] = { ...rosterFor(id), ...mutator() };
      });
    };
    row.querySelector(".r-available").addEventListener("change", (e) => { save(() => ({ available: e.target.checked })); renderStarterSummary(); });
    row.querySelector(".r-position").addEventListener("change", (e) => { save(() => ({ position: e.target.value })); renderStarterSummary(); });
    row.querySelector(".r-maxmin").addEventListener("input", (e) => {
      const v = e.target.value.trim();
      save(() => ({ maxMin: v === "" ? null : Math.max(0, parseInt(v, 10) || 0) }));
    });
    row.querySelector(".r-starter").addEventListener("change", (e) => { save(() => ({ starter: e.target.checked })); renderStarterSummary(); });
    row.querySelector(".r-lock").addEventListener("change", (e) => save(() => ({ lock: e.target.checked })));
  });

  renderStarterSummary();
}

// ─────────────────────────── Gantt tooltip ───────────────────────────
let ganttTooltipEl = null;

function ganttTooltipHtml(target) {
  const seg = target.closest(".gantt-seg");
  if (seg) {
    const { name, pos, start, end } = seg.dataset;
    const dur = Number(end) - Number(start);
    return `<strong>${escapeHtml(name)}</strong> — ${escapeHtml(pos)}<br>On ${start}' → Off ${end}' (${dur} min stint)`;
  }
  const nameEl = target.closest(".gantt-name");
  if (nameEl) {
    const { name, pos, mins, stints } = nameEl.dataset;
    return `<strong>${escapeHtml(name)}</strong> — ${escapeHtml(pos)}<br>${mins} min total across ${stints} stint${stints === "1" ? "" : "s"}`;
  }
  return null;
}

function positionTooltip(x, y) {
  const el = ganttTooltipEl;
  const pad = 14;
  el.style.left = "0px";
  el.style.top = "0px";
  const rect = el.getBoundingClientRect();
  let left = x + pad;
  let top = y + pad;
  if (left + rect.width > window.innerWidth - 4) left = x - rect.width - pad;
  if (top + rect.height > window.innerHeight - 4) top = y - rect.height - pad;
  el.style.left = `${Math.max(4, left)}px`;
  el.style.top = `${Math.max(4, top)}px`;
}

function showGanttTooltip(html, x, y) {
  ganttTooltipEl.innerHTML = html;
  ganttTooltipEl.hidden = false;
  positionTooltip(x, y);
}

function hideGanttTooltip() {
  ganttTooltipEl.hidden = true;
}

function initGanttTooltip() {
  ganttTooltipEl = document.createElement("div");
  ganttTooltipEl.className = "gantt-tooltip";
  ganttTooltipEl.hidden = true;
  document.body.appendChild(ganttTooltipEl);

  const container = $("#gantt-container");

  container.addEventListener("mousemove", (e) => {
    if (drag) return; // the drag handler owns the tooltip mid-drag
    const html = ganttTooltipHtml(e.target);
    if (html) showGanttTooltip(html, e.clientX, e.clientY);
    else hideGanttTooltip();
  });
  container.addEventListener("mouseleave", hideGanttTooltip);

  // Touch/tap support: tap a segment or name to pin the tooltip, tap elsewhere to dismiss.
  container.addEventListener("click", (e) => {
    const html = ganttTooltipHtml(e.target);
    if (html) {
      const rect = e.target.getBoundingClientRect();
      showGanttTooltip(html, rect.left + rect.width / 2, rect.top);
      e.stopPropagation();
    } else {
      hideGanttTooltip();
    }
  });
  // Keyboard focus (segments/names are tabindex=0) shows the same tooltip.
  container.addEventListener(
    "focus",
    (e) => {
      const html = ganttTooltipHtml(e.target);
      if (html) {
        const rect = e.target.getBoundingClientRect();
        showGanttTooltip(html, rect.left + rect.width / 2, rect.bottom);
      }
    },
    true
  );
  container.addEventListener("blur", hideGanttTooltip, true);

  document.addEventListener("click", (e) => {
    if (!container.contains(e.target)) hideGanttTooltip();
  });
}

// ─────────────────────────── Dragging stints ──────────────────────────
// A stint bar can be moved whole, or have either end pulled, snapping to whole
// minutes. The commit happens once on release so the tables and the on-field
// count are recalculated a single time rather than on every pointer move.
const EDGE_GRAB_PX = 10;
let drag = null;

function minutesPerPixel(track, total) {
  const w = track.getBoundingClientRect().width;
  return w > 0 ? total / w : 0;
}

function ganttPointerDown(e) {
  const seg = e.target.closest(".gantt-seg");
  if (!seg || e.button > 0) return;

  const track = seg.parentElement;
  const rect = seg.getBoundingClientRect();
  const total = getState().match.periods * getState().match.perLen;

  const nearStart = e.clientX - rect.left <= EDGE_GRAB_PX;
  const nearEnd = rect.right - e.clientX <= EDGE_GRAB_PX;
  // On a very short bar the two edge zones would overlap and swallow "move",
  // so the wider half wins.
  const mode = rect.width < EDGE_GRAB_PX * 2.5
    ? (nearStart && !nearEnd ? "start" : nearEnd && !nearStart ? "end" : "move")
    : nearStart ? "start" : nearEnd ? "end" : "move";

  drag = {
    seg,
    track,
    total,
    mode,
    pid: seg.dataset.pid,
    idx: Number(seg.dataset.idx),
    startX: e.clientX,
    origStart: Number(seg.dataset.start),
    origEnd: Number(seg.dataset.end),
    mpp: minutesPerPixel(track, total),
    moved: false,
  };

  seg.setPointerCapture(e.pointerId);
  seg.classList.add("dragging");
  hideGanttTooltip();
  e.preventDefault();
}

function dragValues(e) {
  const deltaMin = Math.round((e.clientX - drag.startX) * drag.mpp);
  let { origStart: start, origEnd: end } = drag;

  if (drag.mode === "move") {
    const span = end - start;
    start = Math.min(Math.max(0, start + deltaMin), drag.total - span);
    end = start + span;
  } else if (drag.mode === "start") {
    start = Math.min(Math.max(0, start + deltaMin), end - 1);
  } else {
    end = Math.max(Math.min(drag.total, end + deltaMin), start + 1);
  }
  return [start, end];
}

function ganttPointerMove(e) {
  if (!drag) return;
  const [start, end] = dragValues(e);
  if (start !== drag.origStart || end !== drag.origEnd) drag.moved = true;

  drag.seg.style.left = `${(start / drag.total) * 100}%`;
  drag.seg.style.width = `${((end - start) / drag.total) * 100}%`;
  showGanttTooltip(
    `<strong>${escapeHtml(drag.seg.dataset.name)}</strong><br>On ${start}' → Off ${end}' (${end - start} min)`,
    e.clientX,
    e.clientY
  );
}

function ganttPointerUp(e) {
  if (!drag) return;
  const { pid, idx, moved } = drag;
  const [start, end] = dragValues(e);
  drag.seg.classList.remove("dragging");
  hideGanttTooltip();
  drag = null;

  if (!moved) return; // a plain click, not a drag

  updateState((s) => {
    const segs = (s.schedule[pid] || []).map((seg) => seg.slice());
    if (!segs[idx]) return;
    segs[idx] = [start, end];
    // Overlapping stints for one player are not two stints — merge them.
    s.schedule[pid] = mergeSegs(segs);
    // A pin records exact stints, so keep it in step with what was just dragged.
    if (s.pins?.[pid]?.length) s.pins[pid] = s.schedule[pid].map((seg) => seg.slice());
  });
  markScheduleEdited();
  renderSheet();
}

/**
 * Pinning holds a player's stints exactly as they are, so a regenerate
 * schedules the rest of the position around them. That is how a coach gives
 * someone more (or less) than the even share.
 */
function initPinButtons() {
  $("#gantt-container").addEventListener("click", (e) => {
    const btn = e.target.closest(".pin-btn");
    if (!btn) return;
    const pid = btn.dataset.pin;
    updateState((s) => {
      s.pins = s.pins || {};
      if (s.pins[pid]?.length) delete s.pins[pid];
      else s.pins[pid] = (s.schedule[pid] || []).map((seg) => seg.slice());
    });
    renderSheet();
  });
}

function initGanttDrag() {
  const container = $("#gantt-container");
  container.addEventListener("pointerdown", ganttPointerDown);
  container.addEventListener("pointermove", ganttPointerMove);
  container.addEventListener("pointerup", ganttPointerUp);
  container.addEventListener("pointercancel", () => {
    if (drag) { drag.seg.classList.remove("dragging"); drag = null; }
    hideGanttTooltip();
    renderSheet();
  });
}

// ─────────────────────────── Sub sheet tab ───────────────────────────
function generateRotation() {
  const s = getState();
  const positions = activePositions();
  const names = positions.map((p) => p.name);
  const available = s.squad.filter((p) => rosterFor(p.id).available && names.includes(rosterFor(p.id).position));

  $("#generate-error").hidden = true;
  if (!available.length) {
    $("#generate-error").hidden = false;
    $("#generate-error").textContent = "No available players — set up the roster in Match setup.";
    return;
  }

  const assign = {}, caps = {}, locks = {};
  for (const p of available) {
    const r = rosterFor(p.id);
    assign[p.id] = r.position;
    caps[p.id] = r.maxMin ?? null;
    locks[p.id] = !!r.lock;
  }

  // Pinned players keep the stints the coach set; everyone else is scheduled
  // around them. Pins for players no longer available are ignored.
  const pins = {};
  for (const p of available) {
    const pinned = (s.pins || {})[p.id];
    if (pinned && pinned.length) pins[p.id] = pinned.map((seg) => seg.slice());
  }

  // Within each position, ticked starters go first (stable sort keeps squad
  // order among ties) so schedulePosition's initial on-field slots are filled
  // by them — the rest of the position's slots auto-fill from squad order.
  const ordered = [...available].sort((a, b) => {
    const aStarter = rosterFor(a.id).starter ? 0 : 1;
    const bStarter = rosterFor(b.id).starter ? 0 : 1;
    return aStarter - bStarter;
  });

  const total = s.match.periods * s.match.perLen;
  const schedule = buildSchedule(ordered, assign, positions, total, s.match.minBreak, s.match.maxBreak, caps, locks, pins);

  updateState((s) => {
    s.schedule = schedule;
    s.assign = assign;
    s.scheduleEdited = false;
  });

  hideRegenWarning();
  renderSheet();
}

/**
 * Regenerating throws away hand-tuned stints, so ask first — but only when
 * there is actually something to lose.
 */
function requestGenerate() {
  const s = getState();
  if (s.schedule && s.scheduleEdited) {
    $("#regen-warning").hidden = false;
    $("#regen-warning").scrollIntoView({ block: "nearest", behavior: "smooth" });
    return;
  }
  generateRotation();
}

function hideRegenWarning() {
  $("#regen-warning").hidden = true;
}

/** Called by every hand-edit path so the warning knows there is work to lose. */
function markScheduleEdited() {
  updateState((s) => { s.scheduleEdited = true; });
  const badge = $("#edited-badge");
  if (badge) badge.hidden = false;
}

function renderSheet() {
  const s = getState();
  const has = s.schedule && Object.keys(s.schedule).length > 0;
  $("#sheet-empty-msg").hidden = !!has;
  $("#sheet-results").hidden = !has;
  if (!has) return;

  const positions = activePositions();
  const total = s.match.periods * s.match.perLen;
  const qmins = Math.floor(total / Math.max(1, s.match.periods));
  const assign = s.assign || {};
  const schedule = s.schedule;
  const squadById = Object.fromEntries(s.squad.map((p) => [p.id, p]));

  $("#edited-badge").hidden = !s.scheduleEdited;

  const stintNote = s.match.maxStint > 0 ? ` · max stint ${s.match.maxStint}'` : "";
  $("#print-header").innerHTML = `<h2>Hockey Manager — Sub Sheet</h2>
    <p>${s.match.periods} × ${s.match.perLen} min (${total} min total) ·
    max bench ${s.match.maxOff}' · target break ${s.match.targetOff}' ·
    min stint ${s.match.minStart}'${stintNote} ·
    printed ${new Date().toLocaleDateString()}</p>`;

  renderSanity(schedule, positions, total);
  renderGantt(schedule, assign, positions, total, s.match.periods, qmins);
  renderMinutesTable(schedule, assign, positions, s.squad);
  renderTimelineTable(schedule, assign, positions, squadById, qmins);
  renderManualEditor(schedule, s.squad);
}

function renderSanity(schedule, positions, total) {
  const counts = onFieldCounts(schedule, total);
  const targetOn = positions.reduce((sum, p) => sum + (Number(p.onField) || 0), 0);
  const ok = counts.every((c) => c === targetOn);
  const banner = $("#sanity-banner");
  if (ok) {
    banner.className = "banner-ok";
    banner.textContent = `✓ Exactly ${targetOn} players on field at all times.`;
  } else {
    const bad = counts.map((c, m) => (c !== targetOn ? m : null)).filter((m) => m !== null).slice(0, 5);
    banner.className = "banner-warn";
    banner.textContent = `On-field count off at minutes ${bad.join(", ")} (expected ${targetOn}). Check that each position has enough players assigned.`;
  }
  renderStintNote(schedule);
}

/**
 * Max bench time is a hard guarantee, so with a deep bench and a short bench
 * cap it can force stints below the minimum. That is correct precedence but
 * shouldn't be silent — a coach seeing 1-minute stints deserves to know why.
 */
/**
 * Report what each position actually got. Because break and stint are locked
 * together by the squad size, some break windows are simply unreachable — with
 * 8 substitutes for 4 slots, breaks can only be multiples of 8 minutes. Say so
 * rather than quietly missing the target.
 */
function renderStintNote(schedule) {
  const s = getState();
  const note = $("#stint-note");
  const assign = s.assign || {};
  const { minBreak, maxBreak } = s.match;

  const lines = [];
  for (const pos of activePositions()) {
    if (pos.mode === "split") continue;
    const members = Object.keys(assign).filter((pid) => assign[pid] === pos.name);
    const pinnedHere = members.filter((pid) => (s.pins || {})[pid]?.length);
    const free = members.length - pinnedHere.length;
    const slots = Math.max(0, Number(pos.onField) - pinnedHere.length);
    if (free <= slots || slots <= 0) continue;

    const plan = positionPlan(free, slots, minBreak, maxBreak);
    if (plan.breakLen == null) continue;

    const breakOutside = plan.breakLen < minBreak || plan.breakLen > maxBreak;
    // A stint shorter than a break can't be avoided when the bench is large
    // relative to the field: with n players sharing s places, everyone is on
    // s/n of the match, so the stint is pinned to break x s/(n − s).
    const stintTooShort = plan.stint < minBreak;
    if (!breakOutside && !stintTooShort) continue;

    const shape = `${free} players for ${slots} place${slots === 1 ? "" : "s"}`;
    const got = `a ${plan.breakLen}' break with ${plan.stint}' stints`;
    lines.push(
      breakOutside
        ? `${pos.name}: ${shape} means breaks can only come in steps of ${free - slots} min, ` +
          `so the closest fit is ${got} — outside your ${minBreak}–${maxBreak}' window. ` +
          `Adjust the window or the number of players in this position.`
        : `${pos.name}: ${shape} puts everyone on ${slots}/${free} of the match, which forces ` +
          `${got} — stints shorter than your ${minBreak}' minimum. Raise the max break, or move ` +
          `a player off this position, to lengthen them.`
    );
  }

  if (lines.length) {
    note.hidden = false;
    note.className = "banner-warn";
    note.textContent = lines.join(" ");
  } else {
    note.hidden = true;
  }
}

// Slots are assigned in fixed order and never cycled — a 9th position would
// otherwise repeat slot 1's hue and read as the same position on the chart.
function posColor(positions) {
  const map = {};
  positions.forEach((p, i) => { map[p.name] = PALETTE[i] ?? PALETTE_OTHER; });
  return map;
}

function renderGantt(schedule, assign, positions, total, periods, qmins) {
  const colors = posColor(positions);
  const container = $("#gantt-container");
  let html = `<div class="gantt-axis">`;
  for (let q = 0; q <= periods; q++) {
    const leftPct = ((q * qmins) / total) * 100;
    // The final "FT" label sits at 100%, so pull it back inside the track.
    const endClass = q === periods ? ' class="axis-end"' : "";
    html += `<span${endClass} style="left:${leftPct}%">${q === periods ? "FT" : `Q${q + 1}`}</span>`;
  }
  html += `</div>`;

  for (const pos of positions) {
    const members = Object.keys(assign).filter((pid) => assign[pid] === pos.name);
    if (!members.length) continue;
    const squad = getState().squad;
    const orderedMembers = squad.filter((p) => members.includes(p.id));
    html += `<div class="gantt-pos-label">
      <span class="pos-swatch" style="background:${colors[pos.name]}"></span>${escapeHtml(pos.name)}
    </div>`;
    for (const p of orderedMembers) {
      const segs = schedule[p.id] || [];
      const mins = segs.reduce((sum, [s, e]) => sum + (e - s), 0);
      const name = firstName(p.name);
      const isPinned = !!(getState().pins || {})[p.id]?.length;
      html += `<div class="gantt-row">
        <button class="pin-btn${isPinned ? " pinned" : ""}" data-pin="${p.id}"
                title="${isPinned ? "Pinned — these stints are kept when you regenerate" : "Pin these stints so a regenerate keeps them"}"
                aria-pressed="${isPinned}" aria-label="Pin ${escapeHtml(name)}'s stints">${isPinned ? "★" : "☆"}</button>
        <div class="gantt-name" tabindex="0"
             data-name="${escapeHtml(name)}" data-pos="${escapeHtml(pos.name)}"
             data-mins="${mins}" data-stints="${segs.length}"
             aria-label="${escapeHtml(name)}, ${escapeHtml(pos.name)}, ${mins} minutes total across ${segs.length} stint${segs.length === 1 ? "" : "s"}">
          ${escapeHtml(name)} <span class="mins">${mins}'</span>
        </div>
        <div class="gantt-track">`;
      for (let q = 1; q < periods; q++) {
        const leftPct = ((q * qmins) / total) * 100;
        html += `<div class="gantt-qline" style="left:${leftPct}%"></div>`;
      }
      segs.forEach(([s, e], segIdx) => {
        const leftPct = (s / total) * 100;
        const widthPct = ((e - s) / total) * 100;
        html += `<div class="gantt-seg" tabindex="0" style="left:${leftPct}%;width:${widthPct}%;background:${colors[pos.name]}"
                   data-name="${escapeHtml(name)}" data-pos="${escapeHtml(pos.name)}"
                   data-pid="${p.id}" data-idx="${segIdx}"
                   data-start="${s}" data-end="${e}"
                   aria-label="${escapeHtml(name)}, ${escapeHtml(pos.name)}, on field from minute ${s} to ${e}, ${e - s} minute stint. Drag to adjust."
                 ><span class="seg-grip seg-grip-start" aria-hidden="true"></span
                 ><span class="seg-grip seg-grip-end" aria-hidden="true"></span></div>`;
      });
      html += `</div></div>`;
    }
  }
  container.innerHTML = html;
}

function renderMinutesTable(schedule, assign, positions, squad) {
  const rows = [];
  for (const pos of positions) {
    const members = squad.filter((p) => assign[p.id] === pos.name);
    for (const p of members) {
      const segs = schedule[p.id] || [];
      rows.push({
        player: firstName(p.name),
        pos: pos.name,
        min: segs.reduce((sum, [s, e]) => sum + (e - s), 0),
        stints: segs.length,
      });
    }
  }
  const html = `<div class="table-scroll"><table class="data-table">
    <thead><tr><th>Player</th><th>Pos</th><th>Min</th><th>Stints</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td>${escapeHtml(r.player)}</td><td>${escapeHtml(r.pos)}</td><td>${r.min}</td><td>${r.stints}</td></tr>`).join("")}</tbody>
  </table></div>`;
  $("#minutes-table").innerHTML = html;
  $("#minutes-table").dataset.rows = JSON.stringify(rows);
}

function renderTimelineTable(schedule, assign, positions, squadById, qmins) {
  const evs = subEvents(schedule, assign, positions);
  const container = $("#timeline-table");
  if (!evs.length) {
    container.innerHTML = `<p class="caption">No subs (everyone plays the full match).</p>`;
    container.dataset.rows = "[]";
    return;
  }
  const rows = evs.map((e) => ({
    when: qClock(e.minute, qmins),
    pos: e.pos,
    on: firstName(squadById[e.in]?.name),
    off: firstName(squadById[e.out]?.name),
  }));
  container.innerHTML = `<div class="table-scroll"><table class="data-table">
    <thead><tr><th>When</th><th>Pos</th><th>On</th><th>Off</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td>${escapeHtml(r.when)}</td><td>${escapeHtml(r.pos)}</td><td>${escapeHtml(r.on)}</td><td>${escapeHtml(r.off)}</td></tr>`).join("")}</tbody>
  </table></div>`;
  container.dataset.rows = JSON.stringify(rows);
}

// ─────────────────────────── Manual editor ───────────────────────────
function renderManualEditor(schedule, squad) {
  const select = $("#manual-player-select");
  const options = squad.filter((p) => Object.prototype.hasOwnProperty.call(schedule, p.id));
  const prevSelected = select.value;
  select.innerHTML = options.map((p) => `<option value="${p.id}">${escapeHtml(firstName(p.name))}</option>`).join("");
  if (options.some((p) => p.id === prevSelected)) select.value = prevSelected;
  renderManualSegments();
}

function renderManualSegments() {
  const s = getState();
  const who = $("#manual-player-select").value;
  const container = $("#manual-segments");
  if (!who) { container.innerHTML = ""; return; }
  const segs = s.schedule[who] || [];
  const total = s.match.periods * s.match.perLen;
  container.innerHTML = segs
    .map(
      (seg, i) => `
    <div class="manual-seg-row" data-idx="${i}">
      <label>On <input type="number" class="seg-start" min="0" max="${total}" value="${seg[0]}" /></label>
      <label>Off <input type="number" class="seg-end" min="0" max="${total}" value="${seg[1]}" /></label>
      <button class="btn danger-outline icon-btn seg-delete" title="Delete stint">✕</button>
    </div>`
    )
    .join("");

  container.querySelectorAll(".manual-seg-row").forEach((row) => {
    const idx = Number(row.dataset.idx);
    const syncFromInputs = () => {
      const segsNow = getState().schedule[who].slice();
      segsNow[idx] = [
        parseInt(row.querySelector(".seg-start").value, 10) || 0,
        parseInt(row.querySelector(".seg-end").value, 10) || 0,
      ];
      updateState((s) => { s.schedule[who] = segsNow; });
    };
    row.querySelector(".seg-start").addEventListener("input", syncFromInputs);
    row.querySelector(".seg-end").addEventListener("input", syncFromInputs);
    row.querySelector(".seg-delete").addEventListener("click", () => {
      const segsNow = getState().schedule[who].slice();
      segsNow.splice(idx, 1);
      updateState((s) => { s.schedule[who] = mergeSegs(segsNow); });
      markScheduleEdited();
      renderSheet();
    });
  });
}

function initManualEditor() {
  $("#manual-player-select").addEventListener("change", renderManualSegments);
  $("#manual-add-stint-btn").addEventListener("click", () => {
    const who = $("#manual-player-select").value;
    if (!who) return;
    const s = getState();
    const total = s.match.periods * s.match.perLen;
    const segsNow = (s.schedule[who] || []).slice();
    segsNow.push([0, Math.min(total, 5)]);
    updateState((s) => { s.schedule[who] = segsNow; });
    markScheduleEdited();
    renderManualSegments();
  });
  $("#manual-apply-btn").addEventListener("click", () => {
    const who = $("#manual-player-select").value;
    if (!who) return;
    const segsNow = getState().schedule[who] || [];
    updateState((s) => { s.schedule[who] = mergeSegs(segsNow); });
    markScheduleEdited();
    renderSheet();
  });
}

// ─────────────────────────── Export / print ───────────────────────────
function initExport() {
  $("#generate-btn").addEventListener("click", requestGenerate);
  $("#regen-confirm-btn").addEventListener("click", generateRotation);
  $("#regen-cancel-btn").addEventListener("click", hideRegenWarning);

  $("#export-minutes-csv-btn").addEventListener("click", () => {
    const rows = JSON.parse($("#minutes-table").dataset.rows || "[]");
    downloadCsv("minutes.csv", ["Player", "Position", "Minutes", "Stints"], rows.map((r) => [r.player, r.pos, r.min, r.stints]));
  });
  $("#export-timeline-csv-btn").addEventListener("click", () => {
    const rows = JSON.parse($("#timeline-table").dataset.rows || "[]");
    downloadCsv("sub-timeline.csv", ["When", "Position", "On", "Off"], rows.map((r) => [r.when, r.pos, r.on, r.off]));
  });
  $("#print-btn").addEventListener("click", () => window.print());
}

// ─────────────────────────── Init ───────────────────────────
function renderAll() {
  renderSquad();
  renderPositions();
  renderRoster();
  renderSheet();
}

function init() {
  initTabs();
  initSquadTab();
  initMatchInputs();
  initPositionsTab();
  initManualEditor();
  initExport();
  initGanttTooltip();
  initGanttDrag();
  initPinButtons();
  renderAll();
}

document.addEventListener("DOMContentLoaded", init);
