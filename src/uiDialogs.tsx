/**
 * In-app dialogs (OpenIDEA-style). Never use window.prompt/confirm/alert —
 * those show an ugly "tauri.localhost" host chrome in WebView2.
 */
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { t } from "./i18n";
import { useApp } from "./store";
import { Modal } from "./components/Modal";

type Entry = {
  id: number;
  node: ReactNode;
};

let nextId = 1;
let entries: Entry[] = [];
const listeners = new Set<() => void>();

function publish() {
  for (const l of listeners) l();
}

function mount(node: (id: number) => ReactNode): number {
  const id = nextId++;
  entries = [...entries, { id, node: node(id) }];
  publish();
  return id;
}

function unmount(id: number) {
  entries = entries.filter((e) => e.id !== id);
  publish();
}

/** Renders the active promise dialogs; mount once under App. */
export function DialogHost() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    listeners.add(bump);
    return () => {
      listeners.delete(bump);
    };
  }, []);
  if (!entries.length) return null;
  return (
    <>
      {entries.map((e) => (
        <Fragment key={e.id}>{e.node}</Fragment>
      ))}
    </>
  );
}

function splitList(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Single-line prompt. `null` = cancelled. Empty string allowed when `allowEmpty`. */
export function askPrompt(opts: {
  title: string;
  label: string;
  initial?: string;
  placeholder?: string;
  allowEmpty?: boolean;
  confirmLabel?: string;
}): Promise<string | null> {
  return new Promise((resolve) => {
    mount((id) => (
      <PromptAsk
        {...opts}
        onDone={(v) => {
          unmount(id);
          resolve(v);
        }}
      />
    ));
  });
}

function PromptAsk(props: {
  title: string;
  label: string;
  initial?: string;
  placeholder?: string;
  allowEmpty?: boolean;
  confirmLabel?: string;
  onDone: (v: string | null) => void;
}) {
  const locale = useApp((s) => s.locale);
  const [value, setValue] = useState(props.initial ?? "");
  const ok = props.allowEmpty || !!value.trim();
  return (
    <Modal
      open
      title={props.title}
      onClose={() => props.onDone(null)}
      primaryLabel={props.confirmLabel ?? t(locale, "ok")}
      primaryDisabled={!ok}
      onPrimary={() => props.onDone(props.allowEmpty ? value : value.trim())}
    >
      <label className="modal-field">
        <span>{props.label}</span>
        <input
          value={value}
          placeholder={props.placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && ok) props.onDone(props.allowEmpty ? value : value.trim());
          }}
        />
      </label>
    </Modal>
  );
}

/** Confirm dialog. */
export function askConfirm(opts: {
  title: string;
  message: string;
  danger?: boolean;
  confirmLabel?: string;
}): Promise<boolean> {
  return new Promise((resolve) => {
    mount((id) => (
      <ConfirmAsk
        {...opts}
        onDone={(v) => {
          unmount(id);
          resolve(v);
        }}
      />
    ));
  });
}

function ConfirmAsk(props: {
  title: string;
  message: string;
  danger?: boolean;
  confirmLabel?: string;
  onDone: (v: boolean) => void;
}) {
  const locale = useApp((s) => s.locale);
  return (
    <Modal
      open
      title={props.title}
      onClose={() => props.onDone(false)}
      primaryLabel={props.confirmLabel ?? t(locale, "confirm")}
      primaryDanger={props.danger}
      onPrimary={() => props.onDone(true)}
    >
      <p className="modal-text" style={{ whiteSpace: "pre-wrap" }}>
        {props.message}
      </p>
    </Modal>
  );
}

/** Info alert (OK only). */
export function askAlert(opts: { title: string; message: string }): Promise<void> {
  return new Promise((resolve) => {
    mount((id) => (
      <AlertAsk
        {...opts}
        onDone={() => {
          unmount(id);
          resolve();
        }}
      />
    ));
  });
}

