/**
 * Change lists (OpenIDEA-style). Persisted per project in localStorage.
 * Every changed/conflicted file belongs to exactly one list; new files join the active list.
 */
import { create } from "zustand";

export const DEFAULT_LIST_ID = "default";
export const DEFAULT_LIST_NAME = "Changes";

export type Changelist = { id: string; name: string; comment: string };

export type ChangelistState = {
  lists: Changelist[];
  active: string;
  files: Record<string, string>;
};

export function initialChangelists(): ChangelistState {
  return {
    lists: [{ id: DEFAULT_LIST_ID, name: DEFAULT_LIST_NAME, comment: "" }],
    active: DEFAULT_LIST_ID,
    files: {},
  };
}

function storageKey(root: string): string {
  return `idevcs.changelists.${root.replace(/\\/g, "/")}`;
}

export function loadChangelists(root: string): ChangelistState {
  try {
    const raw = localStorage.getItem(storageKey(root));
    if (!raw) return initialChangelists();
    const parsed = JSON.parse(raw) as ChangelistState;
    if (!parsed?.lists?.length) return initialChangelists();
    return {
      lists: parsed.lists,
      active: parsed.active || DEFAULT_LIST_ID,
      files: parsed.files ?? {},
    };
  } catch {
    return initialChangelists();
  }
}

export function saveChangelists(root: string, state: ChangelistState): void {
  localStorage.setItem(storageKey(root), JSON.stringify(state));
}

export function listOf(state: ChangelistState, rel: string): string {
  const id = state.files[rel];
  return id && state.lists.some((l) => l.id === id) ? id : state.active;
}

/** Pin new paths to active; drop gone paths. Returns null when unchanged. */
export function syncAssignments(
  state: ChangelistState,
  changed: readonly string[],
): ChangelistState | null {
  const live = new Set(changed);
  const files: Record<string, string> = {};
  let dirty = false;
  for (const [rel, id] of Object.entries(state.files)) {
    if (live.has(rel) && state.lists.some((l) => l.id === id)) files[rel] = id;
    else dirty = true;
  }
  for (const rel of changed) {
    if (!(rel in files)) {
      files[rel] = state.active;
      dirty = true;
    }
  }
  return dirty ? { ...state, files } : null;
}

export function validateListName(
  state: ChangelistState,
  name: string,
  exceptId?: string,
): string | null {
  const n = name.trim();
  if (!n) return "Name must not be empty";
  if (state.lists.some((l) => l.id !== exceptId && l.name.toLowerCase() === n.toLowerCase())) {
    return `A changelist named '${n}' already exists`;
  }
  return null;
}

function newId(state: ChangelistState): string {
  let id: string;
  do {
    id = `cl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  } while (state.lists.some((l) => l.id === id));
  return id;
}

export function addList(
  state: ChangelistState,
  name: string,
  opts: { comment?: string; makeActive?: boolean } = {},
): { state: ChangelistState; id: string } {
  const id = newId(state);
  const list: Changelist = { id, name: name.trim(), comment: opts.comment ?? "" };
  return {
    id,
    state: {
      ...state,
      lists: [...state.lists, list],
      active: opts.makeActive ? id : state.active,
    },
  };
}

export function editList(
  state: ChangelistState,
  id: string,
  name: string,
  comment: string,
): ChangelistState {
  return {
    ...state,
    lists: state.lists.map((l) => (l.id === id ? { ...l, name: name.trim(), comment } : l)),
  };
}

export function setActiveList(state: ChangelistState, id: string): ChangelistState {
  return state.lists.some((l) => l.id === id) ? { ...state, active: id } : state;
}

export function removeList(state: ChangelistState, id: string): ChangelistState {
  if (id === state.active || id === DEFAULT_LIST_ID || !state.lists.some((l) => l.id === id)) {
    return state;
  }
  const files = Object.fromEntries(
    Object.entries(state.files).map(([rel, lid]) => [rel, lid === id ? state.active : lid]),
  );
  return { ...state, lists: state.lists.filter((l) => l.id !== id), files };
}

export function moveFiles(
  state: ChangelistState,
  rels: readonly string[],
  id: string,
): ChangelistState {
  if (!state.lists.some((l) => l.id === id)) return state;
  const files = { ...state.files };
  for (const rel of rels) files[rel] = id;
  return { ...state, files };
}

type ClStore = {
  root: string | null;
  state: ChangelistState;
  load: (root: string) => void;
  update: (fn: (s: ChangelistState) => ChangelistState) => void;
  syncFromStatus: (changedRels: string[]) => void;
};

export const useChangelists = create<ClStore>((set, get) => ({
  root: null,
  state: initialChangelists(),
  load: (root) => {
    set({ root, state: loadChangelists(root) });
  },
  update: (fn) => {
    const { root, state } = get();
    const next = fn(state);
    if (next === state) return;
    set({ state: next });
    if (root) saveChangelists(root, next);
  },
  syncFromStatus: (changedRels) => {
    const { root, state } = get();
    const next = syncAssignments(state, changedRels);
    if (!next) return;
    set({ state: next });
    if (root) saveChangelists(root, next);
  },
}));
