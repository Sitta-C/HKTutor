import { expect, test } from '@playwright/test';

import type {
  QualificationDocumentType,
  QualificationStatus,
  QualificationTutor,
} from '@/lib/api/types';
import type { Page, Route } from '@playwright/test';

const tutor = {
  id: 'tutor-ui',
  email: 'tutor@example.test',
  role: 'TUTOR',
  displayName: 'Tutor One',
};
const admin = { id: 'admin-ui', email: 'admin@example.test', role: 'ADMIN', displayName: 'Admin' };
const createdAt = '2026-10-08T03:00:00.000Z';
const reviewedAt = '2026-10-09T04:00:00.000Z';

interface ReviewRecord {
  id: string;
  tutor: QualificationTutor;
  type: QualificationDocumentType;
  fileName: string;
  status: QualificationStatus;
  rejectionReason: string | null;
}

const profile = {
  role: 'TUTOR',
  consentCurrent: true,
  profileComplete: true,
  policyVersion: '2026-01',
  profile: {
    firstName: 'Tutor',
    lastName: 'One',
    nickname: 'Tutor',
    displayName: 'Tutor One',
    bio: 'Math tutor',
    experienceYears: 4,
    verificationStatus: 'PENDING',
    ratingAverage: null,
    reviewCount: 0,
  },
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function session(page: Page) {
  await page
    .context()
    .addCookies([
      { name: 'hktutor_refresh', value: 'ui-test-session', url: 'http://localhost:3000' },
    ]);
  await page.addInitScript(() => window.localStorage.setItem('hktutor-language', 'en'));
}

test('tutor validates, uploads, sees pending status and retries denied preview', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await session(page);
  let uploaded = false;
  let previews = 0;
  let releaseUpload: (() => void) | undefined;
  const uploadGate = new Promise<void>((resolve) => {
    releaseUpload = resolve;
  });
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/v1/auth/refresh') {
      return json(route, { accessToken: 'ui-test-token', user: tutor });
    }
    if (path === '/api/v1/profiles/me') {
      return json(route, profile);
    }
    if (path === '/api/v1/tutors/me/qualification-documents') {
      if (request.method() === 'POST') {
        await uploadGate;
        uploaded = true;
        expect(request.headers()['authorization']).toBe('Bearer ui-test-token');
        expect(request.postDataBuffer()?.toString()).toContain('documentType');
        return json(
          route,
          {
            documentId: 'doc-1',
            status: 'PENDING',
            fileName: 'degree.pdf',
            mimeType: 'application/pdf',
            size: 12,
            createdAt,
          },
          201,
        );
      }
      return json(route, {
        items: uploaded
          ? [
              {
                documentId: 'doc-1',
                type: 'DEGREE',
                status: 'PENDING',
                reviewedAt: null,
                rejectionReason: null,
              },
            ]
          : [],
      });
    }
    if (path === '/api/v1/tutors/me/qualification-documents/doc-1/signed-url') {
      previews += 1;
      if (previews === 1) {
        return json(route, { message: 'Forbidden' }, 403);
      }
      return json(route, {
        url:
          previews === 4
            ? 'https://example.invalid/degree-refreshed.pdf'
            : 'https://example.invalid/degree.pdf',
        expiresAt: previews === 2 ? '2000-01-01T00:00:00.000Z' : '2099-01-01T00:00:00.000Z',
      });
    }
    return json(route, { message: `Unexpected request: ${path}` }, 500);
  });

  await page.goto('/dashboard/profile');
  const section = page.getByRole('region', { name: 'Tutor certificates' });
  await expect(section.getByText('No documents submitted yet.')).toBeVisible();
  const file = section.getByLabel('PDF, JPEG or PNG, up to 5 MB');
  await file.setInputFiles({
    name: 'empty.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.alloc(0),
  });
  await expect(section.getByRole('alert')).toHaveText('Choose a file that is not empty.');
  await file.setInputFiles({
    name: 'image.webp',
    mimeType: 'image/webp',
    buffer: Buffer.from('test'),
  });
  await expect(section.getByRole('alert')).toHaveText('Choose a PDF, JPEG or PNG file.');
  await file.setInputFiles({
    name: 'big.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
  });
  await expect(section.getByRole('alert')).toHaveText('The file must be 5 MB or smaller.');
  expect(uploaded).toBe(false);

  await file.setInputFiles({
    name: 'degree.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 test'),
  });
  await expect(section.getByText('degree.pdf')).toBeVisible();
  await section.getByRole('button', { name: 'Remove selected file' }).click();
  await expect(section.getByText('degree.pdf')).toHaveCount(0);
  await file.setInputFiles({
    name: 'degree.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 test'),
  });
  await section.getByRole('button', { name: 'Submit document' }).click();
  await expect(section.getByRole('progressbar')).toBeVisible();
  releaseUpload?.();
  await expect(section.getByText('Document submitted for review.')).toBeVisible();
  await expect(section.getByText('Pending review', { exact: true })).toBeVisible();
  await section.getByRole('button', { name: 'View document' }).click();
  await expect(
    section.getByText('Preview access was denied. Refresh the list and try again.'),
  ).toBeVisible();
  await section.getByRole('button', { name: 'Request a new link' }).click();
  await expect(
    section.getByText('This preview link has expired. Request a new one.'),
  ).toBeVisible();
  await section.getByRole('button', { name: 'Request a new link' }).click();
  await expect(section.getByRole('link', { name: 'Open private document' })).toHaveAttribute(
    'href',
    'https://example.invalid/degree.pdf',
  );
  await section.getByRole('button', { name: 'Request a new link' }).click();
  await expect(section.getByRole('link', { name: 'Open private document' })).toHaveAttribute(
    'href',
    'https://example.invalid/degree-refreshed.pdf',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('refresh documents requests the latest list and shows completion', async ({ page }) => {
  await session(page);
  let listReads = 0;
  let refreshReads = 0;
  let refreshRequested = false;
  let releaseRefresh: (() => void) | undefined;
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/auth/refresh') {
      return json(route, { accessToken: 'ui-test-token', user: tutor });
    }
    if (path === '/api/v1/profiles/me') {
      return json(route, profile);
    }
    if (path === '/api/v1/tutors/me/qualification-documents') {
      listReads += 1;
      if (!refreshRequested) {
        return json(route, { items: [] });
      }
      refreshReads += 1;
      if (refreshReads === 2) {
        return json(route, { message: 'Service unavailable' }, 503);
      }
      await refreshGate;
      return json(route, {
        items: [
          {
            documentId: 'new-doc',
            type: 'CERTIFICATE',
            status: 'PENDING',
            reviewedAt: null,
            rejectionReason: null,
          },
        ],
      });
    }
    return json(route, { message: `Unexpected request: ${path}` }, 500);
  });
  await page.goto('/dashboard/profile');
  const section = page.getByRole('region', { name: 'Tutor certificates' });
  await expect(section.getByText('No documents submitted yet.')).toBeVisible();
  const initialReads = listReads;
  refreshRequested = true;
  await section.getByRole('button', { name: 'Refresh documents' }).click();
  const refreshing = section.getByRole('button', { name: 'Refreshing documents…' });
  await expect(refreshing).toBeDisabled();
  releaseRefresh?.();
  await expect(section.getByText('Documents are up to date.')).toBeVisible();
  await expect(section.getByRole('list').getByText('Certificate', { exact: true })).toBeVisible();
  expect(listReads).toBe(initialReads + 1);
  await section.getByRole('button', { name: 'Refresh documents' }).click();
  await expect(section.getByText('Could not load documents. Try again.')).toBeVisible();
  await expect(section.getByText('Documents are up to date.')).toHaveCount(0);
  await expect(section.getByRole('list').getByText('Certificate', { exact: true })).toBeVisible();
  expect(listReads).toBe(initialReads + 2);
});

