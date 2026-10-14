# mediaERP — API Reference

> Complete HTTP/WebSocket surface of the FastAPI backend, plus a **"where it's used"**
> map showing which frontend hook and page consume each area.
>
> See also: [PROJECT.md](PROJECT.md) · [db.architecture.md](db.architecture.md)

---

## Conventions

- **Base path:** all endpoints are prefixed with `/api/v1`.
- **Auth legend:**
  - **JWT** — requires `Authorization: Bearer <access_token>` (`Depends(get_current_user)`).
  - **Public** — no auth (OAuth callbacks carry context via a `state` nonce; webhooks via signature/verify token).
  - **Permission-gated** — JWT **plus** an RBAC check (`check_permission(module, action)` / `require_permission`) or a role restriction (e.g. *Super Admin only*), noted per row.
- **Response envelope:** successful responses are wrapped by `success_response(...)`
  (`utils/response.py`), so payloads live under `data`. The frontend reads `response.data.data`.
- **Interactive docs:** `GET /docs` and `GET /redoc` are served **only when `DEBUG=true`**.
- **Health:** `GET /api/v1/health` (public).
- **Static:** uploaded files are served at `GET /uploads/<filename>` (publicly reachable).

### Frontend client behaviour ([frontend/lib/axios.ts](frontend/lib/axios.ts))
- Bearer token read from `localStorage.access_token` on every request; also mirrored to a
  7-day `access_token` cookie (used by Next.js middleware for SSR route protection).
- On `401`, a single-flight refresh calls `POST /auth/refresh`; concurrent 401s queue and
  replay with the new token. Refresh failure clears auth and redirects to `/login`.
- **†** = hook uses a raw `fetch` wrapper (manual bearer, **no** auto-refresh) instead of the axios instance.

---

## Endpoint index (by area)

| Area | Prefix | Router | Primary FE hook | FE page(s) |
|------|--------|--------|-----------------|------------|
| Auth | `/auth` | auth.py | `useAuth` | (auth) login/register/reset, settings, users |
| Connectors | `/connectors` | connectors.py | `useConnectors` | connectors, rules, schedule, analytics |
| Sync | `/sync` | sync.py | `useSync` | connectors (cards/history) |
| Reports | `/reports` | reports.py | `useReports` | reports, campaigns |
| Analytics | `/analytics` | analytics.py | `useAnomalies`, `useAttribution` | reports panels |
| AI | `/ai` | ai.py | `useAi` | ai |
| Custom metrics | `/custom-metrics` | custom_metrics.py | `useCustomMetrics` | settings/custom-metrics |
| FX | `/fx` | fx.py | `useFx` | reports |
| Export | `/export` | export.py | `useExport` † | campaigns |
| Projects | `/projects` | projects.py | `useProjects` | dashboard, projects, leader, media-schedule |
| Board statuses | `/board-statuses` | board_statuses.py | `useStatuses` | projects (status modal) |
| Teams | `/teams` | teams.py | `useTeams` | teams, dashboard, leader |
| Pipelines | `/pipelines` | pipelines.py | (pipeline UI) | projects/pipeline |
| Media schedule | `/media-schedule` | media_schedule.py | `useMediaSchedule` | media-schedule |
| Media/upload | `/media` | media.py | `useUpload`, `useSocial` | projects, social |
| Social | `/social` | social.py | `useSocial` | social, social/dm, analytics |
| Schedule (posts) | `/schedule` | schedule.py | `useSchedule` | schedule |
| Rules | `/rules` | rules.py | `useRules` † | rules |
| Budget | `/budget` | budget.py | `useBudget` | campaigns |
| KPI targets | `/kpi-targets` | kpi_targets.py | `useKpiTargets` | *(orphaned — no page)* |
| Email reports | `/email-reports` | email_reports.py | `useEmailReports` † | email-reports |
| Email/SMTP settings | `/settings` | email_settings.py | `useEmailSettings` | settings |
| Notification prefs | `/notification-prefs` | notification_prefs.py | `useNotificationPrefs` | settings |
| Notifications | `/notifications` | notifications.py | `useNotifications` | global (NotificationBell) |
| Chat | `/chat` | chat.py | `useChat` | chat |
| Roles | `/roles` | roles.py | `useRoles` | roles, users |
| Users | `/users` | users.py | `useUsers` | users |
| Audit logs | `/audit-logs` | audit_logs.py | `useAuditLogs` | settings |
| API keys | `/api-keys` | api_keys.py | `useApiKeys` | settings/api-keys |
| Billing | `/billing` | billing.py | `useBilling` † | *(orphaned — billing redirects)* |
| Clients | `/clients` | clients.py | `useClients` † | clients |
| Whitelabel | `/whitelabel` | whitelabel.py | `useWhitelabel` † | settings |
| WhatsApp | `/whatsapp` | whatsapp.py | — | — |
| Webhooks | `/webhooks` | webhook.py | — (Meta calls it) | — |

