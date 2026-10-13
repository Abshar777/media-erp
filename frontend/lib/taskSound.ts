"use client";

/**
 * "New task assigned" — a chime and a spoken line when a task is assigned to you.
 *
 * Plays while the app is open in any tab (visible or not). Unlike the desktop
 * pop-up it does NOT need the browser's notification permission — only the
 * user's own switches below. Rules:
 *   • one sound per assignment, even with the app open in several tabs
 *     (Web Locks + a shared "already played" list in localStorage);
 *   • a burst (three tasks at once) is one sound — "3 new tasks assigned";
 *   • never for old notifications: the caller only passes ones that just arrived.
 * Browsers refuse to start audio before the user has interacted with the page,
 * so `unlockAudio()` runs on the first click / key press; until then a sound can
 * legitimately be silent (the bell and any desktop pop-up still show).
 */

const SOUND_KEY = "notify:task-sound";
const VOICE_KEY = "notify:task-voice";
const PLAYED_KEY = "notify:task-sound-played";
const COALESCE_MS = 1200;
const PLAYED_KEEP = 200;

// ── Switches (per device, default on) ───────────────────────────────────────

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) !== "off";
  } catch {
    return true;
  }
}
function writeFlag(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? "on" : "off");
  } catch {
    /* storage blocked: the switch just won't persist */
  }
}
export const taskSoundEnabled = () => readFlag(SOUND_KEY);
export const setTaskSoundEnabled = (on: boolean) => writeFlag(SOUND_KEY, on);
export const taskVoiceEnabled = () => readFlag(VOICE_KEY);
export const setTaskVoiceEnabled = (on: boolean) => writeFlag(VOICE_KEY, on);

/** What the voice says for `count` assignments arriving together. */
export function announcementText(count: number): string {
  return count > 1 ? `${count} new tasks assigned` : "New task assigned";
}

// ── Audio (one shared context, unlocked on the first gesture) ───────────────

let ctx: AudioContext | null = null;

export function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const Ctx = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    ctx ??= new Ctx();
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

let speechPrimed = false;

/**
 * Call from a user gesture: lets later sounds play in this tab. Returns true once
 * audio is actually running (iOS only allows it inside a real tap / click).
 */
export function unlockAudio(): boolean {
  const ac = getAudioContext();
  try {
    const synth = window.speechSynthesis;
    synth?.getVoices();                       // loads the voice list early
    if (synth && !speechPrimed && typeof SpeechSynthesisUtterance !== "undefined") {
      synth.speak(new SpeechSynthesisUtterance(""));   // iOS: the first speak must be in a gesture
      speechPrimed = true;
    }
  } catch {
    /* no speech support: the chime still plays */
  }
  return ac?.state === "running";
}

/** Three rising notes (G5 · B5 · E6), softly enveloped — distinct from the two-note alert chime. */
async function chime(): Promise<number> {
  const ac = getAudioContext();
  if (!ac) return 0;
  if (ac.state !== "running") {
    // A context that isn't allowed to run yet (no click on this page so far) must not
    // queue notes: they would all play later, out of nowhere, on the next click.
    try {
      await Promise.race([ac.resume(), new Promise((r) => setTimeout(r, 300))]);
    } catch {
      /* stays suspended */
    }
    if ((ac.state as AudioContextState) !== "running") return 0;   // re-read: it can change during the await
  }
  const start = ac.currentTime + 0.01;
  [783.99, 987.77, 1318.51].forEach((freq, i) => {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const t = start + i * 0.11;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + (i === 2 ? 0.45 : 0.2));
    osc.connect(gain).connect(ac.destination);
    osc.start(t);
    osc.stop(t + 0.5);
  });
  return 600;                                 // ms until the chime has finished
}

function speak(text: string): void {
  try {
    const synth = window.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance === "undefined") return;
    const u = new SpeechSynthesisUtterance(text);
    const en = synth.getVoices().filter((v) => v.lang?.toLowerCase().startsWith("en"));
    // The system's default English voice, else an offline one (online voices go silent offline).
    const voice = en.find((v) => v.default) ?? en.find((v) => v.localService) ?? en[0];
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? "en-US";
    u.rate = 1;
    u.pitch = 1;
    u.volume = 0.9;
    if (synth.speaking || synth.pending) {
      synth.cancel();                         // never queue behind an older line,
      setTimeout(() => synth.speak(u), 60);   // and give Chrome/Safari a beat after cancel()
    } else {
      synth.speak(u);
    }
  } catch {
    /* speech is a nicety */
  }
}

/** Play now (no dedupe) — the "Test sound" button and the batched announcer use it. */
export function playTaskAssigned(count = 1, opts: { voice?: boolean } = {}): void {
  const say = opts.voice ?? taskVoiceEnabled();
  chime()
    .then((wait) => {
      if (say) setTimeout(() => speak(announcementText(count)), wait);
    })
    .catch(() => {
      /* audio must never break notification delivery */
    });
}

// ── Once per assignment, across tabs ────────────────────────────────────────

function readPlayed(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(PLAYED_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Of `ids`, the ones no tab has announced yet — and mark them announced. */
export function claimUnplayed(ids: string[]): string[] {
  const played = readPlayed();
  const fresh = ids.filter((id) => !played.includes(id));
  if (fresh.length) {
    try {
      localStorage.setItem(PLAYED_KEY, JSON.stringify([...played, ...fresh].slice(-PLAYED_KEEP)));
    } catch {
      /* without storage each tab may play; acceptable */
    }
  }
  return fresh;
}

let pending: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

async function flush(): Promise<void> {
  const ids = [...new Set(pending)];
  pending = [];
  timer = null;
  if (!ids.length || !taskSoundEnabled()) return;
  const run = () => {
    const fresh = claimUnplayed(ids);
    if (fresh.length) playTaskAssigned(fresh.length);
  };
  // Web Locks make "check, then mark" atomic across this site's tabs.
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (locks?.request) {
    try {
      await locks.request("merp-task-sound", run);
      return;
    } catch {
      /* fall through */
    }
  }
  run();
}

/** Drop anything queued (sign-out, switching user, impersonation). */
export function resetTaskSoundQueue(): void {
  pending = [];
  if (timer) clearTimeout(timer);
  timer = null;
}

/** Queue newly arrived `task_assigned` notification ids; one sound per burst. */
export function announceTaskAssigned(ids: string[]): void {
  if (!ids.length) return;
  pending.push(...ids);
  if (!timer) timer = setTimeout(() => void flush(), COALESCE_MS);
}
