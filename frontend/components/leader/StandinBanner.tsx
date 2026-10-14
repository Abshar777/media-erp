"use client";

import { UserRoundCheck } from "lucide-react";
import { standinDay } from "@/hooks/useStandin";

export interface StandinTeamInfo {
  team_id: string;
  team_name: string;
  leader_name: string;
  end_date: string;
  can_review: boolean;
}

/**
 * Shown on the Leader Desk to someone who is here only as a stand-in: whose
 * desk this is, which teams, until when, and what they may do.
 */
export function StandinBanner({ items }: { items: StandinTeamInfo[] }) {
  if (!items.length) return null;
  // One line per leader (a stand-in may cover two teams for the same leader).
  const byLeader = new Map<string, StandinTeamInfo[]>();
  for (const i of items) byLeader.set(i.leader_name, [...(byLeader.get(i.leader_name) ?? []), i]);
  return (
    <div className="space-y-2">
      {[...byLeader.entries()].map(([leader, list]) => {
        const end = list.map((x) => x.end_date).sort().at(-1) ?? "";
        const review = list.some((x) => x.can_review);
        return (
          <div key={leader}
            className="flex items-start gap-3 rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-3 text-sm">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-700 dark:text-violet-300">
              <UserRoundCheck className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="font-semibold text-violet-900 dark:text-violet-100">
                You&apos;re standing in for {leader}
                <span className="font-normal text-violet-800/80 dark:text-violet-200/80">
                  {" "}· {list.map((x) => x.team_name).join(", ")} · until {standinDay(end)}
                </span>
              </p>
              <p className="mt-0.5 text-xs text-violet-800/80 dark:text-violet-200/80">
                Give new work to your teammates and handle reedits{review ? ", and review submissions (not your own)" : ""}.
                {review ? "" : " Submissions stay with the leader."}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
