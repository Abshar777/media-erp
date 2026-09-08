"""
Relocate legacy root-level R2 objects into the mediaERP/ namespace.

WHY
---
The bucket is shared with the Delta LMS. Objects uploaded before the namespace
change live at the bucket root (`attachments/…`, `social/…`), interleaved with
the LMS's own `images/ documents/ hls/ videos/ kyc/`. New uploads already go to
`mediaERP/<folder>/…`. This script moves the old ones so everything mediaERP
owns sits under one prefix — which is what lets the LMS exclude all of it from
its unauthenticated /assets/* proxy by blocking a single prefix.

SAFETY
------
  • Report-only by default. Pass --apply to write.
  • Objects are COPIED server-side, never moved. Originals stay put, so
    rollback is reverting the DB (or just re-pointing R2_ROOT_PREFIX).
  • Every copy is verified with head_object before any DB row is touched.
  • DB rows are rewritten only for keys that actually exist at the destination.
  • Re-runnable: already-migrated objects and rows are skipped.

Nothing is ever deleted. Once you have confirmed the app is healthy, clean up
the originals with --delete-originals (a separate, explicit run).

USAGE
-----
    cd backend
    python -m scripts.migrate_r2_prefix                     # dry run
    python -m scripts.migrate_r2_prefix --apply             # copy + rewrite DB
    python -m scripts.migrate_r2_prefix --delete-originals  # after verifying
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import settings                                   # noqa: E402
from app.utils.storage import _get_r2_client, object_exists        # noqa: E402

# Legacy top-level folders that belong to mediaERP (NOT the LMS's).
LEGACY_FOLDERS = ("attachments/", "social/")

APPLY = "--apply" in sys.argv
DELETE_ORIGINALS = "--delete-originals" in sys.argv
ROOT = (settings.r2_root_prefix or "").strip("/")


def new_key(old_key: str) -> str:
    return f"{ROOT}/{old_key}"


def list_legacy() -> list[tuple[str, int]]:
    """Every object under a legacy mediaERP folder, excluding already-migrated ones."""
    c = _get_r2_client()
    out: list[tuple[str, int]] = []
    for folder in LEGACY_FOLDERS:
        tok = None
        while True:
            kw = {"Bucket": settings.r2_bucket, "Prefix": folder}
            if tok:
                kw["ContinuationToken"] = tok
            r = c.list_objects_v2(**kw)
            for o in r.get("Contents", []):
                key = o["Key"]
                if not key.startswith(f"{ROOT}/"):
                    out.append((key, o["Size"]))
            if not r.get("IsTruncated"):
                break
            tok = r.get("NextContinuationToken")
    return out


def copy_objects(items: list[tuple[str, int]]) -> dict[str, str]:
    """Server-side copy old -> new. Returns {old_key: new_key} for verified copies."""
    c = _get_r2_client()
    migrated: dict[str, str] = {}
    for i, (old, size) in enumerate(items, 1):
        new = new_key(old)
        if object_exists(new):
            migrated[old] = new
            print(f"  [{i}/{len(items)}] skip (already there)  {old}")
            continue
        if not APPLY:
            print(f"  [{i}/{len(items)}] would copy  {old}  ->  {new}  ({size/1024/1024:.1f} MB)")
            continue
        try:
            c.copy_object(
                Bucket=settings.r2_bucket,
                CopySource={"Bucket": settings.r2_bucket, "Key": old},
                Key=new,
            )
        except Exception as exc:
            print(f"  [{i}/{len(items)}] COPY FAILED  {old}: {exc}")
            continue
        if object_exists(new):
            migrated[old] = new
            print(f"  [{i}/{len(items)}] copied  {old}  ->  {new}")
        else:
            print(f"  [{i}/{len(items)}] VERIFY FAILED (not at destination)  {new}")
    return migrated


def remap(value: str | None, migrated: dict[str, str]) -> str | None:
    """Rewrite one stored key/URL if it points at a migrated object."""
    if not value or not isinstance(value, str):
        return None
    from app.utils.storage import key_from_url
    key = key_from_url(value)
    if key and key in migrated:
        return migrated[key]
    return None


async def rewrite_db(migrated: dict[str, str]) -> None:
    """Point every stored reference at the new key."""
    from app.database import connect_db, close_db, get_db

    await connect_db()
    db = get_db()
    try:
        # ── attachment arrays: project_tasks + messages ───────────────────────
        for coll in ("project_tasks", "messages"):
            changed = 0
            async for doc in db[coll].find({"attachments": {"$exists": True, "$ne": []}}):
                atts = doc.get("attachments") or []
                dirty = False
                for a in atts:
                    if not isinstance(a, dict):
                        continue
                    for field in ("key", "url"):
                        nk = remap(a.get(field), migrated)
                        if nk and a.get(field) != nk:
                            a[field] = nk
                            dirty = True
                if dirty:
                    changed += 1
                    if APPLY:
                        await db[coll].update_one({"_id": doc["_id"]},
                                                  {"$set": {"attachments": atts}})
            print(f"  {coll}: {changed} document(s) {'updated' if APPLY else 'would be updated'}")

        # ── single-URL fields: scheduled_posts ────────────────────────────────
        changed = 0
        async for doc in db["scheduled_posts"].find({}):
            updates = {}
            for field in ("image_url", "video_url"):
                nk = remap(doc.get(field), migrated)
                if nk and doc.get(field) != nk:
                    updates[field] = nk
            if updates:
                changed += 1
                if APPLY:
                    await db["scheduled_posts"].update_one({"_id": doc["_id"]}, {"$set": updates})
        print(f"  scheduled_posts: {changed} document(s) {'updated' if APPLY else 'would be updated'}")
    finally:
        await close_db()


def delete_originals(migrated: dict[str, str]) -> None:
    """Remove the old copies. Only ever for objects verified at the destination."""
    c = _get_r2_client()
    olds = [o for o, n in migrated.items() if object_exists(n)]
    print(f"\nDeleting {len(olds)} original(s) whose copy is verified present")
    if not APPLY:
        print("  (dry run — pass --apply as well to actually delete)")
        return
    for i in range(0, len(olds), 1000):
        batch = olds[i:i + 1000]
        c.delete_objects(Bucket=settings.r2_bucket,
                         Delete={"Objects": [{"Key": k} for k in batch], "Quiet": True})
        print(f"  deleted {len(batch)}")


def main() -> None:
    if not settings.r2_enabled:
        print("[SKIP] R2 is not configured (r2_enabled=False). Nothing to do.")
        return
    if not ROOT:
        print("[ABORT] R2_ROOT_PREFIX is empty — nothing to migrate into.")
        return

    mode = "APPLY" if APPLY else "DRY RUN (nothing will be written)"
    print(f"Bucket: {settings.r2_bucket}   target namespace: {ROOT}/   mode: {mode}\n")

    items = list_legacy()
    total_mb = sum(s for _, s in items) / 1024 / 1024
    print(f"Legacy objects to migrate: {len(items)}  ({total_mb:.1f} MB)\n")
    if not items:
        print("Nothing to do — no objects outside the namespace.")
        return

    migrated = copy_objects(items)
    print(f"\nVerified at destination: {len(migrated)}/{len(items)}")

    if migrated:
        print("\nRewriting database references:")
        asyncio.run(rewrite_db(migrated))

    if DELETE_ORIGINALS:
        delete_originals(migrated)

    print("\nDone." + ("" if APPLY else "  Re-run with --apply to make these changes."))


if __name__ == "__main__":
    main()
