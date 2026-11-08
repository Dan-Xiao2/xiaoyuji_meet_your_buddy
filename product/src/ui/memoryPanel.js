import {
  buildLongitudinalReview,
  domainLabel
} from "../data/growthInsights.js";
import { familyRoleLabel } from "../data/familyModel.js";
import { mayArchiveMoment } from "../services/safety.js";

const xiaoyuPlanetUrl = new URL("../../assets/xiaoyu-planet.png", import.meta.url).href;

const domainGroups = {
  nature: { label: "自然", color: "#77a779", domains: ["science", "explore"] },
  expression: { label: "表达", color: "#ef9153", domains: ["language", "english"] },
  people: { label: "相处", color: "#df786d", domains: ["social"] },
  story: { label: "故事", color: "#8dbfd0", domains: ["story", "art"] },
  thinking: { label: "思考", color: "#e1bd54", domains: ["math"] }
};

// chatting: a chat is in progress, so the empty page offers to go back to it rather than start one.
export function renderMemoryDashboard(container, memory, studentModel, activeLesson, moments = [], selection = {}, { chatting = false } = {}) {
  const name = studentModel?.profile?.nickname || "孩子";
  const childMoments = moments.filter((item) => mayArchiveMoment(item) && isChildMoment(item) && item.reviewEligible !== false);
  if (!childMoments.length) {
    container.innerHTML = renderEmptyMemory(name, chatting);
    return;
  }

  const period = selectGrowthPeriod(childMoments, selection);
  const records = period.records;
  const review = buildLongitudinalReview(records);
  const stage = getGrowthStage(records);
  const starred = [...records].filter((item) => item.starred || item.saved).sort(sortNewest)[0];
  const bucket = period.buckets.find(item => item.key === selection.bucket);
  const visible = bucket ? bucket.records : records.slice(-3);

  container.innerHTML = `
    <header class="growth-app-header"><h1>${escapeHtml(name)}的成长</h1></header>
    ${renderSelectedRange(period)}
    ${records.length ? `
      ${renderDiscovery(name, stage, records)}
      ${renderSelectedChart(period, selection.bucket)}
      <section class="growth-moments" aria-labelledby="growthMomentsTitle">
        <h2 id="growthMomentsTitle">${bucket ? escapeHtml(bucket.label) : "最近的片段"}</h2>
        ${visible.length ? [...visible].reverse().map(item => `<article class="growth-brief">
          <time datetime="${dateKey(item.reviewDate)}">${shortDate(item.reviewDate)}</time>
          <div><strong>${escapeHtml(rankFriendlyTopics([item]).slice(0, 2).join("、") || friendlyDomain(item.domain))}</strong>
          <p>${escapeHtml(shortText(item.parentNote || item.evidence?.observation || "留下了一次交流", 90))}</p></div>
        </article>`).join("") : '<p>这段时间还没有记录</p>'}
      </section>
      ${renderChange(stage, review, records)}
      ${renderKeepsake(stage === "first" ? null : starred)}
    ` : '<section class="growth-chart-empty"><h2>这段时间还没有记录</h2><button class="text-button" type="button" data-memory-action="start-first">去和小宇聊聊</button></section>'}
    <div class="growth-secondary-actions">
      <button class="quiet-link" type="button" data-memory-action="open-backup">备份与完整记录</button>
    </div>
  `;
}

// Local calendar arithmetic preserves day boundaries across daylight-saving changes.
export function selectGrowthPeriod(moments, selection = {}, now = new Date()) {
  const range = ["week", "month", "all"].includes(selection.range) ? selection.range : "week";
  const days = range === "month" ? 30 : 7;
  const offset = Math.max(0, Math.trunc(Number(selection.offset) || 0));
  const all = normalizeRecords(moments.filter(item => isChildMoment(item) && item.reviewEligible !== false));
  const end = new Date(now); end.setHours(23, 59, 59, 999);
  if (range !== "all") end.setDate(end.getDate() - offset * days);
  const first = all.find(item => item.reviewDate <= end);
  const start = new Date(range === "all" && first ? first.reviewDate : end);
  start.setHours(0, 0, 0, 0);
  if (range !== "all") start.setDate(start.getDate() - days + 1);
  const records = all.filter(item => item.reviewDate >= start && item.reviewDate <= end);
  const buckets = [];
  if (range === "all") {
    const groups = new Map();
    records.forEach(item => {
      const key = dateKey(item.reviewDate).slice(0, 7);
      if (!groups.has(key)) groups.set(key, { key, label: key.replace("-", "/"), records: [] });
      groups.get(key).records.push(item);
    });
    buckets.push(...groups.values());
  } else {
    const step = range === "week" ? 1 : 6;
    for (let i = 0; i < days; i += step) {
      const from = new Date(start); from.setDate(from.getDate() + i);
      const to = new Date(from); to.setDate(to.getDate() + step - 1); to.setHours(23, 59, 59, 999);
      buckets.push({ key: dateKey(from), label: step === 1 ? shortDate(from) : `${shortDate(from)}–${shortDate(to)}`,
        records: records.filter(item => item.reviewDate >= from && item.reviewDate <= to) });
    }
  }
  return { range, offset, start, end, records, buckets };
}

