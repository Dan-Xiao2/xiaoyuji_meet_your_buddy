import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplicationPersistence } from '../src/app/applicationPersistence.js';

const state = { studentModel: { studentId: 'test' }, session: { id: 'session', startedAt: 'start', endedAt: 'end', turnCount: 2 }, family: { activeSpeakerId: 'child' }, lastSessionSummary: { momentIds: ['moment'] } };
const names = ['saveState', 'persistStudentModel', 'recordGrowthMoment', 'appendStudentEvent', 'startStudentSession', 'finishStudentSession', 'setGrowthMomentsStarred'];
function setup(failedAt) {
  const calls = [], failures = [];
  const moment = { id: 'saved-moment', revision: 1 };
  const writes = Object.fromEntries(names.map(name => [name, (...args) => {
    calls.push({ name, args });
    if (name === failedAt) throw new Error('synthetic write failure');
    return name === 'recordGrowthMoment' ? moment : undefined;
  }]));
  return { persistence: createApplicationPersistence({ writes, onFailure: result => failures.push(result) }), calls, failures, moment };
}

test('snapshot success belongs only to the exact submitted snapshot', () => {
  const { persistence } = setup();
  assert.equal(persistence.isSnapshotSaved(state), false);
  assert.equal(persistence.saveSnapshot(state).ok, true);
  assert.equal(persistence.isSnapshotSaved(state), true);
  assert.equal(persistence.isSnapshotSaved({ ...state }), false);
});

test('primary failure is reported and cannot be masked by a later snapshot success', () => {
  const { persistence, failures } = setup('persistStudentModel');
  assert.equal(persistence.saveProfile(state).ok, false);
  assert.equal(persistence.saveSnapshot(state).ok, true);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].operation, 'profile');
  assert.equal(failures[0].failedAt, 'persistStudentModel');
});

for (const failedAt of ['recordGrowthMoment', 'persistStudentModel', 'appendStudentEvent']) {
  test(`turn retains partial-write evidence when ${failedAt} fails, without automatic retry`, () => {
    const { persistence, calls, moment, failures } = setup(failedAt);
    const result = persistence.saveTurn(state, { moment: { childQuote: 'test quote' }, events: [['test', 'one'], ['test', 'two']] });
    assert.equal(result.ok, false);
    assert.equal(result.failedAt, failedAt);
    assert.equal(result.moment, failedAt === 'recordGrowthMoment' ? null : moment);
    assert.equal(calls.at(-1).name, failedAt);
    assert.equal(calls.filter(call => call.name === failedAt).length, 1);
    assert.equal(failures.length, 1);
    assert.deepEqual(result.completed, calls.slice(0, -1).map(call => call.name));
  });
}

test('no accepted moment means model-only enrichment never creates a replacement', () => {
  const { persistence, calls } = setup();
  assert.equal(persistence.saveTurn(state).ok, true);
  assert.deepEqual(calls.map(call => call.name), ['persistStudentModel']);
});

test('rejected moment is not replaced or retried', () => {
  let attempts = 0;
  const persistence = createApplicationPersistence({ writes: {
    recordGrowthMoment() { attempts++; return null; }, persistStudentModel() {}
  } });
  const result = persistence.saveTurn(state, { moment: { updateId: 'deleted' } });
  assert.equal(result.moment, null);
  assert.equal(attempts, 1);
});

for (const [method, args, failure] of [
  ['saveSnapshot', [state], 'saveState'],
  ['startSession', [state], 'startStudentSession'],
  ['finishSession', [state], 'finishStudentSession'],
  ['saveObservation', [state, 'task', { notes: 'test' }], 'appendStudentEvent'],
  ['starMoments', [['moment'], true], 'setGrowthMomentsStarred']
]) {
  test(`${method} returns a failure instead of throwing through the UI handler`, () => {
    const { persistence, failures } = setup(failure);
    const result = persistence[method](...args);
    assert.equal(result.ok, false);
    assert.equal(result.failedAt, failure);
    assert.equal(failures.length, 1);
  });
}

test("with saving switched off the family can chat, but nothing new enters the growth archive", () => {
  const { persistence, calls } = setup();
  const off = { ...state, profile: { consent: false } };
  assert.equal(persistence.saveTurn(off, { moment: { childQuote: "test quote" }, events: [["test", "one"]] }).ok, true);
  assert.equal(persistence.saveObservation(off, "task", { completion: "completed" }).ok, true);
  assert.equal(persistence.finishSession(off).ok, true);
  assert.equal(persistence.startSession(off).ok, true);
  assert.deepEqual(calls.map(call => call.name), ["persistStudentModel"], "only the profile itself is saved");
  persistence.saveTurn({ ...state, profile: { consent: true } }, { moment: { childQuote: "test quote" }, events: [] });
  assert.ok(calls.some(call => call.name === "recordGrowthMoment"), "switched on, moments are saved again");
});
