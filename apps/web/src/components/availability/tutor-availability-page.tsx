'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { DashboardIcon } from '@/components/dashboard/dashboard-icon';
import DashboardShell from '@/components/dashboard/dashboard-shell';
import { LocalizedDatePicker } from '@/components/date-time/localized-date-picker';
import {
  GraphPaper,
  NotebookPage,
  PaperCard,
  StatusBadge,
  StickyNote,
  WashiTape,
  notebookButtonClass,
  notebookInputClass,
} from '@/components/ui/notebook';
import {
  bangkokDateTimeToUtc,
  createTutorAvailability,
  deleteTutorAvailability,
  getBangkokWeekRange,
  getBangkokWeekStart,
  getDurationHours,
  getDurationHoursMinutes,
  getTutorAvailability,
  shiftBangkokWeek,
} from '@/lib/api/availability';
import { ApiError } from '@/lib/api/error';
import { getMyProfile } from '@/lib/api/profiles';
import { useAuth } from '@/lib/auth-context';
import {
  formatBangkokDate,
  formatBangkokShortDate,
  formatBangkokTime,
  formatBangkokWeekday,
  formatBangkokWeekRange,
  formatUtcDateTime,
  getBangkokIsoDate,
  getBangkokToday,
} from '@/lib/date-time';
import { useLanguage } from '@/lib/i18n';
import { resolveDashboardGate } from '@/lib/profile-navigation';
import { withReturnTo } from '@/lib/return-to';

import type { TutorAvailabilitySlot } from '@/lib/api/types';

const availabilityInputClass = notebookInputClass({
  className: 'focus:border-tutor focus:ring-sticky-blue/70',
});

const availabilitySecondaryButtonClass = notebookButtonClass({
  tone: 'secondary',
  className: 'min-h-10 px-3 py-2 text-xs',
});

