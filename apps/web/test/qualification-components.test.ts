import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DocumentStatusList } from '@/components/qualifications/document-status-list';
import { qualificationCopy } from '@/components/qualifications/qualification-copy';

describe('qualification status component', () => {
  it('renders an empty state and each reviewed state with a Bangkok-time note', () => {
    const empty = renderToStaticMarkup(
      createElement(DocumentStatusList, {
        documents: [],
        copy: qualificationCopy.en,
        language: 'en',
      }),
    );
    expect(empty).toContain('No documents submitted yet.');

    const documents = [
      {
        documentId: 'pending',
        type: 'DEGREE',
        status: 'PENDING' as const,
        reviewedAt: null,
        rejectionReason: null,
      },
      {
        documentId: 'approved',
        type: 'CERTIFICATE',
        status: 'APPROVED' as const,
        reviewedAt: '2026-10-09T04:00:00.000Z',
        rejectionReason: null,
      },
      {
        documentId: 'rejected',
        type: 'CERTIFICATE',
        status: 'REJECTED' as const,
        reviewedAt: '2026-10-09T04:00:00.000Z',
        rejectionReason: 'Missing seal',
      },
    ];
    const markup = renderToStaticMarkup(
      createElement(DocumentStatusList, {
        documents,
        copy: qualificationCopy.en,
        language: 'en',
      }),
    );

    expect(markup).toContain('Pending review');
    expect(markup).toContain('Approved');
    expect(markup).toContain('Rejected');
    expect(markup).toContain('Review note:</strong> Missing seal');
    expect(markup).toContain('11:00');
    expect(markup).not.toContain('https://');
  });
});
