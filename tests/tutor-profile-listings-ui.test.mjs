import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const read = (filePath) => fs.readFile(filePath, 'utf8');

test('keeps tutor profile editor fields aligned with the API contract', async () => {
  const editor = await read('apps/web/src/components/profile/profile-editor.tsx');

  assert.match(editor, /maxLength=\{100\}[\s\S]*value=\{data\.displayName\}/);
  assert.match(editor, /minLength=\{1\}[\s\S]*maxLength=\{2000\}/);
  assert.match(editor, /copy\.bioHint[^\n]*2000/);
  assert.doesNotMatch(editor, /experienceYears[\s\S]{0,500}max=\{80\}/);
});

test('provides accessible inline form feedback and profile metadata', async () => {
  const editor = await read('apps/web/src/components/profile/profile-editor.tsx');
  const types = await read('apps/web/src/lib/api/types.ts');

  assert.match(editor, /aria-invalid=\{Boolean\(errors\./);
  assert.match(editor, /role="alert"/);
  assert.match(editor, /requestAnimationFrame/);
  assert.match(editor, /profileSummary\.createdAt/);
  assert.match(editor, /profileSummary\.updatedAt/);
  assert.match(types, /createdAt:\s*string;[\s\S]*updatedAt:\s*string;/);
});

test('supports restoring archived listings to draft or publishing them again', async () => {
  const page = await read('apps/web/src/components/listings/tutor-listings-page.tsx');
  const editor = await read('apps/web/src/components/listings/tutor-listing-editor.tsx');
  const api = await read('apps/web/src/lib/api/listings.ts');

  assert.match(api, /restoreTutorListing[\s\S]*updateTutorListingStatus\(listingId, 'DRAFT'\)/);
  assert.match(api, /updateTutorListingStatus[\s\S]*publicationStatus/);
  assert.match(page, /handleRestoreDraft/);
  assert.match(page, /copy\.restoreDraft/);
  assert.match(page, /updateTutorListingStatus\(listingId, 'PUBLISHED'\)/);
  assert.match(page, /publicationStatus === 'ARCHIVED'/);
  assert.match(editor, /updateTutorListingStatus\(savedListingId, 'PUBLISHED'\)/);
  assert.match(editor, /updateTutorListingStatus\(listingId, 'DRAFT'\)/);
  assert.match(editor, /copy\.restoreDraft/);
});