---

## Auth — `/api/v1/auth`
**Used by:** `useAuth` → (auth) pages, settings (profile/password/2FA), users (impersonation); underpins the global session + 401-refresh.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | Public | Register a new user; returns token payload |
| POST | `/auth/login` | Public | Authenticate email/password; returns access + refresh tokens |
| POST | `/auth/refresh` | Public | Exchange refresh token for a new access token |
| GET | `/auth/me` | JWT | Current user profile |
| PUT | `/auth/me` | JWT | Update own profile (name/email) |
| POST | `/auth/logout` | JWT | Logout (stateless success) |
| POST | `/auth/forgot-password` | Public | Send password-reset OTP email |
| POST | `/auth/reset-password` | Public | Validate OTP, set new password |
| PUT | `/auth/password` | JWT | Change password (current + new) |
| POST | `/auth/2fa/setup` | JWT | Generate TOTP secret + QR URI |
| POST | `/auth/2fa/enable` | JWT | Verify code and enable 2FA |
| POST | `/auth/2fa/disable` | JWT | Verify code and disable 2FA |
| GET | `/auth/2fa/status` | JWT | Whether 2FA is enabled |
| POST | `/auth/onboarding/complete` | JWT | Mark onboarding complete |
| GET | `/auth/onboarding/status` | JWT | Onboarding completion status |
| POST | `/auth/impersonate/{user_id}` | Super Admin | Issue a token impersonating another user |
| POST | `/auth/sso-login` | Public | Exchange Root ERP SSO token for a local token |

## Connectors — `/api/v1/connectors`
**Used by:** `useConnectors` → connectors, rules, schedule, analytics pages. OAuth `.../auth` endpoints return a redirect URL; `.../callback` endpoints are hit by the platform.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/connectors` | JWT | List user's connectors |
| POST | `/connectors` | JWT | Create a connector |
| GET | `/connectors/{connector_id}` | JWT | Get one connector |
| PUT | `/connectors/{connector_id}` | JWT | Update a connector |
| DELETE | `/connectors/{connector_id}` | JWT | Delete a connector |
| GET | `/connectors/{platform}/auth` | JWT | Get OAuth authorization URL for a platform |
| GET | `/connectors/{platform}/callback` | Public (state nonce) | OAuth callback; exchanges code, stores encrypted tokens |

Platforms with `auth`/`callback` pairs: `google_ads`, `ga4`, `facebook_ads`, `facebook_pages`,
`instagram`, `instagram_login`, `linkedin_ads`, `tiktok_ads`, plus demo-token connectors
`mailchimp`, `search_console`, `hubspot`, `shopify`.

## Sync — `/api/v1/sync`
**Used by:** `useSync` → connector cards & sync-history panel.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/sync/trigger/{connector_id}` | JWT | Enqueue an immediate sync (Celery, thread fallback) |
| GET | `/sync/status/{connector_id}` | JWT | Connector status + latest sync run |
| GET | `/sync/history/{connector_id}` | JWT | Paginated sync-run history |

