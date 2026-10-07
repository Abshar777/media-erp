import { CheckCircle2, CircleDashed, Clock, Flag, PauseCircle, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AdDayStatus } from "@/types/adReport";

const CHIP: Record<AdDayStatus, { label: string; icon: React.ElementType; cls: string }> = {
  updated:     { label: "Updated",     icon: CheckCircle2,  cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  due:         { label: "Due today",   icon: Clock,         cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  missing:     { label: "Missing",     icon: TriangleAlert, cls: "bg-red-500/10 text-red-700 dark:text-red-400" },
  paused:      { label: "Paused",      icon: PauseCircle,   cls: "bg-muted text-muted-foreground" },
  ended:       { label: "Ended",       icon: Flag,          cls: "bg-muted text-muted-foreground" },
  not_started: { label: "Starts soon", icon: CircleDashed,  cls: "bg-blue-500/10 text-blue-700 dark:text-blue-400" },
};

export function StatusChip({ status, className }: { status: AdDayStatus; className?: string }) {
  const c = CHIP[status];
  const Icon = c.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", c.cls, className)}>
      <Icon className="size-3" />
      {c.label}
    </span>
  );
}
