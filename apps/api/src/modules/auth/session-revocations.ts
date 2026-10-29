import { Injectable } from '@nestjs/common';

export interface SessionRevocation {
  userId: string;
  sessionId?: string;
}

/** In-process cleanup after committed revocations; dispatch still checks persistence. */
@Injectable()
export class SessionRevocations {
  private readonly listeners = new Set<(revocation: SessionRevocation) => void>();

  subscribe(listener: (revocation: SessionRevocation) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  revoke(revocation: SessionRevocation): void {
    for (const listener of this.listeners) {
      listener(revocation);
    }
  }
}
