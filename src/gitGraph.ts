/**
 * Client-side commit graph lanes (topo order: children before parents).
 * Simplified from OpenIDEA's graph.ts / classic `git log --graph` layout.
 */

export interface GraphSegment {
  /** Lane at top (for up) or node (for down). */
  from: number;
  /** Lane at node (for up) or bottom (for down). */
  to: number;
  color: number;
}

export interface GraphRow {
  id: string;
  lane: number;
  color: number;
  up: GraphSegment[];
  down: GraphSegment[];
  width: number;
}

export const GRAPH_COLORS = [
  "#e6b422", // gold
  "#73bd79", // green
  "#70aeff", // blue
  "#c678dd", // purple
  "#e88f89", // coral
  "#56b6c2", // cyan
  "#d19a66", // orange
  "#61afef", // sky
  "#98c379", // lime
  "#e06c75", // red
];

export function graphColor(index: number): string {
  return GRAPH_COLORS[index % GRAPH_COLORS.length]!;
}

interface Lane {
  id: string;
  color: number;
}

/**
 * Build one GraphRow per commit. Commits must be in log order (newest first).
 */
export function buildCommitGraph(
  commits: ReadonlyArray<{ id: string; parents: readonly string[] }>,
): GraphRow[] {
  const lanes: Array<Lane | null> = [];
  let nextColor = 0;
  const rows: GraphRow[] = [];

  const firstFree = () => {
    for (let i = 0; i < lanes.length; i++) if (!lanes[i]) return i;
    return lanes.length;
  };

  const slotsOf = (id: string): number[] => {
    const out: number[] = [];
    for (let i = 0; i < lanes.length; i++) if (lanes[i]?.id === id) out.push(i);
    return out;
  };

  for (const c of commits) {
    const matching = slotsOf(c.id);
    let lane: number;
    let color: number;
    if (matching.length) {
      lane = matching[0]!;
      color = lanes[lane]!.color;
    } else {
      lane = firstFree();
      color = nextColor++;
      while (lanes.length <= lane) lanes.push(null);
    }

    const widthBefore = lanes.length;

    // Lines entering this row from above
    const up: GraphSegment[] = [];
    for (let i = 0; i < lanes.length; i++) {
      const l = lanes[i];
      if (!l) continue;
      up.push({ from: i, to: l.id === c.id ? lane : i, color: l.color });
    }

    // Clear lanes that pointed at this commit (merged into node)
    for (const m of matching) lanes[m] = null;
    if (lane < lanes.length) lanes[lane] = null;
    else while (lanes.length <= lane) lanes.push(null);

    // Pass-through lines (other active lanes) going down
    const down: GraphSegment[] = [];
    for (let i = 0; i < lanes.length; i++) {
      const l = lanes[i];
      if (!l) continue;
      down.push({ from: i, to: i, color: l.color });
    }

    c.parents.forEach((p, k) => {
      if (k === 0) {
        // First parent continues this lane's color
        while (lanes.length <= lane) lanes.push(null);
        lanes[lane] = { id: p, color };
        down.push({ from: lane, to: lane, color });
        return;
      }
      const existing = slotsOf(p)[0] ?? -1;
      if (existing >= 0) {
        down.push({ from: lane, to: existing, color: lanes[existing]!.color });
        return;
      }
      const slot = firstFree();
      const col = nextColor++;
      while (lanes.length <= slot) lanes.push(null);
      lanes[slot] = { id: p, color: col };
      down.push({ from: lane, to: slot, color: col });
    });

    // Trim trailing empty lanes
    while (lanes.length && !lanes[lanes.length - 1]) lanes.pop();

    const widthAfter = down.reduce((w, s) => Math.max(w, s.to + 1, s.from + 1), 0);
    rows.push({
      id: c.id,
      lane,
      color,
      up,
      down,
      width: Math.max(widthBefore, widthAfter, lane + 1, 1),
    });
  }

  return rows;
}
