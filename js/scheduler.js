// Rotation scheduler — break-first.
//
// The old scheduler applied a stack of caps reactively (min stint, max stint,
// max bench) and let them fight: with a thin bench no cadence could satisfy
// them all, so stints thrashed and identical positions drifted apart.
//
// This one solves for the rotation instead. A position's arithmetic already
// fixes the relationship between a stint and a break — with n players and s on
// the field, each player is on s/n of the match, so
//
//     break = stint × (n − s) / s
//
// Setting a stint length and a break length independently therefore
// over-determines the system. Only the break is set (it is the injury-relevant
// one), and the substitution cadence is solved from it; the stint length falls
// out. Because every player rides the same cadence, everyone gets identical
// stint and break lengths and equal total minutes by construction, rather than
// by a fairness heuristic chasing its own tail.

export function argMaxFirst(arr, keyFn) {
  let best = null, bestVal = -Infinity;
  for (const item of arr) {
    const v = keyFn(item);
    if (best === null || v > bestVal) { best = item; bestVal = v; }
  }
  return best;
}

export function argMinFirst(arr, keyFn) {
  let best = null, bestVal = Infinity;
  for (const item of arr) {
    const v = keyFn(item);
    if (best === null || v < bestVal) { best = item; bestVal = v; }
  }
  return best;
}

export function mergeSegs(segs) {
  const sorted = segs.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [s, e] of sorted) {
    if (out.length && s <= out[out.length - 1][1]) {
      out[out.length - 1][1] = Math.max(out[out.length - 1][1], e);
    } else {
      out.push([s, e]);
    }
  }
  return out;
}

export function qClock(minute, qmins) {
  if (qmins <= 0) return `${minute}'`;
  const q = Math.floor(minute / qmins);
  const remaining = qmins - (minute % qmins);
  return `Q${q + 1} ${remaining}:00`;
}

export function firstName(name) {
  name = (name || "").trim();
  return name ? name.split(/\s+/)[0] : "—";
}

/**
 * How often this position substitutes, in minutes.
 *
 * One player rotates off every `step` minutes, so a player sits out for
 * (n − s) × step and plays for s × step. We pick the whole-minute step whose
 * resulting break lands nearest the middle of the allowed window. If no whole
 * step fits inside the window at all (e.g. 4 substitutes with a 3–3 break
 * window, where breaks can only be multiples of 4), we take the closest
 * achievable and let the caller report the miss.
 */
export function rotationStep(n, slots, minBreak, maxBreak) {
  const benchCount = n - slots;
  if (benchCount <= 0) return null; // nobody to rotate with

  const lo = Math.max(1, Math.ceil(minBreak / benchCount));
  const hi = Math.floor(maxBreak / benchCount);
  const mid = (minBreak + maxBreak) / 2;

  if (hi >= lo) {
    let best = lo, bestDist = Infinity;
    for (let step = lo; step <= hi; step++) {
      const dist = Math.abs(benchCount * step - mid);
      if (dist < bestDist) { bestDist = dist; best = step; }
    }
    return best;
  }
  return Math.max(1, Math.round(mid / benchCount));
}

/** What a position will actually do, for reporting back to the coach. */
export function positionPlan(n, slots, minBreak, maxBreak) {
  const step = rotationStep(n, slots, minBreak, maxBreak);
  if (step === null) return { step: null, stint: null, breakLen: null, everyonePlays: true };
  return {
    step,
    stint: slots * step,
    breakLen: (n - slots) * step,
    everyonePlays: false,
  };
}

/**
 * The rotation itself, built rather than discovered.
 *
 * Time is cut into windows of `step` minutes. At window k the players on the
 * field are the s consecutive players starting at k (wrapping round), so each
 * window retires exactly one player and brings on exactly one. Every player
 * therefore gets the same stint (s × step) and the same break ((n − s) × step),
 * and equal minutes, by construction — no fairness heuristic involved, and the
 * on-field count is exactly right at every minute.
 */
function rollingWindow(free, slots, total, step, groupOffset) {
  const n = free.length;
  const out = {};
  const open = {};
  for (const p of free) { out[p] = []; open[p] = null; }

  // No per-position time offset. Shifting a position's substitution clock
  // knocks its cycle out of alignment with the match length, which costs the
  // equal-minutes guarantee (a 6-minute spread in testing) and produced
  // 1-minute stints at the whistle. Positions still rarely sub together
  // because each one's cadence is derived from its own squad size.
  const firstBoundary = step;
  const windowAt = (m) => (m < firstBoundary ? 0 : 1 + Math.floor((m - firstBoundary) / step));

  for (let m = 0; m < total; m++) {
    const k = windowAt(m);
    for (let i = 0; i < n; i++) {
      const onNow = ((i - k) % n + n) % n < slots;
      if (onNow && open[free[i]] === null) open[free[i]] = m;
      if (!onNow && open[free[i]] !== null) {
        out[free[i]].push([open[free[i]], m]);
        open[free[i]] = null;
      }
    }
  }
  for (const p of free) {
    if (open[p] !== null) out[p].push([open[p], total]);
    out[p] = mergeSegs(out[p]);
  }
  return out;
}