export default function TutorAvailabilityPage() {
  const { isLoading: authLoading, logout, user } = useAuth();
  const { language, copy } = useLanguage();
  const router = useRouter();
  const availabilityCopy = copy.dashboard.availability;
  const [weekStart, setWeekStart] = useState(() => getBangkokWeekStart());
  const [date, setDate] = useState(() => getBangkokToday());
  const [startTime, setStartTime] = useState('18:00');
  const [endTime, setEndTime] = useState('19:00');
  const [slots, setSlots] = useState<TutorAvailabilitySlot[]>([]);
  const [profileDisplayName, setProfileDisplayName] = useState<string | null>(null);
  const [profileReady, setProfileReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [busySlotId, setBusySlotId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
    if (authLoading) return;
    if (!user) {
      router.replace('/');
      return;
    }
    if (user.role !== 'TUTOR') {
      router.replace('/dashboard');
      return;
    }

    let active = true;
    getMyProfile()
      .then((result) => {
        if (!active) return;
        if (resolveDashboardGate(result)) {
          router.replace(withReturnTo('/onboarding/profile', '/dashboard/availability'));
          return;
        }
        const profile = result.profile && 'displayName' in result.profile ? result.profile : null;
        setProfileDisplayName(profile?.displayName.trim() || null);
        setProfileReady(true);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        if (caught instanceof ApiError && caught.status === 400) {
          router.replace(withReturnTo('/onboarding/profile', '/dashboard/availability'));
          return;
        }
        setLoadError(caught instanceof Error ? caught.message : availabilityCopy.loadError);
        setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [authLoading, availabilityCopy.loadError, router, user]);

  useEffect(() => {
    if (!user || user.role !== 'TUTOR' || !profileReady) return;
    let active = true;
    const range = getBangkokWeekRange(weekStart);
    getTutorAvailability(range)
      .then((result) => {
        if (!active) return;
        setSlots(result);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setLoadError(caught instanceof Error ? caught.message : '');
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [profileReady, refreshKey, user, weekStart]);

  const groupedSlots = useMemo(() => {
    const groups = new Map<string, TutorAvailabilitySlot[]>();
    slots.forEach((slot) => {
      const key = getBangkokIsoDate(slot.startAtUtc);
      groups.set(key, [...(groups.get(key) ?? []), slot]);
    });
    return [...groups.entries()].sort(([first], [second]) => first.localeCompare(second));
  }, [slots]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setMutationError(null);
    setSuccess(null);
    if (!date || !startTime || !endTime) {
      setFormError(availabilityCopy.emptyForm);
      return;
    }

    try {
      const startAt = bangkokDateTimeToUtc(date, startTime);
      const endAt = bangkokDateTimeToUtc(date, endTime);
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
      setSuccess(availabilityCopy.added);
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
        setFormError(caught instanceof Error ? caught.message : availabilityCopy.createError);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (slot: TutorAvailabilitySlot) => {
    if (slot.state !== 'OPEN') return;
    setBusySlotId(slot.id);
    setMutationError(null);
    setSuccess(null);
    try {
      await deleteTutorAvailability(slot.id);
      setSuccess(availabilityCopy.deleted);
      refreshAvailability();
    } catch (caught: unknown) {
      if (caught instanceof ApiError && caught.status === 409) {
        setMutationError(availabilityCopy.reservedError);
      } else {
        setMutationError(caught instanceof Error ? caught.message : availabilityCopy.deleteError);
      }
    } finally {
      setBusySlotId(null);
    }
  };

  const handleLogout = async () => {
    await logout();
    router.replace('/');
  };

  if (authLoading || !user) {
    return <FullPageState message={availabilityCopy.loading} />;
  }
  if (user.role !== 'TUTOR') return null;
  if (!profileReady) {
    return <FullPageState message={loadError ?? availabilityCopy.loading} />;
  }

  const shellUser = profileDisplayName ? { ...user, displayName: profileDisplayName } : user;
  const weekLabel = formatBangkokWeekRange(weekStart, language);
  const today = getBangkokToday();
  const thisWeek = getBangkokWeekStart();
  const previewStart = date && startTime ? safeBangkokDateTime(date, startTime) : null;
  const previewEnd = date && endTime ? safeBangkokDateTime(date, endTime) : null;
  const openSlotCount = slots.filter((slot) => slot.state === 'OPEN').length;
  const reservedSlotCount = slots.length - openSlotCount;
  const teachingHours = slots.reduce(
    (total, slot) => total + getDurationHours(slot.startAtUtc, slot.endAtUtc),
    0,
  );

  return (
    <DashboardShell
      user={shellUser}
      onLogout={handleLogout}
      headerNavRight={
        <Link href="/dashboard/listings" data-dashboard-action>
          {copy.dashboard.header.myListingsNav}
        </Link>
      }
    >
      <div className="min-w-0 pb-12">
        <header className="mb-6 mt-7">
          <p className="font-note text-xl font-semibold leading-none text-amber-700 sm:text-2xl">
            {availabilityCopy.eyebrow}
          </p>
          <h1 className="mt-2 flex flex-wrap items-center gap-3 text-3xl font-bold tracking-[-0.045em] text-notebook-ink sm:text-4xl">
            <span>{availabilityCopy.title}</span>
            <StatusBadge tone="tutor" className="tracking-wide">
              {availabilityCopy.timezone}
            </StatusBadge>
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-notebook-muted sm:text-base">
            {availabilityCopy.subtitle}
          </p>
        </header>

        <div
          className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
          aria-label={availabilityCopy.weekOf.replace('{date}', weekLabel)}
        >
          <SummaryCard
            label={availabilityCopy.openSlots}
            value={String(openSlotCount)}
            help={availabilityCopy.openSlotsHelp}
          />
          <SummaryCard
            label={availabilityCopy.reservedSlots}
            value={String(reservedSlotCount)}
            help={availabilityCopy.reservedSlotsHelp}
          />
          <SummaryCard
            label={availabilityCopy.teachingHours}
            value={formatHoursMinutes(
              teachingHours,
              availabilityCopy.hour,
              availabilityCopy.hours,
              availabilityCopy.minute,
              availabilityCopy.minutes,
            )}
            help={availabilityCopy.teachingHoursHelp}
            duration
          />
          <SummaryCard
            label={availabilityCopy.timezoneLabel}
            value="UTC+7"
            help="Asia/Bangkok"
            compact
          />
        </div>

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
                    setDate(today);
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

            {mutationError && <Feedback message={mutationError} tone="error" />}
            {success && <Feedback message={success} tone="success" />}
            {isLoading ? (
              <InlineState message={availabilityCopy.loading} />
            ) : loadError !== null ? (
              <InlineState
                message={loadError || availabilityCopy.loadError}
                actionLabel={availabilityCopy.retry}
                onAction={refreshAvailability}
                error
              />
            ) : groupedSlots.length === 0 ? (
              <EmptyState message={availabilityCopy.noSlots} />
            ) : (
              <div className="divide-y divide-dashed divide-paper-edge">
                {groupedSlots.map(([day, daySlots]) => (
                  <article
                    key={day}
                    className="grid gap-3 py-5 first:pt-5 last:pb-0 sm:grid-cols-[120px_minmax(0,1fr)] sm:gap-4"
                  >
                    <div>
                      <strong className="block text-sm font-extrabold text-notebook-ink">
                        {formatBangkokWeekday(daySlots.at(0)?.startAtUtc ?? day, language)}
                      </strong>
                      <span className="mt-1 block text-xs text-notebook-muted">
                        {formatBangkokShortDate(daySlots.at(0)?.startAtUtc ?? day, language)}
                      </span>
                    </div>
                    <div className="flex flex-col gap-2">
                      {daySlots.map((slot) => {
                        const reserved = slot.state === 'RESERVED';
                        const durationHours = getDurationHours(slot.startAtUtc, slot.endAtUtc);
                        const duration = (
                          durationHours === 1
                            ? availabilityCopy.duration
                            : availabilityCopy.durationPlural
                        ).replace('{hours}', formatDuration(durationHours));
                        return (
                          <GraphPaper
                            key={slot.id}
                            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 p-3 sm:grid-cols-[110px_minmax(0,1fr)_auto_auto] sm:gap-3"
                          >
                            <strong className="text-sm font-extrabold text-notebook-ink">
                              {formatBangkokTime(slot.startAtUtc, language)}–
                              {formatBangkokTime(slot.endAtUtc, language)}
                            </strong>
                            <span className="text-xs leading-5 text-notebook-muted max-sm:col-span-2">
                              {duration} ·{' '}
                              {reserved
                                ? availabilityCopy.reservedDetail
                                : availabilityCopy.openDetail}
                            </span>
                            <StatusBadge
                              tone={reserved ? 'warning' : 'tutor'}
                              className="justify-self-start"
                            >
                              {reserved ? availabilityCopy.reserved : availabilityCopy.open}
                            </StatusBadge>
                            <button
                              type="button"
                              className={notebookButtonClass({
                                tone: 'secondary',
                                className: reserved
                                  ? 'min-h-9 px-3 py-1.5 text-xs'
                                  : 'min-h-9 border-red-200 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50',
                              })}
                              disabled={reserved || busySlotId === slot.id}
                              onClick={() => void handleDelete(slot)}
                            >
                              {reserved ? availabilityCopy.reservedAction : availabilityCopy.delete}
                            </button>
                          </GraphPaper>
                        );
                      })}
                    </div>
                  </article>
                ))}
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
                  <LocalizedDatePicker
                    label={availabilityCopy.date}
                    value={date}
                    onChange={setDate}
                    min={today}
                    language={language}
                    calendarLabel={availabilityCopy.calendarLabel}
                    previousMonthLabel={availabilityCopy.previousMonth}
                    nextMonthLabel={availabilityCopy.nextMonth}
                  />
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                    <Field
                      label={availabilityCopy.startTime}
                      type="time"
                      value={startTime}
                      onChange={setStartTime}
                    />
                    <Field
                      label={availabilityCopy.endTime}
                      type="time"
                      value={endTime}
                      onChange={setEndTime}
                    />
                  </div>
                  <GraphPaper className="p-4">
                    <p className="text-[0.68rem] font-extrabold uppercase tracking-[0.12em] text-tutor-deep">
                      {availabilityCopy.preview}
                    </p>
                    <p className="mt-1.5 text-sm font-bold leading-6 text-notebook-ink">
                      {previewStart && previewEnd
                        ? `${formatBangkokDate(previewStart, language)} · ${formatBangkokTime(previewStart, language)}–${formatBangkokTime(previewEnd, language)} · ${formatDurationLabel(getDurationHours(previewStart.toISOString(), previewEnd.toISOString()), availabilityCopy.duration, availabilityCopy.durationPlural)}`
                        : availabilityCopy.emptyForm}
                    </p>
                    {previewStart && previewEnd && (
                      <p className="mt-1 text-xs leading-5 text-notebook-muted">
                        {availabilityCopy.storedAs
                          .replace('{start}', formatUtcDateTime(previewStart, language))
                          .replace('{end}', formatUtcDateTime(previewEnd, language))}
                      </p>
                    )}
                  </GraphPaper>
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
                    <button
                      type="reset"
                      className={notebookButtonClass({
                        tone: 'secondary',
                        className: 'flex-1',
                      })}
                      onClick={() => {
                        setDate(today);
                        setStartTime('18:00');
                        setEndTime('19:00');
                        setFormError(null);
                      }}
                    >
                      {availabilityCopy.reset}
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
    </DashboardShell>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
}: {
  label: string;
  type: 'time';
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-bold text-notebook-ink">
      <span>{label}</span>
      <input
        className={availabilityInputClass}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
      />
    </label>
  );
}

function Feedback({ message, tone }: { message: string; tone: 'error' | 'success' }) {
  return (
    <p
      className={`mt-4 rounded-lg border px-4 py-3 text-xs font-semibold ${
        tone === 'error'
          ? 'border-red-200 bg-red-50 text-red-700'
          : 'border-emerald-200 bg-emerald-50 text-emerald-800'
      }`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      {message}
    </p>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <GraphPaper className="mt-5 flex min-h-40 items-center justify-center border-dashed p-8 text-center text-sm text-notebook-muted">
      {message}
    </GraphPaper>
  );
}

function FullPageState({ message }: { message: string }) {
  return (
    <NotebookPage className="flex items-center justify-center p-6">
      <StickyNote tone="blue" className="min-w-64 px-8 py-7 text-center">
        <WashiTape tone="blue" className="-top-2 left-1/2 -translate-x-1/2" />
        <span className="mx-auto block h-7 w-7 animate-spin rounded-full border-2 border-tutor-deep border-t-transparent motion-reduce:animate-[spin_1.8s_linear_infinite]" />
        <p className="mt-4 font-note text-xl font-semibold text-notebook-ink" role="status">
          {message}
        </p>
      </StickyNote>
    </NotebookPage>
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

function SummaryCard({
  label,
  value,
  help,
  compact = false,
  duration = false,
}: {
  label: string;
  value: string;
  help: string;
  compact?: boolean;
  duration?: boolean;
}) {
  return (
    <PaperCard className="group relative min-h-36 overflow-hidden p-4 transition hover:-translate-y-0.5 hover:shadow-paper sm:p-5">
      <WashiTape tone="blue" className="-right-5 -top-1 rotate-12 opacity-70" />
      <p className="relative z-10 flex items-center gap-2 text-xs font-bold text-notebook-muted before:h-2 before:w-2 before:rounded-full before:bg-tutor">
        {label}
      </p>
      <p
        className={`relative z-10 mt-3 font-black tracking-[-0.045em] text-notebook-ink ${
          compact ? 'text-xl' : duration ? 'text-xl leading-tight' : 'text-3xl'
        }`}
      >
        {value}
      </p>
      <p className="relative z-10 mt-1 text-xs leading-5 text-notebook-muted">{help}</p>
      <span className="absolute -bottom-9 -right-8 h-24 w-24 rounded-full bg-sticky-blue/45 transition group-hover:scale-110" />
    </PaperCard>
  );
}

function formatDuration(hours: number): string {
  return Number.isInteger(hours)
    ? String(hours)
    : hours.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function formatHoursMinutes(
  totalHours: number,
  singularHour: string,
  pluralHour: string,
  singularMinute: string,
  pluralMinute: string,
): string {
  const { hours, minutes } = getDurationHoursMinutes(totalHours);
  const hourLabel = (hours === 1 ? singularHour : pluralHour).replace('{count}', String(hours));
  const minuteLabel = (minutes === 1 ? singularMinute : pluralMinute).replace(
    '{count}',
    String(minutes),
  );
  return `${hourLabel} ${minuteLabel}`;
}

function formatDurationLabel(hours: number, singular: string, plural: string): string {
  return (hours === 1 ? singular : plural).replace('{hours}', formatDuration(hours));
}

function safeBangkokDateTime(date: string, time: string): Date | null {
  try {
    return bangkokDateTimeToUtc(date, time);
  } catch {
    return null;
  }
}