test('a late initial list response cannot erase a document shown after upload', async ({
  page,
}) => {
  await session(page);
  let releaseInitial: (() => void) | undefined;
  let markInitialStarted: (() => void) | undefined;
  const initialGate = new Promise<void>((resolve) => {
    releaseInitial = resolve;
  });
  const initialStarted = new Promise<void>((resolve) => {
    markInitialStarted = resolve;
  });
  let uploaded = false;
  let initialReads = 0;
  let initialAnswered = 0;
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/v1/auth/refresh') {
      return json(route, { accessToken: 'ui-test-token', user: tutor });
    }
    if (path === '/api/v1/profiles/me') {
      return json(route, profile);
    }
    if (path === '/api/v1/tutors/me/qualification-documents') {
      if (request.method() === 'POST') {
        uploaded = true;
        return json(
          route,
          {
            documentId: 'new-doc',
            status: 'PENDING',
            fileName: 'degree.pdf',
            mimeType: 'application/pdf',
            size: 12,
            createdAt,
          },
          201,
        );
      }
      if (!uploaded) {
        initialReads += 1;
        markInitialStarted?.();
        await initialGate;
        await json(route, { items: [] });
        initialAnswered += 1;
        return;
      }
      return json(route, {
        items: [
          {
            documentId: 'new-doc',
            type: 'DEGREE',
            status: 'PENDING',
            reviewedAt: null,
            rejectionReason: null,
          },
        ],
      });
    }
    return json(route, { message: `Unexpected request: ${path}` }, 500);
  });

  await page.goto('/dashboard/profile');
  await initialStarted;
  const section = page.getByRole('region', { name: 'Tutor certificates' });
  await section.getByLabel('PDF, JPEG or PNG, up to 5 MB').setInputFiles({
    name: 'degree.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 test'),
  });
  await section.getByRole('button', { name: 'Submit document' }).click();
  await expect(section.getByText('Pending review', { exact: true })).toBeVisible();
  releaseInitial?.();
  await expect.poll(() => initialAnswered).toBe(initialReads);
  await expect(section.getByText('Pending review', { exact: true })).toBeVisible();
  await expect(section.getByRole('button', { name: 'Submit document' })).toBeDisabled();
});

