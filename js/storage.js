// localStorage persistence for rosters/settings, so a coach doesn't lose
// data between sessions on the sideline.

const KEY = "fhm_state_v1";

// Categorical palette for position colours, in fixed slot order — validated
// with the data-viz six checks against a white chart surface (all adjacent
// pairs clear the CVD and normal-vision floors). The previous ad-hoc palette
// failed: red vs orange measured ΔE 10.4, under the 15 floor, so full-colour
// readers could not reliably tell two positions apart.
// Order is never cycled; a 9th position takes the neutral slot instead.
export const PALETTE = [
  "#2a78d6", // blue
  "#eb6834", // orange
  "#1baf7a", // aqua
  "#eda100", // yellow
  "#e87ba4", // magenta
  "#008300", // green
  "#4a3aa7", // violet
  "#e34948", // red
];
export const PALETTE_OTHER = "#7d8a83";

export const DEFAULT_POSITIONS = [
  { name: "GK", onField: 1, mode: "split" },
  { name: "Defence", onField: 4, mode: "roll" },
  { name: "Midfield", onField: 3, mode: "roll" },
  { name: "Attack", onField: 3, mode: "roll" },
];

export const TEST_SQUAD_NAMES = [
  "Sarah Johnson", "Emma Clarke", "Olivia Wright", "Mia Thompson",
  "Ava Robinson", "Isla Harris", "Grace Martin", "Ruby Scott",
  "Zoe Wilson", "Lily Anderson", "Sophie White", "Chloe Davies",
  "Freya Evans", "Poppy Turner", "Imogen Baker", "Amber Phillips",
];

function defaultState() {
  return {
    version: 1,
    nextId: 1,
    squad: [],
    positions: DEFAULT_POSITIONS.map((p) => ({ ...p })),
    match: { periods: 4, perLen: 15, maxOff: 6, targetOff: 3, minStart: 3, maxStint: 0 },
    roster: {}, // playerId -> {available, position, maxMin, weight, lock}
    schedule: null, // playerId -> [[s,e],...]
    assign: null, // playerId -> positionName
    scheduleEdited: false, // true once a stint has been dragged or hand-edited
  };
}

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    const merged = { ...defaultState(), ...parsed };
    merged.match = { ...defaultState().match, ...(parsed.match || {}) };
    return merged;
  } catch (e) {
    console.warn("Failed to load saved state, starting fresh.", e);
    return defaultState();
  }
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.warn("Failed to save state to localStorage.", e);
  }
}

export function getState() {
  return state;
}

export function newId() {
  const id = `p${state.nextId}`;
  state.nextId += 1;
  persist();
  return id;
}

export function updateState(mutator) {
  mutator(state);
  persist();
}

export function resetAll() {
  state = defaultState();
  persist();
}
