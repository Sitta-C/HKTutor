import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const clientPath = 'apps/web/src/lib/api/tutors.ts';
const typesPath = 'apps/web/src/lib/api/types.ts';
const pagePath = 'apps/web/src/app/tutors/page.tsx';
const componentPath = 'apps/web/src/components/tutors/tutor-search-page.tsx';
const shellPath = 'apps/web/src/components/tutors/public-tutor-search-shell.tsx';

test('defines the S1-T22 public Tutor client contracts', async () => {
  const client = await fs.readFile(clientPath, 'utf8');
  const types = await fs.readFile(typesPath, 'utf8');

  assert.match(client, /getSubjectCatalog/);
  assert.match(client, /getGradeLevelCatalog/);
  assert.match(client, /searchTutors/);
  assert.match(client, /getPublicTutor\(/);
  assert.match(client, /getPublicTutorAvailability/);
  assert.match(client, /'\/subjects'/);
  assert.match(client, /'\/grade-levels'/);
  assert.match(client, /`\/tutors\$\{queryString \? `\?\$\{queryString\}` : ''\}`/);
  assert.match(client, /params\.set\('maxPrice', String\(query\.maxPrice\)\)/);
  assert.match(client, /params\.set\('minimumRating', String\(query\.minimumRating\)\)/);
  assert.doesNotMatch(client, /params\.set\('maxBudget'/);

  for (const field of [
    'listingId',
    'tutorId',
    'displayName',
    'description',
    'experienceYears',
    'subject',
    'grade',
    'pricePerHour',
    'ratingAverage',
    'reviewCount',
    'nextAvailableAt',
  ]) {
    assert.match(types, new RegExp(`export interface TutorSearchResult[\\s\\S]*?${field}`));
  }

  const publicProfile = types.match(/export interface PublicTutorProfile\s*{([\s\S]*?)\n}/)?.[1];
  assert.ok(publicProfile, 'PublicTutorProfile must exist');
  assert.doesNotMatch(publicProfile, /email|phone|firstName|lastName|nickname|consent|document/i);
});

test('renders the public Tutor search route and catalog-backed controls', async () => {
  const page = await fs.readFile(pagePath, 'utf8');
  const component = await fs.readFile(componentPath, 'utf8');
  const shell = await fs.readFile(shellPath, 'utf8');

  assert.match(page, /TutorSearchPage/);
  assert.match(page, /PublicTutorSearchShell/);
  assert.match(shell, /DashboardShell/);
  assert.match(shell, /headerNavRight/);
  assert.match(shell, /public-search-demo-user/);
  for (const controlId of [
    'tutor-search-subject',
    'tutor-search-grade',
    'tutor-search-max-price',
    'tutor-search-min-rating',
  ]) {
    assert.match(component, new RegExp(controlId));
  }
  assert.match(component, /getSubjectCatalog\(\)/);
  assert.match(component, /getGradeLevelCatalog\(\)/);
  assert.match(component, /options=\{subjects\.map/);
  assert.match(component, /options=\{gradeLevels\.map/);
  assert.match(component, /id="tutor-search-max-price"[\s\S]*?step="50"/);
  assert.match(component, /key=\{result\.listingId\}/);
});

test('keeps no-match, validation, network-error, and stale-result states separate', async () => {
  const component = await fs.readFile(componentPath, 'utf8');

  assert.match(component, /No exact matches found/);
  assert.match(component, /setResults\(\[\]\)/);
  assert.match(component, /status === 'validation'/);
  assert.match(component, /status === 'error'/);
  assert.match(component, /status === 'loading'/);
  assert.match(component, /new AbortController\(\)/);
  assert.match(component, /currentRequest !== requestId\.current/);
  assert.match(component, /status === 'success' && results\.length === 0/);
});

test('keeps the search callback stable when the language changes', async () => {
  const component = await fs.readFile(componentPath, 'utf8');
  const executeSearch = component.match(
    /const executeSearch = useCallback\(([\s\S]*?\n {2}\}, \[\]\);)/,
  )?.[1];

  assert.ok(executeSearch, 'executeSearch callback must exist');
  assert.match(executeSearch, /setSearchError\(error\)/);
  assert.doesNotMatch(executeSearch, /text\.searchError/);
  assert.match(executeSearch, /\}, \[\]\);$/);
  assert.match(component, /readSearchError\(searchError, text\.searchError\)/);
});
