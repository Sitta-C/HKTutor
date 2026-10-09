import { beforeEach, describe, expect, it, vi } from 'vitest';

import { authenticatedFetch, authenticatedUpload } from '@/lib/api/client';
import {
  getAdminVerification,
  getAdminVerificationSignedUrl,
  getMyQualificationSignedUrl,
  listAdminVerifications,
  listMyQualifications,
  reviewAdminVerification,
  uploadQualification,
} from '@/lib/api/qualifications';

vi.mock('@/lib/api/client', () => ({ authenticatedFetch: vi.fn(), authenticatedUpload: vi.fn() }));

describe('qualification API contract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends multipart file and document type through the existing authenticated client', async () => {
    const file = new File(['%PDF'], 'degree.pdf', { type: 'application/pdf' });
    const onProgress = vi.fn();
    await uploadQualification(file, 'DEGREE', onProgress);
    expect(authenticatedUpload).toHaveBeenCalledOnce();
    const call = vi.mocked(authenticatedUpload).mock.calls[0];
    if (!call) {
      throw new Error('Expected an upload call');
    }
    const [path, body, progress] = call;
    expect(path).toBe('/tutors/me/qualification-documents');
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('file')).toBe(file);
    expect(body.get('documentType')).toBe('DEGREE');
    expect(progress).toBe(onProgress);
  });

  it('maps owner list and signed URL endpoints without putting document IDs in query fields', async () => {
    await listMyQualifications();
    await listMyQualifications('REJECTED');
    await getMyQualificationSignedUrl('a/b');
    expect(authenticatedFetch).toHaveBeenNthCalledWith(1, '/tutors/me/qualification-documents');
    expect(authenticatedFetch).toHaveBeenNthCalledWith(
      2,
      '/tutors/me/qualification-documents?status=REJECTED',
    );
    expect(authenticatedFetch).toHaveBeenNthCalledWith(
      3,
      '/tutors/me/qualification-documents/a%2Fb/signed-url',
    );
  });

  it('maps the admin queue, detail, preview and review with an opaque encoded cursor', async () => {
    await listAdminVerifications('PENDING', 'a+b=');
    await getAdminVerification('a/b');
    await getAdminVerificationSignedUrl('a/b');
    await reviewAdminVerification('a/b', { decision: 'REJECTED', reason: 'Missing seal' });
    expect(authenticatedFetch).toHaveBeenNthCalledWith(
      1,
      '/admin/tutor-verifications?status=PENDING&limit=20&cursor=a%2Bb%3D',
    );
    expect(authenticatedFetch).toHaveBeenNthCalledWith(2, '/admin/tutor-verifications/a%2Fb');
    expect(authenticatedFetch).toHaveBeenNthCalledWith(
      3,
      '/admin/tutor-verifications/a%2Fb/signed-url',
    );
    expect(authenticatedFetch).toHaveBeenNthCalledWith(4, '/admin/tutor-verifications/a%2Fb', {
      method: 'PATCH',
      body: JSON.stringify({ decision: 'REJECTED', reason: 'Missing seal' }),
    });
  });
});
