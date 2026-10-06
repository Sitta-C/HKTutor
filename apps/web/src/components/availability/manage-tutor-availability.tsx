'use client';

import { useRouter } from 'next/navigation';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';

import { AvailabilitySummary } from '@/components/availability/availability-summary';
import {
  buildAvailabilityWeek,
  buildAvailabilityWeekLayout,
} from '@/components/availability/manage-tutor-availability-model';
import { DashboardIcon } from '@/components/dashboard/dashboard-icon';
import DashboardShell from '@/components/dashboard/dashboard-shell';
import { LocalizedDatePicker } from '@/components/date-time/localized-date-picker';
import { TimeWheelPicker } from '@/components/date-time/time-wheel-picker';
import {
  GraphPaper,
  PaperCard,
  StatusBadge,
  StickyNote,
  WashiTape,
  notebookButtonClass,
} from '@/components/ui/notebook';
import {
  NotebookLoading,
  NotebookLoadingRegion,
  NotebookPageError,
} from '@/components/ui/notebook-loading';
import { useNotebookToast } from '@/components/ui/notebook-toast';
import {
  bangkokDateTimeToUtc,
  createTutorAvailability,
  deleteTutorAvailability,
  getBangkokWeekRange,
  getBangkokWeekStart,
  getTutorAvailability,
  shiftBangkokWeek,
} from '@/lib/api/availability';
import { ApiError } from '@/lib/api/error';
import {
  formatBangkokDateRange,
  formatBangkokDateTime,
  formatBangkokShortDate,
  formatBangkokTime,
  formatBangkokWeekday,
  formatBangkokWeekRange,
  getBangkokIsoDate,
  getBangkokToday,
} from '@/lib/date-time';
import { useLanguage } from '@/lib/i18n';
import { useProfileSession } from '@/lib/use-profile-session';

import styles from './manage-tutor-availability.module.css';

import type { TutorAvailabilitySlot } from '@/lib/api/types';

const availabilitySecondaryButtonClass = notebookButtonClass({
  tone: 'secondary',
  className: 'min-h-10 px-3 py-2 text-xs',
});

