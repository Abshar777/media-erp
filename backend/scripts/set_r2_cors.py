"""
Configure the R2 bucket CORS policy so browsers may upload directly via
pre-signed URLs (PUT) and view objects (GET/HEAD).

Usage (from the backend/ directory):
    python -m scripts.set_r2_cors            # show the diff, write nothing
    python -m scripts.set_r2_cors --apply    # merge our origins into the policy

Origins come from ALLOWED_ORIGINS plus the localhost dev ports.

MERGES BY DEFAULT — read this before adding --replace
-----------------------------------------------------
A bucket has exactly ONE CORS policy and `put_bucket_cors` replaces it
wholesale. `lms-delta` is shared with the Delta LMS, so writing only mediaERP's
origins would silently revoke the LMS's origins and its Range/Content-Range
expose-headers (which its video seeking depends on). That is how the live
upload outage of 2026-09-08 happened in reverse: the policy on the bucket held
the LMS's origins plus a stale `mediaerp.deltainstitutions.com` (no hyphen),
while the live site is `media-erp.deltainstitutions.com` — so every preflight
from production was refused with 403.

`--replace` discards the co-tenant's rules. Only pass it deliberately.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import settings                                      # noqa: E402
from app.utils.storage import ensure_bucket_cors, get_bucket_cors    # noqa: E402

APPLY = "--apply" in sys.argv
REPLACE = "--replace" in sys.argv


def _prune_list() -> list[str]:
    """Origins to drop, from `--prune a,b` or `--prune a --prune b`."""
    out: list[str] = []
    for i, a in enumerate(sys.argv):
        if a == "--prune" and i + 1 < len(sys.argv):
            out += [p.strip() for p in sys.argv[i + 1].split(",") if p.strip()]
        elif a.startswith("--prune="):
            out += [p.strip() for p in a.split("=", 1)[1].split(",") if p.strip()]
    return out

DEV_ORIGINS = (
    "http://localhost:3000", "http://127.0.0.1:3000",
    "http://localhost:3001", "http://127.0.0.1:3001",
)


def main() -> None:
    if not settings.r2_enabled:
        print("[SKIP] R2 is not configured (r2_enabled=False). Nothing to do.")
        return

    origins = [o.strip() for o in settings.allowed_origins.split(",") if o.strip()]
    for dev in DEV_ORIGINS:
        if dev not in origins:
            origins.append(dev)

    existing = get_bucket_cors()
    current = [o for r in existing for o in r.get("AllowedOrigins", [])]

    print(f"Bucket: {settings.r2_bucket}")
    print(f"Mode  : {'REPLACE (discards co-tenant rules!)' if REPLACE else 'MERGE'}"
          f"  {'APPLY' if APPLY else '(dry run)'}\n")

    print(f"Already allowed ({len(current)}):")
    for o in current:
        print(f"    {o}")

    missing = [o for o in origins if o not in current]
    print(f"\nOurs, not yet allowed ({len(missing)}):")
    for o in missing:
        print(f"  + {o}")
    if not missing and not REPLACE:
        print("  (none — policy already covers every origin we need)")

    prune = _prune_list()
    if prune:
        # An origin we still need is never pruned, however it was passed in.
        kept_back = [o for o in prune if o in origins]
        effective = [o for o in prune if o not in origins]
        print(f"\nTo prune ({len(effective)}):")
        for o in effective:
            mark = "-" if o in current else "· not present, no-op"
            print(f"  {mark} {o}" if o in current else f"  - {o}   ({mark})")
        for o in kept_back:
            print(f"  ! {o}   (SKIPPED — it is in our own ALLOWED_ORIGINS)")

    if REPLACE:
        dropped = [o for o in current if o not in origins]
        if dropped:
            print(f"\n!! --replace WOULD REMOVE {len(dropped)} origin(s) "
                  f"belonging to another project:")
            for o in dropped:
                print(f"  - {o}")

    if not APPLY:
        print("\nDry run — nothing written. Re-run with --apply to write.")
        return

    res = ensure_bucket_cors(origins, replace=REPLACE, remove=prune)
    if not res.get("ok"):
        print(f"\n[ABORTED] {res.get('reason')}")
        return
    print(f"\n[OK] mode={res['mode']}")
    print(f"     added  : {res['added'] or 'nothing'}")
    print(f"     removed: {res.get('removed') or 'nothing'}")
    print(f"     policy now allows {len(res['origins'])} origin(s)")


if __name__ == "__main__":
    main()
