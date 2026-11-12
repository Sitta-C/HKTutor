import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizePlan } from '../apps/api/scripts/verify-sprint3-query-plans.mjs';

test('DB05 extracts nested indexes and row work without retaining predicates or identities', () => {
  assert.deepEqual(
    summarizePlan([
      {
        Plan: {
          'Node Type': 'Limit',
          'Actual Rows': 2,
          Plans: [
            {
              'Node Type': 'Bitmap Heap Scan',
              'Actual Rows': 2,
              'Rows Removed by Filter': 3,
              Filter: 'private fixture values must not be retained',
              Plans: [
                {
                  'Node Type': 'Bitmap Index Scan',
                  'Index Name': 'Review_tutorProfileId_createdAt_id_idx',
                  'Actual Rows': 5,
                },
              ],
            },
          ],
        },
        'Execution Time': 0.5,
      },
    ]),
    {
      nodes: ['Limit', 'Bitmap Heap Scan', 'Bitmap Index Scan'],
      indexes: ['Review_tutorProfileId_createdAt_id_idx'],
      rows: 2,
      removed: 3,
      milliseconds: 0.5,
    },
  );
});

test('DB05 rejects missing EXPLAIN evidence rather than reporting a pass', () => {
  for (const invalid of [null, {}, [], [{ Plan: null }], [{ Plan: { 'Node Type': 'Seq Scan' } }]]) {
    assert.throws(() => summarizePlan(invalid));
  }
});
