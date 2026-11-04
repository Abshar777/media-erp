# Backend Features & Endpoints

> Every endpoint and backend feature ever built goes here.
> Read this before building any new endpoint — it may already exist.

---

## API Base: `/api/v1`

All responses use `success_response()` / `error_response()` from `app/utils/response.py`:

```json
{ "success": true,  "message": "...", "data": <any>   }
{ "success": false, "message": "...", "errors": <any>  }
```

---

## Health

### GET /api/v1/health
| | |
|--|--|
| **Auth** | None |
| **200** | `{ env, version }` |
| **File** | `app/main.py` |

---

## Auth — `app/routers/auth.py`

### POST /api/v1/auth/register
| | |
|--|--|
| **Body** | `{ name, email, password (≥8 chars) }` |
| **201** | `{ access_token, refresh_token, token_type, user }` |
| **409** | Email already registered |

### POST /api/v1/auth/login
| | |
|--|--|
| **Body** | `{ email, password }` |
| **200** | `{ access_token, refresh_token, token_type, user }` |
| **401** | Invalid credentials (generic — no enumeration) |

### POST /api/v1/auth/refresh
| | |
|--|--|
| **Body** | `{ refresh_token }` |
| **200** | New `{ access_token, refresh_token, token_type, user }` |
| **401** | Invalid / expired refresh token |

### GET /api/v1/auth/me
| | |
|--|--|
| **Auth** | Bearer |
| **200** | `{ id, email, name, role, plan }` — never exposes hashed_password |

### PUT /api/v1/auth/me  *(Phase 7.1)*
| | |
|--|--|
| **Auth** | Bearer |
| **Body** | `{ name?, email? }` — at least one required |
| **200** | Updated user |
| **409** | Email already taken by another account |

### PUT /api/v1/auth/password  *(Phase 7.1)*
| | |
|--|--|
| **Auth** | Bearer |
| **Body** | `{ current_password, new_password (≥8) }` |
| **200** | `{ message: "Password updated" }` |
| **400** | Wrong current password or same as existing |
| **Note** | Bumps `token_version` — existing refresh tokens remain valid until expiry |

### POST /api/v1/auth/logout
| | |
|--|--|
| **Auth** | Bearer |
| **200** | `"Logged out successfully"` |

---

## Connectors — `app/routers/connectors.py`

### GET /api/v1/connectors
Returns all connector records for the authenticated user (sorted newest first).

### POST /api/v1/connectors
| | |
|--|--|
| **Body** | `{ platform, name, sync_frequency="daily" }` |
| **201** | Connector doc (`status=disconnected`) |

### GET /api/v1/connectors/{connector_id}
Returns single connector (404 if not found or wrong user).

### PUT /api/v1/connectors/{connector_id}
| | |
|--|--|
| **Body** | `{ name?, sync_frequency? }` |
| **400** | Empty body |

### DELETE /api/v1/connectors/{connector_id}
**204** — deletes tokens + connector record.

### GET /api/v1/connectors/google_ads/auth
| | |
|--|--|
| **Query** | `connector_id` (ObjectId of pre-created connector) |
| **200** | `{ auth_url }` — Google OAuth consent URL with PKCE |
| **404** | Connector not found |

### GET /api/v1/connectors/google_ads/callback
Exchange code → store encrypted tokens → **302** redirect to frontend.

### GET /api/v1/connectors/ga4/auth + /callback
Same flow as Google Ads, scope: `analytics.readonly`.

### GET /api/v1/connectors/facebook_ads/auth + /callback
State nonce CSRF protection (no PKCE); two-step short→long-lived token exchange.

### GET /api/v1/connectors/linkedin_ads/auth + /callback
LinkedIn OAuth 2.0 with PKCE.

### GET /api/v1/connectors/tiktok_ads/auth + /callback
TikTok OAuth 2.0.

---

## Sync — `app/routers/sync.py`

