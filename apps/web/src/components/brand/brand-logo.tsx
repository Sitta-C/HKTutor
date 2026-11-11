import Image from 'next/image';

import styles from './brand-logo.module.css';

interface BrandLogoProps {
  readonly className?: string;
  readonly iconOnly?: boolean;
  readonly size?: 'sm' | 'md';
}

export function BrandLogo({ className, iconOnly = false, size = 'md' }: BrandLogoProps) {
  return (
    <span
      className={`${styles.logo} ${styles[size]} ${className ?? ''}`}
      role="img"
      aria-label="HKTutor"
    >
      <Image
        src="/brand/open-chapter.svg"
        alt=""
        width={100}
        height={100}
        unoptimized
        loading="eager"
        className={styles.mark}
      />
      {!iconOnly && (
        <span className={styles.wordmark} aria-hidden="true">
          HKTutor
        </span>
      )}
    </span>
  );
}
