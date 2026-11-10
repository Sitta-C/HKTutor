'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';

import { writeTutorSearchSession } from '@/components/tutors/tutor-search-session';

import type { TutorSearchSession } from '@/components/tutors/tutor-search-session';

/** Restore after fresh results/catalogs provide layout height; never cache public API results. */
export function useTutorSearchSession(
  session: Omit<TutorSearchSession, 'version' | 'scrollY'>,
  initialScrollY: number,
  ready: boolean,
): void {
  const latest = useRef(session);
  const scrollY = useRef(initialScrollY);
  const restoring = useRef(initialScrollY > 0);
  const leaving = useRef(false);

  useEffect(() => {
    latest.current = session;
    writeTutorSearchSession({ ...session, version: 1, scrollY: scrollY.current });
  }, [session]);

  useEffect(() => {
    const previousRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const save = (): void => {
      clearTimeout(timeout);
      writeTutorSearchSession({ ...latest.current, version: 1, scrollY: scrollY.current });
    };
    const onScroll = (): void => {
      if (restoring.current || leaving.current) {
        return;
      }
      scrollY.current = window.scrollY;
      clearTimeout(timeout);
      timeout = setTimeout(save, 150);
    };
    const onNavigate = (event: MouseEvent): void => {
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (
        !(link instanceof HTMLAnchorElement) ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        (link.target !== '' && link.target !== '_self') ||
        link.hasAttribute('download')
      ) {
        return;
      }
      const destination = new URL(link.href);
      if (destination.pathname === location.pathname && destination.search === location.search) {
        return;
      }
      // Capture before Next resets the viewport for the destination page.
      if (!restoring.current) {
        scrollY.current = window.scrollY;
      }
      leaving.current = true;
      save();
    };
    const onInteract = (): void => {
      if (restoring.current) {
        restoring.current = false;
        scrollY.current = window.scrollY;
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key) &&
        !(
          event.target instanceof Element &&
          event.target.closest('input, select, textarea, button, [contenteditable="true"]')
        )
      ) {
        onInteract();
      }
    };
    const onPageShow = (event: PageTransitionEvent): void => {
      if (event.persisted) {
        leaving.current = false;
        restoring.current = false;
        scrollY.current = window.scrollY;
      }
    };
    document.addEventListener('click', onNavigate, true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pagehide', save);
    window.addEventListener('wheel', onInteract, { passive: true });
    window.addEventListener('touchstart', onInteract, { passive: true });
    window.addEventListener('pointerdown', onInteract, { passive: true });
    return () => {
      save();
      window.history.scrollRestoration = previousRestoration;
      document.removeEventListener('click', onNavigate, true);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pagehide', save);
      window.removeEventListener('wheel', onInteract);
      window.removeEventListener('touchstart', onInteract);
      window.removeEventListener('pointerdown', onInteract);
    };
  }, []);

  useLayoutEffect(() => {
    if (!ready || !restoring.current || leaving.current) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      if (!restoring.current || leaving.current) {
        return;
      }
      restoring.current = false;
      window.scrollTo({ top: scrollY.current, behavior: 'instant' });
      scrollY.current = window.scrollY;
    });
    return () => cancelAnimationFrame(frame);
  }, [ready]);
}
