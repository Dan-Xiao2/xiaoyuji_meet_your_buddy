import test from "node:test";
import assert from "node:assert/strict";
import { selectGrowthPeriod, renderMemoryDashboard } from "../src/ui/memoryPanel.js";
const now = new Date(2026, 8, 9, 12);
const moment = (id, ago, extra = {}) => {
  const date = new Date(now); date.setDate(date.getDate() - ago);
  return { id, createdAt: date.toISOString(), topics: [id], domain: "science", childQuote: id, ...extra };
};
const records = [moment("today", 0), moment("edge", 6), moment("previous", 7), moment("month-edge", 29), moment("older", 30), moment("future", -1), moment("adult", 0, { speakerRole: "mother" }), moment("excluded", 0, { reviewEligible: false })];
test("periods use inclusive local dates and exclude family, hidden and future evidence", () => {
  assert.deepEqual(selectGrowthPeriod(records, {}, now).records.map(r => r.id), ["edge", "today"]);
  assert.equal(selectGrowthPeriod(records, { range: "month" }, now).records.length, 4);
  assert.equal(selectGrowthPeriod(records, { range: "all" }, now).records.length, 5);
  assert.deepEqual(selectGrowthPeriod(records, { offset: 1 }, now).records.map(r => r.id), ["previous"]);
});
test("every selected record belongs to exactly one chart bucket", () => {
  for (const range of ["week", "month", "all"]) {
    const p = selectGrowthPeriod(records, { range }, now);
    assert.equal(p.buckets.reduce((sum, b) => sum + b.records.length, 0), p.records.length);
    assert.equal(new Set(p.buckets.flatMap(b => b.records.map(r => r.id))).size, p.records.length);
  }
});
test("all-history does not silently drop months, and calendar windows span DST", () => {
  const long = Array.from({ length: 18 }, (_, i) => moment(String(i), i * 31));
  assert.equal(selectGrowthPeriod(long, { range: "all" }, now).records.length, 18);
  const dst = selectGrowthPeriod([], { range: "week" }, new Date(2026, 2, 31));
  assert.equal(dst.start.getDate(), 25);
  assert.equal(dst.buckets.length, 7);
});
test("the selected window scopes the visible summary and empty state too", () => {
  const container = { innerHTML: "" };
  const old = new Date(); old.setDate(old.getDate() - 70);
  renderMemoryDashboard(container, {}, { profile: { nickname: "安安" } }, null,
    [{ ...moment("old", 0), createdAt: old.toISOString(), topics: ["只有很久以前才聊过"] }], { range: "week" });
  assert.match(container.innerHTML, /这段时间还没有记录/);
  assert.doesNotMatch(container.innerHTML, /只有很久以前才聊过/);
  assert.match(container.innerHTML, /data-growth-range/);
});
