"use client";

import { cn } from "@/lib/utils";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { SelectField } from "@/components/ui/select-field";
import type { ReportDimension } from "@/types/report";

export const PLATFORMS = [
  { value: "",              label: "All platforms" },
  { value: "google_ads",   label: "Google Ads"    },
  { value: "facebook_ads", label: "Facebook Ads"  },
  { value: "linkedin_ads", label: "LinkedIn Ads"  },
  { value: "ga4",          label: "GA4"           },
  { value: "tiktok_ads",   label: "TikTok Ads"    },
];

export const ALL_DIMENSIONS: { value: ReportDimension; label: string }[] = [
  { value: "platform", label: "Platform" },
  { value: "campaign", label: "Campaign" },
  { value: "date",     label: "Date"     },
  { value: "device",   label: "Device"   },
  { value: "country",  label: "Country"  },
];

interface FilterPanelProps {
  platform: string;
  onPlatformChange: (v: string) => void;
  dimensions: ReportDimension[];
  onDimensionsChange: (d: ReportDimension[]) => void;
  dateFrom: string;
  dateTo: string;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
  className?: string;
}

export function FilterPanel({
  platform,
  onPlatformChange,
  dimensions,
  onDimensionsChange,
  dateFrom,
  dateTo,
  onFromChange,
  onToChange,
  className,
}: FilterPanelProps) {
  function toggleDim(d: ReportDimension) {
    if (dimensions.includes(d)) {
      if (dimensions.length === 1) return; // keep at least one
      onDimensionsChange(dimensions.filter((x) => x !== d));
    } else {
      onDimensionsChange([...dimensions, d]);
    }
  }

  return (
    <div className={cn("space-y-4", className)}>
      {/* Platform filter */}
      <div className="space-y-1.5">
        <label htmlFor="filter-panel-platform" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Platform
        </label>
        <SelectField
          id="filter-panel-platform"
          size="sm"
          value={platform}
          onValueChange={(v) => onPlatformChange(v)}
          options={PLATFORMS}
          className="max-w-xs"
        />
      </div>

      {/* Group by (dimensions) */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Group by
        </label>
        <div className="flex flex-wrap gap-2">
          {ALL_DIMENSIONS.map(({ value, label }) => {
            const active = dimensions.includes(value);
            return (
              <button
                key={value}
                type="button"
                onClick={() => toggleDim(value)}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-xs font-medium transition-all",
                  active
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground"
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Date range */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Date range
        </label>
        <DateRangePicker
          dateFrom={dateFrom}
          dateTo={dateTo}
          onFromChange={onFromChange}
          onToChange={onToChange}
        />
      </div>
    </div>
  );
}