test('an ambiguous upload response reloads the committed document before another submission', async ({
  page,
}) => {
  await session(page);
  let committed = false;
  let uploads = 0;
  await page.route('**/api/v1/**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/v1/auth/refresh') {
      return json(route, { accessToken: 'ui-test-token', user: tutor });
    }
    if (path === '/api/v1/profiles/me') {
      return json(route, profile);
    }
    if (path === '/api/v1/tutors/me/qualification-documents') {
      if (request.method() === 'POST') {
        uploads += 1;
        committed = true;
        return route.abort('failed');
      }
      return json(route, {
        items: committed
          ? [
              {
                documentId: 'committed-doc',
                type: 'DEGREE',
                status: 'PENDING',
                reviewedAt: null,
                rejectionReason: null,
              },
            ]
          : [],
      });
    }
    return json(route, { message: `Unexpected request: ${path}` }, 500);
  });

  await page.goto('/dashboard/profile');
  const section = page.getByRole('region', { name: 'Tutor certificates' });
  await expect(section.getByText('No documents submitted yet.')).toBeVisible();
  await section.getByLabel('PDF, JPEG or PNG, up to 5 MB').setInputFiles({
    name: 'degree.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 test'),
  });
  await section.getByRole('button', { name: 'Submit document' }).click();
  await expect(
    section.getByText(
      'Could not confirm the upload. Check the latest documents before submitting again.',
    ),
  ).toBeVisible();
  await expect(section.getByText('Pending review', { exact: true })).toBeVisible();
  await expect(section.getByRole('button', { name: 'Submit document' })).toBeDisabled();
  await expect(section.getByText('Document submitted for review.')).toHaveCount(0);
  expect(uploads).toBe(1);
});