/**
 * players: player ids in squad order.
 * caps: {playerId: maxTotalMinutes | null} — injury / load caps.
 * pins: {playerId: [[start,end], ...]} — stints held exactly as given, so the
 *   rest of the position is scheduled around them.
 * Returns {playerId: [[start,end], ...]}.
 */
export function schedulePosition(players, slots, total, minBreak, maxBreak, groupOffset,
                                  caps = {}, mode = "roll", pins = {}) {
  const n = players.length;
  const out = {};
  if (n === 0) return out;

  if (mode === "split") {
    const per = total / n;
    players.forEach((p, i) => {
      const start = Math.round(i * per);
      const end = i === n - 1 ? total : Math.round((i + 1) * per);
      out[p] = [[start, end]];
    });
    return out;
  }

  const isPinned = (p) => Object.prototype.hasOwnProperty.call(pins, p);
  const pinnedIds = players.filter(isPinned);
  const free = players.filter((p) => !isPinned(p));

  for (const p of pinnedIds) out[p] = mergeSegs((pins[p] || []).map((s) => s.slice()));

  // How many slots the pinned players already occupy, minute by minute.
  const pinnedCount = new Array(total + 1).fill(0);
  for (const p of pinnedIds) {
    for (const [s, e] of out[p]) {
      for (let m = Math.max(0, s); m < Math.min(e, total); m++) pinnedCount[m] += 1;
    }
  }

  if (!free.length) return out;

  const baseSlots = Math.max(0, slots - pinnedCount[0]);
  if (baseSlots <= 0) {
    for (const p of free) out[p] = [];
    return out;
  }
  if (free.length <= baseSlots) {
    // Not enough spare players to rotate — they simply play the whole match.
    for (const p of free) out[p] = [[0, total]];
    return out;
  }

  const step = rotationStep(free.length, baseSlots, minBreak, maxBreak);

  // When the pinned players hold a steady number of slots and nobody has a
  // minutes cap, the rotation is fully determined — build it directly rather
  // than letting a minute-by-minute greedy rediscover it (which drifts at the
  // start and end of the match). The greedy below handles the awkward cases:
  // pins that come and go mid-match, and injury caps that retire a player.
  const residualSteady = pinnedCount.slice(0, total).every((c) => slots - c === baseSlots);
  const anyCaps = free.some((p) => caps[p] != null);
  if (step && residualSteady && !anyCaps) {
    const rotated = rollingWindow(free, baseSlots, total, step, groupOffset);
    for (const p of free) out[p] = rotated[p];
    return out;
  }

  const st = {};
  for (const p of free) {
    st[p] = { on: false, segOpen: null, totalOn: 0, offSince: 0, played: false, retired: false };
  }
  let onNow = [];
  const blocks = {};
  for (const p of free) blocks[p] = [];

  const stintLen = (p, m) => (st[p].on ? m - st[p].segOpen : 0);
  const breakLen = (p, m) => m - st[p].offSince;
  const underCap = (p) => caps[p] == null || st[p].totalOn < caps[p];

  const putOn = (p, m) => {
    st[p].on = true;
    st[p].segOpen = m;
    st[p].played = true;
    onNow.push(p);
  };
  const takeOff = (p, m) => {
    st[p].on = false;
    if (st[p].segOpen !== null && m > st[p].segOpen) blocks[p].push([st[p].segOpen, m]);
    st[p].segOpen = null;
    st[p].offSince = m;
    onNow.splice(onNow.indexOf(p), 1);
  };

  // A player who has not been on yet needs no recovery — the minimum break
  // protects someone who just came off, not someone still waiting for a first
  // run. Without this the opening substitution could never happen on cadence.
  const restedEnough = (p, m) => !st[p].played || breakLen(p, m) >= minBreak;

  const candidates = (m, relaxed) =>
    free.filter((p) => !st[p].on && !st[p].retired && underCap(p) && (relaxed || restedEnough(p, m)));

  // Equal minutes is the goal, so the player with the least time on comes on
  // and the player with the most goes off; break and stint length break ties.
  const pickComer = (m, relaxed = false) => {
    const pool = candidates(m, relaxed);
    if (!pool.length) return null;
    return argMinFirst(pool, (p) => st[p].totalOn * 1000 - breakLen(p, m));
  };
  const pickLeaver = (m, minStint = 0) => {
    const pool = onNow.filter((p) => stintLen(p, m) >= minStint);
    if (!pool.length) return null;
    return argMaxFirst(pool, (p) => st[p].totalOn * 1000 + stintLen(p, m));
  };

  for (let m = 0; m <= total; m++) {
    const pinnedNow = pinnedCount[Math.min(m, Math.max(0, total - 1))] || 0;
    const need = Math.max(0, slots - pinnedNow);

    // 1) Injury caps retire a player outright.
    for (const p of [...onNow]) {
      if (caps[p] != null && st[p].totalOn >= caps[p]) {
        takeOff(p, m);
        st[p].retired = true;
      }
    }

    // 2) Nobody may sit longer than the maximum break.
    if (m > 0 && m < total) {
      const overdue = free.filter(
        (p) => !st[p].on && !st[p].retired && st[p].played && underCap(p) && breakLen(p, m) >= maxBreak
      );
      for (const p of overdue) {
        if (onNow.length < need) { putOn(p, m); continue; }
        const lv = pickLeaver(m);
        if (lv != null) { takeOff(lv, m); putOn(p, m); }
      }
    }

    // 3) Hold the on-field count exactly, including when a pin starts or ends.
    while (onNow.length > need) {
      const lv = pickLeaver(m);
      if (lv == null) break;
      takeOff(lv, m);
    }
    while (onNow.length < need) {
      const cm = pickComer(m) ?? pickComer(m, true); // relax rest before leaving a slot empty
      if (cm == null) break;
      putOn(cm, m);
    }

    // 4) The rotation itself: one player off, one on, every `step` minutes.
    //    Staggered per position so the whole team doesn't change at once.
    if (step && m > 0 && m < total && (m - groupOffset) % step === 0) {
      const cm = pickComer(m);
      if (cm != null) {
        const lv = pickLeaver(m, step); // never cut a stint shorter than one cadence
        if (lv != null && lv !== cm && st[lv].totalOn >= st[cm].totalOn) {
          takeOff(lv, m);
          putOn(cm, m);
        }
      }
    }

    if (m < total) {
      for (const p of onNow) st[p].totalOn += 1;
    }
  }

  for (const p of [...onNow]) {
    if (st[p].segOpen !== null && total > st[p].segOpen) blocks[p].push([st[p].segOpen, total]);
  }
  for (const p of free) out[p] = mergeSegs(blocks[p]);
  return out;
}

