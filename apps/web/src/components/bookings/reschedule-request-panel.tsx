'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { formatBookingDocketSlot } from '@/components/bookings/booking-docket-model';
import { rescheduleCopy } from '@/components/bookings/reschedule-copy';
import {
  filterTargetSlots,
  getRescheduleActions,
  getRescheduleFailure,
} from '@/components/bookings/reschedule-model';
import { TargetSlotPicker } from '@/components/bookings/target-slot-picker';
import { NotebookAction } from '@/components/ui/notebook-action';
import { NotebookLoadingRegion } from '@/components/ui/notebook-loading';
import { useNotebookToast } from '@/components/ui/notebook-toast';
import { getTutorAvailability } from '@/lib/api/availability';
import {
  approveRescheduleRequest,
  createRescheduleRequest,
  getCurrentRescheduleRequest,
  rejectRescheduleRequest,
  withdrawRescheduleRequest,
} from '@/lib/api/reschedule-requests';
import { getPublicTutorAvailability } from '@/lib/api/tutors';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/lib/i18n';

import type { RescheduleBooking } from '@/components/bookings/reschedule-model';
import type {
  ApproveRescheduleResponse,
  CurrentRescheduleRequestResponse,
  RescheduleAction,
  RescheduleRequestStatus,
  RescheduleTargetSlot,
} from '@/lib/api/types';
import type { FormEvent } from 'react';

async function loadRescheduleState(
  bookingId: string,
  tutorId: string,
  isTutor: boolean,
): Promise<{ current: CurrentRescheduleRequestResponse; slots: RescheduleTargetSlot[] }> {
  const current = await getCurrentRescheduleRequest(bookingId);
  if (!current.allowedActions.includes('CREATE')) {
    return { current, slots: [] };
  }
  const from = new Date().toISOString();
  const candidates = isTutor
    ? (await getTutorAvailability({ from })).filter((slot) => slot.state === 'OPEN')
    : await getPublicTutorAvailability(tutorId, { from });
  // Both endpoints scope their results to this tutor; public slots omit the tutor ID.
  return { current, slots: candidates.map((slot) => ({ ...slot, tutorProfileId: tutorId })) };
}

