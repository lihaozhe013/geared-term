import { useCallback, useEffect, useState } from 'react';
import type { UpdateNotice } from '@geared-term/protocol';

export function useUpdateNotice(): {
  notice: UpdateNotice | null;
  dismiss: (commitSha: string) => Promise<void>;
} {
  const [notice, setNotice] = useState<UpdateNotice | null>(null);

  useEffect(() => {
    let receivedEvent = false;
    const offNotice = window.geared.onUpdateNotice((next) => {
      receivedEvent = true;
      setNotice(next);
    });
    void window.geared
      .getUpdateNotice()
      .then((initial) => {
        if (!receivedEvent) setNotice(initial);
      })
      .catch(() => undefined);
    return offNotice;
  }, []);

  const dismiss = useCallback(async (commitSha: string): Promise<void> => {
    await window.geared.dismissUpdateNotice(commitSha);
    setNotice(null);
  }, []);

  return { notice, dismiss };
}
