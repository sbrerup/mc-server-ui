/**
 * Hover, focus and tap all open a tooltip, so it works with a mouse, a keyboard and
 * a phone. It renders in a portal so a card's overflow can't clip it.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  label?: string;
  className?: string;
}

const GAP = 8;
const MARGIN = 12;

export function Tooltip({ content, children, label, className }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number; above: boolean }>();
  const anchor = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const id = useId();
  const closeTimer = useRef<number | undefined>(undefined);

  const show = useCallback(() => {
    window.clearTimeout(closeTimer.current);
    setOpen(true);
  }, []);

  // A short delay lets the pointer travel from the icon onto the tooltip, for selecting text.
  const hide = useCallback(() => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 120);
  }, []);

  const place = useCallback(() => {
    const a = anchor.current?.getBoundingClientRect();
    const b = bubble.current?.getBoundingClientRect();
    if (!a || !b) return;
    const above = a.bottom + GAP + b.height > window.innerHeight - MARGIN && a.top - GAP - b.height > MARGIN;
    const left = Math.min(Math.max(MARGIN, a.left + a.width / 2 - b.width / 2), window.innerWidth - b.width - MARGIN);
    setPosition({ top: above ? a.top - GAP - b.height : a.bottom + GAP, left, above });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
    else setPosition(undefined);
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setPinned(false);
      }
    };
    const onScroll = () => {
      setOpen(false);
      setPinned(false);
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!anchor.current?.contains(target) && !bubble.current?.contains(target)) {
        setOpen(false);
        setPinned(false);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={className ?? "tip-trigger"}
        aria-label={label ?? "More information"}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onPointerEnter={(e) => e.pointerType === "mouse" && show()}
        onPointerLeave={(e) => e.pointerType === "mouse" && !pinned && hide()}
        onFocus={show}
        onBlur={() => !pinned && hide()}
        onClick={() => {
          setPinned((p) => !p);
          setOpen(true);
        }}
      >
        {children}
      </button>
      {open &&
        createPortal(
          <div
            ref={bubble}
            id={id}
            role="tooltip"
            className="tooltip"
            style={position ? { top: position.top, left: position.left, opacity: 1 } : { top: 0, left: 0, opacity: 0 }}
            onPointerEnter={show}
            onPointerLeave={() => !pinned && hide()}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
