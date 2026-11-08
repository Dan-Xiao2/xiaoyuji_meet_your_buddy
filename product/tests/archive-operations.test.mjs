import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArchiveBackup, changeArchiveMoment } from '../src/data/archiveOperations.js';
import { createInitialStudentModel } from '../src/student/studentSchema.js';
import { normalizeLocalStudentDb, recordGrowthMoment, clearLocalStudentDb, loadLocalStudentDb, saveLocalStudentDb, setGrowthMomentsStarred } from '../src/data/localStudentDb.js';
import { createLocalArchiveExport } from '../src/services/storage.js';
import { commitArchivePair, replaceArchivePairForRecovery, recoverArchiveTransaction, assertArchiveRevision, STATE_KEY, DB_KEY, REVISION_KEY } from '../src/services/localPersistence.js';
import { buildLongitudinalReview } from '../src/data/growthInsights.js';
import { renderMemoryArchive, renderMemoryDashboard } from '../src/ui/memoryPanel.js';

export function fixture() {
  const profile = { name: '测试孩子', ageBand: '4-5', interest: '', goal: '', consent: true, configured: true };
  const studentModel = createInitialStudentModel(profile, 'test-child');
  const state = { profile, studentModel, family: {members: []}, session: { status: 'idle' } };
  const date = new Date().toISOString();
  const db = normalizeLocalStudentDb({ studentModels: { 'test-child': studentModel }, sessions: [], events: [], growthMoments: [
    { id: 'one', studentId: 'test-child', childQuote: '我想去公园', tutorResponse: '一起看看吧', topics: ['公园'], domain: 'explore', createdAt: date, observedAt: date },
    { id: 'two', studentId: 'test-child', childQuote: '我喜欢画画', tutorResponse: '想画什么呢', topics: ['画画'], domain: 'art', createdAt: date, observedAt: date }
  ] });
  return { state, db };
}
function encode(pair) { return JSON.stringify(createLocalArchiveExport(pair.state, pair.db)); }
class Storage {
  values = new Map(); count = 0; failAt = 0;
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { if (++this.count === this.failAt) throw new Error('quota'); this.values.set(key, value); }
  removeItem(key) { this.values.delete(key); }
}

test('full export restores records and family but never resumes a microphone session', () => {
  const original = fixture(); original.state.session.status = 'active';
  const result = parseArchiveBackup(encode(original));
  assert.deepEqual(result.db.growthMoments, original.db.growthMoments);
  assert.equal(result.state.session.status, 'idle');
  assert.deepEqual(result.state.messages, []);
  assert.equal(result.state.studentModel.studentId, 'test-child');
});
test('rejects malformed, partial, unsupported and prototype-bearing files', () => {
  for (const text of ['no json', '{}', '{"records":[]}', '{"__proto__":{}}']) assert.throws(() => parseArchiveBackup(text));
  for (const mutate of [
    v => v.schemaVersion = 99,
    v => v.state.profile.ageBand = '0-1',
    v => v.localArchive.growthMoments.push(v.localArchive.growthMoments[0]),
    v => v.localArchive.growthMoments[0].studentId = 'other',
    v => v.localArchive.growthMoments[0].createdAt = 'bad date',
    v => v.localArchive.growthMoments[0].topics = {},
    v => v.state.studentModel.engagement.offlineObservations = {},
    v => v.state.studentModel.profile.interests = [null],
    v => v.state.studentModel.skills['language.full_sentence'] = null
  ]) {
    const value = JSON.parse(encode(fixture())); mutate(value);
    assert.throws(() => parseArchiveBackup(JSON.stringify(value)));
  }
});
test('correction clears unsupported cached conclusions but keeps other original records', () => {
  const {state, db} = fixture();
  state.messages = [{ content: 'stale conclusion' }];
  state.studentModel.engagement.recentWins = ['stale conclusion'];
  db.events.push({ id: 'event', studentId: 'test-child', text: 'stale conclusion' });
  const next = changeArchiveMoment(state, db, 'one', { childQuote: '我想去画画', topics: ['画画'], parentConfirmed: true });
  assert.equal(next.db.growthMoments[0].childQuote, '我想去画画');
  assert.equal(next.db.growthMoments[0].evidence.sourceQuote, '我想去画画');
  assert.equal(next.db.growthMoments[0].parentConfirmed, true);
  assert.equal(next.db.growthMoments[1].childQuote, '我喜欢画画');
  assert.ok(!JSON.stringify(next).includes('stale conclusion'));
  assert.equal(state.messages[0].content, 'stale conclusion');
});
test('note-only edits preserve student model, while exclusion updates reviews', () => {
  const pair = fixture();
  const noted = changeArchiveMoment(pair.state, pair.db, 'one', { parentNote: '家长补充', parentConfirmed: true });
  assert.deepEqual(noted.state, pair.state);
  assert.equal(noted.db.growthMoments[0].parentNote, '家长补充');
  assert.equal(noted.db.growthMoments[0].revision, pair.db.growthMoments[0].revision + 1);
  const excluded = changeArchiveMoment(noted.state, noted.db, 'one', { reviewEligible: false });
  assert.equal(excluded.db.growthMoments.length, 2);
  assert.equal(buildLongitudinalReview(excluded.db.growthMoments).totalMoments, 1);
  const again = changeArchiveMoment(excluded.state, excluded.db, 'one', { parentNote: '仍不计入' });
  assert.equal(again.db.growthMoments[0].reviewEligible, false);
});