function shortDate(date) { return `${date.getMonth() + 1}/${date.getDate()}`; }

function renderSelectedRange(period) {
  return `<div class="growth-range-bar">
    <div class="growth-segments" role="radiogroup" aria-label="选择成长记录时间范围">
      ${[["week", "7天"], ["month", "30天"], ["all", "全部"]].map(([value, label]) => `<label><input type="radio" name="growth-range" data-growth-range value="${value}" ${period.range === value ? "checked" : ""}><span>${label}</span></label>`).join("")}
    </div>
    <div class="growth-date-stepper">
      <button type="button" data-growth-step="previous" aria-label="上一时段" title="上一时段" ${period.range === "all" ? "disabled" : ""}><i data-lucide="chevron-left" aria-hidden="true"></i></button>
      <span>${period.start.getFullYear() !== period.end.getFullYear() ? period.start.getFullYear() + "/" : ""}${shortDate(period.start)} – ${shortDate(period.end)}</span>
      <button type="button" data-growth-step="next" aria-label="下一时段" title="下一时段" ${!period.offset || period.range === "all" ? "disabled" : ""}><i data-lucide="chevron-right" aria-hidden="true"></i></button>
    </div></div>`;
}

function renderSelectedChart(period, selectedBucket) {
  const max = Math.max(1, ...period.buckets.map(b => b.records.length));
  const days = new Set(period.records.map(item => dateKey(item.reviewDate))).size;
  return `<section class="growth-exploration" aria-labelledby="growthExplorationTitle">
    <div class="growth-simple-heading"><h2 id="growthExplorationTitle">探索过的日子</h2><small>${days}天 · ${period.records.length}个片段</small></div>
    <div class="growth-record-chart${period.range === "all" ? " is-months" : ""}" style="--columns:${period.buckets.length}">
      ${period.buckets.map(b => `<button type="button" data-growth-bucket="${b.key}" aria-label="${b.label}，${b.records.length}个片段" aria-pressed="${selectedBucket === b.key}">
        <span class="track"><span class="bar" style="--height:${b.records.length / max * 100}%"></span></span><span>${b.label.split("–")[0]}</span>
      </button>`).join("")}
    </div><p class="growth-record-legend"><i aria-hidden="true"></i>留下的片段</p>
  </section>`;
}

export function renderMemoryArchive(container, moments = [], profileName = "孩子") {
  moments = moments.filter(mayArchiveMoment);
  // No records: one quiet empty state, without a disabled toolbar or a "0 条珍藏" counter
  // (docs/ui-motion-guidelines.md: modules without data are hidden).
  if (!moments.length) {
    container.innerHTML = `
      <section class="conversation-archive is-empty" aria-labelledby="conversationArchiveTitle">
        <h2 id="conversationArchiveTitle" class="sr-only">${escapeHtml(profileName)}的完整记录</h2>
        <div class="moment-empty"><strong>还没有记录</strong><p>聊过之后，原话会保存在这台设备上。</p></div>
        <p class="moment-action-status" id="momentActionStatus" aria-live="polite"></p>
      </section>
    `;
    return;
  }
  container.innerHTML = `
    <section class="conversation-archive" aria-labelledby="conversationArchiveTitle">
      <div class="backup-summary">
        <div>
          <p class="eyebrow">保存在这台设备</p>
          <h2 id="conversationArchiveTitle">${escapeHtml(profileName)}的完整记录</h2>
          <p>共 ${moments.length} 条</p>
        </div>
        <span>${moments.filter((item) => item.starred || item.saved).length}<small>条珍藏</small></span>
      </div>
      ${renderArchiveToolbar(moments.length > 0)}
      <p class="moment-action-status" id="momentActionStatus" aria-live="polite"></p>
      <div class="conversation-moment-list">${renderArchiveRows(moments)}</div>
    </section>
  `;
}

function renderEmptyMemory(name, chatting = false) {
  return `
    <header class="growth-app-header">
      <h1>${escapeHtml(name)}的成长</h1>
    </header>
    <section class="memory-empty-state" aria-labelledby="memoryEmptyTitle">
      <img src="${xiaoyuPlanetUrl}" alt="" />
      <div>
        <h2 id="memoryEmptyTitle">还没有成长记录</h2>
        <p>从一次聊天开始</p>
        <button class="primary-button" type="button" data-memory-action="start-first">${chatting ? "回到聊天" : "开始聊天"}</button>
      </div>
    </section>
  `;
}

