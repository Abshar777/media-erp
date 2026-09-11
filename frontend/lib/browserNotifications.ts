"use client";

/**
 * Desktop notifications + a short alert tone for the events people asked to be
 * interrupted for: an @mention, work assigned to them, or something waiting on
 * their approval.
 *
 * Scope, so expectations are right: this uses the Notification API, which only
 * fires while the app is open in a tab (it may be a background tab, or the
 * window may be behind another app — but not closed). Alerting with the browser
 * fully shut requires Web Push: VAPID keys, a service-worker push handler, and
 * per-device subscriptions stored server-side. That is a separate piece of work.
 */

import type { NotificationType } from "@/types/notification";

/** Types worth interrupting someone for. Everything else stays in the bell. */
const ALERT_TYPES = new Set<string>([
  "mention",
  "task_assigned",
  "pending_review",   // something needs your approval
  "task_reedit",      // your work came back
]);

const PREF_KEY = "notify:desktop";

export function isAlertType(type: string): boolean {
  return ALERT_TYPES.has(type);
}

export function desktopSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function desktopPermission(): NotificationPermission | "unsupported" {
  return desktopSupported() ? Notification.permission : "unsupported";
}

/** User's own on/off switch, independent of the browser-level permission. */
export function desktopEnabled(): boolean {
  if (!desktopSupported()) return false;
  try {
    return localStorage.getItem(PREF_KEY) !== "off";
  } catch {
    return true;   // storage blocked (private window) — don't silently disable
  }
}

export function setDesktopEnabled(on: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, on ? "on" : "off");
  } catch {
    /* nothing we can do; the toggle just won't persist */
  }
}

export async function requestDesktopPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!desktopSupported()) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

// ── Sound ─────────────────────────────────────────────────────────────────────

let audioCtx: AudioContext | null = null;

/**
 * A two-note chime synthesised via WebAudio rather than shipping an asset —
 * no file to load, and nothing to 404 if the deploy misses it.
 *
 * Browsers refuse to start audio until the user has interacted with the page,
 * so this can legitimately do nothing on a freshly-loaded background tab. That
 * is the browser's rule, not a failure, hence the silent catch.
 */
export function playAlertSound(): void {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audioCtx ??= new Ctx();
    if (audioCtx.state === "suspended") void audioCtx.resume();

    const now = audioCtx.currentTime;
    [880, 1174.7].forEach((freq, i) => {
      const osc = audioCtx!.createOscillator();
      const gain = audioCtx!.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = now + i * 0.12;
      // Quick fade in/out — a raw start/stop clicks audibly.
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      osc.connect(gain).connect(audioCtx!.destination);
      osc.start(t);
      osc.stop(t + 0.24);
    });
  } catch {
    /* audio is a nicety; never let it break notification delivery */
  }
}

// ── Show ──────────────────────────────────────────────────────────────────────

export function showDesktopNotification(n: {
  id: string;
  type: NotificationType | string;
  title: string;
  message: string;
}): void {
  if (!isAlertType(n.type)) return;
  if (!desktopSupported() || !desktopEnabled()) return;
  if (Notification.permission !== "granted") return;

  // Don't interrupt someone who is already looking at the app.
  if (typeof document !== "undefined" && document.visibilityState === "visible") {
    playAlertSound();
    return;
  }

  try {
    const notif = new Notification(n.title, {
      body: n.message,
      icon: "/icons/icon-192.png",
      // Same tag replaces rather than stacks, so a burst of events doesn't
      // bury the desktop under duplicates.
      tag: `merp-${n.type}`,
      renotify: true,
    } as NotificationOptions);
    notif.onclick = () => {
      window.focus();
      notif.close();
    };
    playAlertSound();
  } catch {
    /* some browsers throw when constructing off a user gesture — ignore */
  }
}

// ── Web Push ──────────────────────────────────────────────────────────────────

/**
 * Web Push adds what the Notification API above cannot do: alert someone with
 * the browser closed. It needs the service worker (already registered for the
 * PWA) plus a per-device subscription stored server-side.
 */

import api from "@/lib/axios";

/** VAPID keys travel as base64url; PushManager wants raw bytes. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

/**
 * Subscribe this browser. Safe to call repeatedly — an existing subscription is
 * reused and simply re-sent, since the server upserts on endpoint.
 * Returns false when push is unavailable or the server has no VAPID keys.
 */
export async function subscribeToPush(): Promise<boolean> {
  if (!pushSupported()) return false;
  if (desktopPermission() !== "granted") return false;

  try {
    const { data } = await api.get<{ data: { public_key: string; enabled: boolean } }>(
      "/push/public-key"
    );
    const key = data.data?.public_key;
    if (!data.data?.enabled || !key) return false;   // server-side push is off

    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();

    // A subscription made against a different VAPID key can never receive our
    // pushes, so replace it rather than silently keeping a dead one.
    if (sub) {
      const existing = sub.options?.applicationServerKey;
      const wanted = urlBase64ToUint8Array(key);
      const same =
        existing &&
        new Uint8Array(existing).length === wanted.length &&
        new Uint8Array(existing).every((b, i) => b === wanted[i]);
      if (!same) {
        await sub.unsubscribe().catch(() => {});
        sub = null;
      }
    }

    sub ??= await reg.pushManager.subscribe({
      userVisibleOnly: true,      // required by Chrome; we always show one
      applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
    });

    await api.post("/push/subscribe", sub.toJSON());
    return true;
  } catch {
    // Push is an enhancement — the socket and bell still work without it.
    return false;
  }
}

export async function unsubscribeFromPush(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    await api.delete("/push/subscribe", { data: { endpoint: sub.endpoint } });
    await sub.unsubscribe();
  } catch {
    /* leaving a stale subscription is harmless — the server prunes on 410 */
  }
}
