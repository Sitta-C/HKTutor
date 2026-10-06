import { NotebookPage, PaperCard, StickyNote, WashiTape } from '@/components/ui/notebook';
import { notebookLoadingPalette } from '@/components/ui/notebook-loading-palette';

import styles from './notebook-loading.module.css';

import type { NotebookLoadingKind } from '@/components/ui/notebook-loading-palette';
import type { ReactNode } from 'react';

export function NotebookLoading({
  kind,
  label,
  layout = 'page',
}: {
  kind: NotebookLoadingKind;
  label: ReactNode;
  layout?: 'page' | 'content';
}) {
  const Container = layout === 'page' ? NotebookPage : 'div';
  const palette = notebookLoadingPalette[kind];

  return (
    <Container
      className={`${styles.stage} ${layout === 'page' ? styles.page : styles.content}`}
      aria-busy="true"
      data-loading-kind={kind}
    >
      <StickyNote
        className={styles.note}
        style={{ backgroundColor: palette.background, color: '#292524' }}
        role="status"
      >
        <WashiTape className={`${styles.tape}`} />
        <span className={styles.spinner} aria-hidden="true" />
        <p className="font-note">{label}</p>
      </StickyNote>
    </Container>
  );
}

export function NotebookPageError({ label }: { label: ReactNode }) {
  return (
    <NotebookPage className={styles.stage}>
      <PaperCard className="max-w-md p-6 text-center text-sm text-red-800" role="alert">
        {label}
      </PaperCard>
    </NotebookPage>
  );
}

export function NotebookLoadingRegion({
  label,
  presentation = 'skeleton',
}: {
  label: string;
  presentation?: 'skeleton' | 'text';
}) {
  if (presentation === 'text') {
    return (
      <p className={styles.inline} role="status" aria-busy="true" data-loading-region>
        {label}
      </p>
    );
  }

  return (
    <div className={styles.region} role="status" aria-busy="true" data-loading-region>
      <p>{label}</p>
      <div className={styles.lines} aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
