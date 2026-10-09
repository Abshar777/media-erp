import { cn } from "@/lib/utils";

/** Meta / Google / Snap / Other — the small fixed-width badge in front of a project name. */
const PLATFORM: Record<string, { label: string; className: string }> = {
  meta:     { label: "Meta",   className: "bg-[#0866FF]/12 text-[#0866FF] dark:bg-[#0866FF]/20 dark:text-[#6aa6ff]" },
  google:   { label: "Google", className: "bg-[#EA4335]/12 text-[#C5221F] dark:bg-[#EA4335]/20 dark:text-[#ff8a80]" },
  snapchat: { label: "Snap",   className: "bg-[#FFFC00]/60 text-[#3d3a00] dark:bg-[#FFFC00]/20 dark:text-[#fff86b]" },
  other:    { label: "Other",  className: "bg-muted text-muted-foreground" },
};

export function PlatformBadge({ platform, className }: { platform: string; className?: string }) {
  const p = PLATFORM[platform] ?? PLATFORM.other;
  return (
    <span className={cn("inline-flex h-[18px] w-[54px] shrink-0 items-center justify-center rounded-md text-[10px] font-semibold uppercase tracking-wide", p.className, className)}>
      {p.label}
    </span>
  );
}
