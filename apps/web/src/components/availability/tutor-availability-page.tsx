'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { DashboardIcon } from '@/components/dashboard/dashboard-icon';
import DashboardShell from '@/components/dashboard/dashboard-shell';
import {
  bangkokDateTimeToUtc,
  createTutorAvailability,
  deleteTutorAvailability,
  formatBangkokDate,
  formatBangkokTime,
  getBangkokWeekRange,
  getBangkokWeekStart,
  getDurationHours,
  getTutorAvailability,
  shiftBangkokWeek,
} from '@/lib/api/availability';
import { ApiError } from '@/lib/api/error';
import { getMyProfile } from '@/lib/api/profiles';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/lib/i18n';

import type { TutorAvailabilitySlot } from '@/lib/api/types';

export default function TutorAvailabilityPage() {
  const { isLoading: authLoading, logout, user } = useAuth();
  const { language, copy } = useLanguage();
  const router = useRouter();
  const availabilityCopy = copy.dashboard.availability;
  const [weekStart, setWeekStart] = useState(() => getBangkokWeekStart());
  const [date, setDate] = useState(() => getBangkokWeekStart());
  const [startTime, setStartTime] = useState('18:00');
  const [endTime, setEndTime] = useState('19:00');
  const [slots, setSlots] = useState<TutorAvailabilitySlot[]>([]);
  const [profileDisplayName, setProfileDisplayName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [busySlotId, setBusySlotId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadAvailability = async () => {
    const range = getBangkokWeekRange(weekStart);
    setIsLoading(true);
    setError(null);
    try {
      setSlots(await getTutorAvailability(range));
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : availabilityCopy.loadError);
    } finally {
      setIsLoading(false);
    }
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
        setError(caught instanceof Error ? caught.message : availabilityCopy.loadError);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [availabilityCopy.loadError, user, weekStart]);

  const groupedSlots = useMemo(() => {
    const groups = new Map<string, TutorAvailabilitySlot[]>();
    slots.forEach((slot) => {
      const key = new Intl.DateTimeFormat('en-CA', {
        day: '2-digit',
        month: '2-digit',
        timeZone: 'Asia/Bangkok',
        year: 'numeric',
      }).format(new Date(slot.startAtUtc));
      groups.set(key, [...(groups.get(key) ?? []), slot]);
    });
    return [...groups.entries()].sort(([first], [second]) => first.localeCompare(second));
  }, [slots]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setError(null);
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
      setWeekStart(getBangkokWeekStart(startAt));
      setDate(date);
      await loadAvailability();
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
    setError(null);
    setSuccess(null);
    try {
      await deleteTutorAvailability(slot.id);
      setSuccess(availabilityCopy.deleted);
      await loadAvailability();
    } catch (caught: unknown) {
      if (caught instanceof ApiError && caught.status === 409) {
        setError(availabilityCopy.reservedError);
      } else {
        setError(caught instanceof Error ? caught.message : availabilityCopy.deleteError);
      }
    } finally {
      setBusySlotId(null);
    }
  };

  const handleLogout = async () => {
    await logout();
    router.replace('/');
  };

  if (authLoading || (isLoading && !profileDisplayName) || !user) {
    return <PageState message={availabilityCopy.loading} />;
  }
  if (user.role !== 'TUTOR') return null;
  if (!profileDisplayName) return <PageState message={availabilityCopy.loadError} />;

  const shellUser = { ...user, displayName: profileDisplayName };
  const weekLabel = formatBangkokDate(bangkokDateTimeToUtc(weekStart, '00:00'), language);
  const today = getBangkokWeekStart();
  const previewStart = date && startTime ? safeBangkokDateTime(date, startTime) : null;
  const previewEnd = date && endTime ? safeBangkokDateTime(date, endTime) : null;

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

        <div className="mt-6 grid gap-5 xl:grid-cols-[1.4fr_minmax(300px,.8fr)]">
          <section className="dash-card p-6 sm:p-7" aria-labelledby="availability-week-title">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="availability-week-title" className="text-xl font-extrabold">
                  {availabilityCopy.weekOf.replace('{date}', weekLabel)}
                </h2>
                <p className="mt-1 text-sm text-[#5e5a52]">{availabilityCopy.timezone}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="dash-btn-dark"
                  aria-label={availabilityCopy.previousWeek}
                  onClick={() => setWeekStart(shiftBangkokWeek(weekStart, -1))}
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="dash-btn-dark"
                  onClick={() => {
                    setWeekStart(today);
                    setDate(today);
                  }}
                >
                  {availabilityCopy.today}
                </button>
                <button
                  type="button"
                  className="dash-btn-dark"
                  aria-label={availabilityCopy.nextWeek}
                  onClick={() => setWeekStart(shiftBangkokWeek(weekStart, 1))}
                >
                  ›
                </button>
              </div>
            </div>

            {error && <Feedback message={error} tone="error" />}
            {success && <Feedback message={success} tone="success" />}
            {isLoading ? (
              <PageState message={availabilityCopy.loading} />
            ) : groupedSlots.length === 0 ? (
              <EmptyState message={availabilityCopy.noSlots} />
            ) : (
              <div className="space-y-5">
                {groupedSlots.map(([day, daySlots]) => (
                  <div key={day} className="border-t border-[#ebe6dd] pt-4">
                    <h3 className="font-extrabold">
                      {formatBangkokDate(daySlots.at(0)?.startAtUtc ?? day, language)}
                    </h3>
                    <div className="mt-3 space-y-2">
                      {daySlots.map((slot) => {
                        const reserved = slot.state === 'RESERVED';
                        return (
                          <div
                            key={slot.id}
                            className="flex flex-wrap items-center gap-3 rounded-xl border border-[#ebe6dd] bg-[#faf8f4] p-4"
                          >
                            <strong className="min-w-[7.5rem] text-lg">
                              {formatBangkokTime(slot.startAtUtc)}–
                              {formatBangkokTime(slot.endAtUtc)}
                            </strong>
                            <span className="text-sm text-[#5e5a52]">
                              {availabilityCopy.duration.replace(
                                '{hours}',
                                formatDuration(getDurationHours(slot.startAtUtc, slot.endAtUtc)),
                              )}
                            </span>
                            <span className={`dash-pill ${reserved ? 'pending' : 'done'}`}>
                              {reserved ? availabilityCopy.reserved : availabilityCopy.open}
                            </span>
                            <button
                              type="button"
                              className="ml-auto dash-link !mt-0 disabled:cursor-not-allowed disabled:opacity-50"
                              disabled={reserved || busySlotId === slot.id}
                              onClick={() => void handleDelete(slot)}
                            >
                              {reserved ? availabilityCopy.reservedAction : availabilityCopy.delete}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <aside>
            <form
              className="dash-card p-6 sm:p-7"
              onSubmit={(event) => void handleSubmit(event)}
              noValidate
            >
              <h2 className="text-xl font-extrabold">{availabilityCopy.addTitle}</h2>
              <p className="mt-1 text-sm text-[#5e5a52]">{availabilityCopy.addDescription}</p>
              <div className="mt-5 space-y-4">
                <Field
                  label={availabilityCopy.date}
                  type="date"
                  value={date}
                  onChange={setDate}
                  min={today}
                />
                <div className="grid gap-4 sm:grid-cols-2">
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
                <div className="rounded-xl bg-[#f4f7fb] p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-[#5e5a52]">
                    {availabilityCopy.preview}
                  </p>
                  <p className="mt-2 font-extrabold">
                    {previewStart && previewEnd
                      ? `${formatBangkokDate(previewStart, language)} · ${formatBangkokTime(previewStart)}–${formatBangkokTime(previewEnd)}`
                      : availabilityCopy.emptyForm}
                  </p>
                  {previewStart && previewEnd && (
                    <p className="mt-1 text-xs text-[#5e5a52]">
                      {availabilityCopy.storedAs
                        .replace('{start}', previewStart.toISOString().slice(11, 16))
                        .replace('{end}', previewEnd.toISOString().slice(11, 16))}
                    </p>
                  )}
                </div>
                {formError && (
                  <p className="text-sm font-semibold text-[#c04f40]" role="alert">
                    {formError}
                  </p>
                )}
                <div className="flex flex-wrap gap-3">
                  <button type="submit" className="dash-btn-dark" disabled={isSaving}>
                    <DashboardIcon name="plus" className="h-4 w-4" />
                    {isSaving ? availabilityCopy.adding : availabilityCopy.add}
                  </button>
                  <button
                    type="reset"
                    className="dash-link !mt-0"
                    onClick={() => {
                      setDate(weekStart);
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
            <div className="mt-5 rounded-xl border border-[#f1ddc4] bg-[#fffaf4] p-4 text-sm text-[#7e5428]">
              {availabilityCopy.reservedHelp}
            </div>
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
  min,
}: {
  label: string;
  type: 'date' | 'time';
  value: string;
  onChange: (value: string) => void;
  min?: string;
}) {
  return (
    <label className="block text-sm font-bold text-[#1a1916]">
      <span className="mb-2 block">{label}</span>
      <input
        className="w-full rounded-xl border border-[#d9d2c6] bg-white px-3 py-3 text-base"
        type={type}
        value={value}
        min={min}
        onChange={(event) => onChange(event.target.value)}
        required
      />
    </label>
  );
}

function Feedback({ message, tone }: { message: string; tone: 'error' | 'success' }) {
  return (
    <p
      className={`mb-4 rounded-xl p-3 text-sm font-semibold ${tone === 'error' ? 'bg-[#fff1ef] text-[#c04f40]' : 'bg-[#effaf5] text-[#0e8a73]'}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      {message}
    </p>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[#d9d2c6] p-8 text-center text-sm text-[#5e5a52]">
      {message}
    </div>
  );
}

function PageState({ message }: { message: string }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#fbfaf7] p-6 text-sm font-semibold text-[#5e5a52]">
      <span role="status">{message}</span>
    </main>
  );
}

function formatDuration(hours: number): string {
  return Number.isInteger(hours)
    ? String(hours)
    : hours.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function safeBangkokDateTime(date: string, time: string): Date | null {
  try {
    return bangkokDateTimeToUtc(date, time);
  } catch {
    return null;
  }
}
