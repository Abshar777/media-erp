"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Camera, Heart, MessageCircle, Users, Eye,
  Activity, ExternalLink, X, Send, RefreshCw,
  Loader2, ImageIcon, Video, Grid3x3, ChevronRight,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { useConnectors } from "@/hooks/useConnectors";
import {
  useInstagramLoginAccount,
  useInstagramLoginPosts,
  useInstagramLoginInsights,
  useInstagramLoginPostComments,
  useReplyToInstagramComment,
  type IGPost,
} from "@/hooks/useSocial";
import type { Connector } from "@/types/connector";
import { fmtDateOnly } from "@/lib/datetime";
import { SelectField } from "@/components/ui/select-field";

// ── helpers ───────────────────────────────────────────────────────────────────

function today() { return new Date().toISOString().slice(0, 10); }
function daysAgo(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function fmtDate(iso: string) {
  return fmtDateOnly(iso, { day: "2-digit", month: "short", year: "2-digit" });
}
function fmtShort(iso: string) {
  return fmtDateOnly(iso, { day: "2-digit", month: "short" });
}
function formatCount(n: number | undefined) {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
function engagementRate(post: IGPost, followers?: number) {
  if (!followers || followers === 0) return null;
  return (((post.like_count ?? 0) + (post.comments_count ?? 0)) / followers * 100).toFixed(2) + "%";
}

function MediaIcon({ type }: { type: IGPost["media_type"] }) {
  if (type === "VIDEO") return <Video className="size-3 text-white" />;
  if (type === "CAROUSEL_ALBUM") return <Grid3x3 className="size-3 text-white" />;
  return <ImageIcon className="size-3 text-white" />;
}

const igGradient = "linear-gradient(135deg, #E1306C, #833AB4, #405DE6)";

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, icon, iconBg, loading, period,
}: {
  label: string; value: number | undefined; icon: React.ReactNode;
  iconBg: string; loading: boolean; period: string;
}) {
  return (
    <div className="rounded-2xl border bg-card p-5 flex flex-col gap-3 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <div className={`size-9 rounded-xl flex items-center justify-center ${iconBg}`}>
          {icon}
        </div>
      </div>
      {loading
        ? <div className="h-8 w-20 rounded-lg bg-muted animate-pulse" />
        : <p className="text-3xl font-bold leading-none">{value != null ? formatCount(value) : "—"}</p>
      }
      <p className="text-xs text-muted-foreground">{period}</p>
    </div>
  );
}

// ── Comment panel ─────────────────────────────────────────────────────────────

