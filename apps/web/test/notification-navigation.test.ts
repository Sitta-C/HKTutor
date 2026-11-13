import { afterEach, describe, expect, it, vi } from 'vitest';

import { consumeNotificationOpen, rememberNotificationOpen } from '@/lib/notification-navigation';

afterEach(() => vi.useRealTimers());

describe('same-tab notification opening receipts', () => {
  it('lets a fresh tab acknowledge without an originating handler', () => {
    expect(consumeNotificationOpen('student', 'fresh-tab')).toBe(false);
  });
  it('consumes a local intent once, scoped to the originating user and notification', () => {
    rememberNotificationOpen('student', 'local');
    expect(consumeNotificationOpen('other-user', 'local')).toBe(false);
    expect(consumeNotificationOpen('student', 'another')).toBe(false);
    expect(consumeNotificationOpen('student', 'local')).toBe(true);
    expect(consumeNotificationOpen('student', 'local')).toBe(false);
  });
  it('expires an abandoned navigation instead of suppressing a later receipt', () => {
    vi.useFakeTimers();
    rememberNotificationOpen('student', 'abandoned');
    vi.advanceTimersByTime(60_000);
    expect(consumeNotificationOpen('student', 'abandoned')).toBe(false);
  });
  it('bounds retained intents when navigation never reaches a destination', () => {
    for (let index = 0; index <= 100; index += 1) {
      rememberNotificationOpen('student', `bounded-${index}`);
    }
    expect(consumeNotificationOpen('student', 'bounded-0')).toBe(false);
    expect(consumeNotificationOpen('student', 'bounded-100')).toBe(true);
  });
});
