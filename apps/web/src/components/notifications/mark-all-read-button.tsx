import styles from './notification.module.css';

export function MarkAllReadButton({
  disabled,
  label,
  onClick,
}: {
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={styles.textAction} disabled={disabled} onClick={onClick}>
      {label}
    </button>
  );
}
