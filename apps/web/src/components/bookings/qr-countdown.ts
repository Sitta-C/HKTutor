export function getQrCountdown(expiresAt: string, now: number): string | null {
  const deadline = Date.parse(expiresAt);
  if (!Number.isFinite(deadline) || !Number.isFinite(now)) {
    return null;
  }
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
