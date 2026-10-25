import test from 'node:test';
import assert from 'node:assert/strict';
import { loadState, saveState } from '../src/services/storage.js';
import { loadLocalStudentDb, recordGrowthMoment } from '../src/data/localStudentDb.js';
import { STATE_KEY, DB_KEY } from '../src/services/localPersistence.js';
import { createInitialState } from '../src/data/studentModel.js';

function withStorage(entries, run) {
  const values = new Map(Object.entries(entries));
  const original = globalThis.window;
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
  globalThis.window = { localStorage: storage };
  try { run(storage); } finally { globalThis.window = original; }
}

test('unreadable state is reported, not silently treated as a new family', () => {
  for (const raw of ['broken', 'null', '[]', '{}', '']) {
    withStorage({ [STATE_KEY]: raw }, storage => {
      assert.throws(() => loadState());
      assert.throws(() => saveState(createInitialState()));
      assert.equal(storage.getItem(STATE_KEY), raw);
    });
  }
});

test('unreadable growth archive cannot be replaced with a newly captured moment', () => {
  for (const raw of ['broken', 'null', '[]', '{}', '{"studentModels":{},"growthMoments":[null]}']) {
    withStorage({ [DB_KEY]: raw }, storage => {
      assert.throws(() => loadLocalStudentDb());
      assert.throws(() => recordGrowthMoment({ studentId: 'test', childQuote: '测试原话', tutorResponse: '测试回复' }));
      assert.equal(storage.getItem(DB_KEY), raw);
    });
  }
});

test('a damaged current key does not fall back to an older legacy archive', () => {
  withStorage({ [STATE_KEY]: '', 'momo-learning-mvp-state': JSON.stringify(createInitialState()) }, storage => {
    assert.throws(() => loadState());
    assert.equal(storage.getItem(STATE_KEY), '');
  });
});