test('legacy revisions default to one and corrected revisions survive backup restore', () => {
  const pair = fixture();
  assert.equal(pair.db.growthMoments[0].revision, 1);
  const next = changeArchiveMoment(pair.state, pair.db, 'one', { parentNote: '补充' });
  assert.equal(parseArchiveBackup(encode(next)).db.growthMoments[0].revision, 2);
});

test('enrichment requires the saved revision and session; repeated commits do not write', () => {
  clearLocalStudentDb();
  const input = { studentId: 'test-child', sessionId: 'session-one', childQuote: '我想去公园', tutorResponse: '一起看看吧' };
  const first = recordGrowthMoment(input);
  const update = { ...input, updateId: first.id, expectedRevision: first.revision, topics: ['公园'] };
  for (const bad of [{ expectedRevision: undefined }, { sessionId: 'other' }, { studentId: 'other' }]) {
    recordGrowthMoment({ ...update, ...bad });
    assert.deepEqual(loadLocalStudentDb().growthMoments, [first]);
  }
  const second = recordGrowthMoment(update);
  assert.equal(second.revision, 2);
  assert.equal(recordGrowthMoment({ ...update, topics: ['过期'] }), null);
  assert.deepEqual(loadLocalStudentDb().growthMoments, [second]);
});

test('star toggles reject old enrichment even when the final starred value is unchanged', () => {
  clearLocalStudentDb();
  const input = { studentId: 'test-child', childQuote: '我喜欢画画', tutorResponse: '一起画吧' };
  const first = recordGrowthMoment(input);
  setGrowthMomentsStarred([first.id], true);
  setGrowthMomentsStarred([first.id], false);
  const before = loadLocalStudentDb();
  assert.equal(before.growthMoments[0].revision, 3);
  assert.equal(before.growthMoments[0].starred, first.starred);
  recordGrowthMoment({ ...input, updateId: first.id, expectedRevision: first.revision, topics: ['过期'] });
  assert.deepEqual(loadLocalStudentDb(), before);
});

