import { useEffect, useRef, type ReactNode } from "react";
import { t } from "../i18n";
import { useApp } from "../store";

export interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Footer primary action */
  primaryLabel?: string;
  onPrimary?: () => void;
  primaryDisabled?: boolean;
  primaryDanger?: boolean;
  secondaryLabel?: string;
  onSecondary?: () => void;
  wide?: boolean;
}

export function Modal({
  open,
  title,
  onClose,
  children,
  primaryLabel,
  onPrimary,
  primaryDisabled,
  primaryDanger,
  secondaryLabel,
  onSecondary,
  wide,
}: ModalProps) {
  const locale = useApp((s) => s.locale);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    const t = window.setTimeout(() => {
      const el = panelRef.current?.querySelector<HTMLElement>("input,textarea,select,button.primary");
      el?.focus();
    }, 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="diff-popup-backdrop" onClick={onClose}>
      <div
        ref={panelRef}
        className={`modal-dialog ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="diff-popup-bar">
          <strong>{title}</strong>
          <div className="title-spacer" />
          <button type="button" className="icon-btn" aria-label={t(locale, "closeDiff")} onClick={onClose}>
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {(onPrimary || onSecondary) && (
          <div className="modal-footer">
            <button type="button" className="ghost" onClick={onSecondary ?? onClose}>
              {secondaryLabel ?? t(locale, "cancel")}
            </button>
            {onPrimary && (
              <button
                type="button"
                className={primaryDanger ? "danger" : "primary"}
                disabled={primaryDisabled}
                onClick={onPrimary}
              >
                {primaryLabel ?? t(locale, "ok")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
