import { getState, updateState, newId, PALETTE, TEST_SQUAD_NAMES } from "./storage.js";
import { buildSchedule, subEvents, onFieldCounts, mergeSegs, qClock, firstName } from "./scheduler.js";
import { downloadCsv } from "./export.js";

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
  return (
    s.roster[playerId] || {
      available: true,
      position: names[0] || "",
      maxMin: null,
      weight: 1,
      lock: false,
    }
  );
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
    });
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
  $("#maxoff-input").value = s.match.maxOff;
  $("#targetoff-input").value = s.match.targetOff;
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
  bind("#maxoff-input", "maxOff", (v) => parseInt(v, 10));
  bind("#targetoff-input", "targetOff", (v) => parseInt(v, 10));
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

function initPositionsTab() {
  $("#add-position-btn").addEventListener("click", () => {
    updateState((s) => { s.positions.push({ name: "New position", onField: 1, mode: "roll" }); });
    renderPositions();
  });
}

function renderRoster() {
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
      <div class="player-name">${escapeHtml(p.number)}  ${escapeHtml(p.name)}</div>
      <div class="roster-fields">
        <label class="checkbox-field"><input type="checkbox" class="r-available" ${r.available ? "checked" : ""} /> In squad</label>
        <label>Position
          <select class="r-position">
            ${posNames.map((n) => `<option value="${escapeHtml(n)}" ${n === r.position ? "selected" : ""}>${escapeHtml(n)}</option>`).join("")}
          </select>
        </label>
        <label>Max min
          <input type="number" class="r-maxmin" min="0" max="120" step="1" value="${r.maxMin ?? ""}" placeholder="none" />
        </label>
        <label>Weight
          <input type="number" class="r-weight" min="0.1" step="0.1" value="${r.weight ?? 1}" />
        </label>
      </div>
      <label class="checkbox-field"><input type="checkbox" class="r-lock" ${r.lock ? "checked" : ""} /> Lock on (never subbed off)</label>
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
    row.querySelector(".r-available").addEventListener("change", (e) => save(() => ({ available: e.target.checked })));
    row.querySelector(".r-position").addEventListener("change", (e) => save(() => ({ position: e.target.value })));
    row.querySelector(".r-maxmin").addEventListener("input", (e) => {
      const v = e.target.value.trim();
      save(() => ({ maxMin: v === "" ? null : Math.max(0, parseInt(v, 10) || 0) }));
    });
    row.querySelector(".r-weight").addEventListener("input", (e) => {
      const v = parseFloat(e.target.value);
      save(() => ({ weight: Number.isFinite(v) && v > 0 ? v : 1 }));
    });
    row.querySelector(".r-lock").addEventListener("change", (e) => save(() => ({ lock: e.target.checked })));
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

  const assign = {}, caps = {}, weights = {}, locks = {};
  for (const p of available) {
    const r = rosterFor(p.id);
    assign[p.id] = r.position;
    caps[p.id] = r.maxMin ?? null;
    weights[p.id] = r.weight ?? 1;
    locks[p.id] = !!r.lock;
  }

  const total = s.match.periods * s.match.perLen;
  const schedule = buildSchedule(available, assign, positions, total, s.match.maxOff, s.match.targetOff, caps, weights, locks);

  updateState((s) => {
    s.schedule = schedule;
    s.assign = assign;
  });

  renderSheet();
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
}

function posColor(positions) {
  const map = {};
  positions.forEach((p, i) => { map[p.name] = PALETTE[i % PALETTE.length]; });
  return map;
}

function renderGantt(schedule, assign, positions, total, periods, qmins) {
  const colors = posColor(positions);
  const container = $("#gantt-container");
  let html = `<div class="gantt-axis">`;
  for (let q = 0; q <= periods; q++) {
    const leftPct = ((q * qmins) / total) * 100;
    html += `<span style="left:${leftPct}%">${q === periods ? "FT" : `Q${q + 1}`}</span>`;
  }
  html += `</div>`;

  for (const pos of positions) {
    const members = Object.keys(assign).filter((pid) => assign[pid] === pos.name);
    if (!members.length) continue;
    const squad = getState().squad;
    const orderedMembers = squad.filter((p) => members.includes(p.id));
    html += `<div class="gantt-pos-label" style="color:${colors[pos.name]}">${escapeHtml(pos.name)}</div>`;
    for (const p of orderedMembers) {
      const segs = schedule[p.id] || [];
      const mins = segs.reduce((sum, [s, e]) => sum + (e - s), 0);
      html += `<div class="gantt-row">
        <div class="gantt-name">${escapeHtml(firstName(p.name))} <span class="mins">${mins}'</span></div>
        <div class="gantt-track">`;
      for (let q = 1; q < periods; q++) {
        const leftPct = ((q * qmins) / total) * 100;
        html += `<div class="gantt-qline" style="left:${leftPct}%"></div>`;
      }
      for (const [s, e] of segs) {
        const leftPct = (s / total) * 100;
        const widthPct = ((e - s) / total) * 100;
        html += `<div class="gantt-seg" style="left:${leftPct}%;width:${widthPct}%;background:${colors[pos.name]}"></div>`;
      }
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
      <button class="btn danger-outline icon-btn seg-delete" title="Delete stint">🗑</button>
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
    renderManualSegments();
  });
  $("#manual-apply-btn").addEventListener("click", () => {
    const who = $("#manual-player-select").value;
    if (!who) return;
    const segsNow = getState().schedule[who] || [];
    updateState((s) => { s.schedule[who] = mergeSegs(segsNow); });
    renderSheet();
  });
}

// ─────────────────────────── Export / print ───────────────────────────
function initExport() {
  $("#generate-btn").addEventListener("click", generateRotation);

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
  renderAll();
}

document.addEventListener("DOMContentLoaded", init);
