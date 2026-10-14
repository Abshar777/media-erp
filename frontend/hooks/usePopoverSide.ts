"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * Which side a header popover card should open to. Anchored to the right edge
 * of its pill, a wide card runs off the left of the screen whenever the header
 * wraps and the pill ends up on the left — so open toward the side with room.
 */
export function usePopoverSide(ref: RefObject<HTMLElement | null>, open: boolean, cardWidth: number) {
  const [side, setSide] = useState<"left" | "right">("right");
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setSide(r.right - cardWidth < 8 ? "left" : "right");
  }, [open, ref, cardWidth]);
  return side;
}
