export const growthDomains = {
  story: { label: "故事想象", color: "#ef755f" },
  science: { label: "自然科学", color: "#4e9a6a" },
  math: { label: "数感思维", color: "#4d8bd6" },
  language: { label: "语言表达", color: "#8a6cc4" },
  english: { label: "英语启蒙", color: "#e7a93f" },
  explore: { label: "现实探索", color: "#49a5a1" },
  art: { label: "艺术创造", color: "#d56d95" },
  social: { label: "社会情绪", color: "#e18b58" }
};

export function buildGrowthInsights(moments = [], offlineObservations = [], now = new Date()) {
  const records = [
    ...moments.filter((item) => item.reviewEligible !== false).map((item) => ({ domain: normalizeDomain(item.domain), createdAt: item.observedAt || item.createdAt })),
    ...offlineObservations.map((item) => ({ domain: domainFromOfflineObservation(item), createdAt: item.createdAt }))
  ].filter((item) => isValidDate(item.createdAt));

  const recentDays = buildRecentDays(now, 7);
  const recentKeys = new Set(recentDays.map((day) => day.key));
  const hasRecentRecords = records.some((record) => recentKeys.has(dateKey(new Date(record.createdAt))));
  const days = hasRecentRecords || !records.length ? recentDays : buildAvailableDays(records, 7);
  const dayMap = new Map(days.map((day) => [day.key, day]));
  const domainTotals = {};

  records.forEach((record) => {
    const key = dateKey(new Date(record.createdAt));
    const day = dayMap.get(key);
    if (!day) return;
    day.domains[record.domain] = (day.domains[record.domain] || 0) + 1;
    day.total += 1;
    domainTotals[record.domain] = (domainTotals[record.domain] || 0) + 1;
  });

  const activeDays = days.filter((day) => day.total > 0).length;
  const visibleDomains = Object.entries(domainTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({ key, count, ...growthDomains[key] }));
  const leadingDomain = visibleDomains[0] || null;

  return {
    days,
    activeDays,
    totalExplorations: records.filter((record) => dayMap.has(dateKey(new Date(record.createdAt)))).length,
    leadingDomain,
    visibleDomains,
    mode: activeDays >= 4 ? "week" : activeDays >= 2 ? "available" : activeDays === 1 ? "first_day" : "empty",
    periodLabel: hasRecentRecords || !records.length ? "最近 7 天" : "最近有记录的日期",
    maxDailyTotal: Math.max(1, ...days.map((day) => day.total))
  };
}

export function buildLongitudinalReview(moments = [], now = new Date()) {
  const records = moments
    .filter((item) => item?.reviewEligible !== false && isValidDate(item.observedAt || item.createdAt))
    .map((item) => ({ ...item, reviewDate: new Date(item.observedAt || item.createdAt) }))
    .sort((a, b) => a.reviewDate - b.reviewDate);

  return {
    week: summarizePeriod(records, now, 7, "本周"),
    month: summarizePeriod(records, now, 30, "本月"),
    interestJourney: buildInterestJourney(records),
    beforeNow: buildBeforeNow(records),
    totalMoments: records.length
  };
}

function summarizePeriod(records, now, days, label) {
  const end = new Date(now);
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);
  const periodRecords = records.filter((item) => item.reviewDate >= start && item.reviewDate <= end);
  const topics = rankTopics(periodRecords).slice(0, 4);
  const activeDays = new Set(periodRecords.map((item) => dateKey(item.reviewDate))).size;
  const standout = chooseStandout(periodRecords);

  return {
    label,
    count: periodRecords.length,
    activeDays,
    topics,
    headline: periodRecords.length
      ? topics.length
        ? `${label}常常聊到${topics.map((item) => item.label).join("、")}`
        : `${label}留下了 ${periodRecords.length} 个成长片段`
      : `${label}还没有新的成长片段`,
    detail: periodRecords.length
      ? `${activeDays} 天有记录，所有总结都可以回到孩子原话。`
      : "有真实互动后再生成回看，不用模板补齐。",
    standoutQuote: standout?.childQuote || "",
    standoutId: standout?.id || "",
    evidenceIds: periodRecords.map((item) => item.id)
  };
}

function buildInterestJourney(records) {
  const groups = new Map();
  records.forEach((item) => {
    const key = weekKey(item.reviewDate);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });

  return [...groups.entries()]
    .slice(-8)
    .map(([key, items]) => ({
      key,
      label: formatWeekLabel(key),
      topics: rankTopics(items).slice(0, 3),
      evidenceIds: items.map((item) => item.id)
    }));
}

