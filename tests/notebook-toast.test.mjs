import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const read = (filePath) => fs.readFile(filePath, 'utf8');

test('provides notebook success and error toasts from the application root', async () => {
  const provider = await read('apps/web/src/components/ui/notebook-toast.tsx');
  const layout = await read('apps/web/src/app/layout.tsx');

  assert.match(provider, /export type NotebookToastTone = 'success' \| 'error'/);
  assert.match(provider, /export function NotebookToastProvider/);
  assert.match(provider, /export function useNotebookToast/);
  assert.match(layout, /<NotebookToastProvider>\{children\}<\/NotebookToastProvider>/);
});

test('auto-dismisses notebook toasts after two seconds without a close button', async () => {
  const provider = await read('apps/web/src/components/ui/notebook-toast.tsx');

  assert.match(provider, /success: 2000, error: 2000/);
  assert.match(provider, /setTimeout\(\(\) => dismiss\(id\)/);
  assert.match(provider, /visible: false/);
  assert.match(provider, /toast-out_200ms/);
  assert.match(provider, /clearTimeout\(timer\)/);
  assert.doesNotMatch(provider, /onClick=\{onDismiss\}/);
  assert.doesNotMatch(provider, /aria-label=\{closeLabel\}/);
});

test('sizes toast cards to their content while respecting the viewport', async () => {
  const provider = await read('apps/web/src/components/ui/notebook-toast.tsx');

  assert.match(provider, /left-1\/2 top-3/);
  assert.match(provider, /-translate-x-1\/2 flex-col items-center/);
  assert.match(provider, /relative w-fit max-w-full/);
  assert.match(provider, /max-w-sm/);
  assert.match(provider, /origin-top/);
  assert.match(provider, /<div className="flex items-center gap-2\.5">/);
  assert.match(provider, /-left-5 top-\[-4\] h-3 w-14 rotate-\[-24deg\]/);
});

test('animates the success and error marks without external icon packages', async () => {
  const provider = await read('apps/web/src/components/ui/notebook-toast.tsx');
  const styles = await read('apps/web/src/app/globals.css');

  assert.match(provider, /function SuccessMark/);
  assert.match(provider, /function ErrorMark/);
  assert.match(provider, /toast-icon-in_400ms/);
  assert.match(provider, /toast-stroke-in_300ms/);
  assert.match(provider, /toast-stroke-in_220ms/);
  assert.match(styles, /@keyframes toast-icon-in/);
  assert.match(styles, /@keyframes toast-stroke-in/);
});

test('announces toast feedback accessibly without a third-party dependency', async () => {
  const provider = await read('apps/web/src/components/ui/notebook-toast.tsx');
  const webPackage = JSON.parse(await read('apps/web/package.json'));
  const dependencyNames = Object.keys({
    ...webPackage.dependencies,
    ...webPackage.devDependencies,
  });

  assert.match(provider, /role=\{success \? 'status' : 'alert'\}/);
  assert.match(provider, /aria-live=\{success \? 'polite' : 'assertive'\}/);
  assert.match(provider, /aria-atomic="true"/);
  assert.equal(
    dependencyNames.some((name) => /sonner|react-hot-toast|react-toastify/i.test(name)),
    false,
  );
});

test('uses notebook toasts for saved and mutation feedback', async () => {
  const profile = await read('apps/web/src/components/profile/profile-editor.tsx');
  const listing = await read('apps/web/src/components/listings/tutor-listing-editor.tsx');
  const availability = await read(
    'apps/web/src/components/availability/manage-tutor-availability.tsx',
  );

  assert.match(profile, /useNotebookToast/);
  assert.match(profile, /toast\.success/);
  for (const feature of [listing, availability]) {
    assert.match(feature, /useNotebookToast/);
    assert.match(feature, /toast\.success/);
    assert.match(feature, /toast\.error/);
  }
});
