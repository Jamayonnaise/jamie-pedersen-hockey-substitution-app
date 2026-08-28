// localStorage persistence for rosters/settings, so a coach doesn't lose
// data between sessions on the sideline.

const KEY = "fhm_state_v1";

export const PALETTE = [
  "#d946ef", "#f97316", "#22c55e", "#ef4444", "#3b82f6",
  "#14b8a6", "#a855f7", "#eab308", "#ec4899", "#0ea5e9",
];

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
