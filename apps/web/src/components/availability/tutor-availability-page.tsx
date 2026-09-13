'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { DashboardIcon } from '@/components/dashboard/dashboard-icon';
import DashboardShell from '@/components/dashboard/dashboard-shell';
import { LocalizedDatePicker } from '@/components/date-time/localized-date-picker';
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

import type { TutorAvailabilitySlot } from '@/lib/api/types';

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
        const profile = result.profile && 'displayName' in result.profile ? result.profile : null;
        setProfileDisplayName(profile?.displayName.trim() || null);
      })
      .catch(() => {
        if (active) setProfileDisplayName(null);
      });

    return () => {
      active = false;
    };
  }, [authLoading, router, user]);

  useEffect(() => {
    if (!user || user.role !== 'TUTOR') return;
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
  }, [refreshKey, user, weekStart]);

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
      headerNavRight={<Link href="/dashboard/listings">{copy.dashboard.header.myListingsNav}</Link>}
    >
      <div className="min-w-0 pb-12">
        <header className="dash-greeting">
          <p className="dash-eyebrow">{availabilityCopy.eyebrow}</p>
          <h1>
            <span>{availabilityCopy.title}</span>
            <span className="dash-role-chip dash-role-chip-tutor">{availabilityCopy.timezone}</span>
          </h1>
          <p>{availabilityCopy.subtitle}</p>
        </header>

        <div
          className="availability-summary"
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

        <div className="availability-layout">
          <section
            className="dash-card availability-panel"
            aria-labelledby="availability-week-title"
          >
            <div className="availability-section-head">
              <div>
                <h2 id="availability-week-title">
                  {availabilityCopy.weekOf.replace('{date}', weekLabel)}
                </h2>
                <p>{availabilityCopy.weekDescription}</p>
              </div>
              <div className="availability-week-actions">
                <button
                  type="button"
                  className="availability-secondary-button availability-arrow-button"
                  aria-label={availabilityCopy.previousWeek}
                  onClick={() => changeWeek(shiftBangkokWeek(weekStart, -1))}
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="availability-secondary-button"
                  onClick={() => {
                    changeWeek(thisWeek);
                    setDate(today);
                  }}
                >
                  {availabilityCopy.thisWeek}
                </button>
                <button
                  type="button"
                  className="availability-secondary-button availability-arrow-button"
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
              <div>
                {groupedSlots.map(([day, daySlots]) => (
                  <article key={day} className="availability-day">
                    <div className="availability-day-label">
                      <strong>
                        {formatBangkokWeekday(daySlots.at(0)?.startAtUtc ?? day, language)}
                      </strong>
                      <span>
                        {formatBangkokShortDate(daySlots.at(0)?.startAtUtc ?? day, language)}
                      </span>
                    </div>
                    <div className="availability-slot-list">
                      {daySlots.map((slot) => {
                        const reserved = slot.state === 'RESERVED';
                        const durationHours = getDurationHours(slot.startAtUtc, slot.endAtUtc);
                        const duration = (
                          durationHours === 1
                            ? availabilityCopy.duration
                            : availabilityCopy.durationPlural
                        ).replace('{hours}', formatDuration(durationHours));
                        return (
                          <div key={slot.id} className="availability-slot">
                            <strong className="availability-slot-time">
                              {formatBangkokTime(slot.startAtUtc, language)}–
                              {formatBangkokTime(slot.endAtUtc, language)}
                            </strong>
                            <span className="availability-slot-copy">
                              {duration} ·{' '}
                              {reserved
                                ? availabilityCopy.reservedDetail
                                : availabilityCopy.openDetail}
                            </span>
                            <span
                              className={`dash-pill ${reserved ? 'pending' : 'dash-pill-tutor confirmed'}`}
                            >
                              {reserved ? availabilityCopy.reserved : availabilityCopy.open}
                            </span>
                            <button
                              type="button"
                              className={
                                reserved
                                  ? 'availability-secondary-button'
                                  : 'availability-delete-button'
                              }
                              disabled={reserved || busySlotId === slot.id}
                              onClick={() => void handleDelete(slot)}
                            >
                              {reserved ? availabilityCopy.reservedAction : availabilityCopy.delete}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <aside className="availability-stack">
            <form
              className="dash-card availability-panel"
              onSubmit={(event) => void handleSubmit(event)}
              noValidate
            >
              <div className="availability-section-head">
                <div>
                  <h2>{availabilityCopy.addTitle}</h2>
                  <p>{availabilityCopy.addDescription}</p>
                </div>
              </div>
              <div className="availability-form-body">
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
                <div className="availability-time-grid">
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
                <div className="availability-preview">
                  <p className="availability-preview-label">{availabilityCopy.preview}</p>
                  <p className="availability-preview-value">
                    {previewStart && previewEnd
                      ? `${formatBangkokDate(previewStart, language)} · ${formatBangkokTime(previewStart, language)}–${formatBangkokTime(previewEnd, language)} · ${formatDurationLabel(getDurationHours(previewStart.toISOString(), previewEnd.toISOString()), availabilityCopy.duration, availabilityCopy.durationPlural)}`
                      : availabilityCopy.emptyForm}
                  </p>
                  {previewStart && previewEnd && (
                    <p className="availability-preview-help">
                      {availabilityCopy.storedAs
                        .replace('{start}', formatUtcDateTime(previewStart, language))
                        .replace('{end}', formatUtcDateTime(previewEnd, language))}
                    </p>
                  )}
                </div>
                {formError && (
                  <p className="availability-form-error" role="alert">
                    {formError}
                  </p>
                )}
                <div className="availability-form-actions">
                  <button type="submit" className="dash-btn-dark" disabled={isSaving}>
                    <DashboardIcon name="plus" className="h-4 w-4" />
                    {isSaving ? availabilityCopy.adding : availabilityCopy.add}
                  </button>
                  <button
                    type="reset"
                    className="availability-secondary-button"
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
            <section className="availability-notice">
              <strong>{availabilityCopy.reservedHelpTitle}</strong>
              <p>{availabilityCopy.reservedHelp}</p>
            </section>
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
    <label className="availability-field">
      <span>{label}</span>
      <input
        className="availability-input"
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
    <p className={`availability-feedback ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {message}
    </p>
  );
}

function EmptyState({ message }: { message: string }) {
  return <div className="availability-empty">{message}</div>;
}

function FullPageState({ message }: { message: string }) {
  return (
    <div className="availability-page-state">
      <span role="status">{message}</span>
    </div>
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
    <div className={`availability-inline-state ${error ? 'error' : ''}`}>
      <span role={error ? 'alert' : 'status'}>{message}</span>
      {actionLabel && onAction && (
        <button type="button" className="availability-secondary-button" onClick={onAction}>
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
    <section className="dash-card availability-stat">
      <p className="availability-stat-label">{label}</p>
      <p
        className={`availability-stat-value ${compact ? 'compact' : ''} ${duration ? 'duration' : ''}`}
      >
        {value}
      </p>
      <p className="availability-stat-help">{help}</p>
    </section>
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