export function RescheduleRequestPanel({
  booking,
  tutorId,
  disabled = false,
  onApproved,
  onRefresh,
  onBusyChange,
  onRequiresRefresh,
  outcome,
  onOutcome,
}: {
  booking: RescheduleBooking;
  tutorId: string;
  disabled?: boolean;
  onApproved: (result: ApproveRescheduleResponse) => void;
  onRefresh: () => void;
  onBusyChange: (busy: boolean) => void;
  onRequiresRefresh: () => void;
  outcome: RescheduleRequestStatus | null;
  onOutcome: (status: RescheduleRequestStatus | null) => void;
}) {
  const { user } = useAuth();
  const { language } = useLanguage();
  const copy = rescheduleCopy[language];
  const toast = useNotebookToast();
  const id = useId();
  const gate = useRef(false);
  const alive = useRef(false);
  const readRevision = useRef(0);
  const [current, setCurrent] = useState<CurrentRescheduleRequestResponse | null>(null);
  const [slots, setSlots] = useState<RescheduleTargetSlot[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<ReturnType<typeof getRescheduleFailure> | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    alive.current = true;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive.current = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const revision = readRevision.current;
    if (gate.current) {
      return;
    }
    const isCurrent = () => active && revision === readRevision.current;
    async function load(): Promise<void> {
      try {
        const result = await loadRescheduleState(booking.id, tutorId, user?.role === 'TUTOR');
        if (!isCurrent()) {
          return;
        }
        setCurrent(result.current);
        setSlots(result.slots);
      } catch (error: unknown) {
        if (isCurrent()) {
          setFailure(getRescheduleFailure(error, rescheduleCopy[language]));
        }
      } finally {
        if (isCurrent()) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      active = false;
    };
    // The parent remounts this panel after a full booking refresh or slot/status change.
  }, [booking.id, tutorId, user?.role, language]);

  const actions = current && user ? getRescheduleActions(current, user.id, booking, now) : [];
  const candidates = filterTargetSlots(slots, tutorId, booking, now);
  const locked = disabled || loading || pending || failure?.requiresRefresh === true;
  const request = current?.request;
  const isPending = request?.status === 'PENDING';
  const actionRole = user?.role === 'STUDENT' ? 'student' : 'tutor';

  async function submit(action: RescheduleAction): Promise<void> {
    if (gate.current || locked || !current || !user) {
      return;
    }
    if (!getRescheduleActions(current, user.id, booking, Date.now()).includes(action)) {
      setFailure({ message: copy.conflict, requiresRefresh: true });
      return;
    }
    if (
      action === 'CREATE' &&
      (!filterTargetSlots(slots, tutorId, booking, Date.now()).some(
        (slot) => slot.id === selectedId,
      ) ||
        reason.trim().length > 500)
    ) {
      setFailure({ message: copy.invalid, requiresRefresh: false });
      return;
    }
    gate.current = true;
    readRevision.current += 1;
    setPending(true);
    onBusyChange(true);
    onOutcome(null);
    setFailure(null);
    try {
      let approval: ApproveRescheduleResponse | null = null;
      if (action === 'CREATE') {
        const result = await createRescheduleRequest(booking.id, {
          targetSlotId: selectedId,
          reason,
        });
        if (result.status !== 'PENDING' || result.bookingId !== booking.id) {
          throw new Error('Unexpected reschedule creation response');
        }
      } else if (request) {
        const result =
          action === 'APPROVE'
            ? await approveRescheduleRequest(request.id)
            : action === 'REJECT'
              ? await rejectRescheduleRequest(request.id)
              : await withdrawRescheduleRequest(request.id);
        const expectedStatus = { APPROVE: 'APPROVED', REJECT: 'REJECTED', WITHDRAW: 'WITHDRAWN' };
        if (result.requestId !== request.id || result.status !== expectedStatus[action]) {
          throw new Error('Unexpected reschedule decision response');
        }
        if ('booking' in result) {
          if (result.booking.id !== booking.id || result.booking.slotId !== result.newSlot.id) {
            throw new Error('Unexpected approved booking');
          }
          approval = result;
        }
        if (alive.current) {
          onOutcome(result.status);
          setCurrent(null);
          setSlots([]);
        }
      }
      if (approval) {
        if (alive.current) {
          onApproved(approval);
          toast.success(copy.success);
        }
        return;
      }
      // The existing API returns only pending requests; decision outcomes come from the POST.
      // A failed state read locks actions until a full booking refresh.
      const latest = await loadRescheduleState(booking.id, tutorId, user.role === 'TUTOR');
      if (!alive.current) {
        return;
      }
      setCurrent(latest.current);
      setReason('');
      setSelectedId('');
      setSlots(latest.slots);
      // A disappearing request immediately after create may mean a competing decision won.
      if (action === 'CREATE' && !latest.current.request) {
        onRefresh();
      }
      toast.success(copy.success);
    } catch (error: unknown) {
      if (alive.current) {
        const nextFailure = getRescheduleFailure(error, copy);
        setFailure(nextFailure);
        if (nextFailure.requiresRefresh) {
          onRequiresRefresh();
        }
      }
    } finally {
      gate.current = false;
      onBusyChange(false);
      if (alive.current) {
        setPending(false);
      }
    }
  }

  function create(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void submit('CREATE');
  }

  return (
    <section
      aria-label={copy.title}
      aria-busy={loading || pending}
      className="min-w-0 space-y-3 border-t border-dashed border-paper-edge p-4"
    >
      <h3 className="font-semibold">{copy.title}</h3>
      <p className="text-sm text-notebook-muted">{copy.policy}</p>
      {loading ? (
        <NotebookLoadingRegion label={copy.loading} />
      ) : (
        <>
          <p role="status" className="text-sm font-semibold">
            {request
              ? copy[request.status]
              : outcome
                ? copy[outcome]
                : current
                  ? copy.noRequest
                  : null}
          </p>
          <p className="text-sm">
            {copy.original}: {formatBookingDocketSlot(booking.slot, language).label}
          </p>
          {request && (
            <div className="space-y-2 text-sm [overflow-wrap:anywhere]">
              {current?.targetSlot && (
                <p>
                  {copy.target}: {formatBookingDocketSlot(current.targetSlot, language).label}
                </p>
              )}
              <p>{request.reason}</p>
              {isPending && (
                <p>{request.requestedById === user?.id ? copy.requester : copy.reviewer}</p>
              )}
            </div>
          )}
          {current && !isPending && !actions.includes('CREATE') && (
            <p className="text-sm text-notebook-muted">
              {booking.status === 'CONFIRMED' ? copy.cutoff : copy.ineligible}
            </p>
          )}
          {isPending && request.requestedById !== user?.id && !actions.includes('APPROVE') && (
            <p className="text-sm text-notebook-muted">{copy.approvalUnavailable}</p>
          )}
          {actions.includes('CREATE') && (
            <form onSubmit={create} className="space-y-3">
              <TargetSlotPicker
                slots={candidates}
                selectedId={selectedId}
                onSelect={setSelectedId}
                disabled={locked}
                language={language}
                copy={copy}
              />
              <label htmlFor={`${id}-reason`} className="block text-sm">
                {copy.reason}
              </label>
              <textarea
                id={`${id}-reason`}
                maxLength={500}
                rows={2}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                disabled={locked}
                aria-describedby={`${id}-reason-hint`}
                className="w-full rounded border border-paper-edge p-2 text-sm"
              />
              <p id={`${id}-reason-hint`} className="text-sm text-notebook-muted">
                {copy.reasonLimit}
              </p>
              <NotebookAction
                role={actionRole}
                type="submit"
                size="compact"
                disabled={locked || !candidates.some((slot) => slot.id === selectedId)}
              >
                {pending ? copy.working : copy.CREATE}
              </NotebookAction>
            </form>
          )}
          <div className="flex flex-wrap gap-2">
            {actions
              .filter((action) => action !== 'CREATE')
              .map((action) => (
                <NotebookAction
                  role={actionRole}
                  key={action}
                  size="compact"
                  tone={action === 'APPROVE' ? 'primary' : 'secondary'}
                  disabled={locked}
                  onClick={() => void submit(action)}
                >
                  {pending ? copy.working : copy[action]}
                </NotebookAction>
              ))}
          </div>
        </>
      )}
      {failure && (
        <p role="alert" className="text-sm text-red-800">
          {failure.message}
        </p>
      )}
      <NotebookAction
        role={actionRole}
        size="compact"
        tone="secondary"
        disabled={pending || disabled}
        onClick={onRefresh}
      >
        {copy.refresh}
      </NotebookAction>
    </section>
  );
}
