import test from "node:test";
import assert from "node:assert/strict";
import { createDurableSnapshot, recoverDurableSnapshot } from "../src/services/indexedArchive.js";
import { DB_KEY, STATE_KEY, REVISION_KEY } from "../src/services/localPersistence.js";
import { createInitialState } from "../src/data/studentModel.js";
import { normalizeLocalStudentDb } from "../src/data/localStudentDb.js";

function memoryStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
}

test("durable snapshot captures state and growth records together", () => {
  const storage = memoryStorage({ [STATE_KEY]: '{"session":1}', [DB_KEY]: '{"moments":2}' });
  const snapshot = createDurableSnapshot(storage);
  assert.equal(snapshot.state, '{"session":1}');
  assert.equal(snapshot.db, '{"moments":2}');
  assert.ok(snapshot.savedAt);
});

test("an empty cache restores one complete valid snapshot, never a cleared generation", () => {
  const state = createInitialState();
  const db = normalizeLocalStudentDb({ studentModels: {}, growthMoments: [] });
  const snapshot = { state: JSON.stringify(state), db: JSON.stringify(db), revision: null };
  const fresh = memoryStorage();
  assert.equal(recoverDurableSnapshot(fresh, snapshot), true);
  assert.deepEqual(JSON.parse(fresh.getItem(STATE_KEY)), state);
  assert.deepEqual(JSON.parse(fresh.getItem(DB_KEY)), db);
  const cleared = memoryStorage({ [REVISION_KEY]: 'after-clear' });
  assert.equal(recoverDurableSnapshot(cleared, snapshot), false);
  assert.equal(cleared.getItem(STATE_KEY), null);
  assert.equal(cleared.getItem(DB_KEY), null);
});

test("invalid durable envelopes cannot become the primary archive", () => {
  for (const raw of ['null', '[]', '{}', 'broken']) {
    const storage = memoryStorage();
    assert.equal(recoverDurableSnapshot(storage, { state: raw, db: raw }), false);
    assert.equal(storage.getItem(STATE_KEY), null);
    assert.equal(storage.getItem(DB_KEY), null);
  }
});

test("recovery never mixes a snapshot with newer local data or overwrites damaged originals", () => {
  const storage = memoryStorage({ [STATE_KEY]: "broken", [DB_KEY]: '{"newer":true}' });
  assert.equal(recoverDurableSnapshot(storage, { state: '{"safe":true}', db: '{"older":true}' }), false);
  assert.equal(storage.getItem(STATE_KEY), 'broken');
  assert.equal(storage.getItem(DB_KEY), '{"newer":true}');
});
