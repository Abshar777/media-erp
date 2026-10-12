"use client";

import { Search, X, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SelectField } from "@/components/ui/select-field";
import { BOARD_COLUMNS } from "@/types/project";
import type { DateFilterOption, ProjectFilters, TaskPriority, TaskStatus } from "@/types/project";

const DATE_OPTS: { value: DateFilterOption; label: string }[] = [
  { value: "",           label: "All Time" },
  { value: "today",      label: "Today" },
  { value: "this_week",  label: "This Week" },
  { value: "this_month", label: "This Month" },
  { value: "this_year",  label: "This Year" },
  { value: "custom",     label: "Custom" },
];

interface Props {
  filters: ProjectFilters;
  onChange: (f: Partial<ProjectFilters>) => void;
  onReset: () => void;
}

export function ProjectFiltersBar({ filters, onChange, onReset }: Props) {
  const statuses = BOARD_COLUMNS;
  const hasActive =
    filters.search || filters.status || filters.priority || filters.date_filter;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Search */}
      <div className="relative flex-1 min-w-[200px] max-w-xs">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
        <input
          value={filters.search}
          onChange={e => onChange({ search: e.target.value })}
          placeholder="Search tasks…"
          className="w-full rounded-lg border bg-background pl-8 pr-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 transition"
        />
        {filters.search && (
          <button
            onClick={() => onChange({ search: "" })}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {/* Date filter chips */}
      <div className="flex items-center gap-1 flex-wrap">
        {DATE_OPTS.map(opt => (
          <button
            key={opt.value}
            onClick={() => onChange({ date_filter: opt.value, date_from: "", date_to: "" })}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium border transition-all",
              filters.date_filter === opt.value
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-border hover:bg-muted"
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Custom date range */}
      {filters.date_filter === "custom" && (
        <div className="flex items-center gap-2">
          <Calendar className="size-3.5 text-muted-foreground" />
          <input
            type="date"
            value={filters.date_from}
            onChange={e => onChange({ date_from: e.target.value })}
            className="rounded-lg border bg-background px-2 py-1.5 text-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 transition"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <input
            type="date"
            value={filters.date_to}
            onChange={e => onChange({ date_to: e.target.value })}
            className="rounded-lg border bg-background px-2 py-1.5 text-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 transition"
          />
        </div>
      )}

      {/* Status filter */}
      <SelectField<TaskStatus | "">
        aria-label="Status"
        size="sm"
        value={filters.status}
        onValueChange={v => onChange({ status: v })}
        className="w-auto min-w-[8.5rem] text-muted-foreground"
        options={[
          { value: "", label: "All Statuses" },
          ...statuses.map(s => ({ value: s.key as TaskStatus, label: s.label, dot: s.color })),
        ]}
      />

      {/* Priority filter */}
      <SelectField<TaskPriority | "">
        aria-label="Priority"
        size="sm"
        value={filters.priority}
        onValueChange={v => onChange({ priority: v })}
        className="w-auto min-w-[8rem] text-muted-foreground"
        options={[
          { value: "", label: "All Priorities" },
          { value: "low", label: "Low", dot: "#94a3b8" },
          { value: "medium", label: "Medium", dot: "#f97316" },
          { value: "high", label: "High", dot: "#ef4444" },
        ]}
      />

      {/* Reset */}
      {hasActive && (
        <Button variant="ghost" size="sm" onClick={onReset} className="text-xs h-8 gap-1">
          <X className="size-3" />
          Clear
        </Button>
      )}
    </div>
  );
}
