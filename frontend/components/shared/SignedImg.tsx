"use client";

/**
 * SignedImg — an <img> for objects served from the private R2 bucket.
 *
 * Attachment URLs are short-lived signed GETs minted by the backend at read
 * time (see backend/app/utils/storage.py). A tab left open past the TTL holds
 * URLs that have expired, so the image 403s on load. When that happens this
 * component asks the caller to refetch the query that produced the URL, once,
 * and re-renders with the fresh one.
 *
 * The retry is deliberately capped at a single attempt: a genuinely missing
 * object 404s forever, and retrying that in a loop would hammer the API.
 */
import { useEffect, useRef, useState } from "react";

interface SignedImgProps {
  src: string;
  alt?: string;
  className?: string;
  /**
   * Called when the image fails to load and a stale signed URL is the likely
   * cause. Should invalidate/refetch whatever query supplied `src`.
   */
  onExpired?: () => void;
  /** Rendered instead of the image once a retry has also failed. */
  fallback?: React.ReactNode;
}

export function SignedImg({ src, alt, className, onExpired, fallback }: SignedImgProps) {
  // Tracks the src we already spent our one retry on, so a *new* URL gets a
  // fresh attempt while the same failing URL does not.
  const retriedFor = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (failed && fallback !== undefined) return <>{fallback}</>;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt ?? ""}
      className={className}
      onError={() => {
        if (retriedFor.current !== src && onExpired) {
          retriedFor.current = src;
          onExpired();
          return;
        }
        setFailed(true);
      }}
    />
  );
}

export default SignedImg;
