"use client";

import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Camera, Share2, ImageIcon, Link2, Send,
  User, Heart, MessageCircle, Bookmark, MoreHorizontal,
  CheckCircle2, AlertCircle, Loader2, Video, Grid3x3,
  PenSquare, ExternalLink, RefreshCw, X, Upload,
  BarChart3, Users, TrendingUp, Wifi, WifiOff, Mail,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import { Field, FieldLabel } from "@/components/ui/field";
import { useConnectors } from "@/hooks/useConnectors";
import type { Connector } from "@/types/connector";
import { fmtDate } from "@/lib/datetime";
import {
  useFacebookPages,
  useInstagramLoginAccount,
  useInstagramLoginConversations,
  useFacebookConversations,
  usePublishFacebookPost,
  usePublishInstagramLoginPost,
  useInstagramLoginPosts,
  useFacebookPosts,
  useInstagramLoginPostComments,
  useFacebookPostComments,
  useUploadMedia,
  type IGPost,
  type FBPost,
  type IGComment,
  type FBComment,
  type FacebookPage,
} from "@/hooks/useSocial";

type Platform   = "instagram" | "facebook";
type PageTab    = "overview" | "create" | "posts";
type PostStatus = "idle" | "publishing" | "success" | "error";

const igGradient = "linear-gradient(135deg, #E1306C, #833AB4, #405DE6)";

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string) {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60) return "just now";
    const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24); if (d < 30)  return `${d}d ago`;
    return fmtDate(iso);
  } catch { return ""; }
}