## Reports — `/api/v1/reports`
**Used by:** `useReports` → reports, campaigns pages. Shared view is public.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/reports/overview` | JWT | Overview KPIs |
| GET | `/reports/campaigns` | JWT | Paginated campaigns table |
| GET | `/reports/trend` | JWT | Trend chart series |
| POST | `/reports/custom` | JWT | Run custom report (metrics/dimensions/filters) |
| POST | `/reports/blend` | JWT | Cross-platform data blend on date axis |
| GET | `/reports/export` | JWT | CSV export of a custom report |
| GET | `/reports/saved` | JWT | List saved reports |
| POST | `/reports/saved` | JWT | Save a report |
| GET | `/reports/saved/{report_id}` | JWT | Get a saved report |
| PUT | `/reports/saved/{report_id}` | JWT | Update a saved report |
| DELETE | `/reports/saved/{report_id}` | JWT | Delete a saved report |
| POST | `/reports/saved/{report_id}/share` | JWT | Create/return a public share token |
| DELETE | `/reports/saved/{report_id}/share` | JWT | Revoke the public share link |
| GET | `/reports/shared/{share_token}` | **Public** | View a shared report read-only |

## Analytics — `/api/v1/analytics`
**Used by:** `useAnomalies`, `useAttribution` → report panels.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/analytics/attribution` | JWT | Cross-channel attribution (first/last/linear/time_decay) |
| GET | `/analytics/anomalies` | JWT | Rolling z-score anomaly detection (14-day baseline) |

## AI — `/api/v1/ai`
**Used by:** `useAi` → ai page.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/ai/query` | JWT | NL question → generate pipeline → execute → explain → persist |
| GET | `/ai/history` | JWT | Paginated history of AI queries |
| GET | `/ai/history/{query_id}` | JWT | Full result of one historical query |

## Custom metrics — `/api/v1/custom-metrics`
**Used by:** `useCustomMetrics` → settings/custom-metrics.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/custom-metrics` | JWT | List formula metrics |
| POST | `/custom-metrics` | JWT | Create a formula |
| POST | `/custom-metrics/preview` | JWT | Validate + evaluate a formula with sample data |
| DELETE | `/custom-metrics/{metric_id}` | JWT | Delete a formula |

## FX — `/api/v1/fx`
**Used by:** `useFx` → reports.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/fx/rates` | JWT | Exchange rates vs base currency (Redis-cached 24h) |

## Export — `/api/v1/export`
**Used by:** `useExport` † → campaigns (file downloads).

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/export/campaigns/excel` | JWT | Branded `.xlsx` campaign export |
| GET | `/export/campaigns/pdf` | JWT | Branded PDF campaign export |

## Projects — `/api/v1/projects`
**Used by:** `useProjects` → dashboard, projects, leader, media-schedule. Visibility is role-scoped.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/projects` | JWT (role-scoped) | List tasks (own/team/leader/all) with filters |
| POST | `/projects` | JWT | Create task (workflow starts `pending`; fires notifications) |
| GET | `/projects/leader/queue` | JWT (leaders/elevated) | Leader Desk feed: review + incoming + teams |
| PUT | `/projects/{task_id}` | JWT (workflow/role gated) | Update / transition status / reassign / route |
| DELETE | `/projects/{task_id}` | JWT | Delete task |

## Board statuses — `/api/v1/board-statuses`
**Used by:** `useStatuses` → project status modal.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/board-statuses` | JWT | List kanban columns (auto-seeds defaults) |
| POST | `/board-statuses` | JWT | Create a column |
| PUT | `/board-statuses/reorder` | JWT | Reorder columns |
| PUT | `/board-statuses/{status_id}` | JWT | Rename/recolour a column |
| DELETE | `/board-statuses/{status_id}` | JWT | Delete a column (tasks reassigned) |

