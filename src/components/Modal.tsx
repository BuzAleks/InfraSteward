import { type ReactNode, useEffect, useRef } from "react";
import { X } from "lucide-react";

type ModalProps = {
  title: string;
  children: ReactNode;
  onClose: () => void;
  width?: "medium" | "wide";
};

export function Modal({ title, children, onClose, width = "medium" }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = dialog?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    focusable?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
      if (event.key !== "Tab" || !dialog) {
        return;
      }
      const items = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((item) => !item.hasAttribute("disabled"));
      if (items.length === 0) {
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [onClose]);

  return (
    <div className="modalBackdrop" role="presentation">
      <div className={`modal modal-${width}`} role="dialog" aria-modal="true" aria-labelledby="modal-title" ref={dialogRef}>
        <header className="modalHeader">
          <h2 id="modal-title">{title}</h2>
          <button className="iconButton" type="button" aria-label="Cancel" title="Cancel" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="modalBody">{children}</div>
      </div>
    </div>
  );
}