test('a failed profile refresh does not hide a confirmed upload', async ({ page }) => {
  await session(page);
  let uploaded = false;
  await page.route('**/api/v1/**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/v1/auth/refresh') {
      return json(route, { accessToken: 'ui-test-token', user: tutor });
    }
    if (path === '/api/v1/profiles/me') {
      return uploaded ? json(route, { message: 'Service unavailable' }, 503) : json(route, profile);
    }
    if (path === '/api/v1/tutors/me/qualification-documents') {
      if (request.method() === 'POST') {
        uploaded = true;
        return json(
          route,
          {
            documentId: 'new-doc',
            status: 'PENDING',
            fileName: 'degree.pdf',
            mimeType: 'application/pdf',
            size: 12,
            createdAt,
          },
          201,
        );
      }
      return json(route, {
        items: uploaded
          ? [
              {
                documentId: 'new-doc',
                type: 'DEGREE',
                status: 'PENDING',
                reviewedAt: null,
                rejectionReason: null,
              },
            ]
          : [],
      });
    }
    return json(route, { message: `Unexpected request: ${path}` }, 500);
  });

  await page.goto('/dashboard/profile');
  const section = page.getByRole('region', { name: 'Tutor certificates' });
  await expect(section.getByText('No documents submitted yet.')).toBeVisible();
  await section.getByLabel('PDF, JPEG or PNG, up to 5 MB').setInputFiles({
    name: 'degree.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 test'),
  });
  await section.getByRole('button', { name: 'Submit document' }).click();
  await expect(section.getByText('Document submitted for review.')).toBeVisible();
  await expect(section.getByText('Pending review', { exact: true })).toBeVisible();
  await expect(
    section.getByText('Documents refreshed, but profile status could not be updated.'),
  ).toBeVisible();
  await expect(section.getByText('Could not submit the document.')).toHaveCount(0);
});

test('upload conflict refreshes the list without showing a new successful submission', async ({
  page,
}) => {
  await session(page);
  let pending = false;
  await page.route('**/api/v1/**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/v1/auth/refresh') {
      return json(route, { accessToken: 'ui-test-token', user: tutor });
    }
    if (path === '/api/v1/profiles/me') {
      return json(route, profile);
    }
    if (path === '/api/v1/tutors/me/qualification-documents') {
      if (request.method() === 'POST') {
        pending = true;
        return json(route, { message: 'Document already pending' }, 409);
      }
      return json(route, {
        items: pending
          ? [
              {
                documentId: 'existing',
                type: 'DEGREE',
                status: 'PENDING',
                reviewedAt: null,
                rejectionReason: null,
              },
            ]
          : [],
      });
    }
    return json(route, { message: `Unexpected request: ${path}` }, 500);
  });
  await page.goto('/dashboard/profile');
  const section = page.getByRole('region', { name: 'Tutor certificates' });
  await expect(section.getByText('No documents submitted yet.')).toBeVisible();
  await section.getByLabel('PDF, JPEG or PNG, up to 5 MB').setInputFiles({
    name: 'degree.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 test'),
  });
  await section.getByRole('button', { name: 'Submit document' }).click();
  await expect(
    section.getByText('A document of this type is already pending. The list has been refreshed.'),
  ).toBeVisible();
  await expect(section.getByText('Pending review', { exact: true })).toBeVisible();
  await expect(section.getByRole('button', { name: 'Submit document' })).toBeDisabled();
  await expect(section.getByText('Document submitted for review.')).toHaveCount(0);
});

