/** Tiny leads trend for a report card. Unreported days break the line. */
export function Sparkline({ values, className }: { values: (number | null)[]; className?: string }) {
  const w = 96, h = 24;
  const nums = values.filter((v): v is number => v != null);
  if (nums.length === 0) {
    return <div className={className} aria-hidden style={{ width: w, height: h }} />;
  }
  const max = Math.max(...nums, 1);
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pt = (v: number, i: number): [number, number] => [i * step, h - 2 - (v / max) * (h - 4)];

  const runs: [number, number][][] = [];
  let cur: [number, number][] = [];
  values.forEach((v, i) => {
    if (v == null) { if (cur.length) runs.push(cur); cur = []; return; }
    cur.push(pt(v, i));
  });
  if (cur.length) runs.push(cur);

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={className} aria-hidden>
      {runs.map((run, i) =>
        run.length === 1 ? (
          <circle key={i} cx={run[0][0]} cy={run[0][1]} r={1.6} fill="currentColor" />
        ) : (
          <path
            key={i}
            d={run.map(([x, y], j) => `${j ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("")}
            fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"
          />
        ),
      )}
    </svg>
  );
}
