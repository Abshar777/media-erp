"use client";

/**
 * SelectField — the app's dropdown, replacing native <select>.
 *
 * A native <select> opens a list the operating system draws (Windows: white
 * rows, a pale-blue highlight, no padding), which can't be styled to match
 * the app. This keeps the same simple contract — a value and a list of
 * options — on Base UI's Select (accessible listbox: ↑ ↓ Home End, Enter,
 * Esc, type-to-jump, focus returned to the trigger, flips near screen edges).
 *
 *   <SelectField value={priority} onValueChange={setPriority} options={[
 *     { value: "low", label: "Low", dot: "#94a3b8" }, …
 *   ]} />
 *
 * Values may be strings or numbers and are handed back with their own type;
 * "" works as an option ("All", "None"). Options can carry a colour dot, an
 * icon, a second line (`description`), a `group` heading and `disabled`.
 */
import * as React from "react";
import { Select } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type Val = string | number;

export interface SelectOption<V extends Val = string> {
  value: V;
  label: React.ReactNode;
  /** Plain text for type-to-jump and the trigger when `label` is rich. */
  text?: string;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  /** A small colour dot before the label (teams, statuses, priorities). */
  dot?: string;
  group?: string;
  disabled?: boolean;
}

interface Props<V extends Val> {
  value: V | null | undefined;
  onValueChange: (value: V) => void;
  options: ReadonlyArray<SelectOption<V>>;
  /** Shown when nothing (or a value not in the list) is chosen. */
  placeholder?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  /** An icon at the start of the trigger (e.g. a filter's icon). */
  leading?: React.ReactNode;
  disabled?: boolean;
  id?: string;
  /** Blocks a native form submit while empty ("" counts as empty). */
  required?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  className?: string;
  /** Popup width follows the trigger by default; set to fit wider labels. */
  popupClassName?: string;
  /** Error state: red border. */
  invalid?: boolean;
}

// Base UI matches values with Object.is and treats null as "nothing chosen",
// so every value travels as a string with a fixed prefix (keeps "" distinct).
const key = (v: Val) => `v:${typeof v}:${v}`;

const SIZE = {
  sm: "h-8 rounded-md px-2.5 text-xs gap-1.5",
  md: "h-9 rounded-lg px-3 text-sm gap-2",
  lg: "h-10 rounded-lg px-3 text-sm gap-2",
} as const;

function Dot({ color }: { color: string }) {
  return <span aria-hidden className="block size-2 shrink-0 rounded-full" style={{ background: color }} />;
}