function renderDiscovery(name, stage, records) {
  const recent = records.slice(stage === "first" ? -3 : stage === "long" ? -Math.ceil(records.length / 3) : -8);
  const recentTopics = rankFriendlyTopics(recent);
  const earlierTopics = rankFriendlyTopics(records.slice(0, Math.max(1, Math.ceil(records.length / 3))));
  const topic = recentTopics[0] || friendlyDomain(recent.at(-1)?.domain);
  const secondTopic = recentTopics.find((item) => item !== topic);
  let message = `最近的记录里，${name}聊到了${topic}。`;

  if (stage === "weeks") {
    message = `最近的记录提到了${topic}${secondTopic ? `，也聊到了${secondTopic}` : ""}。`;
  }

  if (stage === "long") {
    const earlier = earlierTopics[0] || topic;
    message = earlier === topic
      ? `${topic}在不同时期的记录里都出现过。`
      : `早些的记录提到${earlier}，最近的记录提到${topic}。`;
  }

  return `
    <section class="growth-discovery-card" aria-labelledby="growthDiscoveryTitle">
      <div>
        <p>这一段的小发现</p>
        <h2 id="growthDiscoveryTitle">${escapeHtml(message)}</h2>
      </div>
    </section>
  `;
}

function renderChange(stage, review, records) {
  if (!review.beforeNow.ready) return "";
  const earlier = friendlyTopic(review.beforeNow.title.match(/^从(.+)，到/)?.[1] || rankFriendlyTopics(records.slice(0, 3))[0] || "新的发现");
  const recent = friendlyTopic(review.beforeNow.title.match(/，到(.+)$/)?.[1] || rankFriendlyTopics(records.slice(-3))[0] || earlier);

  if (stage === "long") {
    const steps = buildJourneySteps(review, records);
    return `
      <section class="growth-change" aria-labelledby="growthChangeTitle">
        <div class="growth-simple-heading"><div><p>话题回看</p><h2 id="growthChangeTitle">不同时期，聊过这些</h2></div></div>
        <div class="growth-journey-path">${steps.map((step, index) => `<div><small>${index === 0 ? "早些时候" : index === steps.length - 1 ? "最近" : "后来"}</small><strong>${escapeHtml(step)}</strong></div>`).join("")}</div>
      </section>
    `;
  }

  return `
    <section class="growth-change" aria-labelledby="growthChangeTitle">
      <div class="growth-simple-heading"><div><p>话题回看</p><h2 id="growthChangeTitle">${escapeHtml(earlier === recent ? `${recent}在两个时期都出现过` : `从${earlier}，到${recent}`)}</h2></div></div>
      <div class="growth-before-now"><div><small>刚开始</small><strong>${escapeHtml(earlier)}</strong></div><span aria-hidden="true"></span><div><small>最近</small><strong>${escapeHtml(recent)}</strong></div></div>
    </section>
  `;
}

function renderKeepsake(moment) {
  if (!moment?.childQuote) return "";
  return `
    <section class="growth-keepsake" aria-labelledby="growthKeepsakeTitle">
      <span aria-hidden="true">★</span>
      <div><p>珍藏瞬间 · <time>${escapeHtml(formatMomentDate(moment.observedAt || moment.createdAt))}</time></p><blockquote id="growthKeepsakeTitle">“${escapeHtml(shortText(moment.childQuote, 88))}”</blockquote></div>
    </section>
  `;
}

function renderArchiveToolbar(hasMoments) {
  return `
    <div class="moment-toolbar${hasMoments ? "" : " is-disabled"}">
      <label class="select-all-moments"><input type="checkbox" id="selectAllMoments" ${hasMoments ? "" : "disabled"} />全选</label>
      <label class="download-format">下载为<select id="momentDownloadFormat" ${hasMoments ? "" : "disabled"}><option value="text">阅读文本</option><option value="json">完整数据</option></select></label>
      <button class="text-button" type="button" data-memory-action="save-selected" ${hasMoments ? "" : "disabled"}>珍藏</button>
      <button class="primary-button" type="button" data-memory-action="download-selected" ${hasMoments ? "" : "disabled"}>下载</button>
    </div>
  `;
}

function renderArchiveRows(moments) {
  if (!moments.length) return '<div class="moment-empty"><strong>还没有记录</strong><p>开始聊天后，完整内容会保存在这里。</p></div>';
  return [...moments].sort(sortNewest).map(renderGrowthMoment).join("");
}

