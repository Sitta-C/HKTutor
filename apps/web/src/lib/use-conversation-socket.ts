'use client';

import { useEffect, useRef, useState } from 'react';

import { subscribeConversationRealtime } from '@/lib/conversation-realtime';

import type { ConversationSocketState } from '@/lib/conversation-realtime';

/** Own exactly one visible thread subscription, including Strict Mode setup/cleanup replay. */
export function useConversationSocket(
  conversationId: string,
  invalidate: () => void,
  connectionChanged: (state: ConversationSocketState) => void,
): ConversationSocketState {
  const callbacks = useRef({ invalidate, connectionChanged });
  const [state, setState] = useState<ConversationSocketState>('connecting');
  useEffect(() => {
    callbacks.current = { invalidate, connectionChanged };
  }, [invalidate, connectionChanged]);
  useEffect(() => {
    let active = true;
    let stop: (() => void) | null = null;
    const changed = (next: ConversationSocketState) => {
      if (active) {
        setState(next);
        callbacks.current.connectionChanged(next);
      }
    };
    const visibilityChanged = () => {
      stop?.();
      stop = null;
      if (document.hidden) {
        changed('paused');
      } else {
        stop = subscribeConversationRealtime(
          conversationId,
          () => callbacks.current.invalidate(),
          changed,
        );
      }
    };
    visibilityChanged();
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', visibilityChanged);
      stop?.();
    };
  }, [conversationId]);
  return state;
}
