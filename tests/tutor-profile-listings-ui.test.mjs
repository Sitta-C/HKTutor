import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const read = (filePath) => fs.readFile(filePath, 'utf8');

test('keeps tutor listing routes and API client wired', async () => {
  const listRoute = await read('apps/web/src/app/dashboard/listings/page.tsx');
  const newRoute = await read('apps/web/src/app/dashboard/listings/new/page.tsx');
  const editRoute = await read('apps/web/src/app/dashboard/listings/[listingId]/edit/page.tsx');
  const api = await read('apps/web/src/lib/api/listings.ts');

  assert.match(listRoute, /TutorListingsPage/);
  assert.match(newRoute, /TutorListingEditor/);
  assert.match(editRoute, /params:\s*Promise<\{ listingId: string \}>/);
  assert.match(api, /getTutorListings/);
  assert.match(api, /createTutorListing/);
  assert.match(api, /updateTutorListing/);
  assert.match(api, /updateTutorListingStatus/);
});

test('supports restoring archived listings to draft or publishing them again', async () => {
  const page = await read('apps/web/src/components/listings/tutor-listings-page.tsx');
  const editor = await read('apps/web/src/components/listings/tutor-listing-editor.tsx');
  const api = await read('apps/web/src/lib/api/listings.ts');

  assert.match(api, /restoreTutorListing[\s\S]*updateTutorListingStatus\(listingId, 'DRAFT'\)/);
  assert.match(api, /updateTutorListingStatus[\s\S]*publicationStatus/);
  assert.match(page, /handleRestoreDraft/);
  assert.match(page, /copy\.restoreDraft/);
  assert.match(page, /publishTutorListing\(listingId\)/);
  assert.match(page, /publicationStatus === 'ARCHIVED'/);
  assert.match(editor, /publishTutorListing\(savedListingId\)/);
  assert.match(editor, /updateTutorListingStatus\(listingId, 'DRAFT'\)/);
  assert.match(editor, /copy\.restoreDraft/);
});

test('keeps listing form feedback accessible and within the API contract', async () => {
  const editor = await read('apps/web/src/components/listings/tutor-listing-editor.tsx');

  assert.match(editor, /noValidate/);
  assert.match(editor, /aria-invalid=\{Boolean\(errors\./);
  assert.match(editor, /min="0\.01"/);
  assert.match(editor, /maxLength=\{1000\}/);
  assert.match(editor, /descriptionLength < 20/);
  assert.match(editor, /role="alert"/);
  assert.match(editor, /role="status"/);
});