## Teams — `/api/v1/teams`
**Used by:** `useTeams` → teams, dashboard, leader.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/teams` | JWT (role-scoped) | List teams (elevated see all) |
| GET | `/teams/all` | JWT | All teams (id/name/color) |
| GET | `/teams/users` | JWT | Minimal user directory for pickers |
| POST | `/teams` | JWT (teams.create) | Create a team (creator becomes leader) |
| GET | `/teams/{team_id}` | JWT (member/elevated) | Team detail + enriched members |
| PUT | `/teams/{team_id}` | JWT (leader/admin) | Update team info |
| DELETE | `/teams/{team_id}` | JWT (teams.delete) | Delete a team |
| POST | `/teams/{team_id}/members` | JWT (leader/admin) | Add a member |
| DELETE | `/teams/{team_id}/members/{user_id}` | JWT (leader/admin) | Remove a member (not last leader) |
| PUT | `/teams/{team_id}/members/{user_id}/role` | JWT (leader/admin) | Change a member's role |
| GET | `/teams/{team_id}/members/{user_id}/report` | JWT (admin/leader/self) | Member performance report |

## Pipelines — `/api/v1/pipelines`
**Used by:** pipeline builder UI (React-Flow graph of teams).

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/pipelines` | JWT (pipeline.view) | List pipelines |
| POST | `/pipelines` | JWT (SA/Admin/Coordinator) | Create pipeline |
| GET | `/pipelines/{pipeline_id}` | JWT (pipeline.view) | Get pipeline detail |
| PUT | `/pipelines/{pipeline_id}` | JWT (SA/Admin/Coordinator) | Update pipeline |
| DELETE | `/pipelines/{pipeline_id}` | JWT (SA/Admin/Coordinator) | Delete pipeline |

## Media schedule — `/api/v1/media-schedule`
**Used by:** `useMediaSchedule` → media-schedule.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/media-schedule/tasks` | JWT | Create a media task |
| GET | `/media-schedule/tasks` | JWT (role-scoped) | List media tasks (own/team/all) |
| PATCH | `/media-schedule/tasks/{task_id}` | JWT | Update a media task |
| DELETE | `/media-schedule/tasks/{task_id}` | JWT | Cancel (soft) a media task |

## Media / upload — `/api/v1/media`
**Used by:** `useUpload`, `useSocial` → projects, social.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/media/upload` | JWT | Upload image/video, return public URL (≤ 50 MB) |
| POST | `/media/upload-attachments` | JWT | Upload ≤ 10 task attachments (≤ 25 MB each) |

## Social — `/api/v1/social`
**Used by:** `useSocial` → social, social/dm, analytics. All calls pass a `connector_id`.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/social/facebook/pages` | JWT | List accessible Facebook Pages |
| POST | `/social/facebook/post` | JWT | Publish a Facebook Page post |
| POST | `/social/facebook/dm` | JWT | Send a Messenger DM from a Page |
| GET | `/social/facebook/posts` | JWT | Posts for a Facebook Page |
| GET | `/social/facebook/posts/{post_id}/comments` | JWT | Comments on a Page post |
| GET | `/social/facebook/conversations` | JWT | Messenger inbox |
| GET | `/social/facebook/conversations/{conversation_id}/messages` | JWT | Messages in a conversation |
| GET | `/social/instagram/accounts` | JWT | Linked IG Business accounts |
| POST | `/social/instagram/post` | JWT | Publish an Instagram post |
| POST | `/social/instagram/dm` | JWT | Send an Instagram DM |
| GET | `/social/instagram/conversations` | JWT | IG Direct conversations |
| GET | `/social/instagram/conversations/{conversation_id}/messages` | JWT | Messages in an IG conversation |
| GET | `/social/instagram_login/account` | JWT | IG profile (Instagram Login connector) |
| POST | `/social/instagram_login/post` | JWT | Publish via Instagram Login |
| GET | `/social/instagram_login/posts` | JWT | Media posts (IG Login) |
| GET | `/social/instagram_login/posts/{post_id}/comments` | JWT | Comments on an IG post |
| POST | `/social/instagram_login/posts/{post_id}/comments/{comment_id}/reply` | JWT | Reply to an IG comment |
| GET | `/social/instagram_login/insights` | JWT | Daily account-level IG insights |
| GET | `/social/instagram_login/conversations` | JWT | IG Direct conversations (IG Login) |
| GET | `/social/instagram_login/conversations/{conversation_id}/messages` | JWT | Messages in an IG Login conversation |
| POST | `/social/instagram_login/dm` | JWT | Send an IG DM (IG Login) |
| GET | `/social/webhook-messages` | JWT | Locally-persisted webhook DM messages |

## Schedule (social posts) — `/api/v1/schedule`
**Used by:** `useSchedule` → schedule. Executed by the in-process post-scheduler daemon.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/schedule/posts` | JWT | Create a scheduled social post |
| GET | `/schedule/posts` | JWT | List scheduled posts (filters) |
| GET | `/schedule/posts/{post_id}` | JWT | Get a scheduled post |
| PATCH | `/schedule/posts/{post_id}` | JWT | Update a pending post |
| DELETE | `/schedule/posts/{post_id}` | JWT | Cancel a pending post |