test('admin retries failed detail, rejects with a note and approves another document', async ({
  page,
}) => {
  await session(page);
  const decisions: unknown[] = [];
  let failFirstDetail = true;
  const records: ReviewRecord[] = [
    {
      id: 'doc-1',
      tutor: { userId: 'tutor-1', displayName: 'Tutor One', verificationStatus: 'PENDING' },
      type: 'DEGREE',
      fileName: 'degree.pdf',
      status: 'PENDING',
      rejectionReason: null,
    },
    {
      id: 'doc-2',
      tutor: { userId: 'tutor-2', displayName: 'Tutor Two', verificationStatus: 'PENDING' },
      type: 'CERTIFICATE',
      fileName: 'certificate.png',
      status: 'PENDING',
      rejectionReason: null,
    },
  ];
  await page.route('**/api/v1/**', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/auth/refresh') {
      return json(route, { accessToken: 'ui-test-token', user: admin });
    }
    if (url.pathname === '/api/v1/admin/tutor-verifications') {
      return json(route, {
        items: records
          .filter((record) => record.status === (url.searchParams.get('status') ?? 'PENDING'))
          .map((record) => ({
            documentId: record.id,
            type: record.type,
            status: record.status,
            fileName: record.fileName,
            mimeType: 'application/pdf',
            size: 100,
            createdAt,
            reviewedAt: record.status === 'PENDING' ? null : reviewedAt,
            rejectionReason: record.rejectionReason,
            tutor: record.tutor,
          })),
        nextCursor: null,
      });
    }
    if (url.pathname === '/api/v1/admin/tutor-verifications/doc-1/signed-url') {
      return json(route, {
        url: 'https://example.invalid/admin-degree.pdf',
        expiresAt: '2099-01-01T00:00:00.000Z',
      });
    }
    const match = /^\/api\/v1\/admin\/tutor-verifications\/(doc-[12])$/.exec(url.pathname);
    if (match) {
      const record = records.find((item) => item.id === match[1]);
      if (!record) {
        return json(route, { message: 'Not found' }, 404);
      }
      if (request.method() === 'PATCH') {
        const body: unknown = request.postDataJSON();
        if (
          typeof body !== 'object' ||
          body === null ||
          !('decision' in body) ||
          (body.decision !== 'APPROVED' && body.decision !== 'REJECTED')
        ) {
          throw new Error('Expected an approval or rejection decision');
        }
        const reason =
          'reason' in body && typeof body.reason === 'string' ? body.reason : undefined;
        const decision = body.decision;
        decisions.push({ decision, ...(reason ? { reason } : {}) });
        record.status = decision;
        record.rejectionReason = decision === 'REJECTED' ? (reason ?? null) : null;
        record.tutor.verificationStatus = decision === 'APPROVED' ? 'VERIFIED' : 'REJECTED';
        return json(route, {
          documentId: record.id,
          status: record.status,
          reviewedAt,
          reviewedBy: 'admin-ui',
          tutorVerificationStatus: decision === 'APPROVED' ? 'VERIFIED' : 'REJECTED',
        });
      }
      if (record.id === 'doc-1' && failFirstDetail) {
        failFirstDetail = false;
        return json(route, { message: 'Service unavailable' }, 503);
      }
      return json(route, {
        document: {
          documentId: record.id,
          type: record.type,
          status: record.status,
          fileName: record.fileName,
          mimeType: 'application/pdf',
          size: 100,
          createdAt,
          reviewedAt: record.status === 'PENDING' ? null : reviewedAt,
          rejectionReason: record.rejectionReason,
        },
        tutor: record.tutor,
        reviewHistory:
          record.status === 'PENDING'
            ? []
            : [
                {
                  status: record.status,
                  reviewedAt,
                  reviewedBy: 'admin-ui',
                  reason: record.rejectionReason,
                },
              ],
      });
    }
    return json(route, { message: `Unexpected request: ${url.pathname}` }, 500);
  });

  await page.goto('/dashboard');
  const queue = page.getByRole('region', { name: 'Tutor verification queue' });
  await queue.getByRole('button', { name: /Tutor One/ }).click();
  await expect(
    queue.getByText('Could not load document details. Select it again or refresh the queue.'),
  ).toBeVisible();
  await queue.getByRole('button', { name: /Tutor One/ }).click();
  await expect(queue.getByRole('heading', { name: 'Tutor One' })).toBeVisible();
  await queue.getByRole('button', { name: 'View document' }).click();
  await expect(queue.getByRole('link', { name: 'Open private document' })).toHaveAttribute(
    'href',
    'https://example.invalid/admin-degree.pdf',
  );
  await queue.getByRole('button', { name: /Tutor One/ }).click();
  await expect(queue.getByRole('link', { name: 'Open private document' })).toBeVisible();
  await queue.getByRole('radio', { name: 'Reject' }).check();
  await queue.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(queue.getByText('Enter a reason before rejecting.')).toBeVisible();
  expect(decisions).toHaveLength(0);
  await queue.getByLabel('Review note').fill('  Missing seal  ');
  await queue.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(queue.getByText('Review saved.')).toBeVisible();
  await expect(queue.getByText('Review note: Missing seal')).toBeVisible();
  expect(decisions).toEqual([{ decision: 'REJECTED', reason: 'Missing seal' }]);
  await queue.getByRole('button', { name: /Tutor Two/ }).click();
  await queue.getByLabel('Review note').fill('Original certificate checked');
  await queue.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(queue.getByText('Approved', { exact: true }).first()).toBeVisible();
  expect(decisions).toEqual([
    { decision: 'REJECTED', reason: 'Missing seal' },
    { decision: 'APPROVED', reason: 'Original certificate checked' },
  ]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('admin load more waits for a queue refresh to finish', async ({ page }) => {
  await session(page);
  let releaseRefresh: (() => void) | undefined;
  let markRefreshStarted: (() => void) | undefined;
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  const refreshStarted = new Promise<void>((resolve) => {
    markRefreshStarted = resolve;
  });
  let refreshing = false;
  let moreReads = 0;
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/v1/auth/refresh') {
      return json(route, { accessToken: 'ui-test-token', user: admin });
    }
    if (url.pathname === '/api/v1/admin/tutor-verifications') {
      if (url.searchParams.has('cursor')) {
        moreReads += 1;
        return json(route, { items: [], nextCursor: null });
      }
      if (refreshing) {
        markRefreshStarted?.();
        await refreshGate;
      }
      return json(route, {
        items: [
          {
            documentId: refreshing ? 'doc-2' : 'doc-1',
            type: 'DEGREE',
            status: 'PENDING',
            fileName: refreshing ? 'new.pdf' : 'old.pdf',
            mimeType: 'application/pdf',
            size: 100,
            createdAt,
            reviewedAt: null,
            rejectionReason: null,
            tutor: {
              userId: refreshing ? 'tutor-2' : 'tutor-1',
              displayName: refreshing ? 'Tutor Two' : 'Tutor One',
              verificationStatus: 'PENDING',
            },
          },
        ],
        nextCursor: refreshing ? null : 'next-page',
      });
    }
    return json(route, { message: `Unexpected request: ${url.pathname}` }, 500);
  });

  await page.goto('/dashboard');
  const queue = page.getByRole('region', { name: 'Tutor verification queue' });
  await expect(queue.getByRole('button', { name: /Tutor One/ })).toBeVisible();
  await expect(queue.getByRole('button', { name: 'Load more' })).toBeEnabled();
  refreshing = true;
  await queue.getByRole('button', { name: 'Refresh documents' }).click();
  await refreshStarted;
  await expect(queue.getByRole('button', { name: 'Load more' })).toBeDisabled();
  releaseRefresh?.();
  await expect(queue.getByRole('button', { name: /Tutor Two/ })).toBeVisible();
  expect(moreReads).toBe(0);
});

