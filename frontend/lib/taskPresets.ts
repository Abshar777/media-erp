/**
 * Matching for task-name suggestions.
 *
 * "a" matches any WORD that starts with a ("Apple", "Monthly ad report").
 * Several typed words must each start a word ("mon ad" → "Monthly ad report").
 * Rank: whole name starts with it → every word matched → contains it (3+ letters).
 * Within a rank: saved before company before recent, then most used.
 */
export interface Suggestion {
  key: string;
  title: string;
  source: "saved" | "company" | "recent";
  uses: number;
  teamId?: string | null;
  teamName?: string;
  description?: string;
  priority?: "low" | "medium" | "high" | null;
}

const SOURCE_RANK = { saved: 0, company: 1, recent: 2 } as const;
const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

export function matchRank(title: string, query: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = title.toLowerCase();
  if (t.startsWith(q)) return 0;
  const tw = words(title), qw = words(q);
  if (qw.length && qw.every((x) => tw.some((w) => w.startsWith(x)))) return 1;
  // Plain "contains" only from 3 letters — with 1–2 it matches almost everything.
  if (q.length >= 3 && t.includes(q)) return 2;
  return null;
}

export function rankSuggestions(items: Suggestion[], query: string, limit = 8): Suggestion[] {
  const seen = new Set<string>();
  return items
    .map((s) => ({ s, r: matchRank(s.title, query) }))
    .filter((x): x is { s: Suggestion; r: number } => x.r !== null)
    .sort((a, b) => a.r - b.r || SOURCE_RANK[a.s.source] - SOURCE_RANK[b.s.source] || b.s.uses - a.s.uses || a.s.title.localeCompare(b.s.title))
    .map((x) => x.s)
    .filter((s) => {                               // same name from two lists → keep the best one
      const k = s.title.trim().toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, limit);
}

/** Split a title into [text, bold] parts for the typed words (word starts, or the plain substring). */
export function highlight(title: string, query: string): { text: string; hit: boolean }[] {
  const q = query.trim();
  if (!q) return [{ text: title, hit: false }];
  const marks = new Array(title.length).fill(false);
  const lower = title.toLowerCase();
  if (lower.startsWith(q.toLowerCase())) {
    for (let i = 0; i < q.length; i++) marks[i] = true;
  } else {
    for (const part of words(q)) {
      const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "giu");
      let m: RegExpExecArray | null;
      while ((m = re.exec(title))) {
        const start = m.index + m[1].length;
        for (let i = start; i < start + m[2].length; i++) marks[i] = true;
        if (m[0].length === 0) re.lastIndex++;
      }
    }
    if (!marks.some(Boolean)) {
      const at = lower.indexOf(q.toLowerCase());
      if (at >= 0) for (let i = at; i < at + q.length; i++) marks[i] = true;
    }
  }
  const out: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < title.length; i++) {
    const last = out[out.length - 1];
    if (last && last.hit === marks[i]) last.text += title[i];
    else out.push({ text: title[i], hit: marks[i] });
  }
  return out;
}
