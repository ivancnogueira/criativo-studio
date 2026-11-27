import React, { useEffect, useMemo, useState } from "react";
import { resolveActiveServerUrl } from "../../services/http-client";

export interface OptimizedChatThumbnailProps {
  url: string;
  alt: string;
  className?: string;
  width?: number;
}

export function buildOptimizedThumbnailUrl(rawUrl: string, width = 480): string {
  try {
    const parsed = new URL(rawUrl, "http://localhost");
    let relPath: string | null = null;
    if (parsed.pathname === "/api/arquivos/raw") {
      relPath = parsed.searchParams.get("path");
    } else if (parsed.pathname.startsWith("/api/arquivos/raw/")) {
      relPath = decodeURIComponent(parsed.pathname.slice("/api/arquivos/raw/".length));
    }
    if (relPath) {
      const safeW = Math.max(64, Math.min(1600, Math.round(width)));
      return resolveActiveServerUrl(
        `/api/arquivos/thumbnail?path=${encodeURIComponent(relPath)}&w=${safeW}`,
      );
    }
  } catch {
    // mantém URL original quando não for relativa ao endpoint local de arquivos
  }
  return resolveActiveServerUrl(rawUrl);
}

/**
 * Renderiza miniatura otimizada no feed do chat com lazy loading e fallback automático
 * para a URL original em caso de erro.
 */
export function OptimizedChatThumbnail({
  url,
  alt,
  className,
  width = 480,
}: OptimizedChatThumbnailProps): React.ReactElement {
  const [useFallback, setUseFallback] = useState<boolean>(false);

  useEffect(() => {
    setUseFallback(false);
  }, [url]);

  const originalUrl = useMemo(() => resolveActiveServerUrl(url), [url]);
  const thumbnailUrl = useMemo(() => buildOptimizedThumbnailUrl(url, width), [url, width]);
  const activeSrc = useFallback ? originalUrl : thumbnailUrl;

  return (
    <img
      src={activeSrc}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => {
        if (!useFallback && thumbnailUrl !== originalUrl) {
          setUseFallback(true);
        }
      }}
      className={className}
    />
  );
}