test('switching documents during a review keeps the selected detail in sync', async ({ page }) => {
  await session(page);
  let releaseReview: (() => void) | undefined;
  let markReviewStarted: (() => void) | undefined;
  const reviewGate = new Promise<void>((resolve) => {
    releaseReview = resolve;
  });
  const reviewStarted = new Promise<void>((resolve) => {
    markReviewStarted = resolve;
  });
  const detailReads: string[] = [];
  let reviewed = false;
  let reviewRequests = 0;
  const records: ReviewRecord[] = [
    {
      id: 'doc-1',
      tutor: { userId: 'tutor-1', displayName: 'Tutor One', verificationStatus: 'PENDING' },
      type: 'DEGREE',
      fileName: 'degree.pdf',
      status: 'PENDING',
      rejectionReason: null,
    },
    {
      id: 'doc-2',
      tutor: { userId: 'tutor-2', displayName: 'Tutor Two', verificationStatus: 'PENDING' },
      type: 'CERTIFICATE',
      fileName: 'certificate.png',
      status: 'PENDING',
      rejectionReason: null,
    },
  ];
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/auth/refresh') {
      return json(route, { accessToken: 'ui-test-token', user: admin });
    }
    if (url.pathname === '/api/v1/admin/tutor-verifications') {
      return json(route, {
        items: records
          .filter((record) => !reviewed || record.id !== 'doc-1')
          .map((record) => ({
            documentId: record.id,
            type: record.type,
            status: record.status,
            fileName: record.fileName,
            mimeType: 'application/pdf',
            size: 100,
            createdAt,
            reviewedAt: null,
            rejectionReason: null,
            tutor: record.tutor,
          })),
        nextCursor: null,
      });
    }
    const match = /^\/api\/v1\/admin\/tutor-verifications\/(doc-[12])$/.exec(url.pathname);
    if (match) {
      const record = records.find((item) => item.id === match[1]);
      if (!record) {
        return json(route, { message: 'Not found' }, 404);
      }
      if (request.method() === 'PATCH') {
        reviewRequests += 1;
        markReviewStarted?.();
        await reviewGate;
        reviewed = true;
        return json(route, {
          documentId: record.id,
          status: 'APPROVED',
          reviewedAt,
          reviewedBy: 'admin-ui',
          tutorVerificationStatus: 'VERIFIED',
        });
      }
      detailReads.push(record.id);
      return json(route, {
        document: {
          documentId: record.id,
          type: record.type,
          status: reviewed && record.id === 'doc-1' ? 'APPROVED' : 'PENDING',
          fileName: record.fileName,
          mimeType: 'application/pdf',
          size: 100,
          createdAt,
          reviewedAt: reviewed && record.id === 'doc-1' ? reviewedAt : null,
          rejectionReason: null,
        },
        tutor: record.tutor,
        reviewHistory: [],
      });
    }
    return json(route, { message: `Unexpected request: ${url.pathname}` }, 500);
  });

  await page.goto('/dashboard');
  const queue = page.getByRole('region', { name: 'Tutor verification queue' });
  await queue.getByRole('button', { name: /Tutor One/ }).click();
  await expect(queue.getByRole('heading', { name: 'Tutor One' })).toBeVisible();
  await queue.getByRole('button', { name: 'Approve', exact: true }).click();
  await reviewStarted;
  await queue.getByRole('button', { name: /Tutor Two/ }).click();
  await expect(queue.getByRole('heading', { name: 'Tutor Two' })).toBeVisible();
  await expect(queue.getByRole('button', { name: 'Approve', exact: true })).toBeDisabled();
  releaseReview?.();
  await expect(queue.getByText('Review saved.')).toBeVisible();
  await expect(queue.getByRole('button', { name: /Tutor Two/ })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(queue.getByRole('heading', { name: 'Tutor Two' })).toBeVisible();
  await expect(queue.getByRole('button', { name: 'Approve', exact: true })).toBeEnabled();
  expect(detailReads).toEqual(['doc-1', 'doc-2']);
  expect(reviewRequests).toBe(1);
});