## Rules — `/api/v1/rules`
**Used by:** `useRules` † → rules. Evaluated by the in-process rules-evaluator daemon (~5min).

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/rules` | JWT | List automated rules |
| POST | `/rules` | JWT | Create a rule |
| PATCH | `/rules/{rule_id}` | JWT | Update a rule |
| DELETE | `/rules/{rule_id}` | JWT | Delete a rule |
| GET | `/rules/history` | JWT | Alert trigger history |
| POST | `/rules/evaluate` | JWT | Manually run rule evaluation |

## Budget — `/api/v1/budget`
**Used by:** `useBudget` → campaigns.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/budget/goals` | JWT | List budget goals |
| POST | `/budget/goals` | JWT | Create a budget goal |
| DELETE | `/budget/goals/{goal_id}` | JWT | Delete a budget goal |
| GET | `/budget/alerts` | JWT | Goals where spend ≥ alert threshold |
| GET | `/budget/pacing` | JWT | Pacing status per goal |

## KPI targets — `/api/v1/kpi-targets`
**Used by:** `useKpiTargets` *(currently not imported by any page)*.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/kpi-targets` | JWT | List KPI targets |
| POST | `/kpi-targets` | JWT | Create a KPI target |
| PUT | `/kpi-targets/{target_id}` | JWT | Update a KPI target |
| DELETE | `/kpi-targets/{target_id}` | JWT | Delete a KPI target |

## Email reports — `/api/v1/email-reports`
**Used by:** `useEmailReports` † → email-reports. Sent by the in-process email-scheduler daemon (~1min).

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/email-reports/schedules` | JWT | List email report schedules |
| POST | `/email-reports/schedules` | JWT | Create a schedule |
| PATCH | `/email-reports/schedules/{schedule_id}` | JWT | Update a schedule (recomputes next send) |
| DELETE | `/email-reports/schedules/{schedule_id}` | JWT | Delete a schedule |
| POST | `/email-reports/send-now/{schedule_id}` | JWT | Send the report immediately |
| POST | `/email-reports/test-email` | JWT | Send a test email (verify SMTP) |

## Email / SMTP settings — `/api/v1/settings`
**Used by:** `useEmailSettings` → settings. Super Admin only.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/settings/email-smtp` | Super Admin | Get SMTP config (password masked) |
| PUT | `/settings/email-smtp` | Super Admin | Update SMTP config |
| POST | `/settings/email-smtp/test` | Super Admin | Send SMTP test email |

## Auto-approve — `/api/v1/auto-approve`
**Used by:** `useAutoApprove` / `useSaveAutoApprove` / `useHoldAutoApprove` → Leader Desk (`AutoApproveControl`, `AutoApproveStrip`).

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/auto-approve` | JWT | Your switch + delay, `can_use` (you lead a team), `teams`, `max_delay_minutes` |
| PUT | `/auto-approve` | JWT (team leader) | `{enabled, delay_minutes}`; turning off removes your timers from waiting work |
| POST | `/auto-approve/hold/{task_id}` | JWT (team leader / elevated) | `{hold}`: stop / resume auto-approval for one task waiting in review |

