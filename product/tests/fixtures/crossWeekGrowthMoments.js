export function createCrossWeekGrowthMoments(now = new Date()) {
  const at = (daysAgo, hour = 18) => {
    const date = new Date(now);
    date.setDate(date.getDate() - daysAgo);
    date.setHours(hour, 20, 0, 0);
    return date.toISOString();
  };

  return [
    createMoment("week-6-dinosaur", at(40), "霸王龙为什么有那么大的牙？", "science", ["恐龙", "动物"]),
    createMoment("week-5-dinosaur", at(34), "小恐龙会不会也要找妈妈？", "story", ["恐龙", "动物", "妈妈"]),
    createMoment("week-4-leaf", at(26), "树叶上这条线是不是小虫走的路？", "science", ["树叶", "昆虫"]),
    createMoment("week-3-rain", at(19), "云里面装了多少雨？", "science", ["云", "雨"]),
    createMoment("week-2-moon", at(12), "月亮是不是跟着我们的车走？", "science", ["月亮"]),
    createMoment("week-2-shadow", at(9), "为什么我的影子晚上不见了？", "science", ["影子", "光"]),
    createMoment("week-1-moon", at(4), "月亮变成弯弯的，是不是太阳只照到一点点？", "science", ["月亮", "太阳"]),
    createMoment("today-shadow", at(0), "我把手放到灯前面，墙上就有一只大鸟。", "explore", ["影子", "光"], true)
  ];
}

function createMoment(id, observedAt, childQuote, domain, topics, starred = false) {
  return {
    schemaVersion: 3,
    id,
    studentId: "cross-week-test-student",
    sessionId: `session_${id}`,
    observedAt,
    createdAt: observedAt,
    childQuote,
    childText: childQuote,
    tutorResponse: "这是测试夹具中的简短回应。",
    tutorText: "这是测试夹具中的简短回应。",
    topics,
    domains: [domain],
    primaryDomain: domain,
    domain,
    lessonTitle: topics[0],
    boardSnapshot: null,
    sourceType: "child_utterance",
    sourceModel: "test_fixture",
    reviewEligible: true,
    evidence: {
      type: childQuote.includes("？") ? "question" : "observation",
      sourceQuote: childQuote,
      observation: "测试用可追溯原话。",
      childIntent: "表达或探索",
      inference: "",
      confidence: 1
    },
    confidence: 1,
    parentConfirmed: false,
    starred,
    saved: starred,
    status: "captured",
    updatedAt: observedAt
  };
}
