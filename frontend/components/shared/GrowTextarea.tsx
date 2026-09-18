"use client";

/**
 * GrowTextarea — a textarea that follows what you type.
 *
 * A fixed three-row box hides most of what someone just wrote, and a box that
 * grows without limit pushes the buttons off the bottom of a modal. This grows
 * with the content up to `maxRows`, then scrolls; an Expand toggle lifts the
 * cap when the text has outgrown it, so a long note can be read in full
 * without leaving the form.
 */
import { useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** Height it starts at. */
  minRows?: number;
  /** Height it stops growing at, until Expand is pressed. */
  maxRows?: number;
  /** Height the Expand toggle opens it to. */
  expandedRows?: number;
  autoFocus?: boolean;
  className?: string;
  label?: React.ReactNode;
  hint?: React.ReactNode;
}

export function GrowTextarea({
  value,
  onChange,
  placeholder,
  minRows = 3,
  maxRows = 8,
  expandedRows = 20,
  autoFocus,
  className,
  label,
  hint,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Measured from the element's own line-height rather than assumed, so the
    // cap holds whatever the font ends up being.
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 20;
    const padding = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const cap = line * (expanded ? expandedRows : maxRows) + padding;
    const floor = line * minRows + padding;

    el.style.height = "auto";
    const needed = el.scrollHeight;
    el.style.height = `${Math.min(Math.max(needed, floor), cap)}px`;
    el.style.overflowY = needed > cap ? "auto" : "hidden";
    // Offer the toggle only once the text has actually outgrown the cap —
    // a toggle over two lines is noise.
    setOverflowing(needed > line * maxRows + padding);
  }, [value, expanded, minRows, maxRows, expandedRows]);

  return (
    <div className="space-y-1">
      {(label || (overflowing || expanded)) && (
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">{label}</div>
          {(overflowing || expanded) && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-primary hover:underline"
            >
              {expanded ? <Minimize2 className="size-3" /> : <Maximize2 className="size-3" />}
              {expanded ? "Collapse" : "Expand"}
            </button>
          )}
        </div>
      )}
      {hint}
      <textarea
        ref={ref}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={minRows}
        className={cn(
          "w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30",
          className
        )}
      />
    </div>
  );
}

export default GrowTextarea;
