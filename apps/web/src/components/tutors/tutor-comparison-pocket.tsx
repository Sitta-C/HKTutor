'use client';

import { useSearchParams } from 'next/navigation';
import {
  Suspense,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';

import { DashboardIcon } from '@/components/dashboard/dashboard-icon';
import {
  comparisonSortQueryValue,
  withComparisonSort,
} from '@/components/tutors/comparison-sort-query';
import { ComparisonSortSelector } from '@/components/tutors/comparison-sort-selector';
import { formatPublicTutorSlot } from '@/components/tutors/public-tutor-detail-model';
import { tutorComparisonCopy } from '@/components/tutors/tutor-comparison-copy';
import { loadComparisonColumn } from '@/components/tutors/tutor-comparison-data';
import { sortTutorComparisonView } from '@/components/tutors/tutor-comparison-sort';
import {
  COMPARISON_ATTRIBUTES,
  buildTutorComparisonView,
} from '@/components/tutors/tutor-comparison-view-model';
import {
  placeComparisonPanel,
  useFloatingComparison,
} from '@/components/tutors/use-floating-comparison';
import { NotebookLoadingRegion } from '@/components/ui/notebook-loading';
import { useLanguage } from '@/lib/i18n';

import styles from './tutor-comparison-pocket.module.css';

import type { TutorComparisonCopy } from '@/components/tutors/tutor-comparison-copy';
import type { ComparisonColumn } from '@/components/tutors/tutor-comparison-model';
import type { ComparisonSort } from '@/components/tutors/tutor-comparison-sort';
import type {
  ComparisonAttribute,
  TutorComparisonViewColumn,
} from '@/components/tutors/tutor-comparison-view-model';
import type {
  ComparisonFlight,
  TutorComparisonController,
} from '@/components/tutors/use-tutor-comparison';
import type { ReactNode, RefObject } from 'react';

const subscribeClient = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function TutorComparisonPocket({
  controller,
}: {
  controller: TutorComparisonController;
}): ReactNode {
  const mounted = useSyncExternalStore(subscribeClient, clientSnapshot, serverSnapshot);
  return mounted
    ? createPortal(
        <Suspense fallback={null}>
          <FloatingPocket controller={controller} />
        </Suspense>,
        document.body,
      )
    : null;
}

function FloatingPocket({ controller }: { controller: TutorComparisonController }) {
  const searchParams = useSearchParams();
  const { language } = useLanguage();
  const text = tutorComparisonCopy[language];
  const { choices, flights, notice, remove, clear, finishFlight } = controller;
  const [dialog, setDialog] = useState({ open: false, cycle: 0 });
  const [retry, setRetry] = useState(0);
  const [loaded, setLoaded] = useState<{
    cycle: number;
    retry: number;
    columns: ComparisonColumn[];
    now: number;
  }>({
    cycle: 0,
    retry: 0,
    columns: [],
    now: 0,
  });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const badgeRef = useRef<HTMLSpanElement>(null);
  const restoreFocus = useRef(true);
  const columnPositions = useRef(new Map<string, number>());
  const columnLayout = useRef({ selection: '', width: 0 });
  const id = useId();
  const key = `${dialog.cycle}:${retry}:${choices.map((choice) => `${choice.tutorId}/${choice.listingId}`).join(',')}`;
  // Unchanged columns stay steady during edits; every open/retry starts a fresh public read.
  const columns: ComparisonColumn[] = choices.map((choice) => {
    const existing =
      loaded.cycle === dialog.cycle && loaded.retry === retry
        ? loaded.columns.find(
            (column) =>
              column.choice.tutorId === choice.tutorId &&
              column.choice.listingId === choice.listingId,
          )
        : undefined;
    return existing ?? { choice, state: 'loading' };
  });
  // Cells render only the allow-listed public view, never the raw profile/listing responses.
  const sorted = sortTutorComparisonView(
    buildTutorComparisonView(columns),
    comparisonSortQueryValue(searchParams),
    loaded.now,
  );
  const view = sorted.columns;
  const changeSort = (sort: ComparisonSort): void => {
    if (sort === sorted.sort && !sorted.error) {
      return;
    }
    // Next's native history integration updates useSearchParams without navigation or public reads.
    window.history.pushState(null, '', withComparisonSort(new URL(window.location.href), sort));
  };

  const close = useCallback((focus = true) => {
    restoreFocus.current = focus;
    setDialog((current) => ({ ...current, open: false }));
  }, []);
  const onDragStart = useCallback(() => close(false), [close]);
  const toggle = useCallback(() => {
    restoreFocus.current = true;
    setDialog((current) => ({ open: !current.open, cycle: current.cycle + 1 }));
  }, []);
  const floating = useFloatingComparison(buttonRef, panelRef, onDragStart, toggle);

  useEffect(() => {
    if (!dialog.open || choices.length === 0) {
      return;
    }
    let active = true;
    const abort = new AbortController();
    // A timed-out read becomes a retryable error; closing or changing selection discards it.
    const timeout = window.setTimeout(() => abort.abort(), 15_000);
    void Promise.all(choices.map((choice) => loadComparisonColumn(choice, abort.signal))).then(
      (next) => {
        window.clearTimeout(timeout);
        if (active) {
          setLoaded({ cycle: dialog.cycle, retry, columns: next, now: Date.now() });
        }
      },
    );
    return () => {
      active = false;
      window.clearTimeout(timeout);
      abort.abort();
    };
  }, [dialog.open, dialog.cycle, retry, choices, key]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const button = buttonRef.current;
    if (!panel || !button) {
      return;
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (dialog.open) {
      if (!panel.open) {
        panel.show();
      }
      placeComparisonPanel(button, panel);
      const animation = panel.animate(
        [
          { opacity: 0, transform: 'scale(.24)' },
          { opacity: 1, transform: 'scale(1)' },
        ],
        { duration: reduced ? 0 : 360, easing: 'cubic-bezier(.16, 1, .3, 1)' },
      );
      closeRef.current?.focus({ preventScroll: true });
      const scroll = panel.querySelector<HTMLElement>('[data-comparison-scroll]');
      if (scroll) {
        scroll.scrollTop = 0;
      }
      return () => animation.cancel();
    }
    if (!panel.open) {
      return;
    }
    const animation = panel.animate(
      [
        { opacity: 1, transform: 'scale(1)' },
        { opacity: 0, transform: 'scale(.36)' },
      ],
      { duration: reduced ? 0 : 190, easing: 'cubic-bezier(.4, 0, 1, 1)' },
    );
    void animation.finished.then(() => panel.close()).catch(() => {});
    if (restoreFocus.current) {
      button.focus({ preventScroll: true });
    }
    return () => animation.cancel();
  }, [dialog.open]);

  useEffect(() => {
    const panel = panelRef.current;
    const button = buttonRef.current;
    if (!panel || !button) {
      return;
    }
    const observer = new ResizeObserver(() => {
      if (panel.open) {
        placeComparisonPanel(button, panel);
      }
    });
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!dialog.open) {
      return;
    }
    const outside = (event: globalThis.PointerEvent) => {
      if (
        event.target instanceof Node &&
        !panelRef.current?.contains(event.target) &&
        !buttonRef.current?.contains(event.target)
      ) {
        close(false);
      }
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [dialog.open, close]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!dialog.open || !panel?.open) {
      columnPositions.current.clear();
      columnLayout.current = { selection: '', width: 0 };
      return;
    }
    const next = new Map<string, number>();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const selection = choices.map((choice) => choice.tutorId).join(',');
    const width = panel.clientWidth;
    const animateEdit =
      columnLayout.current.selection !== selection && columnLayout.current.width === width;
    const tableLeft = panel.querySelector('table')?.getBoundingClientRect().left ?? 0;
    for (const header of panel.querySelectorAll<HTMLElement>('thead [data-tutor-column]')) {
      const tutorId = header.dataset.tutorColumn;
      if (!tutorId) {
        continue;
      }
      const x = header.getBoundingClientRect().left - tableLeft;
      next.set(tutorId, x);
      const previous = columnPositions.current.get(tutorId);
      if (!animateEdit || reduced || previous === undefined || Math.abs(previous - x) < 1) {
        continue;
      }
      for (const cell of panel.querySelectorAll<HTMLElement>('[data-tutor-column]')) {
        if (cell.dataset.tutorColumn === tutorId) {
          cell.animate(
            [{ transform: `translateX(${previous - x}px)` }, { transform: 'translateX(0)' }],
            { duration: 240, easing: 'cubic-bezier(.2, .8, .2, 1)' },
          );
        }
      }
    }
    columnPositions.current = next;
    columnLayout.current = { selection, width };
  }, [dialog.open, choices, loaded]);

  const arrive = useCallback(
    (flightId: number) => {
      finishFlight(flightId);
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        badgeRef.current?.animate(
          [
            { transform: 'scale(1)' },
            { transform: 'scale(1.22)', offset: 0.45 },
            { transform: 'scale(1)' },
          ],
          { duration: 300, easing: 'cubic-bezier(.2, .8, .3, 1)' },
        );
      }
    },
    [finishFlight],
  );
  const count = choices.filter(
    (choice) => !flights.some((flight) => flight.tutorId === choice.tutorId),
  ).length;

  return (
    <div className={styles.root}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.button}
        aria-label={`${text.pocket} (${choices.length}/3)`}
        aria-expanded={dialog.open}
        aria-haspopup="dialog"
        aria-controls={`${id}-panel`}
        aria-describedby={`${id}-drag`}
        data-comparison-button
        {...floating}
      >
        <span className={styles.glyph}>
          <DashboardIcon name="compare" />
        </span>
        <span ref={badgeRef} className={styles.badge} aria-hidden="true">
          {count}
        </span>
      </button>
      <p id={`${id}-drag`} className="sr-only">
        {text.dragHelp}
      </p>
      <p role="status" aria-live="polite" className="sr-only">
        {notice
          ? `${text[notice.action]} ${notice.name}. ${choices.length}/3. ${choices.length === 3 ? text.limit : text.guide}`
          : ''}
      </p>
      <dialog
        ref={panelRef}
        id={`${id}-panel`}
        className={styles.panel}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-hint`}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        data-comparison-panel
      >
        <div className={styles.header}>
          <h2 id={`${id}-title`}>
            {text.title} <span>{choices.length}/3</span>
          </h2>
          <button
            ref={closeRef}
            type="button"
            className={styles.iconButton}
            aria-label={text.close}
            onClick={() => close()}
          >
            <DashboardIcon name="close" />
          </button>
        </div>
        <p id={`${id}-hint`} className={styles.hint}>
          {choices.length === 1
            ? `${text.oneMore} ${text.subtitle}`
            : choices.length === 0
              ? text.guide
              : text.subtitle}
        </p>
        <ComparisonSortSelector
          sort={sorted.sort}
          disabled={choices.length < 2 || !columns.some((column) => column.state === 'ready')}
          onChange={changeSort}
          text={text}
        />
        <p
          className="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-comparison-sort-status
        >
          {dialog.open ? text.sortAnnouncement.replace('{sort}', text[sorted.sort]) : ''}
        </p>
        {sorted.error && (
          <p role="alert" className={styles.hint}>
            {text.invalidSort}
          </p>
        )}
        {choices.length === 0 ? (
          <p className={styles.empty}>{text.empty}</p>
        ) : (
          <div className={styles.scroll} data-comparison-scroll>
            <table className={styles.table} style={{ minWidth: 104 + choices.length * 150 }}>
              <caption className="sr-only">{text.table}</caption>
              <thead>
                <tr>
                  <th scope="col">{text.course}</th>
                  {view.map((column) => (
                    <th
                      key={column.tutorId}
                      scope="col"
                      data-comparison-column={column.state}
                      data-tutor-column={column.tutorId}
                    >
                      <div className={styles.columnTop}>
                        <span className={styles.grade}>
                          {column.state === 'ready' ? (column.entry.grade ?? '—') : '—'}
                        </span>
                        <button
                          type="button"
                          className={styles.iconButton}
                          aria-label={`${text.remove}: ${column.state === 'ready' ? column.entry.displayName : column.position + 1}`}
                          onClick={() => {
                            remove(column.tutorId);
                            closeRef.current?.focus({ preventScroll: true });
                          }}
                        >
                          <DashboardIcon name="close" />
                        </button>
                      </div>
                      {column.state === 'ready' ? (
                        <div className={styles.columnIdentity}>
                          <span className={styles.avatar} aria-hidden="true">
                            {initials(column.entry.displayName)}
                          </span>
                          <div>
                            <strong className={styles.name}>{column.entry.displayName}</strong>
                            <small className={styles.subject}>
                              {column.entry.subject ?? text.missing}
                            </small>
                          </div>
                        </div>
                      ) : (
                        <ColumnStatus
                          column={column}
                          text={text}
                          retry={() => setRetry((value) => value + 1)}
                        />
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ATTRIBUTES.map((attribute) => (
                  <tr key={attribute}>
                    <th scope="row">{text[attribute]}</th>
                    {view.map((column) => (
                      <td key={column.tutorId} data-tutor-column={column.tutorId}>
                        <ComparisonValue
                          column={column}
                          attribute={attribute}
                          language={language}
                          text={text}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className={styles.footer}>
          <button
            type="button"
            className={styles.clear}
            disabled={choices.length === 0}
            onClick={() => {
              clear();
              closeRef.current?.focus({ preventScroll: true });
            }}
          >
            {text.clear}
          </button>
          {choices.length > 0 && <span className={styles.scrollHint}>{text.scroll} ↔</span>}
        </div>
      </dialog>
      {flights.map((flight) => (
        <SelectionFlight key={flight.id} flight={flight} target={buttonRef} onFinish={arrive} />
      ))}
    </div>
  );
}

function ColumnStatus({
  column,
  text,
  retry,
}: {
  column: TutorComparisonViewColumn;
  text: TutorComparisonCopy;
  retry: () => void;
}) {
  if (column.state === 'loading') {
    return <NotebookLoadingRegion label={text.loading} presentation="text" />;
  }
  return (
    <div className={styles.columnState} role={column.state === 'error' ? 'alert' : 'status'}>
      <p>{column.state === 'unavailable' ? text.unavailable : text.error}</p>
      {column.state === 'error' && (
        <button type="button" className={styles.clear} onClick={retry}>
          {text.retry}
        </button>
      )}
    </div>
  );
}

function ComparisonValue({
  column,
  attribute,
  language,
  text,
}: {
  column: TutorComparisonViewColumn;
  attribute: ComparisonAttribute;
  language: 'en' | 'th';
  text: TutorComparisonCopy;
}): ReactNode {
  if (column.state !== 'ready') {
    return (
      <span aria-hidden="true" className={styles.muted}>
        —
      </span>
    );
  }
  const { entry } = column;
  const { rating } = entry;
  const missing = <span className={styles.muted}>{text.missing}</span>;
  switch (attribute) {
    case 'price':
      return entry.pricePerHour === null ? (
        missing
      ) : (
        <span className={styles.amount}>
          {new Intl.NumberFormat(language === 'th' ? 'th-TH' : 'en-US', {
            maximumFractionDigits: 2,
          }).format(entry.pricePerHour)}{' '}
          ฿
        </span>
      );
    case 'subject':
      return entry.subject === null ? (
        missing
      ) : (
        <>
          {entry.subject}
          {entry.grade !== null && <small>{entry.grade}</small>}
        </>
      );
    case 'rating':
      return rating.state === 'rated' ? (
        <>
          <strong className={styles.score}>{rating.score}</strong>
          <small>/ 5</small>
        </>
      ) : (
        <span className={styles.muted}>
          {rating.state === 'new' ? text.newTutor : text.missing}
        </span>
      );
    case 'reviews':
      return rating.reviewCount === null ? text.missing : rating.reviewCount;
    case 'experience':
      return entry.experienceYears === null ? (
        missing
      ) : (
        <>
          {entry.experienceYears} {text.years}
        </>
      );
    case 'availability': {
      if (!entry.nextAvailability) {
        return <span className={styles.muted}>{text.noSlots}</span>;
      }
      const slot = formatPublicTutorSlot(entry.nextAvailability, language);
      return (
        <time dateTime={entry.nextAvailability.startAtUtc} aria-label={slot.label}>
          {slot.startDate}
          <small className={styles.time}>
            {slot.start}–{slot.end}
            {slot.endDate ? ` ${slot.endDate}` : ''}
          </small>
        </time>
      );
    }
  }
}

function SelectionFlight({
  flight,
  target,
  onFinish,
}: {
  flight: ComparisonFlight;
  target: RefObject<HTMLButtonElement | null>;
  onFinish: (id: number) => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const node = ref.current;
      const button = target.current;
      if (!node || !button) {
        return;
      }
      const progress = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 1
        : Math.min(1, (now - start) / 570);
      const eased = 1 - (1 - progress) ** 2.4;
      const end = button.getBoundingClientRect();
      const x0 = flight.source.left + flight.source.width / 2 - 18;
      const y0 = flight.source.top + flight.source.height / 2 - 18;
      const x1 = end.left + end.width / 2 - 18;
      const y1 = end.top + end.height / 2 - 18;
      const lift = Math.min(100, Math.abs(y1 - y0) * 0.25 + 40);
      const x = x0 + (x1 - x0) * eased;
      const y = y0 + (y1 - y0) * eased - Math.sin(Math.PI * eased) * lift;
      node.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${1 - 0.65 * progress ** 3})`;
      node.style.opacity = String(progress > 0.88 ? (1 - progress) / 0.12 : 1);
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        onFinish(flight.id);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [flight, onFinish, target]);
  return (
    <span ref={ref} className={styles.flight} aria-hidden="true">
      {initials(flight.name)}
    </span>
  );
}

function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => Array.from(part)[0] ?? '')
      .join('')
      .toUpperCase() || 'T'
  );
}
