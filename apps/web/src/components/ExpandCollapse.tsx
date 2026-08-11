"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type TransitionEvent,
} from "react";

type Props = {
  open: boolean;
  children: ReactNode;
  className?: string;
  /** Extra class on the overflow-clipped inner wrapper. */
  innerClassName?: string;
  style?: CSSProperties;
};

/**
 * Smooth height + opacity expand/collapse. Keeps children mounted through the
 * close transition so the panel can animate away instead of vanishing.
 */
export function ExpandCollapse({
  open,
  children,
  className = "",
  innerClassName = "",
  style,
}: Props) {
  const [mounted, setMounted] = useState(open);
  const [expanded, setExpanded] = useState(open);
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    if (open) {
      setMounted(true);
      const reduce =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce) {
        setExpanded(true);
        return;
      }
      // Double rAF so the 0fr → 1fr transition runs after mount paint.
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => {
          if (openRef.current) setExpanded(true);
        });
      });
      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
      };
    }
    setExpanded(false);
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setMounted(false);
      return;
    }
    // Fallback if transitionend never fires (some engines omit grid-row events).
    const t = window.setTimeout(() => {
      if (!openRef.current) setMounted(false);
    }, 400);
    return () => clearTimeout(t);
  }, [open]);

  const onTransitionEnd = (e: TransitionEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    // Wait for height (longer than opacity) so close doesn't cut short.
    if (e.propertyName !== "grid-template-rows") return;
    if (!openRef.current) setMounted(false);
  };

  if (!mounted) return null;

  return (
    <div
      className={`ui-expand${expanded ? " is-open" : ""}${className ? ` ${className}` : ""}`}
      style={style}
      onTransitionEnd={onTransitionEnd}
      aria-hidden={!expanded}
    >
      <div className={`ui-expand-inner${innerClassName ? ` ${innerClassName}` : ""}`}>
        {children}
      </div>
    </div>
  );
}
