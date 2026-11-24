/**
 * Per-change Accept / Ignore / auto-resolve controls (OpenIDEA mergeGutters, simplified icons).
 */
import { RangeSetBuilder, StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  GutterMarker,
  WidgetType,
  gutter,
  type ViewUpdate,
} from "@codemirror/view";
import {
  canResolveAutomatically,
  changesSide,
  isConflict,
  isResolved,
  mergeField,
  type MergeChange,
  type MergeSide,
} from "./mergeModel";

export interface MergeControls {
  accept(index: number, side: MergeSide, resolve: boolean): void;
  ignore(index: number, side: MergeSide, resolve: boolean): void;
  resolveAutomatically(index: number): void;
}

export const syncSide = StateEffect.define<readonly MergeChange[]>();

const sideChanges = StateField.define<readonly MergeChange[]>({
  create: () => [],
  update(value, tr) {
    for (const e of tr.effects) if (e.is(syncSide)) return e.value;
    return value;
  },
});

function button(className: string, title: string, label: string, press: (e: MouseEvent) => void) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.title = title;
  b.setAttribute("aria-label", title);
  b.textContent = label;
  b.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  b.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    press(e);
  });
  return b;
}

class SideMarker extends GutterMarker {
  constructor(
    readonly index: number,
    readonly side: MergeSide,
    readonly oneside: boolean,
    readonly controls: MergeControls,
  ) {
    super();
  }
  eq(other: SideMarker) {
    return other.index === this.index && other.side === this.side && other.oneside === this.oneside;
  }
  toDOM() {
    const box = document.createElement("div");
    box.className = "cm-merge-ops";
    const arrow = this.side === "left" ? (this.oneside ? "↘" : "→") : this.oneside ? "↙" : "←";
    box.append(
      button("cm-merge-op cm-merge-accept", "Accept (Ctrl/⌘ to resolve with this side)", arrow, (e) =>
        this.controls.accept(this.index, this.side, e.metaKey || e.ctrlKey),
      ),
      button("cm-merge-op cm-merge-ignore", "Ignore (Ctrl/⌘ to ignore both)", "×", (e) =>
        this.controls.ignore(this.index, this.side, e.metaKey || e.ctrlKey),
      ),
    );
    return box;
  }
}

export function sideControls(side: MergeSide, controls: MergeControls): Extension {
  return [
    sideChanges,
    gutter({
      class: "cm-merge-gutter",
      lineMarker(view, line) {
        const doc = view.state.doc;
        const changes = view.state.field(sideChanges);
        const index = changes.findIndex((c) => {
          if (!changesSide(c, side) || c.done[side]) return false;
          const from = (side === "left" ? c.leftRange : c.rightRange)[0];
          return doc.lineAt(Math.min(from, doc.length)).from === line.from;
        });
        return index < 0 ? null : new SideMarker(index, side, changes[index]!.oneside, controls);
      },
      lineMarkerChange: (update) => update.transactions.some((tr) => tr.effects.some((e) => e.is(syncSide))),
    }),
  ];
}

class WandMarker extends GutterMarker {
  constructor(
    readonly index: number,
    readonly controls: MergeControls,
  ) {
    super();
  }
  eq(other: WandMarker) {
    return other.index === this.index;
  }
  toDOM() {
    const box = document.createElement("div");
    box.className = "cm-merge-ops";
    box.append(
      button("cm-merge-op cm-merge-wand", "Resolve Automatically", "✦", () =>
        this.controls.resolveAutomatically(this.index),
      ),
    );
    return box;
  }
}

export const mergeChanged = (u: ViewUpdate) =>
  u.docChanged || u.startState.field(mergeField) !== u.state.field(mergeField);

export function resultControls(controls: MergeControls): Extension {
  return gutter({
    class: "cm-merge-gutter",
    lineMarker(view, line) {
      const doc = view.state.doc;
      const found = view.state
        .field(mergeField)
        .findIndex(
          (c) =>
            isConflict(c) &&
            canResolveAutomatically(doc, c, "base") &&
            doc.lineAt(Math.min(c.from, doc.length)).from === line.from,
        );
      return found < 0 ? null : new WandMarker(found, controls);
    },
    lineMarkerChange: mergeChanged,
  });
}

class PointWidget extends WidgetType {
  constructor(readonly className: string) {
    super();
  }
  eq(other: PointWidget) {
    return other.className === this.className;
  }
  toDOM() {
    const el = document.createElement("div");
    el.className = `cm-merge-point ${this.className}`;
    return el;
  }
}

export const resultMarks = EditorView.decorations.compute([mergeField], (state) => {
  const out = new RangeSetBuilder<Decoration>();
  const doc = state.doc;
  for (const c of state.field(mergeField)) {
    const className = isResolved(c)
      ? "cm-merge-resolved"
      : isConflict(c)
        ? "cm-merge-conflict"
        : "cm-merge-change";
    if (c.to > c.from) {
      const last = doc.lineAt(c.to - 1).number;
      for (let n = doc.lineAt(c.from).number; n <= last; n++)
        out.add(doc.line(n).from, doc.line(n).from, Decoration.line({ class: className }));
    } else if (!isResolved(c)) {
      out.add(c.from, c.from, Decoration.widget({ widget: new PointWidget(className), block: true, side: -1 }));
    }
  }
  return out.finish();
});

export const mergeTheme = EditorView.baseTheme({
  ".cm-merge-gutter": { minWidth: "34px" },
  ".cm-merge-ops": { display: "flex", alignItems: "center", justifyContent: "center", height: "100%", gap: "1px" },
  ".cm-merge-op": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "16px",
    height: "16px",
    padding: 0,
    border: "none",
    borderRadius: "3px",
    color: "var(--fg-secondary)",
    background: "transparent",
    cursor: "pointer",
    fontSize: "12px",
    lineHeight: "1",
  },
  ".cm-merge-op:hover": { color: "var(--fg)", background: "rgba(127,127,127,0.2)" },
  ".cm-merge-conflict": { backgroundColor: "color-mix(in srgb, #e5484d 16%, transparent)" },
  ".cm-merge-change": { backgroundColor: "color-mix(in srgb, #3b82f6 14%, transparent)" },
  ".cm-merge-resolved": { color: "var(--fg-secondary)", opacity: 0.75 },
  ".cm-merge-point": { height: "2px", margin: "0", pointerEvents: "none" },
  ".cm-merge-point.cm-merge-conflict": { backgroundColor: "#e5484d" },
  ".cm-merge-point.cm-merge-change": { backgroundColor: "#3b82f6" },
  "&": { height: "100%" },
  ".cm-scroller": { overflow: "auto", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: "12px" },
  ".cm-content": { padding: "4px 0" },
  ".cm-gutters": { background: "var(--bg-elev)", borderRight: "1px solid var(--border)", color: "var(--fg-secondary)" },
});