export function SelectField<V extends Val = string>({
  value, onValueChange, options, placeholder = "Select…", size = "md", leading,
  disabled, id, required, className, popupClassName, invalid, ...aria
}: Props<V>) {
  const [open, setOpen] = React.useState(false);
  const byKey = React.useMemo(() => new Map(options.map((o) => [key(o.value), o])), [options]);
  const current = value === null || value === undefined ? null : byKey.get(key(value)) ?? null;
  const items = React.useMemo(
    () => options.map((o) => ({ value: key(o.value), label: o.text ?? (typeof o.label === "string" ? o.label : String(o.value)) })),
    [options],
  );

  // Group headings, in first-seen order; ungrouped options first.
  const sections = React.useMemo(() => {
    const out: { group: string | null; options: SelectOption<V>[] }[] = [];
    for (const o of options) {
      const g = o.group ?? null;
      let s = out.find((x) => x.group === g);
      if (!s) { s = { group: g, options: [] }; out.push(s); }
      s.options.push(o);
    }
    return out;
  }, [options]);

  // Esc closes only this list. Handled on the trigger and the popup (focus can be on
  // either), before it reaches a parent's React onKeyDown (e.g. an inline edit row)
  // or a dialog's window listener.
  const closeOnEscape = (e: React.KeyboardEvent) => {
    if (!open || e.key !== "Escape" || e.nativeEvent.isComposing) return;
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
  };

  const renderItem = (o: SelectOption<V>) => (
    <Select.Item
      key={key(o.value)}
      value={key(o.value)}
      disabled={o.disabled}
      label={o.text ?? (typeof o.label === "string" ? o.label : undefined)}
      className={cn(
        "group/item relative flex cursor-default select-none items-start gap-2.5 rounded-lg py-2 pl-2.5 pr-8 text-sm outline-none transition-colors",
        "data-[highlighted]:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-40",
        "data-[selected]:text-primary",
      )}
    >
      {o.dot && <span className="mt-1.5"><Dot color={o.dot} /></span>}
      {o.icon && <span className="mt-0.5 shrink-0 text-muted-foreground group-data-[selected]/item:text-primary [&_svg]:size-4">{o.icon}</span>}
      <span className="min-w-0 flex-1">
        <Select.ItemText className="block truncate font-medium">{o.label}</Select.ItemText>
        {o.description && <span className="block truncate text-xs text-muted-foreground">{o.description}</span>}
      </span>
      <Select.ItemIndicator className="absolute right-2.5 top-2.5 text-primary">
        <Check className="size-4" />
      </Select.ItemIndicator>
    </Select.Item>
  );

  return (
    <Select.Root
      items={items}
      value={current && !(required && current.value === "") ? key(current.value) : null}
      onValueChange={(k) => {
        // Like a native select: re-picking the current option is not a change.
        const o = k == null ? undefined : byKey.get(k as string);
        if (o && (!current || key(o.value) !== key(current.value))) onValueChange(o.value);
      }}
      open={open}
      onOpenChange={setOpen}
      disabled={disabled}
      required={required}
      id={id}
    >
      <Select.Trigger
        onKeyDown={closeOnEscape}
        aria-label={aria["aria-label"]}
        aria-labelledby={aria["aria-labelledby"]}
        className={cn(
          "group/trigger flex w-full min-w-0 items-center border bg-background text-left outline-none transition",
          "hover:border-foreground/20 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30",
          "data-[popup-open]:border-ring data-[popup-open]:ring-2 data-[popup-open]:ring-ring/20",
          "disabled:cursor-not-allowed disabled:opacity-60",
          invalid && "border-red-500 focus-visible:border-red-500 focus-visible:ring-red-500/25",
          SIZE[size],
          className,
        )}
      >
        {leading && <span className="shrink-0 text-muted-foreground [&_svg]:size-4">{leading}</span>}
        {current?.dot && <Dot color={current.dot} />}
        {current?.icon && <span className="shrink-0 text-muted-foreground [&_svg]:size-4">{current.icon}</span>}
        <span className={cn("min-w-0 flex-1 truncate", !current && "text-muted-foreground")}>
          {current ? current.label : placeholder}
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-data-[popup-open]/trigger:rotate-180" />
      </Select.Trigger>

      <Select.Portal>
        <Select.Positioner sideOffset={6} align="start" alignItemWithTrigger={false} collisionPadding={12} className="z-[100] outline-none">
          <Select.Popup
            onKeyDown={closeOnEscape}
            className={cn(
              "max-h-[min(20rem,var(--available-height))] min-w-[max(var(--anchor-width),10rem)] max-w-[var(--available-width)] overflow-y-auto overscroll-contain [scrollbar-width:thin]",
              "rounded-xl border bg-popover p-1 text-popover-foreground shadow-xl shadow-black/10 outline-none dark:shadow-black/40",
              "origin-[var(--transform-origin)] transition-[opacity,transform] duration-100",
              "data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
              popupClassName,
            )}
          >
            <Select.List>
              {sections.map((s, i) => s.group ? (
                <Select.Group key={s.group} className={cn(i > 0 && "mt-1 border-t pt-1")}>
                  <Select.GroupLabel className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {s.group}
                  </Select.GroupLabel>
                  {s.options.map(renderItem)}
                </Select.Group>
              ) : (
                <React.Fragment key="__ungrouped">{s.options.map(renderItem)}</React.Fragment>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

export default SelectField;
