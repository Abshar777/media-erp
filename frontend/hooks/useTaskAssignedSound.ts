"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { NotificationsData } from "@/types/notification";
import { announceTaskAssigned, resetTaskSoundQueue, unlockAudio } from "@/lib/taskSound";

/**
 * Plays the "New task assigned" sound when a task_assigned notification arrives.
 *
 * Watches the notifications cache rather than the socket, so it hears both the
 * live push (useNotificationSocket writes into the cache) and the 60 s poll that
 * catches anything sent while the socket was reconnecting. What's already there
 * on the first load is remembered silently — opening the app never sounds for
 * old assignments, and only notifications at least as new as the newest one already
 * loaded can sound (server time, so a wrong PC clock doesn't matter). Mounted once,
 * in the dashboard layout.
 */
export function useTaskAssignedSound(currentUserId: string | null) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!currentUserId) return;

    // Browsers only allow audio after a gesture. Keep listening until audio is really
    // running: iOS counts taps (touchend / click), not pointerdown.
    const GESTURES = ["pointerdown", "keydown", "click", "touchend"] as const;
    const unlock = () => {
      if (unlockAudio()) GESTURES.forEach((g) => window.removeEventListener(g, unlock));
    };
    GESTURES.forEach((g) => window.addEventListener(g, unlock, { passive: true }));

    const seen = new Set<string>();
    let seeded = false;
    // Newest notification time at first load, in SERVER time, so a PC whose clock is
    // off can't make new assignments look old (or old ones look new).
    let seedNewest = -Infinity;

    const look = (data: NotificationsData | undefined) => {
      if (!data?.items) return;
      if (!seeded) {
        data.items.forEach((n) => {
          seen.add(n.id);
          const at = Date.parse(n.created_at);
          if (Number.isFinite(at)) seedNewest = Math.max(seedNewest, at);
        });
        seeded = true;
        return;
      }
      const fresh: string[] = [];
      for (const n of data.items) {
        if (seen.has(n.id)) continue;
        seen.add(n.id);
        const at = Date.parse(n.created_at);
        // Older than what we already had = an old one sliding into view, not a new one.
        if (n.type === "task_assigned" && !n.read && Number.isFinite(at) && at >= seedNewest) {
          fresh.push(n.id);
        }
      }
      announceTaskAssigned(fresh);
    };

    // Whatever is cached right now counts as "already there".
    qc.getQueriesData<NotificationsData>({ queryKey: ["notifications"] }).forEach(([, d]) => look(d));

    const unsubscribe = qc.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.query.queryKey[0] !== "notifications") return;
      look(event.query.state.data as NotificationsData | undefined);
    });

    return () => {
      unsubscribe();
      GESTURES.forEach((g) => window.removeEventListener(g, unlock));
      resetTaskSoundQueue();                  // nothing queued carries over to another user
    };
  }, [currentUserId, qc]);
}