test('review failure leaves the pending decision unchanged', async ({ page }) => {
  await session(page);
  await page.route('**/api/v1/**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/v1/auth/refresh') {
      return json(route, { accessToken: 'ui-test-token', user: admin });
    }
    if (path === '/api/v1/admin/tutor-verifications') {
      return json(route, {
        items: [
          {
            documentId: 'doc-1',
            type: 'DEGREE',
            status: 'PENDING',
            fileName: 'degree.pdf',
            mimeType: 'application/pdf',
            size: 100,
            createdAt,
            reviewedAt: null,
            rejectionReason: null,
            tutor: { userId: 'tutor-1', displayName: 'Tutor One', verificationStatus: 'PENDING' },
          },
        ],
        nextCursor: null,
      });
    }
    if (path === '/api/v1/admin/tutor-verifications/doc-1') {
      if (request.method() === 'PATCH') {
        return json(route, { message: 'Service unavailable' }, 503);
      }
      return json(route, {
        document: {
          documentId: 'doc-1',
          type: 'DEGREE',
          status: 'PENDING',
          fileName: 'degree.pdf',
          mimeType: 'application/pdf',
          size: 100,
          createdAt,
          reviewedAt: null,
          rejectionReason: null,
        },
        tutor: { userId: 'tutor-1', displayName: 'Tutor One', verificationStatus: 'PENDING' },
        reviewHistory: [],
      });
    }
    return json(route, { message: `Unexpected request: ${path}` }, 500);
  });
  await page.goto('/dashboard');
  const queue = page.getByRole('region', { name: 'Tutor verification queue' });
  await queue.getByRole('button', { name: /Tutor One/ }).click();
  await queue.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(
    queue.getByText('Could not confirm the review. Check its current status before trying again.'),
  ).toBeVisible();
  await expect(queue.getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
  await expect(queue.getByText('Pending review', { exact: true }).last()).toBeVisible();
  await expect(queue.getByText('Review saved.')).toHaveCount(0);
});

