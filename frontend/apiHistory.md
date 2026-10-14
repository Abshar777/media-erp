# Frontend API & Hooks History

> Every TanStack Query hook and Axios call ever created goes here.
> Read this before writing a new hook — it may already exist.
> Format: **Feature · File · Hook · Endpoint · Purpose**

---

## How to use

1. Before creating a hook, search this file.
2. If it exists, reuse it — never duplicate.
3. After creating a new hook, log it here immediately.

---

## Auth Hooks

### useLogin
- **Feature:** 1.11
- **File:** `hooks/useAuth.ts`
- **Type:** useMutation
- **Endpoint:** POST /auth/login
- **Purpose:** Authenticates user, calls `setAuth`, shows toast, pushes to `/dashboard`

### useRegister
- **Feature:** 1.11
- **File:** `hooks/useAuth.ts`
- **Type:** useMutation
- **Endpoint:** POST /auth/register
- **Purpose:** Registers user, calls `setAuth`, shows toast, pushes to `/dashboard`

### useLogout
- **Feature:** 1.11
- **File:** `hooks/useAuth.ts`
- **Type:** useMutation
- **Endpoint:** POST /auth/logout
- **Purpose:** Calls `clearAuth`, clears query cache, pushes to `/login`. Uses `onSettled` so redirect happens even if request fails.

### useMe
- **Feature:** 1.11
- **File:** `hooks/useAuth.ts`
- **Type:** useQuery
- **Endpoint:** GET /auth/me
- **Query key:** `["me"]`
- **Purpose:** Fetches current user profile. `enabled: isAuthenticated` — only runs when authenticated. `staleTime: 5min`.

---

## Connector Hooks (Feature 2.7)

### useConnectors
- **Feature:** 2.7
- **File:** `hooks/useConnectors.ts`
- **Type:** useQuery
- **Endpoint:** GET /connectors
- **Query key:** `["connectors"]`
- **Purpose:** Fetches all connectors for the current user.

### useCreateConnector
- **Feature:** 2.7
- **File:** `hooks/useConnectors.ts`
- **Type:** useMutation
- **Endpoint:** POST /connectors
- **Purpose:** Creates a new connector. Invalidates `["connectors"]` on success.

### useUpdateConnector
- **Feature:** 2.7
- **File:** `hooks/useConnectors.ts`
- **Type:** useMutation
- **Endpoint:** PUT /connectors/:id
- **Purpose:** Updates name/sync_frequency. Invalidates `["connectors"]` on success, shows toast.

### useDeleteConnector
- **Feature:** 2.7
- **File:** `hooks/useConnectors.ts`
- **Type:** useMutation
- **Endpoint:** DELETE /connectors/:id
- **Purpose:** Deletes a connector. Invalidates `["connectors"]` on success, shows toast.

### useStartOAuth
- **Feature:** 2.7
- **File:** `hooks/useConnectors.ts`
- **Type:** useMutation
- **Endpoint:** GET /connectors/{platform}/auth?connector_id={id}
- **Purpose:** Fetches OAuth auth URL then does `window.location.href = url` to redirect user to Google/Facebook consent. Shows error toast on failure.

---

## Template entry

```
### useHookName
- **Feature:** X.Y
- **File:** `hooks/useHookName.ts`
- **Type:** useQuery | useMutation
- **Endpoint:** METHOD /api/v1/path
- **Query key:** ["resource", id]
- **Purpose:** One-line description
```

---

### useAutoApprove / useSaveAutoApprove / useHoldAutoApprove (2026-10-13)
- **File:** `hooks/useAutoApprove.ts`
- **Type:** useQuery / useMutation / useMutation
- **Endpoint:** GET /auto-approve · PUT /auto-approve · POST /auto-approve/hold/{task_id}
- **Query key:** `["auto-approve"]`
- **Purpose:** The leader's own auto-approve switch + delay. Save writes the reply into the cache and refreshes `["projects"]` when turned off (that removes this leader's timers from waiting cards). Hold refreshes `["projects"]`. Also exports `delayLabel(min)` ("Instantly", "30 min", "1 h 30 min").
