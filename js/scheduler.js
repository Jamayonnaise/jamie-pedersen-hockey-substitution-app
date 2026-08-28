// Rotation scheduler — ported line-for-line from the Streamlit app's
// schedule_position / build_schedule / sub_events (streamlit_app.py).
//
// Behavioural invariants preserved from the source:
//   - Max bench time is a HARD guarantee via forced return (leaverHard),
//     independent of priority weight.
//   - Priority weight only softens routine wave swaps (leaverSoft);
//     it can never block a forced return or a cap-out.
//   - Injury cap is a hard ceiling -> permanent retirement, with an
//     emergency fallback so a slot is never left empty.
//   - Lock removes a player from the rotation maths entirely.
//   - Split mode ignores weight/cap/lock, exactly as upstream.
//   - Tie-breaks match Python's max()/min(): first item hit wins ties.

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
 * players: array of player ids (squad order).
 * caps/weights/locks: {playerId: value} maps.
 * minStart: minimum minutes a starting-lineup player must stay on before
 *   being eligible for a routine (non-forced) substitution.
 * Returns {playerId: [[start,end], ...]}.
 */
export function schedulePosition(players, slots, total, maxOff, targetOff, groupOffset,
                                  caps, weights, locks, mode = "roll", minStart = 0) {
  const n = players.length;
  const out = {};
  if (n === 0) return out;

  if (n <= slots) {
    for (const p of players) out[p] = [[0, total]];
    return out;
  }

  if (mode === "split") {
    const per = total / n;
    players.forEach((p, i) => {
      const start = Math.round(i * per);
      const end = i === n - 1 ? total : Math.round((i + 1) * per);
      out[p] = [[start, end]];
    });
    return out;
  }

  const locked = players.filter((p) => locks[p]);
  const rot = players.filter((p) => !locks[p]);
  const rotSlots = slots - locked.length;

  for (const p of locked) out[p] = [[0, total]];

  if (rotSlots <= 0) {
    for (const p of rot) out[p] = [];
    return out;
  }
  if (rot.length <= rotSlots) {
    for (const p of rot) out[p] = [[0, total]];
    return out;
  }

  const initBench = rot.length - rotSlots;
  const W = Math.max(1, Math.min(Math.floor(maxOff / initBench), Math.max(1, targetOff)));

  let on = rot.slice(0, rotSlots);
  let bench = rot.slice(rotSlots);
  const active = new Set(rot);
  const onTime = {}, offRun = {}, segOpen = {}, blocks = {};
  for (const p of rot) {
    onTime[p] = 0;
    offRun[p] = 0;
    segOpen[p] = on.includes(p) ? 0 : null;
    blocks[p] = [];
  }

  const underCap = (p) => caps[p] == null || onTime[p] < caps[p];

  const close = (p, m) => {
    if (segOpen[p] !== null) {
      blocks[p].push([segOpen[p], m]);
      segOpen[p] = null;
    }
  };
  const putOn = (p, m) => {
    on.push(p);
    bench.splice(bench.indexOf(p), 1);
    offRun[p] = 0;
    segOpen[p] = m;
  };
  const takeOff = (p, m, retire = false) => {
    on.splice(on.indexOf(p), 1);
    bench.push(p);
    close(p, m);
    if (retire) active.delete(p);
  };
  const comer = () => {
    const pool = bench.filter((q) => active.has(q) && underCap(q));
    return pool.length ? argMaxFirst(pool, (q) => offRun[q]) : null;
  };
  // No stint — the opening kickoff stint or any later one — may be cut short by a
  // routine swap before it reaches minStart minutes. Measured against the current
  // stint's own start (segOpen), not cumulative on-time, so it applies uniformly
  // every time a player comes on, not just at kickoff.
  const stintElapsed = (q, minute) => (segOpen[q] === null ? Infinity : minute - segOpen[q]);
  const isProtected = (q, minute) => stintElapsed(q, minute) < minStart;
  const leaverSoft = (minute) => {
    if (!on.length) return null;
    const eligible = on.filter((q) => !isProtected(q, minute));
    return eligible.length ? argMaxFirst(eligible, (q) => onTime[q] / (weights[q] ?? 1.0)) : null;
  };
  // Forced return enforces the HARD max-bench guarantee, so it may override
  // the minimum-stint protection as a last resort if nobody else qualifies.
  const leaverHard = (minute) => {
    if (!on.length) return null;
    const eligible = on.filter((q) => !isProtected(q, minute));
    const pool = eligible.length ? eligible : on;
    return argMaxFirst(pool, (q) => onTime[q]);
  };

  for (let minute = 0; minute <= total; minute++) {
    // 1) cap-outs: anyone who hit their max retires; replacement comes on.
    for (const p of on.filter((q) => caps[q] != null && onTime[q] >= caps[q])) {
      const rep = comer();
      takeOff(p, minute, true);
      if (rep) {
        putOn(rep, minute);
      } else {
        const fbPool = bench.filter((q) => q !== p);
        const fb = fbPool.length ? argMinFirst(fbPool, (q) => onTime[q]) : null;
        if (fb != null) {
          active.add(fb);
          putOn(fb, minute);
        }
      }
    }
    // 2) forced return: about to breach max bench time -> comes on now.
    if (minute > 0) {
      for (const p of bench.filter((q) => active.has(q) && offRun[q] >= maxOff)) {
        const lv = leaverHard(minute);
        if (lv != null) {
          takeOff(lv, minute);
          putOn(p, minute);
        }
      }
    }
    // 3) routine wave swap at this group's staggered window. Skipped once too
    // little match time remains for an incoming player to get a full minStart stint.
    if (minute > 0 && minute < total && (minute - groupOffset) % W === 0 && total - minute >= minStart) {
      const cm = comer();
      if (cm != null) {
        const lv = leaverSoft(minute);
        if (lv != null && onTime[lv] >= onTime[cm]) {
          takeOff(lv, minute);
          putOn(cm, minute);
        }
      }
    }
    // 4) accrue the minute.
    if (minute < total) {
      for (const p of on) onTime[p] += 1;
      for (const p of bench) if (active.has(p)) offRun[p] += 1;
    }
  }

  for (const p of on) close(p, total);

  const res = {};
  for (const p of locked) res[p] = [[0, total]];
  for (const p of rot) res[p] = mergeSegs(blocks[p]);
  return res;
}

/**
 * squad: [{id, name, number}]
 * assign: {playerId: positionName}
 * positions: [{name, onField, mode}]
 * Returns {playerId: [[start,end], ...]}
 */
export function buildSchedule(squad, assign, positions, total, maxOff, targetOff,
                               caps, weights, locks, minStart = 0) {
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
    const res = schedulePosition(
      members.map((p) => p.id),
      Number(pos.onField),
      total,
      maxOff,
      targetOff,
      offset,
      caps,
      weights,
      locks,
      mode,
      minStart
    );
    for (const [pid, segs] of Object.entries(res)) {
      schedule[pid] = segs;
    }
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
