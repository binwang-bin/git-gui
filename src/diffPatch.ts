/** Build a minimal unified patch for applying selected hunk/line changes. */

export type PatchLine = { kind: string; text: string };

export function buildHunkPatch(
  path: string,
  header: string,
  lines: PatchLine[],
): string {
  const body = lines
    .map((l) => {
      if (l.kind === "add") return `+${l.text}`;
      if (l.kind === "del") return `-${l.text}`;
      return ` ${l.text}`;
    })
    .join("\n");
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${header}\n${body}\n`;
}

/** Patch containing a single add or del line (with surrounding context if provided). */
export function buildLinePatch(
  path: string,
  hunkHeader: string,
  lines: PatchLine[],
  lineIndex: number,
): string | null {
  const target = lines[lineIndex];
  if (!target || (target.kind !== "add" && target.kind !== "del")) return null;

  // Include context lines for a more reliable apply; keep only this change line.
  const selected: PatchLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.kind === "context" || l.kind === "") {
      selected.push({ kind: "context", text: l.text });
    } else if (i === lineIndex) {
      selected.push(l);
    } else if (l.kind === "add" || l.kind === "del") {
      // skip other change lines
    } else {
      selected.push({ kind: "context", text: l.text });
    }
  }

  // Recount hunk header roughly: use unidiff-zero style with start from original.
  const m = hunkHeader.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
  const oldStart = m ? Number(m[1]) : 1;
  const newStart = m ? Number(m[3]) : 1;
  let oldCount = 0;
  let newCount = 0;
  for (const l of selected) {
    if (l.kind === "del") oldCount += 1;
    else if (l.kind === "add") newCount += 1;
    else {
      oldCount += 1;
      newCount += 1;
    }
  }
  const header = `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`;
  return buildHunkPatch(path, header, selected);
}

export type SideRow = {
  oldLn: number | null;
  newLn: number | null;
  left: string;
  right: string;
  leftKind: "del" | "context" | "empty";
  rightKind: "add" | "context" | "empty";
  /** Index into hunk.lines for change rows (for line ops). */
  lineIndex: number | null;
  changeKind: "add" | "del" | null;
};

/** Expand a hunk into side-by-side rows. */
export function hunkToSideRows(
  lines: PatchLine[],
  oldStart: number,
  newStart: number,
): SideRow[] {
  const rows: SideRow[] = [];
  let oldLn = oldStart;
  let newLn = newStart;
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.kind === "del") {
      const dels: number[] = [];
      while (i < lines.length && lines[i].kind === "del") {
        dels.push(i);
        i++;
      }
      const adds: number[] = [];
      while (i < lines.length && lines[i].kind === "add") {
        adds.push(i);
        i++;
      }
      const n = Math.max(dels.length, adds.length);
      for (let k = 0; k < n; k++) {
        const di = dels[k];
        const ai = adds[k];
        rows.push({
          oldLn: di != null ? oldLn++ : null,
          newLn: ai != null ? newLn++ : null,
          left: di != null ? lines[di].text : "",
          right: ai != null ? lines[ai].text : "",
          leftKind: di != null ? "del" : "empty",
          rightKind: ai != null ? "add" : "empty",
          lineIndex: di ?? ai ?? null,
          changeKind: di != null ? "del" : ai != null ? "add" : null,
        });
      }
    } else if (l.kind === "add") {
      rows.push({
        oldLn: null,
        newLn: newLn++,
        left: "",
        right: l.text,
        leftKind: "empty",
        rightKind: "add",
        lineIndex: i,
        changeKind: "add",
      });
      i++;
    } else {
      rows.push({
        oldLn: oldLn++,
        newLn: newLn++,
        left: l.text,
        right: l.text,
        leftKind: "context",
        rightKind: "context",
        lineIndex: null,
        changeKind: null,
      });
      i++;
    }
  }
  return rows;
}