## Stand-in — `/api/v1/standin`
**Used by:** `useStandin` / `useHandOver` / `useEndStandin` → Leader Desk (`StandinControl`, `StandinBanner`), Sidebar.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/standin` | JWT | My hand-over as a leader (`mine`), where I stand in (`standing_in`), `can_use`, led teams |
| PUT | `/standin` | JWT (team leader) | `{standin_id, start_date, end_date, team_ids?, can_review, note?}` — hand over (replaces an open one) |
| DELETE | `/standin` | JWT | End it now ("I'm back") / cancel a scheduled one |

## Notification prefs — `/api/v1/notification-prefs`
**Used by:** `useNotificationPrefs` → settings.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/notification-prefs` | JWT | Get email notification preferences |
| PUT | `/notification-prefs` | JWT | Update preferences |

## Notifications — `/api/v1/notifications`
**Used by:** `useNotifications` → global NotificationBell.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/notifications` | JWT | List notifications (fires due-date reminders first) |
| PATCH | `/notifications/{notification_id}/read` | JWT | Mark one read |
| POST | `/notifications/read-all` | JWT | Mark all read |

## Chat — `/api/v1/chat`
**Used by:** `useChat` (+ `useChatSocket`) → chat.

| Method | Path | Auth | Description |
|---|---|---|---|
| WS | `/chat/ws` | JWT via `?token=` | Real-time chat socket (message/read/status frames) |
| GET | `/chat/users` | JWT | Active users (except self) with online status |
| GET | `/chat/messages/{other_id}` | JWT | Fetch a message thread |
| PUT | `/chat/messages/{other_id}/read` | JWT | Mark a thread's messages read |
| GET | `/chat/unread` | JWT | Unread counts |
| GET | `/chat/admin/conversations` | Super Admin | All conversation pairs with previews |
| GET | `/chat/admin/messages/{user_a_id}/{user_b_id}` | Super Admin | Full thread between any two users |

## Roles — `/api/v1/roles`
**Used by:** `useRoles` → roles, users.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/roles` | Super Admin | Paginated roles list |
| GET | `/roles/all` | JWT | Simple roles dropdown (any user) |
| POST | `/roles` | Super Admin | Create role |
| GET | `/roles/{role_id}` | Super Admin | Get a role |
| PUT | `/roles/{role_id}` | Super Admin | Update a role |
| DELETE | `/roles/{role_id}` | Super Admin | Delete a role |

## Users — `/api/v1/users`
**Used by:** `useUsers` → users.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/users` | JWT (users.view) | Paginated users list |
| POST | `/users` | JWT (users.create) | Create a user |
| GET | `/users/{user_id}` | JWT (self or users.view) | Get a user |
| PUT | `/users/{user_id}` | JWT (users.edit) | Update a user |
| DELETE | `/users/{user_id}` | JWT (users.delete) | Delete a user |

## Audit logs — `/api/v1/audit-logs`
**Used by:** `useAuditLogs` → settings.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/audit-logs` | JWT | List user's audit trail (filter action/resource_type) |

