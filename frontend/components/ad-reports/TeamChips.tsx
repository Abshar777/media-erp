"use client";

/** The report's teams as small chips, the main team first (facts row on the ad / account header). */
export function TeamChips({ teams, fallback }: { teams?: { id: string; name: string }[]; fallback?: string }) {
  const list = teams?.length ? teams : fallback ? [{ id: "main", name: fallback }] : [];
  if (!list.length) return <>—</>;
  return (
    <span className="flex flex-wrap gap-1">
      {list.map((t, i) => (
        <span key={t.id} title={i === 0 && list.length > 1 ? "Main team" : undefined}
          className={i === 0 ? "rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary"
            : "rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground"}>
          {t.name || "Team"}
        </span>
      ))}
    </span>
  );
}