### POST /api/v1/sync/trigger/{connector_id}
| | |
|--|--|
| **Body** | `{ date_from?, date_to? }` |
| **200** | `{ task_id }` — Celery task ID |
| **404** | Connector not found |

### GET /api/v1/sync/status/{connector_id}
Returns connector with current `status` + `last_synced_at`.

### GET /api/v1/sync/history/{connector_id}
Last 20 sync run records from `sync_runs` collection.

---

## Reports — `app/routers/reports.py`

### GET /api/v1/reports/overview
KPI totals (spend, clicks, impressions, conversions, revenue) + period-over-period deltas.
Query params: `date_from`, `date_to`, `platform`.

### GET /api/v1/reports/campaigns
Paginated campaign list. Query: `platform`, `page`, `limit`, `sort`.

### GET /api/v1/reports/trend
Time-series array. Query: `metric=spend`, `period=daily|weekly`.

### POST /api/v1/reports/custom
| | |
|--|--|
| **Body** | `{ metrics[], dimensions[], filters: { platform[], date_from, date_to }, chart_type }` |
| **200** | Aggregation result |

### GET /api/v1/reports/saved
List saved reports for user.

### POST /api/v1/reports/saved
Save a report config. Body: `{ name, metrics[], dimensions[], filters, chart_type }`.

### GET /api/v1/reports/saved/{report_id}
Single saved report.

### DELETE /api/v1/reports/saved/{report_id}
**204** — deletes saved report.

### GET /api/v1/reports/export
Streams CSV. Query params same as `/custom`.

---

## AI — `app/routers/ai.py`  *(Phase 6)*

### POST /api/v1/ai/query
| | |
|--|--|
| **Auth** | Bearer |
| **Body** | `{ question: str }` |
| **200** | `{ id, question, pipeline, result, explanation, created_at }` |
| **Note** | Gemini 2.5 Flash — generates + executes MongoDB aggregation, then explains in plain English |
| **500** | If `GEMINI_API_KEY` is not set |

### GET /api/v1/ai/history
Paginated history. Query: `limit=20`, `offset=0`.

### GET /api/v1/ai/history/{query_id}
Single AI query record.

---

## Notifications — `app/routers/notifications.py`  *(Phase 7.2)*

### GET /api/v1/notifications
| | |
|--|--|
| **Query** | `limit=20`, `unread_only=false` |
| **200** | `{ items: [...], unread_count: N }` |

### PATCH /api/v1/notifications/{notification_id}/read
Marks a single notification as read. **404** if not found or wrong user.

### POST /api/v1/notifications/read-all
Marks all notifications for the user as read.

---

## My Wallet — `app/routers/wallet.py`  *(2026-11-04)*

### GET /api/v1/wallet?month=YYYY-MM
- **Auth:** any signed-in user (`get_current_user`); no module — only ever your own.
- **What:** your month from the HRMS (`GET /api/v1/integrations/wallet?email=&month=`, signed): salary a day at a time, what came off on which day and why, commission, everything else on the payslip, what finance has paid and what is still to come. Found by the email you sign in with; `month` defaults to this one.
- **Errors:** 400 bad month / no email on the account · 503 `HRMS_*` not set ("isn't linked to the HRMS yet") or the HRMS down · the HRMS's own refusal as it is (404 "No HRMS employee has this email.") · 502 the HRMS refused this server's credentials or answered with something that isn't its API.

---

## MongoDB Collections

| Collection | Purpose | Key Indexes |
|------------|---------|-------------|
| `users` | Auth accounts | `email` (unique) |
| `connectors` | OAuth connector records + encrypted tokens | `(user_id, platform)` unique |
| `marketing_data` | Unified ad data per platform/date/campaign | `(user_id, platform, date, campaign_id)` unique |
| `sync_runs` | Celery task outcomes | `(connector_id, created_at)` |
| `ai_queries` | NL query + pipeline + result + explanation | `(user_id, created_at)` |
| `notifications` | Sync success/error events | `(user_id, created_at)`, `(user_id, read)` |
| `reports` | Saved report configs | `(user_id, created_at)` |