test('ambiguous review failure reloads a decision already saved by the server', async ({
  page,
}) => {
  await session(page);
  let approved = false;
  await page.route('**/api/v1/**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/v1/auth/refresh') {
      return json(route, { accessToken: 'ui-test-token', user: admin });
    }
    if (path === '/api/v1/admin/tutor-verifications') {
      return json(route, {
        items: approved
          ? []
          : [
              {
                documentId: 'doc-1',
                type: 'DEGREE',
                status: 'PENDING',
                fileName: 'degree.pdf',
                mimeType: 'application/pdf',
                size: 100,
                createdAt,
                reviewedAt: null,
                rejectionReason: null,
                tutor: {
                  userId: 'tutor-1',
                  displayName: 'Tutor One',
                  verificationStatus: 'PENDING',
                },
              },
            ],
        nextCursor: null,
      });
    }
    if (path === '/api/v1/admin/tutor-verifications/doc-1') {
      if (request.method() === 'PATCH') {
        approved = true;
        return json(route, { message: 'Connection failed after commit' }, 503);
      }
      return json(route, {
        document: {
          documentId: 'doc-1',
          type: 'DEGREE',
          status: approved ? 'APPROVED' : 'PENDING',
          fileName: 'degree.pdf',
          mimeType: 'application/pdf',
          size: 100,
          createdAt,
          reviewedAt: approved ? reviewedAt : null,
          rejectionReason: null,
        },
        tutor: {
          userId: 'tutor-1',
          displayName: 'Tutor One',
          verificationStatus: approved ? 'VERIFIED' : 'PENDING',
        },
        reviewHistory: [],
      });
    }
    return json(route, { message: `Unexpected request: ${path}` }, 500);
  });
  await page.goto('/dashboard');
  const queue = page.getByRole('region', { name: 'Tutor verification queue' });
  await queue.getByRole('button', { name: /Tutor One/ }).click();
  await queue.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(queue.getByRole('paragraph').filter({ hasText: /^Approved$/ })).toBeVisible();
  await expect(queue.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
  await expect(
    queue.getByText('Could not confirm the review. Check its current status before trying again.'),
  ).toBeVisible();
  await expect(queue.getByText('Review saved.')).toHaveCount(0);
});

test('review conflict reloads server state and removes the pending form', async ({ page }) => {
  await session(page);
  let reviewed = false;
  await page.route('**/api/v1/**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/v1/auth/refresh') {
      return json(route, { accessToken: 'ui-test-token', user: admin });
    }
    if (path === '/api/v1/admin/tutor-verifications') {
      return json(route, {
        items: reviewed
          ? []
          : [
              {
                documentId: 'doc-1',
                type: 'DEGREE',
                status: 'PENDING',
                fileName: 'degree.pdf',
                mimeType: 'application/pdf',
                size: 100,
                createdAt,
                reviewedAt: null,
                rejectionReason: null,
                tutor: {
                  userId: 'tutor-1',
                  displayName: 'Tutor One',
                  verificationStatus: 'PENDING',
                },
              },
            ],
        nextCursor: null,
      });
    }
    if (path === '/api/v1/admin/tutor-verifications/doc-1') {
      if (request.method() === 'PATCH') {
        reviewed = true;
        return json(route, { message: 'Already reviewed' }, 409);
      }
      return json(route, {
        document: {
          documentId: 'doc-1',
          type: 'DEGREE',
          status: reviewed ? 'APPROVED' : 'PENDING',
          fileName: 'degree.pdf',
          mimeType: 'application/pdf',
          size: 100,
          createdAt,
          reviewedAt: reviewed ? reviewedAt : null,
          rejectionReason: null,
        },
        tutor: {
          userId: 'tutor-1',
          displayName: 'Tutor One',
          verificationStatus: reviewed ? 'VERIFIED' : 'PENDING',
        },
        reviewHistory: [],
      });
    }
    return json(route, { message: `Unexpected request: ${path}` }, 500);
  });
  await page.goto('/dashboard');
  const queue = page.getByRole('region', { name: 'Tutor verification queue' });
  await queue.getByRole('button', { name: /Tutor One/ }).click();
  await queue.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(
    queue.getByText('This document was reviewed elsewhere. The queue has been refreshed.'),
  ).toBeVisible();
  await expect(queue.getByText('Approved', { exact: true }).last()).toBeVisible();
  await expect(queue.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
});
