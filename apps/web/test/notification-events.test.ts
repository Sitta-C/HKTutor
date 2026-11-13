import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  notificationChannelName,
  notifyNotificationsChanged,
  subscribeNotificationsChanged,
} from '@/lib/notification-events';

// Browser channels deliver to other channel objects, including objects in the sender's tab.
class TestChannel {
  static channels = new Set<TestChannel>();
  onmessage: ((event: { data: unknown }) => void) | null = null;

  constructor(readonly name: string) {
    TestChannel.channels.add(this);
  }

  postMessage(data: unknown): void {
    for (const peer of TestChannel.channels) {
      if (peer !== this && peer.name === this.name) {
        queueMicrotask(() => peer.onmessage?.({ data }));
      }
    }
  }

  close(): void {
    this.onmessage = null;
    TestChannel.channels.delete(this);
  }
}

describe('notification invalidation signals', () => {
  beforeEach(() => {
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('BroadcastChannel', TestChannel);
  });
  afterEach(() => {
    TestChannel.channels.clear();
    vi.unstubAllGlobals();
  });

  it('refreshes its own tab once, ignoring its channel echo', async () => {
    const refresh = vi.fn();
    const unsubscribe = subscribeNotificationsChanged('student', refresh);
    notifyNotificationsChanged('student');
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(TestChannel.channels.size).toBe(0);
  });

  it('accepts a peer tab for this user, rejects other users and cleans up', async () => {
    const refresh = vi.fn();
    const unsubscribe = subscribeNotificationsChanged('student', refresh);
    const otherUser = new TestChannel(notificationChannelName('other'));
    otherUser.postMessage({ type: 'changed', sourceId: 'peer-tab' });
    await Promise.resolve();
    expect(refresh).not.toHaveBeenCalled();
    const peer = new TestChannel(notificationChannelName('student'));
    peer.postMessage({ type: 'changed', sourceId: 'peer-tab' });
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(1);
    unsubscribe();
    peer.postMessage({ type: 'changed', sourceId: 'peer-tab' });
    notifyNotificationsChanged('student');
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('reconciles peer receipts separately from local invalidation', async () => {
    const refresh = vi.fn();
    const reconcile = vi.fn();
    const unsubscribe = subscribeNotificationsChanged('student', refresh, reconcile);
    notifyNotificationsChanged('student');
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(reconcile).not.toHaveBeenCalled();
    new TestChannel(notificationChannelName('student')).postMessage({
      type: 'changed',
      sourceId: 'another-tab',
    });
    await Promise.resolve();
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it.each([null, 'changed', {}, { type: 'changed' }, { type: 'other', sourceId: 'peer' }])(
    'ignores malformed channel data %j',
    async (data) => {
      const refresh = vi.fn();
      const unsubscribe = subscribeNotificationsChanged('student', refresh);
      new TestChannel(notificationChannelName('student')).postMessage(data);
      await Promise.resolve();
      expect(refresh).not.toHaveBeenCalled();
      unsubscribe();
    },
  );

  it('keeps local invalidation when the browser disables channel creation', () => {
    vi.stubGlobal(
      'BroadcastChannel',
      class {
        constructor() {
          throw new Error('Unavailable');
        }
      },
    );
    const refresh = vi.fn();
    const unsubscribe = subscribeNotificationsChanged('student', refresh);
    notifyNotificationsChanged('student');
    expect(refresh).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
