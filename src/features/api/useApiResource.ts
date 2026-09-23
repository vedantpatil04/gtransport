import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api/client';

export interface ApiResource<T> {
  data: T | null;
  /** True only while the first load is in flight; refreshes keep the previous data visible. */
  loading: boolean;
  refreshing: boolean;
  error: ApiError | null;
  reload: () => void;
}

/**
 * Minimal data-loading hook: no extra dependency, and the loading / empty / error states the
 * admin screens need. `deps` behaves like a useEffect dependency list.
 */
export function useApiResource<T>(loader: () => Promise<T>, deps: unknown[], enabled = true): ApiResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [nonce, setNonce] = useState(0);

  const loadedOnce = useRef(false);
  const latestRequest = useRef(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const requestId = latestRequest.current + 1;
    latestRequest.current = requestId;

    if (loadedOnce.current) setRefreshing(true);
    else setLoading(true);

    loaderRef
      .current()
      .then((result) => {
        // A newer request has started: discard this response so results cannot arrive out of order.
        if (latestRequest.current !== requestId) return;
        setData(result);
        setError(null);
        loadedOnce.current = true;
      })
      .catch((cause: unknown) => {
        if (latestRequest.current !== requestId) return;
        setError(cause instanceof ApiError ? cause : new ApiError(0, 'UNKNOWN', 'Something went wrong.'));
      })
      .finally(() => {
        if (latestRequest.current !== requestId) return;
        setLoading(false);
        setRefreshing(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, loading, refreshing, error, reload };
}

/** Debounces a changing value, so typing in a search box does not fire a request per keystroke. */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