function formatCount(n: number | undefined): string {
  if (n === undefined || n === null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// ── Overview sub-components ───────────────────────────────────────────────────

function StatTile({
  value, label, icon, highlight, onClick,
}: { value: string | number; label: string; icon: React.ReactNode; highlight?: boolean; onClick?: () => void }) {
  const cls = `rounded-xl border p-3 text-center flex flex-col items-center gap-1 transition-colors ${
    highlight ? "border-primary/30 bg-primary/5" : "bg-muted/30"
  } ${onClick ? "cursor-pointer hover:border-primary/40 hover:bg-primary/10" : ""}`;
  return onClick ? (
    <button type="button" className={cls} onClick={onClick}>
      <div className="text-muted-foreground">{icon}</div>
      <p className="text-xl font-bold leading-none">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </button>
  ) : (
    <div className={cls}>
      <div className="text-muted-foreground">{icon}</div>
      <p className="text-xl font-bold leading-none">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const connected = status === "connected";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
      connected
        ? "bg-green-500/15 text-green-600 dark:text-green-400"
        : status === "error"
        ? "bg-red-500/15 text-red-600 dark:text-red-400"
        : "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400"
    }`}>
      {connected ? <Wifi className="size-2.5" /> : <WifiOff className="size-2.5" />}
      {connected ? "Connected" : status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

// ── Instagram Login account card ──────────────────────────────────────────────

function IGLoginCard({
  connector, onViewPosts, onViewDMs,
}: {
  connector: Connector;
  onViewPosts: (connectorId: string) => void;
  onViewDMs: () => void;
}) {
  const { data: account, isLoading: accLoading }    = useInstagramLoginAccount(connector.id);
  const { data: posts   = [], isLoading: postsLoad } = useInstagramLoginPosts(connector.id);
  const { data: convs   = [], isLoading: convsLoad } = useInstagramLoginConversations(connector.id);
  const statsLoading = accLoading || postsLoad || convsLoad;
  const unread = convs.reduce((n, c) => n + (c.unread_count ?? 0), 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border bg-card overflow-hidden shadow-sm hover:shadow-md transition-all"
    >
      {/* Gradient header */}
      <div className="h-20 relative" style={{ background: igGradient }}>
        <div className="absolute bottom-0 left-4 translate-y-1/2 z-10">
          <div className="size-12 rounded-xl border-[3px] border-card overflow-hidden shadow-md bg-muted flex items-center justify-center">
            {account?.profile_picture_url
              ? <img src={account.profile_picture_url} alt="" className="size-full object-cover" />
              : <User className="size-5 text-muted-foreground" />
            }
          </div>
        </div>
        <div className="absolute top-2.5 right-3">
          <StatusBadge status={connector.status} />
        </div>
        <div className="absolute bottom-2 right-3">
          <Camera className="size-4 text-white/70" />
        </div>
      </div>

      <div className="pt-8 px-4 pb-4 space-y-3">
        {/* Identity */}
        <div>
          <p className="font-semibold text-sm leading-tight truncate">
            {account?.username ? `@${account.username}` : connector.name}
          </p>
          <p className="text-[11px] text-muted-foreground">Instagram Direct</p>
          {connector.last_synced_at && (
            <p className="text-[10px] text-muted-foreground/50 mt-0.5">Last sync {timeAgo(connector.last_synced_at)}</p>
          )}
        </div>

        {/* Stats */}
        {statsLoading ? (
          <div className="grid grid-cols-3 gap-2">
            {[0,1,2].map(i => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            <StatTile icon={<Users className="size-3.5" />} value={formatCount(account?.followers_count)} label="Followers" />
            <StatTile
              icon={<ImageIcon className="size-3.5" />}
              value={formatCount(posts.length)}
              label="Posts"
              onClick={connector.status === "connected" ? () => onViewPosts(connector.id) : undefined}
            />
            <StatTile
              icon={<Mail className="size-3.5" />}
              value={convs.length}
              label="DMs"
              highlight={unread > 0}
              onClick={connector.status === "connected" ? onViewDMs : undefined}
            />
          </div>
        )}
        {unread > 0 && (
          <button
            type="button"
            onClick={onViewDMs}
            className="w-full flex items-center gap-1.5 rounded-lg bg-primary/10 border border-primary/20 px-2.5 py-1.5 hover:bg-primary/20 transition-colors"
          >
            <MessageCircle className="size-3 text-primary" />
            <p className="text-[11px] text-primary font-medium">{unread} unread DM{unread !== 1 ? "s" : ""} — tap to open</p>
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ── Facebook Page card ────────────────────────────────────────────────────────

function FBPageAccountCard({
  connectorId, page, connectorStatus, lastSynced, onViewPosts, onViewDMs,
}: {
  connectorId: string;
  page: FacebookPage;
  connectorStatus: string;
  lastSynced: string | null;
  onViewPosts: (connectorId: string, pageId: string) => void;
  onViewDMs: () => void;
}) {
  const { data: posts = [], isLoading: postsLoad } = useFacebookPosts(connectorId, page.id);
  const { data: convs = [], isLoading: convsLoad } = useFacebookConversations(connectorId, page.id);
  const statsLoading = postsLoad || convsLoad;
  const unread = convs.reduce((n, c) => n + (c.unread_count ?? 0), 0);
  const pageAvatar = page.picture?.data?.url;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border bg-card overflow-hidden shadow-sm hover:shadow-md transition-all"
    >
      {/* Blue header */}
      <div className="h-20 relative bg-[#1877F2]">
        <div className="absolute bottom-0 left-4 translate-y-1/2 z-10">
          <div className="size-12 rounded-xl border-[3px] border-card overflow-hidden shadow-md bg-[#1877F2] flex items-center justify-center">
            {pageAvatar
              ? <img src={pageAvatar} alt="" className="size-full object-cover" />
              : <Share2 className="size-5 text-white" />
            }
          </div>
        </div>
        <div className="absolute top-2.5 right-3">
          <StatusBadge status={connectorStatus} />
        </div>
        <div className="absolute bottom-2 right-3">
          <Share2 className="size-4 text-white/70" />
        </div>
      </div>

      <div className="pt-8 px-4 pb-4 space-y-3">
        {/* Identity */}
        <div>
          <p className="font-semibold text-sm leading-tight truncate">{page.name}</p>
          <p className="text-[11px] text-muted-foreground">Facebook Page</p>
          {lastSynced && (
            <p className="text-[10px] text-muted-foreground/50 mt-0.5">Last sync {timeAgo(lastSynced)}</p>
          )}
        </div>

        {/* Stats */}
        {statsLoading ? (
          <div className="grid grid-cols-2 gap-2">
            {[0,1].map(i => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <StatTile
              icon={<ImageIcon className="size-3.5" />}
              value={formatCount(posts.length)}
              label="Posts"
              onClick={connectorStatus === "connected" ? () => onViewPosts(connectorId, page.id) : undefined}
            />
            <StatTile
              icon={<Mail className="size-3.5" />}
              value={convs.length}
              label="DMs"
              highlight={unread > 0}
              onClick={connectorStatus === "connected" ? onViewDMs : undefined}
            />
          </div>
        )}
        {unread > 0 && (
          <button
            type="button"
            onClick={onViewDMs}
            className="w-full flex items-center gap-1.5 rounded-lg bg-primary/10 border border-primary/20 px-2.5 py-1.5 hover:bg-primary/20 transition-colors"
          >
            <MessageCircle className="size-3 text-primary" />
            <p className="text-[11px] text-primary font-medium">{unread} unread DM{unread !== 1 ? "s" : ""} — tap to open</p>
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ── Facebook connector → expands to one card per page ─────────────────────────

function FBConnectorSection({
  connector, onViewPosts, onViewDMs,
}: {
  connector: Connector;
  onViewPosts: (connectorId: string, pageId: string) => void;
  onViewDMs: () => void;
}) {
  const { data: pages = [], isLoading } = useFacebookPages(connector.id);

  if (isLoading) {
    return (
      <>
        {[0].map(i => (
          <div key={i} className="rounded-2xl border bg-card overflow-hidden">
            <div className="h-20 bg-muted animate-pulse" />
            <div className="p-4 pt-8 space-y-3">
              <div className="h-4 w-2/3 rounded bg-muted animate-pulse" />
              <div className="grid grid-cols-2 gap-2">
                <div className="h-14 rounded-xl bg-muted animate-pulse" />
                <div className="h-14 rounded-xl bg-muted animate-pulse" />
              </div>
            </div>
          </div>
        ))}
      </>
    );
  }

  if (pages.length === 0) {
    return (
      <div className="rounded-2xl border bg-card p-6 text-center space-y-2">
        <Share2 className="size-8 text-muted-foreground/30 mx-auto" />
        <p className="text-xs font-medium">{connector.name}</p>
        <p className="text-[11px] text-muted-foreground">No Facebook Pages found</p>
        <StatusBadge status={connector.status} />
      </div>
    );
  }

  return (
    <>
      {pages.map((page) => (
        <FBPageAccountCard
          key={page.id}
          connectorId={connector.id}
          page={page}
          connectorStatus={connector.status}
          lastSynced={connector.last_synced_at}
          onViewPosts={onViewPosts}
          onViewDMs={onViewDMs}
        />
      ))}
    </>
  );
}

// ── Overview panel ────────────────────────────────────────────────────────────

function OverviewPanel({
  igConnectors,
  fbConnectors,
  onViewPosts,
  onViewDMs,
}: {
  igConnectors: Connector[];
  fbConnectors: Connector[];
  onViewPosts: (connectorId: string, pageId?: string) => void;
  onViewDMs: () => void;
}) {
  const totalAccounts     = igConnectors.length + fbConnectors.length;
  const connectedAccounts = [...igConnectors, ...fbConnectors].filter(c => c.status === "connected").length;

  if (totalAccounts === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-28 gap-5 rounded-2xl border bg-card">
        <div className="flex gap-3">
          <div className="size-16 rounded-2xl flex items-center justify-center shadow-md" style={{ background: igGradient }}>
            <Camera className="size-8 text-white" />
          </div>
          <div className="size-16 rounded-2xl bg-[#1877F2] flex items-center justify-center shadow-md">
            <Share2 className="size-8 text-white" />
          </div>
        </div>
        <div className="text-center">
          <p className="font-semibold text-base">No accounts connected</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs">
            Connect your Instagram or Facebook accounts to see your unified inbox, post stats, and follower counts.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => window.location.href = "/connectors"}>
          Go to Connectors
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary bar */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          icon={<BarChart3 className="size-4" />}
          value={totalAccounts}
          label="Total Accounts"
        />
        <StatTile
          icon={<Wifi className="size-4" />}
          value={connectedAccounts}
          label="Connected"
          highlight={connectedAccounts > 0}
        />
        <div
          className="rounded-xl border p-3 text-center flex flex-col items-center gap-1"
          style={{ background: "linear-gradient(135deg,rgba(225,48,108,.08),rgba(64,93,230,.08))" }}
        >
          <Camera className="size-4 text-pink-500" />
          <p className="text-xl font-bold leading-none">{igConnectors.length}</p>
          <p className="text-[11px] text-muted-foreground">Instagram</p>
        </div>
        <div
          className="rounded-xl border p-3 text-center flex flex-col items-center gap-1"
          style={{ background: "rgba(24,119,242,.07)" }}
        >
          <Share2 className="size-4 text-blue-500" />
          <p className="text-xl font-bold leading-none">{fbConnectors.length}</p>
          <p className="text-[11px] text-muted-foreground">Facebook</p>
        </div>
      </div>

      {/* Account cards grid */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">All Accounts</h2>
          <span className="text-xs text-muted-foreground">({totalAccounts})</span>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {igConnectors.map((c) => (
            <IGLoginCard
              key={c.id}
              connector={c}
              onViewPosts={(id) => onViewPosts(id)}
              onViewDMs={onViewDMs}
            />
          ))}
          {fbConnectors.map((c) => (
            <FBConnectorSection
              key={c.id}
              connector={c}
              onViewPosts={onViewPosts}
              onViewDMs={onViewDMs}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── MediaInput — file upload OR paste a URL ───────────────────────────────────

function MediaInput({
  label,
  value,
  onChange,
  accept = "image/*",
  placeholder = "https://example.com/image.jpg",
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
  accept?: string;
  placeholder?: string;
}) {
  const upload = useUploadMedia();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file) return;
      const result = await upload.mutateAsync(file);
      onChange(result.url);
    },
    [upload, onChange]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const isDataUrl = value.startsWith("data:");
  const hasValidUrl = value && !isDataUrl && (value.startsWith("http://") || value.startsWith("https://"));

  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>

      {/* Drop zone / pick button */}
      <div
        className={`relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-5 transition-colors cursor-pointer ${
          dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"
        } ${upload.isPending ? "opacity-60 pointer-events-none" : ""}`}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <input
          ref={fileRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
        />

        {upload.isPending ? (
          <>
            <Loader2 className="size-7 text-primary animate-spin" />
            <p className="text-xs text-muted-foreground">Uploading…</p>
          </>
        ) : hasValidUrl ? (
          <>
            {accept.startsWith("image") && (
              <img src={value} alt="" className="max-h-28 rounded-lg object-contain" onError={() => {}} />
            )}
            <div className="flex items-center gap-1.5 mt-1">
              <CheckCircle2 className="size-3.5 text-green-500" />
              <span className="text-xs text-green-600 dark:text-green-400 font-medium">Uploaded</span>
              <button
                type="button"
                className="ml-2 text-xs text-muted-foreground hover:text-destructive transition-colors"
                onClick={(e) => { e.stopPropagation(); onChange(""); }}
              >
                Remove
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="size-10 rounded-full bg-muted flex items-center justify-center">
              <Upload className="size-5 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="text-xs font-medium">Click to upload or drag & drop</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {accept === "video/*" ? "MP4, MOV up to 50 MB" : "JPG, PNG, WebP up to 50 MB"}
              </p>
            </div>
          </>
        )}
      </div>

      {/* Or paste a URL */}
      <div className="flex items-center gap-2 mt-2">
        <div className="h-px flex-1 bg-border" />
        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">or paste a URL</span>
        <div className="h-px flex-1 bg-border" />
      </div>
      <div className="relative mt-1">
        <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          type="url"
          className={`pl-8 text-xs ${isDataUrl ? "border-destructive ring-1 ring-destructive" : ""}`}
        />
      </div>
      {isDataUrl && (
        <p className="text-xs text-destructive mt-1">
          ⚠ Base64 data URLs are not supported — please use the upload button above or paste a public HTTPS URL.
        </p>
      )}
    </Field>
  );
}

// ── Instagram live phone preview ──────────────────────────────────────────────

function InstagramPreview({ caption, imageUrl, username }: { caption: string; imageUrl: string; username: string }) {
  return (
    <div className="w-full max-w-[320px] rounded-3xl border-[3px] border-foreground/10 bg-background overflow-hidden shadow-2xl">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <div className="size-8 rounded-full p-[2px]" style={{ background: igGradient }}>
            <div className="size-full rounded-full bg-muted flex items-center justify-center">
              <User className="size-3.5 text-muted-foreground" />
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold leading-none">{username || "your_account"}</p>
            <p className="text-[10px] text-muted-foreground">Sponsored</p>
          </div>
        </div>
        <MoreHorizontal className="size-4 text-muted-foreground" />
      </div>
      <div className="aspect-square bg-muted/40 flex items-center justify-center overflow-hidden">
        {imageUrl ? (
          <img src={imageUrl} alt="Preview" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground/40">
            <ImageIcon className="size-12" />
            <p className="text-xs">Add image URL to preview</p>
          </div>
        )}
      </div>
      <div className="px-4 py-3 space-y-2">
        <div className="flex justify-between">
          <div className="flex gap-4">
            <Heart className="size-5 text-muted-foreground" />
            <MessageCircle className="size-5 text-muted-foreground" />
            <Send className="size-5 text-muted-foreground" />
          </div>
          <Bookmark className="size-5 text-muted-foreground" />
        </div>
        <p className="text-xs font-semibold">1,234 likes</p>
        {caption && (
          <p className="text-xs leading-relaxed">
            <span className="font-semibold">{username || "your_account"}</span>{" "}
            {caption.length > 100 ? caption.slice(0, 100) + "…" : caption}
          </p>
        )}
        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">just now</p>
      </div>
    </div>
  );
}

function FacebookPreview({ caption, imageUrl, pageName }: { caption: string; imageUrl: string; pageName: string }) {
  return (
    <div className="w-full max-w-[360px] rounded-2xl border bg-card shadow overflow-hidden text-sm">
      <div className="flex items-center gap-3 p-3 border-b">
        <div className="size-10 rounded-full bg-[#1877F2] flex items-center justify-center">
          <Share2 className="size-5 text-white" />
        </div>
        <div>
          <p className="font-semibold text-sm">{pageName || "Your Page"}</p>
          <p className="text-xs text-muted-foreground">Just now · 🌐</p>
        </div>
        <MoreHorizontal className="size-4 text-muted-foreground ml-auto" />
      </div>
      {caption && <p className="px-3 pt-3 pb-2 text-sm leading-relaxed">{caption.length > 200 ? caption.slice(0, 200) + "…" : caption}</p>}
      {imageUrl && (
        <div className="aspect-video bg-muted overflow-hidden">
          <img src={imageUrl} alt="Preview" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        </div>
      )}
      <div className="flex gap-1 px-3 py-2 border-t text-xs text-muted-foreground">
        <span>👍 Like</span><span className="mx-2">·</span><span>💬 Comment</span><span className="mx-2">·</span><span>↗ Share</span>
      </div>
    </div>
  );
}

// ── Status overlay ─────────────────────────────────────────────────────────────

function StatusOverlay({ status, errorMsg, onReset }: { status: PostStatus; errorMsg?: string; onReset: () => void }) {
  if (status === "idle") return null;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-card/95 backdrop-blur-sm rounded-2xl p-6"
    >
      {status === "publishing" && (
        <>
          <Loader2 className="size-10 animate-spin text-primary" />
          <p className="font-medium text-sm">Publishing… (images ready in ~5s, videos up to 90s)</p>
        </>
      )}
      {status === "success" && (
        <>
          <CheckCircle2 className="size-12 text-green-500" />
          <p className="font-semibold">Published!</p>
          <Button size="sm" variant="outline" onClick={onReset}>Create another</Button>
        </>
      )}
      {status === "error" && (
        <>
          <AlertCircle className="size-12 text-destructive" />
          <p className="font-semibold">Failed to publish</p>
          {errorMsg && (
            <p className="text-xs text-muted-foreground text-center max-w-xs leading-relaxed">{errorMsg}</p>
          )}
          <Button size="sm" variant="outline" onClick={onReset}>Try again</Button>
        </>
      )}
    </motion.div>
  );
}

// ── Comment modal ─────────────────────────────────────────────────────────────

function IGCommentModal({
  post, connectorId, onClose,
}: { post: IGPost; connectorId: string; onClose: () => void }) {
  const { data: comments = [], isLoading } = useInstagramLoginPostComments(connectorId, post.id);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-lg rounded-2xl border bg-card shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold">Comments</h3>
            <p className="text-xs text-muted-foreground">{comments.length} comment{comments.length !== 1 ? "s" : ""}</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted transition-colors">
            <X className="size-4" />
          </button>
        </div>
        {/* Post preview */}
        <div className="flex items-start gap-3 px-5 py-3 border-b bg-muted/30">
          {(post.media_url || post.thumbnail_url) && (
            <img src={post.thumbnail_url || post.media_url} alt="" className="size-14 rounded-lg object-cover shrink-0" />
          )}
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground line-clamp-3">{post.caption || "No caption"}</p>
            <div className="flex gap-3 mt-1.5 text-xs text-muted-foreground">
              <span>❤️ {post.like_count ?? 0}</span>
              <span>💬 {post.comments_count ?? 0}</span>
            </div>
          </div>
        </div>
        {/* Comments list */}
        <div className="max-h-80 overflow-y-auto p-5 space-y-3">
          {isLoading ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-10 rounded-lg bg-muted animate-pulse" />)}</div>
          ) : comments.length === 0 ? (
            <div className="text-center py-8 space-y-2">
              <MessageCircle className="size-8 text-muted-foreground/30 mx-auto" />
              {(post.comments_count ?? 0) > 0 ? (
                <>
                  <p className="text-sm font-medium">Comments not loading</p>
                  <p className="text-xs text-muted-foreground max-w-xs mx-auto leading-relaxed">
                    This post has {post.comments_count} comment{post.comments_count !== 1 ? "s" : ""} but they
                    can&apos;t be read yet. The <strong>instagram_business_manage_comments</strong> permission
                    was recently added — please <strong>reconnect your Instagram connector</strong> to grant it.
                  </p>
                  <a
                    href="/connectors"
                    className="inline-block mt-1 text-xs text-primary underline"
                  >
                    Go to Connectors →
                  </a>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No comments yet</p>
              )}
            </div>
          ) : (
            comments.map((c: IGComment) => (
              <div key={c.id} className="flex items-start gap-2.5">
                <div className="size-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <User className="size-3.5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold">@{c.username || "user"}</span>
                    <span className="text-[10px] text-muted-foreground">{timeAgo(c.timestamp)}</span>
                    {(c.like_count ?? 0) > 0 && <span className="text-[10px] text-muted-foreground ml-auto">❤️ {c.like_count}</span>}
                  </div>
                  <p className="text-xs text-foreground/90 mt-0.5">{c.text}</p>
                  {c.replies?.data?.length ? (
                    <p className="text-[10px] text-muted-foreground mt-0.5">↩ {c.replies.data.length} repl{c.replies.data.length === 1 ? "y" : "ies"}</p>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      </motion.div>
    </div>
  );
}

function FBCommentModal({
  post, connectorId, pageId, onClose,
}: { post: FBPost; connectorId: string; pageId: string; onClose: () => void }) {
  const { data: comments = [], isLoading } = useFacebookPostComments(connectorId, pageId, post.id);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-lg rounded-2xl border bg-card shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold">Comments</h3>
            <p className="text-xs text-muted-foreground">{post.comments?.summary?.total_count ?? 0} total</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted transition-colors"><X className="size-4" /></button>
        </div>
        <div className="flex items-start gap-3 px-5 py-3 border-b bg-muted/30">
          {post.full_picture && <img src={post.full_picture} alt="" className="size-14 rounded-lg object-cover shrink-0" />}
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground line-clamp-3">{post.message || post.story || "No caption"}</p>
            <div className="flex gap-3 mt-1.5 text-xs text-muted-foreground">
              <span>👍 {post.likes?.summary?.total_count ?? 0}</span>
              <span>💬 {post.comments?.summary?.total_count ?? 0}</span>
              {post.shares && <span>↗ {post.shares.count}</span>}
            </div>
          </div>
        </div>
        <div className="max-h-80 overflow-y-auto p-5 space-y-3">
          {isLoading ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-10 rounded-lg bg-muted animate-pulse" />)}</div>
          ) : comments.length === 0 ? (
            <div className="text-center py-8">
              <MessageCircle className="size-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No comments yet</p>
            </div>
          ) : (
            comments.map((c: FBComment) => (
              <div key={c.id} className="flex items-start gap-2.5">
                <div className="size-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <User className="size-3.5 text-muted-foreground" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold">{c.from?.name || "User"}</span>
                    <span className="text-[10px] text-muted-foreground">{timeAgo(c.created_time)}</span>
                    {(c.like_count ?? 0) > 0 && <span className="text-[10px] text-muted-foreground ml-auto">👍 {c.like_count}</span>}
                  </div>
                  <p className="text-xs text-foreground/90 mt-0.5">{c.message}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </motion.div>
    </div>
  );
}

// ── Instagram post card ───────────────────────────────────────────────────────

function IGPostCard({ post, connectorId }: { post: IGPost; connectorId: string }) {
  const [showComments, setShowComments] = useState(false);
  const thumb = post.thumbnail_url || post.media_url;
  return (
    <>
      <div className="group relative rounded-xl border bg-card overflow-hidden hover:shadow-md transition-shadow">
        <div className="aspect-square bg-muted overflow-hidden relative">
          {thumb ? (
            <img src={thumb} alt={post.caption || ""} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground/30">
              {post.media_type === "VIDEO" ? <Video className="size-10" /> : <ImageIcon className="size-10" />}
            </div>
          )}
          {post.media_type === "VIDEO" && (
            <div className="absolute top-2 right-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] text-white">▶ Video</div>
          )}
          {post.media_type === "CAROUSEL_ALBUM" && (
            <div className="absolute top-2 right-2"><Grid3x3 className="size-4 text-white drop-shadow" /></div>
          )}
        </div>
        <div className="p-3 space-y-2">
          {post.caption && (
            <p className="text-xs text-muted-foreground line-clamp-2">{post.caption}</p>
          )}
          <div className="flex items-center justify-between">
            <div className="flex gap-3 text-xs text-muted-foreground">
              <button className="flex items-center gap-1 hover:text-red-500 transition-colors">
                <Heart className="size-3.5" /> <span>{post.like_count ?? 0}</span>
              </button>
              <button
                className="flex items-center gap-1 hover:text-primary transition-colors"
                onClick={() => setShowComments(true)}
              >
                <MessageCircle className="size-3.5" /> <span>{post.comments_count ?? 0}</span>
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground">{timeAgo(post.timestamp)}</span>
              {post.permalink && (
                <a href={post.permalink} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary transition-colors">
                  <ExternalLink className="size-3" />
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
      <AnimatePresence>
        {showComments && (
          <IGCommentModal post={post} connectorId={connectorId} onClose={() => setShowComments(false)} />
        )}
      </AnimatePresence>
    </>
  );
}

// ── Facebook post card ────────────────────────────────────────────────────────

function FBPostCard({ post, connectorId, pageId }: { post: FBPost; connectorId: string; pageId: string }) {
  const [showComments, setShowComments] = useState(false);
  return (
    <>
      <div className="rounded-xl border bg-card overflow-hidden hover:shadow-md transition-shadow">
        {post.full_picture && (
          <div className="aspect-video bg-muted overflow-hidden">
            <img src={post.full_picture} alt="" className="w-full h-full object-cover" />
          </div>
        )}
        <div className="p-3 space-y-2">
          {(post.message || post.story) && (
            <p className="text-xs text-muted-foreground line-clamp-3">{post.message || post.story}</p>
          )}
          <div className="flex items-center justify-between">
            <div className="flex gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">👍 {post.likes?.summary?.total_count ?? 0}</span>
              <button
                className="flex items-center gap-1 hover:text-primary transition-colors"
                onClick={() => setShowComments(true)}
              >
                <MessageCircle className="size-3.5" />
                <span>{post.comments?.summary?.total_count ?? 0}</span>
              </button>
              {post.shares && <span>↗ {post.shares.count}</span>}
            </div>
            <span className="text-[10px] text-muted-foreground">{timeAgo(post.created_time)}</span>
          </div>
        </div>
      </div>
      <AnimatePresence>
        {showComments && (
          <FBCommentModal post={post} connectorId={connectorId} pageId={pageId} onClose={() => setShowComments(false)} />
        )}
      </AnimatePresence>
    </>
  );
}

// ── My Posts panel ────────────────────────────────────────────────────────────

function MyPostsPanel({
  platform, connectorId, pageId, igAccount,
}: {
  platform: Platform;
  connectorId: string;
  pageId: string;
  igAccount: { username?: string; name?: string } | undefined;
}) {
  const {
    data: igPosts = [], isLoading: igLoading, isError: igError, refetch: refetchIg,
  } = useInstagramLoginPosts(platform === "instagram" ? connectorId : "");

  const {
    data: fbPosts = [], isLoading: fbLoading, isError: fbError, refetch: refetchFb,
  } = useFacebookPosts(platform === "facebook" ? connectorId : "", platform === "facebook" ? pageId : "");

  const posts = platform === "instagram" ? igPosts : fbPosts;
  const isLoading = platform === "instagram" ? igLoading : fbLoading;
  const isError   = platform === "instagram" ? igError  : fbError;
  const refetch   = platform === "instagram" ? refetchIg : refetchFb;

  const notReady = !connectorId || (platform === "facebook" && !pageId);

  if (notReady) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 rounded-2xl border bg-card">
        <Grid3x3 className="size-10 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">Select a connector{platform === "facebook" ? " and page" : ""} to view posts</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="aspect-square rounded-xl bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 rounded-2xl border bg-card">
        <AlertCircle className="size-8 text-destructive/60" />
        <p className="text-sm text-muted-foreground">Failed to load posts</p>
        <Button size="sm" variant="outline" onClick={() => refetch()}><RefreshCw className="size-3.5 mr-1.5" />Retry</Button>
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 rounded-2xl border bg-card">
        <Grid3x3 className="size-10 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">No posts yet</p>
        <p className="text-xs text-muted-foreground/60">Posts you create will appear here</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground font-medium">{posts.length} posts</p>
        <Button size="sm" variant="ghost" onClick={() => refetch()} className="h-7 px-2 gap-1 text-xs">
          <RefreshCw className="size-3" /> Refresh
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {platform === "instagram"
          ? (igPosts as IGPost[]).map((p) => (
              <IGPostCard key={p.id} post={p} connectorId={connectorId} />
            ))
          : (fbPosts as FBPost[]).map((p) => (
              <FBPostCard key={p.id} post={p} connectorId={connectorId} pageId={pageId} />
            ))
        }
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SocialPage() {
  const [pageTab, setPageTab]           = useState<PageTab>("create");
  const [platform, setPlatform]         = useState<Platform>("instagram");
  const [connectorId, setConnectorId]   = useState("");
  const [pageId, setPageId]             = useState("");
  const [caption, setCaption]           = useState("");
  const [imageUrl, setImageUrl]         = useState("");
  const [videoUrl, setVideoUrl]         = useState("");
  const [link, setLink]                 = useState("");
  const [mediaType, setMediaType]       = useState<"image" | "video">("image");
  const [postStatus, setPostStatus]     = useState<PostStatus>("idle");
  const [postError, setPostError]       = useState<string>("");

  const { data: allConnectors = [] }    = useConnectors();
  // Overview: show ALL connectors regardless of status (so users see disconnected/error too)
  const igConnectors                    = allConnectors.filter((c) => c.platform === "instagram_login");
  const fbConnectors                    = allConnectors.filter((c) => c.platform === "facebook_pages");
  // Create/My Posts tabs: only connected connectors can be posted to
  const igConnected                     = igConnectors.filter((c) => c.status === "connected");
  const fbConnected                     = fbConnectors.filter((c) => c.status === "connected");
  const activeConnectors                = platform === "instagram" ? igConnected : fbConnected;

  const { data: fbPages = [], isLoading: pagesLoading } = useFacebookPages(platform === "facebook" ? connectorId : "");
  const { data: igAccount } = useInstagramLoginAccount(platform === "instagram" ? connectorId : "");

  const publishFb = usePublishFacebookPost();
  const publishIg = usePublishInstagramLoginPost();

  function resetForm() { setCaption(""); setImageUrl(""); setVideoUrl(""); setLink(""); setPostStatus("idle"); setPostError(""); }

  function handleConnectorChange(id: string) { setConnectorId(id); setPageId(""); }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const hasMedia = platform === "instagram" && mediaType === "video"
      ? videoUrl.trim()
      : imageUrl.trim();
    if (!caption.trim() && !hasMedia) return;
    setPostStatus("publishing");
    if (platform === "facebook") {
      publishFb.mutate(
        { connector_id: connectorId, page_id: pageId, message: caption, link: link || undefined, image_url: imageUrl || undefined },
        {
          onSuccess: () => setPostStatus("success"),
          onError: (err: unknown) => {
            const msg = (err as { response?: { data?: { detail?: string; message?: string } } })
              ?.response?.data?.detail ||
              (err as { response?: { data?: { detail?: string; message?: string } } })
              ?.response?.data?.message ||
              "Failed to publish. Please try again.";
            setPostError(msg);
            setPostStatus("error");
          },
        }
      );
    } else {
      publishIg.mutate(
        {
          connector_id: connectorId, caption,
          image_url: mediaType === "image" ? imageUrl || undefined : undefined,
          video_url: mediaType === "video" ? videoUrl || undefined : undefined,
        },
        {
          onSuccess: () => setPostStatus("success"),
          onError: (err: unknown) => {
            const msg = (err as { response?: { data?: { detail?: string; message?: string } } })
              ?.response?.data?.detail ||
              (err as { response?: { data?: { detail?: string; message?: string } } })
              ?.response?.data?.message ||
              "Failed to publish. Please try again.";
            setPostError(msg);
            setPostStatus("error");
          },
        }
      );
    }
  }

  const activeMedia = platform === "instagram" && mediaType === "video" ? videoUrl : imageUrl;
  const canSubmit =
    !!connectorId &&
    (platform === "facebook" ? !!pageId : true) &&
    !!(caption.trim() || activeMedia.trim()) &&
    postStatus === "idle";

  const selectedFbPage = fbPages.find((p) => p.id === pageId);

  return (
    <div className="flex h-full flex-col gap-5 pb-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight">Social</h1>
        <p className="text-sm text-muted-foreground">Create posts and view your content across platforms.</p>
      </div>

      {/* Page tabs — Overview / Create Post / My Posts */}
      <div className="flex gap-1 rounded-xl bg-muted/50 p-1 border w-fit">
        {([
          { id: "overview" as PageTab, icon: <BarChart3 className="size-4" />, label: "Overview" },
          { id: "create"   as PageTab, icon: <PenSquare  className="size-4" />, label: "Create Post" },
          { id: "posts"    as PageTab, icon: <Grid3x3    className="size-4" />, label: "My Posts" },
        ] as const).map(({ id, icon, label }) => (
          <button
            key={id}
            onClick={() => setPageTab(id)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
              pageTab === id ? "bg-card text-foreground shadow-sm border" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {icon} {label}
          </button>
        ))}
      </div>

      {/* Platform selector — hidden on Overview tab */}
      {pageTab !== "overview" && (
        <div className="flex gap-2">
          <button
            onClick={() => { setPlatform("instagram"); setConnectorId(""); setPageId(""); }}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all border ${platform === "instagram" ? "border-transparent text-white shadow-lg" : "border-border bg-background text-muted-foreground hover:text-foreground"}`}
            style={platform === "instagram" ? { background: igGradient } : {}}
          >
            <Camera className="size-4" /> Instagram
          </button>
          <button
            onClick={() => { setPlatform("facebook"); setConnectorId(""); setPageId(""); }}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all border ${platform === "facebook" ? "bg-[#1877F2] border-[#1877F2] text-white shadow-lg" : "border-border bg-background text-muted-foreground hover:text-foreground"}`}
          >
            <Share2 className="size-4" /> Facebook
          </button>
        </div>
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={pageTab === "overview" ? "overview" : platform + pageTab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.18 }}
        >
          {/* ── OVERVIEW TAB ── */}
          {pageTab === "overview" && (
            <OverviewPanel
              igConnectors={igConnectors}
              fbConnectors={fbConnectors}
              onViewPosts={(connectorId, pageId) => {
                // Switch to My Posts tab with that connector pre-selected
                const isIg = igConnectors.some(c => c.id === connectorId);
                setPlatform(isIg ? "instagram" : "facebook");
                setConnectorId(connectorId);
                if (pageId) setPageId(pageId);
                setPageTab("posts");
              }}
              onViewDMs={() => {
                window.location.href = "/social/dm";
              }}
            />
          )}

          {/* ── Connector / Page selectors (shared between Create & My Posts) ── */}
          {pageTab !== "overview" && (
            <div className="flex flex-wrap gap-3 mb-5">
              <div className="min-w-[200px] flex-1 max-w-xs">
                <Field>
                  <FieldLabel htmlFor="social-connector">Connector</FieldLabel>
                  <SelectField id="social-connector" value={connectorId} onValueChange={(v) => handleConnectorChange(v)}
                    placeholder="Select connector…"
                    options={[
                      { value: "", label: "Select connector…" },
                      ...activeConnectors.map((c) => ({ value: c.id, label: c.name })),
                    ]} />
                </Field>
              </div>
              {connectorId && platform === "facebook" && (
                <div className="min-w-[200px] flex-1 max-w-xs">
                  <Field>
                    <FieldLabel htmlFor="social-fb-page">Facebook Page</FieldLabel>
                    {pagesLoading ? <p className="text-sm text-muted-foreground py-2 px-1"><Loader2 className="size-3.5 inline animate-spin mr-1" />Loading…</p> : (
                      <SelectField id="social-fb-page" value={pageId} onValueChange={(v) => setPageId(v)}
                        placeholder="Select page…"
                        options={[
                          { value: "", label: "Select page…" },
                          ...fbPages.map((p) => ({ value: p.id, label: p.name })),
                        ]} />
                    )}
                  </Field>
                </div>
              )}
            </div>
          )}

          {/* ── MY POSTS TAB ── */}
          {pageTab === "posts" && (
            <MyPostsPanel
              platform={platform}
              connectorId={connectorId}
              pageId={pageId}
              igAccount={igAccount}
            />
          )}

          {/* ── CREATE POST TAB ── */}
          {pageTab === "create" && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
              {/* Left: composer */}
              <div className="relative rounded-2xl border bg-card shadow-sm overflow-hidden">
                <StatusOverlay status={postStatus} errorMsg={postError} onReset={resetForm} />
                <div className="p-6">
                  {activeConnectors.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 py-16 text-center">
                      {platform === "instagram"
                        ? <div className="size-14 rounded-2xl flex items-center justify-center" style={{ background: igGradient }}><Camera className="size-7 text-white" /></div>
                        : <div className="size-14 rounded-2xl bg-[#1877F2] flex items-center justify-center"><Share2 className="size-7 text-white" /></div>
                      }
                      <div>
                        <p className="font-semibold">No {platform === "instagram" ? "Instagram" : "Facebook"} connector</p>
                        <p className="text-sm text-muted-foreground mt-1">Connect an account first to start posting.</p>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => window.location.href = "/connectors"}>Go to Connectors</Button>
                    </div>
                  ) : (
                    <form onSubmit={handleSubmit} className="space-y-5">
                      {/* Instagram account badge */}
                      {connectorId && platform === "instagram" && igAccount && (
                        <div className="flex items-center gap-3 rounded-xl border p-3">
                          <div className="size-9 rounded-full p-0.5 shrink-0" style={{ background: igGradient }}>
                            <div className="size-full rounded-full bg-card flex items-center justify-center">
                              <User className="size-4 text-muted-foreground" />
                            </div>
                          </div>
                          <div>
                            <p className="text-sm font-medium">@{igAccount.username || igAccount.name}</p>
                            {igAccount.followers_count !== undefined && (
                              <p className="text-xs text-muted-foreground">{igAccount.followers_count.toLocaleString()} followers</p>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Selected FB page badge */}
                      {connectorId && platform === "facebook" && selectedFbPage && (
                        <div className="flex items-center gap-3 rounded-xl border p-3">
                          <div className="size-9 rounded-full bg-[#1877F2] flex items-center justify-center shrink-0">
                            <Share2 className="size-4 text-white" />
                          </div>
                          <p className="text-sm font-medium">{selectedFbPage.name}</p>
                        </div>
                      )}

                      {/* Media type toggle (Instagram) */}
                      {platform === "instagram" && connectorId && (
                        <div className="flex gap-1 rounded-lg border p-1 w-fit">
                          <button type="button" onClick={() => setMediaType("image")}
                            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${mediaType === "image" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                            <ImageIcon className="size-3.5" /> Photo
                          </button>
                          <button type="button" onClick={() => setMediaType("video")}
                            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${mediaType === "video" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                            <Video className="size-3.5" /> Reels
                          </button>
                        </div>
                      )}

                      {/* Caption */}
                      <Field>
                        <FieldLabel>Caption</FieldLabel>
                        <div className="relative">
                          <textarea
                            value={caption}
                            onChange={(e) => setCaption(e.target.value)}
                            rows={5}
                            maxLength={platform === "instagram" ? 2200 : 63206}
                            placeholder="Write your caption…"
                            className="w-full resize-none rounded-lg border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring pb-6"
                          />
                          <span className="absolute bottom-2 right-3 text-[10px] text-muted-foreground/60">
                            {caption.length}/{platform === "instagram" ? "2,200" : "63,206"}
                          </span>
                        </div>
                      </Field>

                      {/* Image upload / URL */}
                      {(platform === "facebook" || mediaType === "image") && (
                        <MediaInput
                          label="Photo"
                          value={imageUrl}
                          onChange={setImageUrl}
                          accept="image/*"
                          placeholder="https://example.com/image.jpg"
                        />
                      )}

                      {/* Video upload / URL (Instagram Reels) */}
                      {platform === "instagram" && mediaType === "video" && (
                        <MediaInput
                          label="Video (Reels — MP4)"
                          value={videoUrl}
                          onChange={setVideoUrl}
                          accept="video/*"
                          placeholder="https://example.com/video.mp4"
                        />
                      )}

                      {/* Link (Facebook only) */}
                      {platform === "facebook" && (
                        <Field>
                          <FieldLabel>Link (optional)</FieldLabel>
                          <div className="relative">
                            <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                            <Input value={link} onChange={(e) => setLink(e.target.value)}
                              placeholder="https://example.com" type="url" className="pl-9" />
                          </div>
                        </Field>
                      )}

                      <Button type="submit" className="w-full" disabled={!canSubmit}>
                        <Send className="mr-2 size-4" />
                        {`Publish to ${platform === "instagram" ? "Instagram" : "Facebook"}`}
                      </Button>
                    </form>
                  )}
                </div>
              </div>

              {/* Right: live preview */}
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-center py-6 bg-muted/30 rounded-2xl border min-h-[300px]">
                  {platform === "instagram" ? (
                    <InstagramPreview
                      caption={caption}
                      imageUrl={mediaType === "image" ? imageUrl : ""}
                      username={igAccount?.username || igAccount?.name || ""}
                    />
                  ) : (
                    <FacebookPreview caption={caption} imageUrl={imageUrl} pageName={selectedFbPage?.name || ""} />
                  )}
                </div>
                {/* Tips */}
                <div className="rounded-xl border bg-card p-4 space-y-2">
                  <p className="text-xs font-semibold text-foreground/70">
                    {platform === "instagram" ? "📸 Instagram Tips" : "📘 Facebook Tips"}
                  </p>
                  {platform === "instagram" ? (
                    <ul className="space-y-1 text-[11px] text-muted-foreground">
                      <li>• Image URL must be publicly accessible (no auth)</li>
                      <li>• Caption limit: 2,200 characters</li>
                      <li>• Use 3–5 relevant hashtags for reach</li>
                      <li>• Reels: MP4, max 90 seconds, 9:16 ratio</li>
                    </ul>
                  ) : (
                    <ul className="space-y-1 text-[11px] text-muted-foreground">
                      <li>• Posts with images get 2.3× more engagement</li>
                      <li>• Best posting times: 9am–3pm weekdays</li>
                      <li>• Add a link to drive traffic to your website</li>
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