test('parent corrections and deletion remain authoritative even with a current revision', () => {
  clearLocalStudentDb();
  const pair = fixture();
  const corrected = changeArchiveMoment(pair.state, pair.db, 'one', { childQuote: '我想去画画' });
  saveLocalStudentDb(corrected.db);
  const input = { studentId: 'test-child', updateId: 'one', expectedRevision: 2, childQuote: '旧原话', tutorResponse: '旧回复' };
  recordGrowthMoment(input);
  assert.deepEqual(loadLocalStudentDb(), corrected.db);
  const deleted = changeArchiveMoment(corrected.state, corrected.db, 'one', {}, true);
  saveLocalStudentDb(deleted.db);
  recordGrowthMoment(input);
  assert.deepEqual(loadLocalStudentDb(), deleted.db);
});
test('delete is child-scoped; active chats and invalid edits are rejected', () => {
  const {state, db} = fixture();
  db.growthMoments.push({ ...db.growthMoments[0], studentId: 'other' });
  const next = changeArchiveMoment(state, db, 'one', {}, true);
  assert.equal(next.db.growthMoments.length, 2);
  assert.equal(next.db.growthMoments.find(m => m.id === 'one').studentId, 'other');
  assert.throws(() => changeArchiveMoment(state, db, 'one', {childQuote: ''}));
  state.session.status = 'active';
  assert.throws(() => changeArchiveMoment(state, db, 'one', {}, true));
});
test('archives no longer silently discard records after 500 entries or sessions after 200', () => {
  const {state, db} = fixture();
  db.growthMoments = Array.from({ length: 550 }, (_, i) => ({...db.growthMoments[0], id: `m-${i}`}));
  db.sessions = Array.from({ length: 250 }, (_, i) => ({id:`s-${i}`,studentId:'test-child',startedAt:new Date().toISOString()}));
  const next = parseArchiveBackup(encode({state,db}));
  assert.equal(next.db.growthMoments.length, 550);
  assert.equal(next.db.sessions.length, 250);
});
test('saving pair commits both stores and removes legacy fallbacks', () => {
  const s = new Storage(); s.setItem('momo-learning-mvp-state', 'old');
  const pair = fixture(); commitArchivePair(s, pair.state, pair.db);
  assert.deepEqual(JSON.parse(s.getItem(STATE_KEY)), pair.state);
  assert.deepEqual(JSON.parse(s.getItem(DB_KEY)), pair.db);
  assert.equal(s.getItem('momo-learning-mvp-state'), null);
});
test('failed writes preserve old pair at journal, database and state stages', () => {
  for (const offset of [1,2,3,4]) {
    const s = new Storage(); s.setItem(STATE_KEY, 'old-state'); s.setItem(DB_KEY, 'old-db');
    s.failAt = s.count + offset;
    assert.throws(() => commitArchivePair(s, {}, {}));
    assert.equal(s.getItem(STATE_KEY), 'old-state');
    assert.equal(s.getItem(DB_KEY), 'old-db');
  }
});
test('restore or clear invalidates stale writers even before a storage event is delivered', () => {
  const a = new Storage();
  const b = { getItem: key => a.getItem(key), setItem: (key, value) => a.setItem(key, value), removeItem: key => a.removeItem(key) };
  assertArchiveRevision(a); assertArchiveRevision(b);
  const pair = fixture(); commitArchivePair(a, pair.state, pair.db);
  assert.doesNotThrow(() => assertArchiveRevision(a));
  assert.throws(() => assertArchiveRevision(b), /变化/);
  assert.throws(() => commitArchivePair(b, {}, {}), /变化/);
  const revision = a.getItem(REVISION_KEY);
  commitArchivePair(a, null, null);
  assert.equal(a.getItem(STATE_KEY), null);
  assert.equal(a.getItem(DB_KEY), null);
  assert.notEqual(a.getItem(REVISION_KEY), revision);
});
test('an invalid transaction journal never erases stored data', () => {
  for (const journal of ['', 'broken', 'null', '[]', '{}', '{"unrelated":"value"}']) {
    const s = new Storage();
    s.setItem(STATE_KEY, 'original-state'); s.setItem(DB_KEY, 'original-db');
    s.setItem('xiaoyuji-archive-transaction-v1', journal);
    assert.throws(() => recoverArchiveTransaction(s));
    assert.equal(s.getItem(STATE_KEY), 'original-state');
    assert.equal(s.getItem(DB_KEY), 'original-db');
  }
});
test('explicit recovery replaces a damaged journal; failed replacement retains every original key', () => {
  const journalKey = 'xiaoyuji-archive-transaction-v1';
  for (const rawJournal of ['', 'broken', '{}']) {
    for (const failOffset of [0, 1, 2, 3, 4]) {
      const s = new Storage();
      s.setItem(STATE_KEY, 'original-state'); s.setItem(DB_KEY, 'original-db');
      s.setItem('momo-learning-mvp-state', 'legacy');
      s.setItem(REVISION_KEY, 'original-revision'); s.setItem(journalKey, rawJournal);
      const before = new Map(s.values);
      const pair = fixture();
      if (failOffset) {
        s.failAt = s.count + failOffset;
        assert.throws(() => replaceArchivePairForRecovery(s, pair.state, pair.db));
        assert.deepEqual(s.values, before);
      } else {
        replaceArchivePairForRecovery(s, pair.state, pair.db);
        assert.deepEqual(JSON.parse(s.getItem(STATE_KEY)), pair.state);
        assert.deepEqual(JSON.parse(s.getItem(DB_KEY)), pair.db);
        assert.equal(s.getItem(journalKey), null);
        assert.equal(s.getItem('momo-learning-mvp-state'), null);
        assert.notEqual(s.getItem(REVISION_KEY), 'original-revision');
      }
    }
  }
});
test('interrupted explicit recovery restores the damaged journal as well as the old pair', () => {
  const s = new Storage();
  const journalKey = 'xiaoyuji-archive-transaction-v1';
  s.setItem(journalKey, JSON.stringify({ [STATE_KEY]: 'old-state', [DB_KEY]: 'old-db', [journalKey]: 'broken' }));
  s.setItem(DB_KEY, 'partial'); recoverArchiveTransaction(s);
  assert.equal(s.getItem(STATE_KEY), 'old-state');
  assert.equal(s.getItem(DB_KEY), 'old-db');
  assert.equal(s.getItem(journalKey), 'broken');
  assert.throws(() => recoverArchiveTransaction(s));
  assert.equal(s.getItem(DB_KEY), 'old-db');
});
test('interrupted transaction restores prior values', () => {
  const s = new Storage();
  s.setItem('xiaoyuji-archive-transaction-v1', JSON.stringify({[STATE_KEY]:'old-state',[DB_KEY]:'old-db'}));
  s.setItem(DB_KEY,'partial'); recoverArchiveTransaction(s);
  assert.equal(s.getItem(DB_KEY),'old-db'); assert.equal(s.getItem(STATE_KEY),'old-state');
});
test('archive escapes user text and excluded moments disappear from the growth page', () => {
  const {state,db} = fixture(); const container = {innerHTML:''};
  db.growthMoments[0].parentNote = '<img src=x onerror=alert(1)>';
  renderMemoryArchive(container, db.growthMoments, '<script>');
  assert.ok(!container.innerHTML.includes('<img src=x'));
  assert.ok(container.innerHTML.includes('&lt;script&gt;'));
  for (const moment of db.growthMoments) moment.reviewEligible = false;
  renderMemoryDashboard(container, {}, state.studentModel, null, db.growthMoments);
  assert.ok(container.innerHTML.includes('还没有成长记录'));
  assert.ok(!container.innerHTML.includes('公园'));
  assert.ok(container.innerHTML.includes('>开始聊天<'));
  renderMemoryDashboard(container, {}, state.studentModel, null, db.growthMoments, {}, { chatting: true });
  assert.ok(container.innerHTML.includes('>回到聊天<'), 'during a chat the empty page offers to go back to it');
});
