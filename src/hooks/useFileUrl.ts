import { useEffect, useState } from 'react';
import { getFile } from '@/lib/fileStore';
import type { FileRef } from '@/types';

/** Resolves a stored upload to a displayable data URL. Generated (seeded) files resolve to null. */
export function useFileUrl(ref: FileRef | null | undefined) {
  const [state, setState] = useState<{ id: string | null; url: string | null; loading: boolean }>({ id: null, url: null, loading: false });
  const id = ref && ref.kind !== 'generated' ? ref.id : null;
  useEffect(() => {
    let alive = true;
    if (!id) {
      setState({ id: null, url: null, loading: false });
      return;
    }
    setState({ id, url: null, loading: true });
    void getFile(id).then((url) => {
      if (alive) setState({ id, url, loading: false });
    });
    return () => {
      alive = false;
    };
  }, [id]);
  return state.id === id ? state : { id, url: null, loading: Boolean(id) };
}