function renderGrowthMoment(moment) {
  const childQuote = moment.childQuote || moment.childText || "";
  const tutorResponse = moment.tutorResponse || moment.tutorText || "";
  const starred = Boolean(moment.starred || moment.saved);
  const isFamilyNote = !isChildMoment(moment);
  const speakerLabel = moment.speakerName || (isFamilyNote ? familyRoleLabel(moment.speakerRole) : "孩子");
  return `
    <article class="conversation-moment${isFamilyNote ? " is-family-note" : ""}" data-moment-id="${escapeHtml(moment.id)}">
      <label class="moment-checkbox"><input type="checkbox" class="moment-select" value="${escapeHtml(moment.id)}" /><span class="sr-only">选择${escapeHtml(shortText(childQuote, 20))}</span></label>
      <div class="moment-content">
        <div class="moment-meta"><time>${escapeHtml(formatMomentDate(moment.observedAt || moment.createdAt))}</time><span class="domain-label domain-${escapeHtml(moment.domain)}">${escapeHtml(domainLabel(moment.domain))}</span>${starred ? '<span class="saved-label">已珍藏</span>' : ""}</div>
        <strong class="child-question"><span>${escapeHtml(speakerLabel)}说</span>“${escapeHtml(shortText(childQuote, 120))}”</strong>
        <p><span>小宇</span>${escapeHtml(shortText(tutorResponse, 200))}</p>
        ${moment.parentNote ? `<p><span>家长备注</span>${escapeHtml(moment.parentNote)}</p>` : ""}
        ${moment.parentConfirmed ? '<small>家长已确认</small>' : ""}
        ${moment.parentEdited ? '<small> · 家长已整理</small>' : ""}
        ${moment.reviewEligible === false ? '<small> · 不计入成长回看</small>' : ""}
      </div>
      <div class="moment-row-actions"><button type="button" class="quiet-link" data-memory-action="toggle-save" data-moment-id="${escapeHtml(moment.id)}" aria-pressed="${starred}">${starred ? "取消珍藏" : "珍藏"}</button><button type="button" class="quiet-link" data-memory-action="download-one" data-moment-id="${escapeHtml(moment.id)}">下载</button><button type="button" class="quiet-link" data-memory-action="edit" data-moment-id="${escapeHtml(moment.id)}">整理</button></div>
    </article>
  `;
}

function getGrowthStage(records) {
  const distinctDays = new Set(records.map((item) => dateKey(item.reviewDate))).size;
  if (distinctDays <= 1) return "first";
  const spanDays = Math.floor((records.at(-1).reviewDate - records[0].reviewDate) / 86400000);
  return spanDays >= 28 && records.length >= 8 ? "long" : "weeks";
}

function normalizeRecords(moments) {
  return moments.filter((item) => mayArchiveMoment(item) && isValidDate(item.observedAt || item.createdAt)).map((item) => ({ ...item, reviewDate: new Date(item.observedAt || item.createdAt) })).sort((a, b) => a.reviewDate - b.reviewDate);
}

function buildJourneySteps(review, records) {
  const weekly = review.interestJourney.map((week) => friendlyTopic(week.topics[0]?.label)).filter(Boolean);
  const candidates = [...new Set(weekly)];
  if (candidates.length >= 3) return [candidates[0], candidates[Math.floor(candidates.length / 2)], candidates.at(-1)];
  return candidates.length ? candidates : rankFriendlyTopics(records).slice(0, 3);
}

function rankFriendlyTopics(records) {
  const counts = new Map();
  records.forEach((item) => {
    const topics = item.topics?.length ? item.topics : [friendlyDomain(item.domain)];
    topics.forEach((topic) => {
      const label = friendlyTopic(topic);
      if (label) counts.set(label, (counts.get(label) || 0) + 1);
    });
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN")).map(([label]) => label);
}

function friendlyTopic(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/社交|问候|确认|发起|交流|朋友/.test(text)) return "主动交流";
  if (/宠物|小猫|小狗|猫|狗|动物/.test(text)) return "小动物";
  if (/语言|表达/.test(text)) return "表达想法";
  if (/艺术|画画|绘画/.test(text)) return "画画和创造";
  if (/故事|想象/.test(text)) return "故事和想象";
  if (/现实探索/.test(text)) return "身边的发现";
  return text.length > 8 ? text.slice(0, 8) : text;
}

function friendlyDomain(domain) {
  return domainGroups[groupForDomain(domain)]?.label || "新的发现";
}

function groupForDomain(domain) {
  return Object.entries(domainGroups).find(([, item]) => item.domains.includes(domain))?.[0] || "expression";
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isChildMoment(item) {
  return item.sourceType !== "parent_note" && !["mother", "father", "grandparent", "caregiver", "other"].includes(item.speakerRole);
}

function sortNewest(a, b) {
  return new Date(b.observedAt || b.createdAt) - new Date(a.observedAt || a.createdAt);
}

function formatMomentDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未标注日期";
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function shortText(value, limit) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function isValidDate(value) {
  return !Number.isNaN(new Date(value).getTime());
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