## API keys — `/api/v1/api-keys`
**Used by:** `useApiKeys` → settings/api-keys.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api-keys` | JWT | List keys (hashes never returned) |
| POST | `/api-keys` | JWT | Create a key (raw key returned once) |
| DELETE | `/api-keys/{key_id}` | JWT | Revoke/delete a key |
| PATCH | `/api-keys/{key_id}/toggle` | JWT | Enable/disable without deleting |

## Billing — `/api/v1/billing`
**Used by:** `useBilling` † *(orphaned — `billing/` page redirects to dashboard)*. Stripe calls the webhook.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/billing/plans` | Public | List subscription plans |
| GET | `/billing/subscription` | JWT | Current subscription + plan limits |
| GET | `/billing/usage` | JWT | Usage vs plan limits |
| POST | `/billing/create-checkout` | JWT | Create Stripe checkout session (demo mode if unconfigured) |
| POST | `/billing/create-portal` | JWT | Create Stripe billing-portal session |
| POST | `/billing/webhook` | Public (Stripe signature) | Stripe webhook receiver (hidden from schema) |

## Clients — `/api/v1/clients`
**Used by:** `useClients` † → clients.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/clients` | JWT | List agency clients (filter status/search) |
| POST | `/clients` | JWT | Create a client |
| GET | `/clients/stats` | JWT | Agency dashboard stats across clients |
| GET | `/clients/:id/summary` | JWT | Client summary: 30-day spend + platform breakdown |
| PATCH | `/clients/{client_id}` | JWT | Update a client |
| DELETE | `/clients/{client_id}` | JWT | Delete a client |
| POST | `/clients/{client_id}/invite` | JWT | Generate invite token + send invite email |

> ⚠️ Route-ordering caveats in `clients.py`: `GET /clients/:id/summary` uses a **literal**
> `:id` segment (not a FastAPI path param), and `GET /clients/stats` is declared **after**
> the `{client_id}` routes, so registration order matters.

## Whitelabel — `/api/v1/whitelabel`
**Used by:** `useWhitelabel` † → settings.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/whitelabel/settings` | JWT | Get branding settings (defaults if unset) |
| PUT | `/whitelabel/settings` | JWT | Update branding settings |
| DELETE | `/whitelabel/settings` | JWT | Reset branding to defaults |

## WhatsApp — `/api/v1/whatsapp`
**Used by:** — (backend/manual). Backed by WhatsApp Cloud API.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/whatsapp/test` | JWT | Send a hardcoded test WhatsApp message |
| PUT | `/whatsapp/phone` | JWT | Save the user's WhatsApp phone number |

## Webhooks — `/api/v1/webhooks`
**Called by:** Meta (Facebook/Instagram). No frontend usage.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/webhooks/facebook` | Public (verify_token) | Meta `hub.challenge` verification handshake |
| POST | `/webhooks/facebook` | Public (HMAC signature) | Receive Meta events; persist DMs + notify |
| GET/POST | `/webhooks/instagram/deauthorize` | Public | Meta app-removal callback |
| GET/POST | `/webhooks/instagram/delete` | Public | Meta data-deletion request (returns confirmation) |

---

## Where the API is used — summary

- **Frontend (Next.js)** is the primary consumer. Each backend area maps to one hook in
  [frontend/hooks/](frontend/hooks/) (see the index table above); hooks are composed into
  the pages under `app/(dashboard)/`. Cross-cutting areas (`/auth`, `/notifications`,
  `/sync`, `/analytics`, `/board-statuses`) are consumed by shared components rather than a
  single page.
- **External services call in** to: OAuth callbacks (`/connectors/{platform}/callback`),
  Stripe (`/billing/webhook`), and Meta (`/webhooks/*`).
- **Programmatic access** is available via API keys (`/api-keys`) authenticated through the
  `authenticate_api_key` helper.
- **Public (no-auth) endpoints:** `/health`, `/auth/{register,login,refresh,forgot-password,reset-password,sso-login}`,
  `/reports/shared/{share_token}`, `/billing/plans`, all OAuth callbacks, and all webhooks.
- **Not currently reachable from the UI:** `/kpi-targets/*` (hook exists, no page) and
  `/billing/*` (page redirects to dashboard).

For the WebSocket, hooks-that-bypass-axios (†), and store details, see
[frontend/lib/axios.ts](frontend/lib/axios.ts) and [frontend/stores/authStore.ts](frontend/stores/authStore.ts).