function AlertAsk(props: { title: string; message: string; onDone: () => void }) {
  const locale = useApp((s) => s.locale);
  return (
    <Modal
      open
      title={props.title}
      onClose={props.onDone}
      primaryLabel={t(locale, "ok")}
      onPrimary={props.onDone}
    >
      <p className="modal-text" style={{ whiteSpace: "pre-wrap" }}>
        {props.message}
      </p>
    </Modal>
  );
}

export interface ChooseManyOptions {
  title: string;
  options: readonly string[];
  initial: readonly string[];
  customLabel?: string;
}

/** OpenIDEA Log User/Branch › Select… — multi-check + optional custom CSV. */
export function chooseMany(opts: ChooseManyOptions): Promise<string[] | null> {
  return new Promise((resolve) => {
    mount((id) => (
      <ChooseManyDialog
        {...opts}
        onDone={(r) => {
          unmount(id);
          resolve(r);
        }}
      />
    ));
  });
}

function ChooseManyDialog(props: ChooseManyOptions & { onDone: (r: string[] | null) => void }) {
  const locale = useApp((s) => s.locale);
  const { title, options, initial, customLabel, onDone } = props;
  const [query, setQuery] = useState("");
  const [checked, setChecked] = useState(
    () => new Set(initial.filter((v) => options.includes(v))),
  );
  const [custom, setCustom] = useState(() =>
    initial.filter((v) => !options.includes(v)).join(", "),
  );
  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  const submit = () =>
    onDone([
      ...options.filter((o) => checked.has(o)),
      ...(customLabel ? splitList(custom) : []),
    ]);

  return (
    <Modal open title={title} onClose={() => onDone(null)} wide onPrimary={submit} primaryLabel={t(locale, "ok")}>
      <label className="modal-field">
        <input
          value={query}
          placeholder={t(locale, "filterList")}
          aria-label={t(locale, "filterList")}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="choose-many-list" role="group" aria-label={title}>
        {shown.map((o) => (
          <label key={o} className="modal-check">
            <input
              type="checkbox"
              checked={checked.has(o)}
              onChange={(e) => {
                const on = e.target.checked;
                setChecked((s) => {
                  const n = new Set(s);
                  if (on) n.add(o);
                  else n.delete(o);
                  return n;
                });
              }}
            />
            <span title={o}>{o}</span>
          </label>
        ))}
        {!shown.length && <p className="modal-text">{t(locale, "noMatches")}</p>}
      </div>
      {customLabel && (
        <label className="modal-field">
          <span>{customLabel}</span>
          <input value={custom} onChange={(e) => setCustom(e.target.value)} />
        </label>
      )}
    </Modal>
  );
}

/** OpenIDEA Date › Select… — From / To date inputs. */
export function chooseDateRange(): Promise<{ after: number | null; before: number | null } | null> {
  return new Promise((resolve) => {
    mount((id) => (
      <DateRangeDialog
        onDone={(r) => {
          unmount(id);
          resolve(r);
        }}
      />
    ));
  });
}

function parseDay(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

function DateRangeDialog({
  onDone,
}: {
  onDone: (r: { after: number | null; before: number | null } | null) => void;
}) {
  const locale = useApp((s) => s.locale);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const after = parseDay(from);
  const toDay = parseDay(to);
  const before = toDay == null ? null : new Date(toDay).setDate(new Date(toDay).getDate() + 1);
  const error =
    after == null && before == null
      ? t(locale, "chooseStartOrEnd")
      : after != null && before != null && after >= before
        ? t(locale, "startAfterEnd")
        : null;

  return (
    <Modal
      open
      title={t(locale, "filterByDate")}
      onClose={() => onDone(null)}
      primaryLabel={t(locale, "ok")}
      primaryDisabled={!!error}
      onPrimary={() => {
        if (!error) onDone({ after, before });
      }}
    >
      <label className="modal-field">
        <span>{t(locale, "dateFrom")}</span>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
      </label>
      <label className="modal-field">
        <span>{t(locale, "dateTo")}</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </label>
      {(from || to) && error && <p className="modal-warn">{error}</p>}
    </Modal>
  );
}
