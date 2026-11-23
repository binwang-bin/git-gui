import { graphColor, type GraphRow, type GraphSegment } from "../gitGraph";

const LANE = 14;
const ROW_H = 24;
const R = 3.5;
const PAD = 6;

function pathFor(seg: GraphSegment, half: "up" | "down"): string {
  const midY = ROW_H / 2;
  if (half === "up") {
    const x0 = PAD + seg.from * LANE + LANE / 2;
    const x1 = PAD + seg.to * LANE + LANE / 2;
    if (seg.from === seg.to) {
      return `M ${x0} 0 L ${x1} ${midY}`;
    }
    // Curve into the node
    const cy = midY * 0.35;
    return `M ${x0} 0 L ${x0} ${cy} Q ${x0} ${midY} ${x1} ${midY}`;
  }
  const x0 = PAD + seg.from * LANE + LANE / 2;
  const x1 = PAD + seg.to * LANE + LANE / 2;
  if (seg.from === seg.to) {
    return `M ${x0} ${midY} L ${x1} ${ROW_H}`;
  }
  const cy = midY + (ROW_H - midY) * 0.65;
  return `M ${x0} ${midY} Q ${x0} ${cy} ${x1} ${cy} L ${x1} ${ROW_H}`;
}

export function CommitGraphCell(props: { row: GraphRow }) {
  const { row } = props;
  const w = PAD * 2 + Math.max(row.width, 1) * LANE;
  const cx = PAD + row.lane * LANE + LANE / 2;
  const cy = ROW_H / 2;
  const nodeColor = graphColor(row.color);

  return (
    <svg
      className="commit-graph"
      width={w}
      height={ROW_H}
      viewBox={`0 0 ${w} ${ROW_H}`}
      aria-hidden
    >
      {row.up.map((s, i) => (
        <path
          key={`u-${i}`}
          d={pathFor(s, "up")}
          fill="none"
          stroke={graphColor(s.color)}
          strokeWidth={1.6}
          strokeLinecap="round"
        />
      ))}
      {row.down.map((s, i) => (
        <path
          key={`d-${i}`}
          d={pathFor(s, "down")}
          fill="none"
          stroke={graphColor(s.color)}
          strokeWidth={1.6}
          strokeLinecap="round"
        />
      ))}
      <circle cx={cx} cy={cy} r={R} fill={nodeColor} stroke={nodeColor} strokeWidth={1} />
    </svg>
  );
}
