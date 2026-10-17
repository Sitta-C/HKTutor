import styles from './notification.module.css';

export function UnreadBadge({ count, label }: { count: number; label: string }) {
  if (count <= 0) {
    return null;
  }
  return (
    <span className={styles.badge} aria-label={label}>
      {count > 99 ? '99+' : count}
    </span>
  );
}