function CommentPanel({
  connectorId, post, onClose,
}: {
  connectorId: string; post: IGPost; onClose: () => void;
}) {
  const { data: comments = [], isLoading } = useInstagramLoginPostComments(connectorId, post.id);
  const reply = useReplyToInstagramComment();
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");

  function handleReply(commentId: string) {
    if (!replyText.trim()) return;
    reply.mutate(
      { connectorId, postId: post.id, commentId, message: replyText.trim() },
      { onSuccess: () => { setReplyText(""); setReplyingTo(null); } }
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Post mini-header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b shrink-0">
        <div className="size-10 rounded-lg overflow-hidden bg-muted shrink-0">
          {(post.thumbnail_url ?? post.media_url)
            ? <img src={post.thumbnail_url ?? post.media_url} alt="" className="size-full object-cover" />
            : <div className="size-full flex items-center justify-center"><Camera className="size-4 text-muted-foreground" /></div>
          }
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{post.caption || "No caption"}</p>
          <p className="text-xs text-muted-foreground">{fmtDate(post.timestamp)}</p>
        </div>
        <button onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:bg-muted transition-colors">
          <X className="size-4" />
        </button>
      </div>

      {/* Comments list */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {isLoading && (
          <div className="flex items-center justify-center py-10 gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading comments…
          </div>
        )}
        {!isLoading && comments.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
            <MessageCircle className="size-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No comments yet</p>
          </div>
        )}
        {comments.map((c) => (
          <div key={c.id} className="space-y-2">
            <div className="flex gap-2.5">
              <div className="size-7 rounded-full bg-muted flex items-center justify-center shrink-0 text-[10px] font-bold uppercase text-muted-foreground">
                {(c.username ?? "?")[0]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="rounded-xl rounded-tl-sm bg-muted/50 px-3 py-2">
                  <p className="text-xs font-semibold">@{c.username ?? "user"}</p>
                  <p className="text-sm mt-0.5">{c.text}</p>
                </div>
                <div className="flex items-center gap-3 mt-1 px-1">
                  <span className="text-[10px] text-muted-foreground">{fmtDate(c.timestamp)}</span>
                  <button
                    onClick={() => setReplyingTo(replyingTo === c.id ? null : c.id)}
                    className="text-[10px] font-medium text-primary hover:underline"
                  >
                    Reply
                  </button>
                </div>
                {c.replies?.data?.map((r) => (
                  <div key={r.id} className="flex gap-2 mt-2 ml-4">
                    <div className="size-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-[9px] font-bold uppercase text-primary">
                      {(r.username ?? "?")[0]}
                    </div>
                    <div className="rounded-xl rounded-tl-sm bg-primary/5 px-2.5 py-1.5 flex-1">
                      <p className="text-[10px] font-semibold text-primary">@{r.username ?? "you"}</p>
                      <p className="text-xs mt-0.5">{r.text}</p>
                    </div>
                  </div>
                ))}
                {replyingTo === c.id && (
                  <div className="flex items-center gap-2 mt-2 ml-4">
                    <input
                      autoFocus
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleReply(c.id)}
                      placeholder="Write a reply…"
                      className="flex-1 rounded-xl border bg-background px-3 py-1.5 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
                    />
                    <button
                      onClick={() => handleReply(c.id)}
                      disabled={!replyText.trim() || reply.isPending}
                      className="rounded-xl bg-primary p-1.5 text-primary-foreground disabled:opacity-50 hover:bg-primary/90 transition-colors"
                    >
                      {reply.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Post row ──────────────────────────────────────────────────────────────────

function PostRow({
  post, followers, isSelected, onSelect,
}: {
  post: IGPost; followers?: number; isSelected: boolean; onSelect: () => void;
}) {
  const eng = engagementRate(post, followers);
  const thumb = post.thumbnail_url ?? post.media_url;

  return (
    <tr
      onClick={onSelect}
      className={`cursor-pointer border-b transition-colors hover:bg-muted/30 ${isSelected ? "bg-primary/5" : ""}`}
    >
      <td className="py-3 pl-4 pr-2">
        <div className="relative size-10 rounded-lg overflow-hidden bg-muted shrink-0">
          {thumb
            ? <img src={thumb} alt="" className="size-full object-cover" />
            : <div className="size-full flex items-center justify-center bg-gradient-to-br from-pink-500/20 to-purple-500/20">
                <Camera className="size-4 text-muted-foreground" />
              </div>
          }
          <div className="absolute bottom-0.5 right-0.5 rounded-sm p-0.5" style={{ background: igGradient }}>
            <MediaIcon type={post.media_type} />
          </div>
        </div>
      </td>
      <td className="py-3 px-2 max-w-[200px]">
        {post.caption
          ? <p className="text-sm truncate">{post.caption}</p>
          : <p className="text-sm italic text-muted-foreground">No caption</p>
        }
        {post.permalink && (
          <a
            href={post.permalink} target="_blank" rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-primary mt-0.5"
          >
            <ExternalLink className="size-2.5" /> View on Camera
          </a>
        )}
      </td>
      <td className="py-3 px-2 text-sm text-muted-foreground whitespace-nowrap">{fmtDate(post.timestamp)}</td>
      <td className="py-3 px-2">
        <span className="flex items-center gap-1 text-sm">
          <Heart className="size-3.5 text-rose-400" />{formatCount(post.like_count)}
        </span>
      </td>
      <td className="py-3 px-2">
        <span className="flex items-center gap-1 text-sm">
          <MessageCircle className="size-3.5 text-blue-400" />{formatCount(post.comments_count)}
        </span>
      </td>
      <td className="py-3 pl-2 pr-3">
        {eng
          ? <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">{eng}</span>
          : <span className="text-xs text-muted-foreground">—</span>
        }
      </td>
      <td className="py-3 pr-4">
        <ChevronRight className={`size-4 text-muted-foreground transition-transform ${isSelected ? "rotate-90 text-primary" : ""}`} />
      </td>
    </tr>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const { data: allConnectors = [] } = useConnectors();
  const igConnectors = allConnectors.filter((c: Connector) => c.platform === "instagram_login");

  const [connectorId, setConnectorId] = useState("");
  const activeId = connectorId || igConnectors[0]?.id || "";
  const activeConnector = igConnectors.find((c: Connector) => c.id === activeId);
  const isConnected = activeConnector?.status === "connected";

  // Date range
  const [dateFrom, setDateFrom] = useState(daysAgo(30));
  const [dateTo, setDateTo]   = useState(today());
  const [refreshKey, setRefreshKey] = useState(0);

  function setPreset(n: number) {
    setDateFrom(daysAgo(n));
    setDateTo(today());
    setRefreshKey((k) => k + 1);
  }

  // Data
  const { data: account, isLoading: accLoading } = useInstagramLoginAccount(activeId);
  const { data: posts = [], isLoading: postsLoading, refetch: refetchPosts } = useInstagramLoginPosts(activeId);
  const { data: insights, isLoading: insightsLoading, refetch: refetchInsights } = useInstagramLoginInsights(activeId, dateFrom, dateTo);

  const [selectedPost, setSelectedPost] = useState<IGPost | null>(null);

  const handleRefresh = useCallback(() => {
    refetchPosts();
    refetchInsights();
    setRefreshKey((k) => k + 1);
  }, [refetchPosts, refetchInsights]);

  // Build chart data by merging insight series on end_time
  const chartData = (() => {
    if (!insights) return [];
    const intr = insights.total_interactions ?? [];
    const rch = insights.reach ?? [];
    const pv  = insights.profile_views ?? [];
    const map: Record<string, { date: string; "Total Interactions"?: number; Reach?: number; "Profile Views"?: number }> = {};
    for (const p of intr) {
      const d = fmtShort(p.end_time);
      map[d] = { ...(map[d] ?? { date: d }), "Total Interactions": p.value };
    }
    for (const p of rch) {
      const d = fmtShort(p.end_time);
      map[d] = { ...(map[d] ?? { date: d }), Reach: p.value };
    }
    for (const p of pv) {
      const d = fmtShort(p.end_time);
      map[d] = { ...(map[d] ?? { date: d }), "Profile Views": p.value };
    }
    return Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
  })();

  const totalInteractions = insights?.total_interactions?.reduce((s, p) => s + p.value, 0);
  const totalReach        = insights?.reach?.reduce((s, p) => s + p.value, 0);
  const totalProfileViews = insights?.profile_views?.reduce((s, p) => s + p.value, 0);

  const dayCount = Math.round((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400000) || 30;

  // No connectors
  if (igConnectors.length === 0) {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold">Camera Analytics</h1>
            <p className="text-sm text-muted-foreground">Account insights powered by instagram_business_manage_insights</p>
          </div>
        </div>
        <div className="flex flex-col items-center justify-center py-24 gap-5 rounded-2xl border bg-card">
          <div className="size-20 rounded-2xl flex items-center justify-center shadow-lg" style={{ background: igGradient }}>
            <Camera className="size-10 text-white" />
          </div>
          <div className="text-center">
            <p className="font-semibold text-lg">No Instagram account connected</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-xs">
              Connect your Instagram Business account in Connectors to see analytics.
            </p>
          </div>
          <a href="/connectors" className="rounded-xl border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors">
            Go to Connectors
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Camera Analytics</h1>
          <p className="text-sm text-muted-foreground">Account insights powered by instagram_business_manage_insights</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Connector selector */}
          {igConnectors.length > 1 && (
            <SelectField
              aria-label="Instagram account"
              value={activeId}
              onValueChange={(v) => { setConnectorId(v); setSelectedPost(null); }}
              options={igConnectors.map((c: Connector) => ({ value: c.id, label: c.name }))}
              className="w-auto min-w-[10rem] rounded-xl"
            />
          )}

          {/* Preset buttons */}
          {["7", "30", "90"].map((n) => (
            <button
              key={n}
              onClick={() => setPreset(+n)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium border transition-colors ${
                dayCount === +n ? "bg-foreground text-background border-foreground" : "bg-background hover:bg-muted"
              }`}
            >
              {n}d
            </button>
          ))}

          {/* Date inputs */}
          <input
            type="date" value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="rounded-xl border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
          />
          <span className="text-muted-foreground">→</span>
          <input
            type="date" value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="rounded-xl border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
          />

          {/* Refresh */}
          <button
            onClick={handleRefresh}
            className="flex items-center gap-1.5 rounded-xl border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
          >
            <RefreshCw className={`size-3.5 ${insightsLoading || postsLoading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Disconnected state */}
      {!isConnected && activeConnector && (
        <div className="flex flex-col items-center justify-center py-16 gap-4 rounded-2xl border border-dashed bg-card">
          <div className="size-14 rounded-2xl flex items-center justify-center opacity-60" style={{ background: igGradient }}>
            <Camera className="size-7 text-white" />
          </div>
          <div className="text-center">
            <p className="font-medium">{activeConnector.name} is disconnected</p>
            <p className="text-sm text-muted-foreground mt-1">Reconnect this account in Connectors to view analytics.</p>
          </div>
          <a href="/connectors" className="rounded-xl border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors">
            Reconnect
          </a>
        </div>
      )}

      {/* ── Connected content ── */}
      {isConnected && (
        <div className={`grid gap-5 ${selectedPost ? "lg:grid-cols-[1fr_400px]" : "grid-cols-1"}`}>
          <div className="space-y-5 min-w-0">

            {/* Account card */}
            <div className="rounded-2xl border bg-card px-5 py-4 flex items-center gap-4 shadow-sm">
              <div className="size-11 rounded-full overflow-hidden shrink-0 shadow" style={{ background: igGradient }}>
                {account?.profile_picture_url
                  ? <img src={account.profile_picture_url} alt="" className="size-full object-cover" />
                  : <div className="size-full flex items-center justify-center">
                      <Camera className="size-5 text-white" />
                    </div>
                }
              </div>
              <div className="flex-1 min-w-0">
                {accLoading
                  ? <div className="space-y-1.5"><div className="h-4 w-28 rounded bg-muted animate-pulse" /><div className="h-3 w-16 rounded bg-muted animate-pulse" /></div>
                  : <>
                      <p className="font-bold text-sm leading-tight">@{account?.username ?? activeConnector?.name}</p>
                      <p className="text-xs text-muted-foreground">{account?.name ?? ""}</p>
                    </>
                }
              </div>
              <div className="flex items-center gap-6 shrink-0 text-right">
                <div>
                  <p className="text-xl font-bold leading-none">{formatCount(account?.followers_count)}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Followers</p>
                </div>
                <div>
                  <p className="text-xl font-bold leading-none">{formatCount(account?.media_count)}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Posts</p>
                </div>
              </div>
            </div>

            {/* KPI cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <KpiCard
                label="Total Interactions"
                value={totalInteractions}
                icon={<Eye className="size-4 text-blue-500" />}
                iconBg="bg-blue-500/10"
                loading={insightsLoading}
                period={`Last ${dayCount} days`}
              />
              <KpiCard
                label="Reach"
                value={totalReach}
                icon={<Activity className="size-4 text-purple-500" />}
                iconBg="bg-purple-500/10"
                loading={insightsLoading}
                period={`Last ${dayCount} days`}
              />
              <KpiCard
                label="Profile Views"
                value={totalProfileViews}
                icon={<Users className="size-4 text-rose-500" />}
                iconBg="bg-rose-500/10"
                loading={insightsLoading}
                period={`Last ${dayCount} days`}
              />
            </div>

            {/* Chart */}
            <div className="rounded-2xl border bg-card p-5 shadow-sm">
              <p className="text-sm font-semibold">Impressions &amp; Reach Over Time</p>
              <p className="text-xs text-muted-foreground mb-4">Daily account-level metrics</p>
              {insightsLoading ? (
                <div className="flex items-center justify-center h-48 gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Loading…
                </div>
              ) : chartData.length === 0 || chartData.every(d => !d["Total Interactions"] && !d.Reach && !d["Profile Views"]) ? (
                <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
                  No data for this period
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.08} />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={36} />
                    <Tooltip
                      contentStyle={{ borderRadius: 12, fontSize: 12, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }}
                      labelStyle={{ fontWeight: 600 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} />
                    <Line type="monotone" dataKey="Total Interactions" stroke="#3b82f6" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="Reach"         stroke="#a855f7" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="Profile Views" stroke="#f43f5e" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Post engagement table */}
            <div className="rounded-2xl border bg-card shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b">
                <div>
                  <p className="text-sm font-semibold">Post-level Engagement</p>
                  <p className="text-xs text-muted-foreground">Individual post performance</p>
                </div>
                {postsLoading
                  ? <RefreshCw className="size-3.5 animate-spin text-muted-foreground" />
                  : <span className="text-xs text-muted-foreground">{posts.length} posts</span>
                }
              </div>

              {postsLoading ? (
                <div className="flex items-center justify-center py-16 gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Loading posts…
                </div>
              ) : posts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <ImageIcon className="size-8 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">No posts found</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/20">
                        <th className="py-2.5 pl-4 pr-2 w-14" />
                        <th className="py-2.5 px-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Caption</th>
                        <th className="py-2.5 px-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Date</th>
                        <th className="py-2.5 px-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Likes</th>
                        <th className="py-2.5 px-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Comments</th>
                        <th className="py-2.5 pl-2 pr-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Engagement</th>
                        <th className="py-2.5 pr-4 w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {posts.map((post) => (
                        <PostRow
                          key={post.id}
                          post={post}
                          followers={account?.followers_count}
                          isSelected={selectedPost?.id === post.id}
                          onSelect={() => setSelectedPost(selectedPost?.id === post.id ? null : post)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Right: comment panel */}
          <AnimatePresence>
            {selectedPost && (
              <motion.div
                key={selectedPost.id}
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 30 }}
                className="rounded-2xl border bg-card shadow-sm overflow-hidden flex flex-col"
                style={{ maxHeight: "80vh", position: "sticky", top: "1rem" }}
              >
                <div className="px-4 py-3 border-b shrink-0" style={{ background: igGradient }}>
                  <p className="text-xs font-semibold text-white/90 uppercase tracking-wider">Comments &amp; Replies</p>
                </div>
                <CommentPanel
                  connectorId={activeId}
                  post={selectedPost}
                  onClose={() => setSelectedPost(null)}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