export default function ManageTutorAvailability() {
  const {
    isLoading: sessionLoading,
    logout,
    profileError,
    profileUser,
    user,
  } = useProfileSession({
    preserveReturnTo: true,
    profileMode: 'required',
    profileErrorMode: 'report',
    requiredRole: 'TUTOR',
  });
  const { language, copy } = useLanguage();
  const toast = useNotebookToast();
  const router = useRouter();
  const availabilityCopy = copy.dashboard.availability;
  const [weekStart, setWeekStart] = useState(() => getBangkokWeekStart());
  const [startDate, setStartDate] = useState(() => getBangkokToday());
  const [endDate, setEndDate] = useState(() => getBangkokToday());
  const [startTime, setStartTime] = useState('18:00');
  const [endTime, setEndTime] = useState('19:00');
  const [slots, setSlots] = useState<TutorAvailabilitySlot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [busySlotId, setBusySlotId] = useState<string | null>(null);
  const [slotToDelete, setSlotToDelete] = useState<TutorAvailabilitySlot | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const updateTime = () => setNow(Date.now());
    const timer = window.setInterval(updateTime, 30_000);
    window.addEventListener('focus', updateTime);
    document.addEventListener('visibilitychange', updateTime);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', updateTime);
      document.removeEventListener('visibilitychange', updateTime);
    };
  }, []);

  const prepareAvailabilityLoad = () => {
    setIsLoading(true);
    setLoadError(null);
    setSlots([]);
  };

  const changeWeek = (nextWeek: string) => {
    prepareAvailabilityLoad();
    if (nextWeek === weekStart) {
      setRefreshKey((key) => key + 1);
    } else {
      setWeekStart(nextWeek);
    }
  };

  const refreshAvailability = () => {
    prepareAvailabilityLoad();
    setRefreshKey((key) => key + 1);
  };

  useEffect(() => {
    if (sessionLoading || profileError || !user || user.role !== 'TUTOR') return;
    let active = true;
    const range = getBangkokWeekRange(weekStart);
    // The existing API filters by start time, so include earlier starts for carry-over slots.
    getTutorAvailability({ to: range.to })
      .then((result) => {
        if (!active) return;
        setSlots(result);
      })
      .catch(() => {
        if (!active) return;
        setLoadError(availabilityCopy.loadError);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [availabilityCopy.loadError, profileError, refreshKey, sessionLoading, user, weekStart]);

  const availabilityWeek = useMemo(
    () => buildAvailabilityWeek(slots, weekStart),
    [slots, weekStart],
  );
  const weekLayout = useMemo(
    () => buildAvailabilityWeekLayout(availabilityWeek),
    [availabilityWeek],
  );

  useEffect(() => {
    const dialog = deleteDialogRef.current;
    if (!dialog) return;
    const selectedSpan = weekLayout.spans.find(({ slot }) => slot.id === slotToDelete?.id);
    const canOpen =
      slotToDelete !== null &&
      (busySlotId !== null ||
        (selectedSpan?.slot.state === 'OPEN' &&
          new Date(selectedSpan.lastSegment.endAtUtc).getTime() > now));
    if (canOpen && !dialog.open) dialog.showModal();
    if (!canOpen && dialog.open) dialog.close();
  }, [busySlotId, now, slotToDelete, weekLayout]);

  const getDeletableSpan = (slot: TutorAvailabilitySlot, currentTime: number) =>
    weekLayout.spans.find(
      (span) =>
        span.slot.id === slot.id &&
        span.slot.state === 'OPEN' &&
        new Date(span.lastSegment.endAtUtc).getTime() > currentTime,
    );

  const handleRequestDelete = (slot: TutorAvailabilitySlot, currentTime: number) => {
    if (getDeletableSpan(slot, currentTime)) {
      setSlotToDelete(slot);
    } else {
      setNow(currentTime);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    if (!startDate || !endDate || !startTime || !endTime) {
      setFormError(availabilityCopy.emptyForm);
      return;
    }

    try {
      const startAt = bangkokDateTimeToUtc(startDate, startTime);
      const endAt = bangkokDateTimeToUtc(endDate, endTime);
      if (endAt <= startAt) {
        setFormError(availabilityCopy.endAfterStart);
        return;
      }
      if (startAt <= new Date()) {
        setFormError(availabilityCopy.futureRequired);
        return;
      }

      setIsSaving(true);
      await createTutorAvailability({ startAt: startAt.toISOString(), endAt: endAt.toISOString() });
      toast.success(availabilityCopy.added);
      const createdWeek = getBangkokWeekStart(startAt);
      if (createdWeek === weekStart) {
        refreshAvailability();
      } else {
        changeWeek(createdWeek);
      }
    } catch (caught: unknown) {
      if (caught instanceof ApiError && caught.status === 409) {
        setFormError(availabilityCopy.overlapError);
      } else {
        toast.error(availabilityCopy.createError);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (slot: TutorAvailabilitySlot) => {
    if (slot.state !== 'OPEN' || busySlotId !== null) return;
    const currentTime = Date.now();
    if (!getDeletableSpan(slot, currentTime)) {
      setNow(currentTime);
      setSlotToDelete(null);
      return;
    }
    setBusySlotId(slot.id);
    try {
      await deleteTutorAvailability(slot.id);
      toast.success(availabilityCopy.deleted);
      refreshAvailability();
    } catch (caught: unknown) {
      if (caught instanceof ApiError && caught.status === 409) {
        toast.error(availabilityCopy.reservedError);
      } else {
        toast.error(availabilityCopy.deleteError);
      }
    } finally {
      setBusySlotId(null);
      setSlotToDelete(null);
    }
  };

  const handleLogout = async () => {
    await logout();
    router.replace('/');
  };

  if (sessionLoading || !user) {
    return <NotebookLoading kind="availabilitySession" label={availabilityCopy.loading} />;
  }
  if (user.role !== 'TUTOR') return null;
  if (profileError) {
    return <NotebookPageError label={profileError} />;
  }

  const shellUser = profileUser ?? user;
  const weekLabel = formatBangkokWeekRange(weekStart, language);
  const today = getBangkokToday();
  const thisWeek = getBangkokWeekStart();
  const openSlotCount = availabilityWeek.slots.filter((slot) => slot.state === 'OPEN').length;
  const reservedSlotCount = availabilityWeek.slots.length - openSlotCount;

  return (
    <DashboardShell user={shellUser} onLogout={handleLogout}>
      <div className="min-w-0 pb-12">
        <header className="mb-6 mt-7">
          <p className="font-note text-xl font-semibold leading-none text-amber-700 sm:text-2xl">
            {availabilityCopy.eyebrow}
          </p>
          <h1 className="mt-2 flex flex-wrap items-center gap-3 text-3xl font-bold tracking-[-0.045em] text-notebook-ink sm:text-4xl">
            <span>{availabilityCopy.title}</span>
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-notebook-muted sm:text-base">
            {availabilityCopy.subtitle}
          </p>
        </header>

        <AvailabilitySummary
          label={availabilityCopy.weekOf.replace('{date}', weekLabel)}
          openSlotCount={openSlotCount}
          reservedSlotCount={reservedSlotCount}
          isLoading={isLoading}
          hasError={loadError !== null}
        />

        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,.75fr)]">
          <PaperCard
            className="overflow-hidden p-5 sm:p-6"
            aria-labelledby="availability-week-title"
          >
            <WashiTape tone="blue" className="-top-2 left-8 rotate-2" />
            <div className="flex flex-col gap-4 border-b border-dashed border-paper-edge pb-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2
                  id="availability-week-title"
                  className="text-lg font-extrabold text-notebook-ink"
                >
                  {availabilityCopy.weekOf.replace('{date}', weekLabel)}
                </h2>
                <p className="mt-1 max-w-md text-xs leading-5 text-notebook-muted">
                  {availabilityCopy.weekDescription}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={notebookButtonClass({
                    tone: 'secondary',
                    className: 'min-h-10 w-10 px-0 py-2 text-lg',
                  })}
                  aria-label={availabilityCopy.previousWeek}
                  onClick={() => changeWeek(shiftBangkokWeek(weekStart, -1))}
                >
                  ‹
                </button>
                <button
                  type="button"
                  className={availabilitySecondaryButtonClass}
                  onClick={() => {
                    changeWeek(thisWeek);
                  }}
                >
                  {availabilityCopy.thisWeek}
                </button>
                <button
                  type="button"
                  className={notebookButtonClass({
                    tone: 'secondary',
                    className: 'min-h-10 w-10 px-0 py-2 text-lg',
                  })}
                  aria-label={availabilityCopy.nextWeek}
                  onClick={() => changeWeek(shiftBangkokWeek(weekStart, 1))}
                >
                  ›
                </button>
              </div>
            </div>

            {isLoading ? (
              <div className="mt-5">
                <NotebookLoadingRegion label={availabilityCopy.loading} />
              </div>
            ) : loadError !== null ? (
              <InlineState
                message={loadError || availabilityCopy.loadError}
                actionLabel={availabilityCopy.retry}
                onAction={refreshAvailability}
                error
              />
            ) : weekLayout.spans.length === 0 ? (
              <EmptyState message={availabilityCopy.noSlots} />
            ) : (
              <div
                className={styles.weekGrid}
                style={{ gridTemplateRows: weekLayout.gridTemplateRows }}
              >
                {weekLayout.days.map(({ day, startAtUtc, rowStart, rowEnd, separatorRow }) => (
                  <Fragment key={day}>
                    <div
                      className={styles.dayLabel}
                      style={{ gridRow: `${rowStart} / ${rowEnd}` }}
                      data-availability-date={day}
                    >
                      <strong className={styles.fullWeekday}>
                        {formatBangkokWeekday(startAtUtc, language)}
                      </strong>
                      <strong className={styles.shortWeekday}>
                        {formatBangkokWeekday(startAtUtc, language, 'short')}
                      </strong>
                      <span>{formatBangkokShortDate(startAtUtc, language)}</span>
                    </div>
                    {separatorRow !== null && (
                      <div
                        className={styles.daySeparator}
                        style={{ gridRow: separatorRow }}
                        aria-hidden="true"
                      />
                    )}
                  </Fragment>
                ))}
                {weekLayout.spans.map(
                  ({ slot, firstSegment, lastSegment, firstDay, lastDay, rowStart, rowEnd }) => {
                    const reserved = slot.state === 'RESERVED';
                    const past = new Date(lastSegment.endAtUtc).getTime() <= now;
                    const spanning = firstDay !== lastDay;
                    const continuesAfterWeek =
                      new Date(lastSegment.endAtUtc).getTime() < new Date(slot.endAtUtc).getTime();
                    const crossesDay =
                      getBangkokIsoDate(slot.startAtUtc) !== getBangkokIsoDate(slot.endAtUtc);
                    const endLabelDate = lastSegment.endsAtMidnight
                      ? lastSegment.startAtUtc
                      : lastSegment.endAtUtc;
                    return (
                      <div
                        key={slot.id}
                        role="group"
                        aria-label={`${formatBangkokDateTime(slot.startAtUtc, language)}–${formatBangkokDateTime(slot.endAtUtc, language)}`}
                        className={`${styles.row} ${spanning ? styles.spanningRow : ''}`}
                        style={{ gridRow: `${rowStart} / ${rowEnd}` }}
                        data-availability-slot={slot.id}
                        data-availability-day={firstDay}
                        data-availability-end-day={lastDay}
                        data-spanning={spanning}
                        data-state={past ? 'past' : reserved ? 'booked' : 'open'}
                      >
                        <div className={styles.binding} aria-hidden="true">
                          <span />
                          <span />
                          <span />
                        </div>
                        <div className={styles.rowBody}>
                          {spanning ? (
                            <div className={styles.spanTimes}>
                              <div className={styles.spanEndpoint}>
                                <span className={styles.endpointLabel}>
                                  {firstSegment.isContinuation
                                    ? availabilityCopy.spanContinued
                                    : availabilityCopy.spanStart}
                                </span>
                                <strong className={styles.time}>
                                  <time dateTime={firstSegment.startAtUtc}>
                                    {formatBangkokTime(firstSegment.startAtUtc, language)}
                                  </time>
                                </strong>
                                <p className={styles.dateRange}>
                                  {formatBangkokShortDate(firstSegment.startAtUtc, language)}
                                </p>
                              </div>
                              <div className={styles.spanConnector} aria-hidden="true" />
                              <div className={styles.spanEndpoint}>
                                <span className={styles.endpointLabel}>
                                  {continuesAfterWeek
                                    ? availabilityCopy.spanContinues
                                    : availabilityCopy.spanEnd}
                                </span>
                                <strong className={styles.time}>
                                  <time dateTime={lastSegment.endAtUtc}>
                                    {lastSegment.endsAtMidnight
                                      ? '24:00'
                                      : formatBangkokTime(lastSegment.endAtUtc, language)}
                                  </time>
                                </strong>
                                <p className={styles.dateRange}>
                                  {formatBangkokShortDate(endLabelDate, language)}
                                </p>
                              </div>
                            </div>
                          ) : (
                            <div className="min-w-0">
                              <strong className={`${styles.time} ${styles.timeRange}`}>
                                <time dateTime={firstSegment.startAtUtc}>
                                  {formatBangkokTime(firstSegment.startAtUtc, language)}
                                </time>
                                <span>–</span>
                                <time dateTime={lastSegment.endAtUtc}>
                                  {lastSegment.endsAtMidnight
                                    ? '24:00'
                                    : formatBangkokTime(lastSegment.endAtUtc, language)}
                                </time>
                              </strong>
                              {crossesDay ? (
                                <p className={styles.dateRange}>
                                  {firstSegment.isContinuation
                                    ? availabilityCopy.continuation.replace(
                                        '{dates}',
                                        formatBangkokDateRange(
                                          slot.startAtUtc,
                                          slot.endAtUtc,
                                          language,
                                        ),
                                      )
                                    : formatBangkokDateRange(
                                        slot.startAtUtc,
                                        slot.endAtUtc,
                                        language,
                                      )}
                                </p>
                              ) : (
                                <p className={styles.detail}>
                                  {reserved
                                    ? availabilityCopy.reservedDetail
                                    : past
                                      ? availabilityCopy.pastDetail
                                      : availabilityCopy.openDetail}
                                </p>
                              )}
                            </div>
                          )}
                          <div className={styles.rowActions}>
                            <StatusBadge
                              tone={past ? 'neutral' : reserved ? 'warning' : 'success'}
                              className={styles.badge ?? ''}
                            >
                              <DashboardIcon
                                name={past ? 'clock' : reserved ? 'bookings' : 'check'}
                                className="h-3.5 w-3.5 shrink-0"
                              />
                              {past
                                ? availabilityCopy.past
                                : reserved
                                  ? availabilityCopy.hasBooking
                                  : availabilityCopy.open}
                            </StatusBadge>
                            {!reserved && !past && (
                              <button
                                type="button"
                                className={notebookButtonClass({
                                  tone: 'secondary',
                                  className: styles.deleteButton,
                                })}
                                aria-label={availabilityCopy.deleteSlotLabel.replace(
                                  '{time}',
                                  `${formatBangkokDateTime(slot.startAtUtc, language)}–${formatBangkokDateTime(slot.endAtUtc, language)}`,
                                )}
                                aria-haspopup="dialog"
                                disabled={busySlotId === slot.id}
                                onClick={() => handleRequestDelete(slot, Date.now())}
                              >
                                <DashboardIcon name="trash" className="h-3.5 w-3.5" />
                                {availabilityCopy.delete}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  },
                )}
              </div>
            )}
          </PaperCard>

          <aside className="space-y-4 xl:sticky xl:top-24">
            <PaperCard className="p-5 sm:p-6">
              <WashiTape tone="yellow" className="-top-2 right-8 rotate-3" />
              <form onSubmit={(event) => void handleSubmit(event)} noValidate>
                <div className="border-b border-dashed border-paper-edge pb-4">
                  <div>
                    <h2 className="text-lg font-extrabold text-notebook-ink">
                      {availabilityCopy.addTitle}
                    </h2>
                    <p className="mt-1 text-xs leading-5 text-notebook-muted">
                      {availabilityCopy.addDescription}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col gap-4 pt-5">
                  <div
                    role="group"
                    aria-labelledby="availability-start-title"
                    className="flex min-w-0 flex-col gap-3"
                  >
                    <h3
                      id="availability-start-title"
                      className="text-sm font-extrabold text-notebook-ink"
                    >
                      {availabilityCopy.startDateTime}
                    </h3>
                    <LocalizedDatePicker
                      name="startDate"
                      label={availabilityCopy.startDate}
                      value={startDate}
                      onChange={(nextDate) => {
                        setStartDate(nextDate);
                        if (endDate < nextDate) setEndDate(nextDate);
                      }}
                      min={today}
                      language={language}
                      calendarLabel={availabilityCopy.calendarLabel}
                      previousMonthLabel={availabilityCopy.previousMonth}
                      nextMonthLabel={availabilityCopy.nextMonth}
                    />
                    <TimeWheelPicker
                      name="startTime"
                      label={availabilityCopy.startTime}
                      value={startTime}
                      onChange={setStartTime}
                      hourLabel={availabilityCopy.wheelHour}
                      minuteLabel={availabilityCopy.wheelMinute}
                    />
                  </div>
                  <div
                    role="group"
                    aria-labelledby="availability-end-title"
                    className="flex min-w-0 flex-col gap-3"
                  >
                    <h3
                      id="availability-end-title"
                      className="flex items-center gap-2 text-sm font-extrabold text-notebook-ink"
                    >
                      {availabilityCopy.endDateTime}
                      <span
                        aria-hidden="true"
                        className="flex-1 border-t border-dashed border-paper-edge"
                      />
                    </h3>
                    <LocalizedDatePicker
                      name="endDate"
                      label={availabilityCopy.endDate}
                      value={endDate}
                      onChange={setEndDate}
                      min={startDate > today ? startDate : today}
                      language={language}
                      calendarLabel={availabilityCopy.calendarLabel}
                      previousMonthLabel={availabilityCopy.previousMonth}
                      nextMonthLabel={availabilityCopy.nextMonth}
                    />
                    <TimeWheelPicker
                      name="endTime"
                      label={availabilityCopy.endTime}
                      value={endTime}
                      onChange={setEndTime}
                      hourLabel={availabilityCopy.wheelHour}
                      minuteLabel={availabilityCopy.wheelMinute}
                    />
                  </div>
                  {formError && (
                    <p
                      className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700"
                      role="alert"
                    >
                      {formError}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="submit"
                      className={notebookButtonClass({ className: 'flex-1' })}
                      disabled={isSaving}
                    >
                      <DashboardIcon name="plus" className="h-4 w-4" />
                      {isSaving ? availabilityCopy.adding : availabilityCopy.add}
                    </button>
                  </div>
                </div>
              </form>
            </PaperCard>
            <StickyNote tone="yellow" className="p-4 text-sm leading-6">
              <strong className="block text-notebook-ink">
                {availabilityCopy.reservedHelpTitle}
              </strong>
              <p className="mt-1 text-xs text-notebook-muted">{availabilityCopy.reservedHelp}</p>
            </StickyNote>
          </aside>
        </div>
      </div>
      <dialog
        ref={deleteDialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="availability-delete-title"
        aria-describedby="availability-delete-description availability-delete-time"
        className={styles.deleteDialog}
        onCancel={(event) => {
          if (busySlotId !== null) event.preventDefault();
        }}
        onClose={() => setSlotToDelete(null)}
      >
        <div className={styles.dialogHeader}>
          <span className={styles.dialogIcon} aria-hidden="true">
            <DashboardIcon name="trash" className="h-[18px] w-[18px]" />
          </span>
          <h2 id="availability-delete-title" className={styles.dialogTitle}>
            {availabilityCopy.deleteTitle}
          </h2>
        </div>
        <p id="availability-delete-description" className={styles.dialogDescription}>
          {slotToDelete &&
          getBangkokIsoDate(slotToDelete.startAtUtc) !== getBangkokIsoDate(slotToDelete.endAtUtc)
            ? availabilityCopy.deleteSpanningDescription
            : availabilityCopy.deleteDescription}
        </p>
        <div id="availability-delete-time" className={styles.dialogSummary}>
          <div className={styles.dialogBinding} aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          {slotToDelete && (
            <dl className={styles.dialogRange}>
              <div className={styles.dialogEndpoint}>
                <dt className={styles.dialogLabel}>{availabilityCopy.spanStart}</dt>
                <dd className={styles.dialogDate}>
                  <time dateTime={slotToDelete.startAtUtc}>
                    {formatBangkokShortDate(slotToDelete.startAtUtc, language)}
                  </time>
                </dd>
                <dd className={styles.dialogTime}>
                  <time dateTime={slotToDelete.startAtUtc}>
                    {formatBangkokTime(slotToDelete.startAtUtc, language)}
                  </time>
                </dd>
              </div>
              <div className={styles.dialogEndpoint}>
                <dt className={styles.dialogLabel}>{availabilityCopy.spanEnd}</dt>
                <dd className={styles.dialogDate}>
                  <time dateTime={slotToDelete.endAtUtc}>
                    {formatBangkokShortDate(slotToDelete.endAtUtc, language)}
                  </time>
                </dd>
                <dd className={styles.dialogTime}>
                  <time dateTime={slotToDelete.endAtUtc}>
                    {formatBangkokTime(slotToDelete.endAtUtc, language)}
                  </time>
                </dd>
              </div>
            </dl>
          )}
        </div>
        <div className={styles.dialogActions}>
          <button
            type="button"
            autoFocus
            className={notebookButtonClass({ tone: 'secondary', className: styles.dialogAction })}
            disabled={busySlotId !== null}
            onClick={() => setSlotToDelete(null)}
          >
            {availabilityCopy.cancelDelete}
          </button>
          <button
            type="button"
            className={notebookButtonClass({
              tone: 'danger',
              className: `${styles.dialogAction} ${styles.dialogDelete}`,
            })}
            disabled={busySlotId !== null}
            onClick={() => {
              if (slotToDelete) void handleDelete(slotToDelete);
            }}
          >
            <DashboardIcon name="trash" className="h-4 w-4 shrink-0" />
            {busySlotId !== null ? availabilityCopy.deleting : availabilityCopy.confirmDelete}
          </button>
        </div>
      </dialog>
    </DashboardShell>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <GraphPaper className="mt-5 flex min-h-40 items-center justify-center border-dashed p-8 text-center text-sm text-notebook-muted">
      {message}
    </GraphPaper>
  );
}

function InlineState({
  message,
  actionLabel,
  onAction,
  error = false,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  error?: boolean;
}) {
  return (
    <div
      className={`mt-5 flex min-h-32 flex-wrap items-center justify-center gap-3 rounded-xl border border-dashed p-4 text-center text-sm ${
        error
          ? 'border-red-200 bg-red-50 text-red-700'
          : 'border-paper-edge bg-paper-deep/65 text-notebook-muted'
      }`}
    >
      <span role={error ? 'alert' : 'status'}>{message}</span>
      {actionLabel && onAction && (
        <button type="button" className={availabilitySecondaryButtonClass} onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
