import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { t, tf } from "../i18n";
import { useApp } from "../store";
import type { ResetMode } from "../types";
import { Modal } from "./Modal";

export function PromptDialog(props: {
  open: boolean;
  title: string;
  label: string;
  initial?: string;
  placeholder?: string;
  danger?: boolean;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: (value: string) => void;
}) {
  const locale = useApp((s) => s.locale);
  const [value, setValue] = useState(props.initial ?? "");
  useEffect(() => {
    if (props.open) setValue(props.initial ?? "");
  }, [props.open, props.initial]);

  return (
    <Modal
      open={props.open}
      title={props.title}
      onClose={props.onClose}
      primaryLabel={props.confirmLabel ?? t(locale, "ok")}
      primaryDanger={props.danger}
      primaryDisabled={!value.trim()}
      onPrimary={() => props.onConfirm(value.trim())}
    >
      <label className="modal-field">
        <span>{props.label}</span>
        <input
          value={value}
          placeholder={props.placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.trim()) props.onConfirm(value.trim());
          }}
        />
      </label>
    </Modal>
  );
}

export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  message: string;
  danger?: boolean;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const locale = useApp((s) => s.locale);
  return (
    <Modal
      open={props.open}
      title={props.title}
      onClose={props.onClose}
      primaryLabel={props.confirmLabel ?? t(locale, "confirm")}
      primaryDanger={props.danger}
      onPrimary={props.onConfirm}
    >
      <p className="modal-text" style={{ whiteSpace: "pre-wrap" }}>
        {props.message}
      </p>
    </Modal>
  );
}

export function ResetDialog(props: {
  open: boolean;
  commitId: string;
  mode: ResetMode;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const locale = useApp((s) => s.locale);
  const desc =
    props.mode === "soft"
      ? t(locale, "resetSoftDesc")
      : props.mode === "mixed"
        ? t(locale, "resetMixedDesc")
        : t(locale, "resetHardDesc");
  const title =
    props.mode === "soft"
      ? t(locale, "resetSoft")
      : props.mode === "mixed"
        ? t(locale, "resetMixed")
        : t(locale, "resetHard");

  return (
    <Modal
      open={props.open}
      title={t(locale, "resetTitle")}
      onClose={props.onClose}
      primaryLabel={title}
      primaryDanger={props.mode === "hard"}
      onPrimary={props.onConfirm}
    >
      <p className="modal-text">{desc}</p>
      <p className="modal-text">
        <code>{props.commitId.slice(0, 12)}</code>
      </p>
      {props.mode === "hard" && <p className="modal-warn">{t(locale, "resetHardWarning")}</p>}
    </Modal>
  );
}

export function NewBranchDialog(props: {
  open: boolean;
  startPoint: string;
  onClose: () => void;
  onConfirm: (name: string) => void;
}) {
  const locale = useApp((s) => s.locale);
  const [name, setName] = useState("");
  useEffect(() => {
    if (props.open) setName("");
  }, [props.open]);

  return (
    <Modal
      open={props.open}
      title={t(locale, "newBranchTitle")}
      onClose={props.onClose}
      primaryLabel={t(locale, "ok")}
      primaryDisabled={!name.trim()}
      onPrimary={() => props.onConfirm(name.trim())}
    >
      <label className="modal-field">
        <span>{t(locale, "branchName")}</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) props.onConfirm(name.trim());
          }}
        />
      </label>
      <label className="modal-field">
        <span>{t(locale, "startPoint")}</span>
        <input value={props.startPoint} readOnly />
      </label>
    </Modal>
  );
}

export function CloneDialog(props: {
  open: boolean;
  onClose: () => void;
  onConfirm: (url: string, path: string) => void;
}) {
  const locale = useApp((s) => s.locale);
  const [url, setUrl] = useState("");
  const [path, setPath] = useState("");
  useEffect(() => {
    if (props.open) {
      setUrl("");
      setPath("");
    }
  }, [props.open]);

  return (
    <Modal
      open={props.open}
      title={t(locale, "cloneTitle")}
      onClose={props.onClose}
      primaryLabel={t(locale, "clone")}
      primaryDisabled={!url.trim() || !path.trim()}
      onPrimary={() => props.onConfirm(url.trim(), path.trim())}
    >
      <label className="modal-field">
        <span>{t(locale, "cloneUrl")}</span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
      </label>
      <div className="modal-field-row">
        <label className="modal-field">
          <span>{t(locale, "clonePath")}</span>
          <input value={path} onChange={(e) => setPath(e.target.value)} />
        </label>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            void open({ directory: true, multiple: false }).then((p) => {
              if (typeof p === "string") setPath(p);
            });
          }}
        >
          {t(locale, "browse")}
        </button>
      </div>
    </Modal>
  );
}

export function RemoteFormDialog(props: {
  open: boolean;
  mode: "add" | "edit";
  initialName?: string;
  initialUrl?: string;
  onClose: () => void;
  onConfirm: (name: string, url: string) => void;
}) {
  const locale = useApp((s) => s.locale);
  const [name, setName] = useState(props.initialName ?? "");
  const [url, setUrl] = useState(props.initialUrl ?? "");
  useEffect(() => {
    if (props.open) {
      setName(props.initialName ?? "");
      setUrl(props.initialUrl ?? "");
    }
  }, [props.open, props.initialName, props.initialUrl]);

  return (
    <Modal
      open={props.open}
      title={props.mode === "add" ? t(locale, "addRemoteTitle") : t(locale, "editRemoteTitle")}
      onClose={props.onClose}
      primaryLabel={t(locale, "ok")}
      primaryDisabled={!name.trim() || !url.trim()}
      onPrimary={() => props.onConfirm(name.trim(), url.trim())}
    >
      <label className="modal-field">
        <span>{t(locale, "remoteName")}</span>
        <input
          value={name}
          disabled={props.mode === "edit"}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="modal-field">
        <span>{t(locale, "remoteUrl")}</span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} />
      </label>
    </Modal>
  );
}

export function deleteBranchMessage(locale: "en" | "zh", name: string): string {
  return tf(locale, "deleteBranchConfirm", { name });
}
