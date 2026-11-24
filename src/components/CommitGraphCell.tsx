/**
 * OpenIDEA `log/GraphCell.tsx` (non-interactive paint path).
 * Lane geometry and stroke style must stay identical to OpenIDEA.
 */
import { LANE, ROW, laneColor, type GraphRow, type GraphSegment } from "../gitGraph";

export function x(lane: number) {
  return LANE / 2 + lane * LANE;
}

/** Straight, also across lanes (IDEA's diagonal edges). */
function seg(fromX: number, fromY: number, toX: number, toY: number) {
  return `M${fromX} ${fromY}L${toX} ${toY}`;
}

/** Arrow head at (`px`, `py`) pointing up (`dir` -1) or down (1): a long edge continues. */
function arrowHead(px: number, py: number, dir: 1 | -1) {
  const back = py - dir * 4;
  return `M${px - 3} ${back}L${px} ${py}L${px + 3} ${back}`;
}

export function CommitGraphCell(props: {
  row: GraphRow;
  head?: boolean;
  height?: number;
}) {
  const { row, head } = props;
  const height = props.height ?? ROW;
  const cy = height / 2;
  const width = Math.max(row.width, 1) * LANE;
  const draw = (s: GraphSegment, i: number, up: boolean) => {
    const fromX = x(s.fromX ?? s.from);
    const toX = x(s.toX ?? s.to);
    const path =
      seg(fromX, up ? 0 : cy, toX, up ? cy : height) +
      (s.arrow ? arrowHead(up ? fromX : toX, up ? 0 : height, up ? -1 : 1) : "");
    return (
      <path
        key={`${up ? "u" : "d"}${i}`}
        d={path}
        stroke={laneColor(s.color)}
        strokeWidth={1.4}
        pointerEvents="none"
        strokeLinecap={s.dashed ? "butt" : "square"}
        strokeDasharray={s.dashed ? "2 2" : undefined}
      />
    );
  };
  return (
    <svg className="commit-graph" width={width} height={height} aria-hidden>
      {row.up.map((s, i) => draw(s, i, true))}
      {row.down.map((s, i) => draw(s, i, false))}
      <circle
        cx={x(row.lane)}
        cy={cy}
        r={head ? 5 : 3.8}
        fill={head ? "var(--bg-app)" : laneColor(row.color)}
        stroke={laneColor(row.color)}
        strokeWidth={head ? 1.5 : 0}
        pointerEvents="none"
      />
      {head && (
        <circle
          cx={x(row.lane)}
          cy={cy}
          r={2.5}
          fill={laneColor(row.color)}
          pointerEvents="none"
        />
      )}
    </svg>
  );
}