function buildBeforeNow(records) {
  if (records.length < 4) {
    return {
      ready: false,
      title: "还需要多一点时间",
      detail: "至少积累 4 个跨时间的真实片段后，再生成“以前与现在”。"
    };
  }

  const spanDays = Math.floor((records.at(-1).reviewDate - records[0].reviewDate) / 86400000);
  if (spanDays < 7) {
    return {
      ready: false,
      title: "先继续记录一周",
      detail: "现在的记录还集中在几天内，暂时不能把短期重复说成成长变化。"
    };
  }

  const groupSize = Math.max(2, Math.floor(records.length * 0.4));
  const earlier = records.slice(0, groupSize);
  const recent = records.slice(-groupSize);
  const earlierTopic = rankTopics(earlier)[0]?.label || "当时关心的事";
  const recentTopic = rankTopics(recent)[0]?.label || "最近关心的事";
  const earlierMoment = chooseTopicMoment(earlier, earlierTopic) || chooseStandout(earlier);
  const recentMoment = chooseTopicMoment(recent, recentTopic) || chooseStandout(recent);
  const changed = earlierTopic !== recentTopic;

  return {
    ready: true,
    title: changed ? `从${earlierTopic}，到${recentTopic}` : `${earlierTopic}一直在孩子的问题里出现`,
    detail: changed
      ? "这是两个时间段里出现次数较多的主题变化，不代表固定兴趣。"
      : "同一个主题在不同时间重复出现，可以一起回看孩子当时怎么说。",
    earlier: {
      label: "以前",
      date: earlierMoment?.reviewDate?.toISOString() || "",
      quote: earlierMoment?.childQuote || "",
      momentId: earlierMoment?.id || ""
    },
    recent: {
      label: "现在",
      date: recentMoment?.reviewDate?.toISOString() || "",
      quote: recentMoment?.childQuote || "",
      momentId: recentMoment?.id || ""
    }
  };
}

function rankTopics(records) {
  const counts = new Map();
  records.forEach((item) => {
    (item.topics || []).forEach((topic) => {
      if (!topic) return;
      const current = counts.get(topic) || { label: topic, count: 0, evidenceIds: [] };
      current.count += 1;
      current.evidenceIds.push(item.id);
      counts.set(topic, current);
    });
  });
  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "zh-CN"));
}

function chooseStandout(records) {
  return [...records]
    .filter((item) => item.childQuote)
    .sort((a, b) => Number(Boolean(b.starred)) - Number(Boolean(a.starred)) || b.childQuote.length - a.childQuote.length)[0];
}

function chooseTopicMoment(records, topic) {
  return [...records]
    .filter((item) => item.childQuote && (item.topics || []).includes(topic))
    .sort((a, b) => b.childQuote.length - a.childQuote.length)[0];
}

function weekKey(date) {
  const value = new Date(date);
  value.setHours(12, 0, 0, 0);
  const day = (value.getDay() + 6) % 7;
  value.setDate(value.getDate() - day);
  return dateKey(value);
}

function formatWeekLabel(key) {
  const date = new Date(`${key}T12:00:00`);
  return `${date.getMonth() + 1}/${date.getDate()}起`;
}

export function domainLabel(domain) {
  return growthDomains[normalizeDomain(domain)].label;
}

function buildRecentDays(now, length) {
  const end = new Date(now);
  end.setHours(12, 0, 0, 0);

  return Array.from({ length }, (_, index) => {
    const date = new Date(end);
    date.setDate(end.getDate() - (length - index - 1));
    return {
      key: dateKey(date),
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      weekday: "日一二三四五六"[date.getDay()],
      isToday: index === length - 1,
      domains: {},
      total: 0
    };
  });
}

function buildAvailableDays(records, length) {
  const uniqueKeys = [
    ...new Set(
      records
        .map((record) => dateKey(new Date(record.createdAt)))
        .sort((a, b) => b.localeCompare(a))
    )
  ]
    .slice(0, length)
    .sort();

  return uniqueKeys.map((key, index) => {
    const date = new Date(`${key}T12:00:00`);
    return {
      key,
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      weekday: "日一二三四五六"[date.getDay()],
      isToday: index === uniqueKeys.length - 1,
      domains: {},
      total: 0
    };
  });
}

function domainFromOfflineObservation(item) {
  const skill = String(item?.skill || "");
  if (skill.startsWith("math") || skill.startsWith("algebra")) return "math";
  if (skill.startsWith("language")) return "language";
  return "explore";
}

function normalizeDomain(value) {
  return growthDomains[value] ? value : "language";
}

function isValidDate(value) {
  return !Number.isNaN(new Date(value).getTime());
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