/**
 * squad: [{id, name, number}]
 * assign: {playerId: positionName}
 * positions: [{name, onField, mode}]
 * locks: {playerId: bool} — iron players, pinned to the whole match.
 * pins: {playerId: [[s,e], ...]} — stints held through a regenerate.
 */
export function buildSchedule(squad, assign, positions, total, minBreak, maxBreak,
                               caps = {}, locks = {}, pins = {}) {
  const schedule = {};
  for (const p of squad) schedule[p.id] = [];
  let rollingIdx = 0;

  for (const pos of positions) {
    const members = squad.filter((p) => assign[p.id] === pos.name);
    if (!members.length) continue;
    const mode = pos.mode || "roll";
    let offset = 0;
    if (mode === "roll") {
      offset = rollingIdx;
      rollingIdx += 1;
    }

    // An iron player is just a pin covering the whole match.
    const posPins = {};
    for (const p of members) {
      if (pins[p.id] && pins[p.id].length) posPins[p.id] = pins[p.id];
      else if (locks[p.id]) posPins[p.id] = [[0, total]];
    }

    const res = schedulePosition(
      members.map((p) => p.id),
      Number(pos.onField),
      total,
      minBreak,
      maxBreak,
      offset,
      caps,
      mode,
      posPins
    );
    for (const [pid, segs] of Object.entries(res)) schedule[pid] = segs;
  }
  return schedule;
}

/**
 * Pairs players who swap at the same minute within a position -> sub timeline.
 * Returns [{minute, pos, in, out}], sorted by minute then position order.
 */
export function subEvents(schedule, assign, positions) {
  const posOrder = {};
  positions.forEach((p, i) => (posOrder[p.name] = i));

  const starts = {}, ends = {};
  for (const [pid, segs] of Object.entries(schedule)) {
    for (const [s, e] of segs) {
      (starts[s] ??= []).push(pid);
      (ends[e] ??= []).push(pid);
    }
  }
  const minutes = [...new Set([...Object.keys(starts), ...Object.keys(ends)].map(Number))].sort(
    (a, b) => a - b
  );

  const events = [];
  for (const minute of minutes) {
    if (minute === 0) continue;
    const ins = starts[minute] || [];
    const outs = ends[minute] || [];
    for (const pos of positions) {
      const pin = ins.filter((p) => assign[p] === pos.name);
      const pout = outs.filter((p) => assign[p] === pos.name);
      const k = Math.min(pin.length, pout.length);
      for (let i = 0; i < k; i++) {
        events.push({ minute, pos: pos.name, in: pin[i], out: pout[i] });
      }
    }
  }
  events.sort((a, b) => a.minute - b.minute || (posOrder[a.pos] ?? 99) - (posOrder[b.pos] ?? 99));
  return events;
}

/** Per-minute on-field count across all positions, for the sanity check. */
export function onFieldCounts(schedule, total) {
  const counts = new Array(total).fill(0);
  for (const segs of Object.values(schedule)) {
    for (const [s, e] of segs) {
      for (let m = s; m < e && m < total; m++) counts[m] += 1;
    }
  }
  return counts;
}
