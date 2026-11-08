import { readFile } from "node:fs/promises";
import { createTutorTurn } from "../src/services/tutorEngine.js";
import { createInitialState } from "../src/data/studentModel.js";
import { applyOfflineObservation } from "../src/student/offlineObservationUpdater.js";
import {
  clearLocalStudentDb,
  finishStudentSession,
  getStudentGrowthMoments,
  getStudentSessions,
  loadLocalStudentDb,
  recordGrowthMoment,
  saveLocalStudentDb,
  startStudentSession,
  setGrowthMomentsStarred
} from "../src/data/localStudentDb.js";
import { buildGrowthInsights, buildLongitudinalReview } from "../src/data/growthInsights.js";
import { createLocalArchiveExport } from "../src/services/storage.js";
import { createActiveSession, endActiveSession, getSessionTimeState, incrementSessionTurn } from "../src/session/sessionManager.js";
import { createInitialStudentModel, migrateStudentModel } from "../src/student/studentSchema.js";
import { normalizeGrowthEvidence, validateTutorOutput } from "./qwenTutor.mjs";
import { deriveDashScopeServiceUrl } from "./qwenSpeech.mjs";
import { selectKnowledgeCards } from "./knowledgeCardSelector.mjs";
import { createCrossWeekGrowthMoments } from "../tests/fixtures/crossWeekGrowthMoments.js";
import { renderMemoryArchive, renderMemoryDashboard } from "../src/ui/memoryPanel.js";
import { renderAdultSummary, renderParentTimeline } from "../src/ui/summary.js";
import { renderOfflineTask } from "../src/ui/offlineTask.js";
import { adaptTutorReply, getAgeInstruction } from "../src/content/ageAdaptation.js";
import { createVoiceUiState, getVoiceStageLayout, shouldFinishVoiceOnRelease } from "../src/ui/voiceState.js";
import { hashParentPin, normalizeParentPin, verifyParentPin } from "../src/services/parentAccess.js";
import { createVoiceActivityDetector } from "../src/services/voiceActivity.js";
import { APP_NAV_ITEMS, createNavigationMarkup } from "../src/ui/appNavigation.js";
import {
  MAX_CAREGIVERS,
  MAX_FAMILY_MEMBERS,
  addFamilyMember,
  createInitialFamily,
  ensureFamilyState,
  getActiveSpeaker,
  removeFamilyMember,
  setActiveSpeaker
} from "../src/data/familyModel.js";

const requiredFiles = [
  "index.html",
  "src/app.js",
  "src/services/tutorEngine.js",
  "src/ui/whiteboard.js",
  "src/ui/memoryPanel.js",
  "src/ui/parentNote.js",
  "src/data/growthInsights.js",
  "src/data/localStudentDb.js",
  "src/session/sessionManager.js",
  "src/data/familyModel.js",
  "src/whiteboard/whiteboardCommands.js",
  "src/styles/base.css",
  "server/server.mjs",
  "server/qwenSpeech.mjs",
  "docs/github-repo-incorporation-plan.md",
  "docs/realtime-voice-plan.md",
  "docs/whiteboard-command-schema.md",
  "docs/preschool-content-strategy.md",
  "docs/ui-motion-guidelines.md",
  "docs/knowledge-runtime.md",
  "src/content/preschoolContentFramework.js",
  "src/content/ageAdaptation.js",
  "src/ui/voiceState.js",
  "src/ui/appNavigation.js",
  "src/services/parentAccess.js",
  "tests/voice-stage-fixture.html",
  "tests/growth-dashboard-fixture.html",
  "tests/fixtures/crossWeekGrowthMoments.js"
];

for (const file of requiredFiles) {
  await readFile(new URL(`../${file}`, import.meta.url), "utf8");
}

if (
  deriveDashScopeServiceUrl(
    "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
    "/api/v1/services/audio/tts/SpeechSynthesizer"
  ) !== "https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer"
) {
  throw new Error("Expected Qwen speech endpoints to reuse the configured workspace domain");
}

const indexMarkup = await readFile(new URL("../index.html", import.meta.url), "utf8");
const componentStyles = await readFile(new URL("../src/styles/components.css", import.meta.url), "utf8");
const responsiveStyles = await readFile(new URL("../src/styles/responsive.css", import.meta.url), "utf8");
const desktopNavigationMarkup = createNavigationMarkup("desktop");
const tabNavigationMarkup = createNavigationMarkup("tabs");
const parentSections = APP_NAV_ITEMS.filter((item) => item.protected);
// The child's screen has no navigation, only the hold-to-enter parent button; the parent area has
// the same sections as top tabs (wide) and bottom tabs (phones), plus "back to Xiaoyu".
if (
  !indexMarkup.includes('id="parentEntry"') ||
  !indexMarkup.includes('id="desktopNavigation"') ||
  !indexMarkup.includes('id="parentTabs"') ||
  !indexMarkup.includes('id="backToXiaoyu"') ||
  indexMarkup.includes('id="mobileMenuButton"') ||
  APP_NAV_ITEMS.length !== 4 ||
  parentSections.length !== 3 ||
  !parentSections.every((item) => desktopNavigationMarkup.includes(item.label) && tabNavigationMarkup.includes(item.label)) ||
  tabNavigationMarkup.includes("一起聊") ||
  !componentStyles.includes(".app-home") ||
  componentStyles.includes(".desktop-session-gate") ||
  componentStyles.includes(".mobile-app-home") ||
  !responsiveStyles.includes("@media (max-width: 900px)") ||
  responsiveStyles.includes("@media (max-width: 620px)")
) {
  throw new Error("Expected one shared navigation and home experience across the 900px responsive boundary");
}

const initialState = createInitialState();

const kindergartenKnowledge = selectKnowledgeCards({
  input: "我不想去幼儿园，早上有点难过。",
  currentState: {
    ...initialState,
    profile: { ...initialState.profile, ageBand: "4-5" },
    activeSpeaker: { role: "child", name: "小北" }
  }
});
if (
  kindergartenKnowledge.intent !== "kindergarten_transition" ||
  kindergartenKnowledge.cardIds.length < 1 ||
  kindergartenKnowledge.cardIds.length > 3 ||
  !kindergartenKnowledge.cardIds.includes("kindergarten-transition-ritual") ||
  !kindergartenKnowledge.context.includes("kindergarten-transition-ritual")
) {
  throw new Error("Expected age- and intent-matched knowledge cards for kindergarten transition input");
}

const parentKnowledge = selectKnowledgeCards({
  input: "孩子今天因为抢玩具不开心，我想知道怎么陪他聊。",
  currentState: {
    ...initialState,
    profile: { ...initialState.profile, ageBand: "4-5" },
    activeSpeaker: { role: "mother", name: "妈妈" }
  }
});
if (
  parentKnowledge.intent !== "emotion_repair" ||
  parentKnowledge.cardIds.length > 3 ||
  parentKnowledge.cardIds.includes("responsive-back-and-forth")
) {
  throw new Error("Expected parent input to use a small adult-appropriate knowledge context");
}

const validTutorOutput = validateTutorOutput(
  {
    tutorReply: "你先告诉我，你看到了什么？",
    board: { type: "science", items: ["树叶", "颜色"] },
    growthEvidence: { sourceQuote: "我看到了树叶", shouldSave: true }
  },
  { input: "我看到了树叶", currentState: initialState, knowledge: kindergartenKnowledge }
);
if (!validTutorOutput.ok) {
  throw new Error(`Expected grounded tutor output to pass validation: ${validTutorOutput.reason}`);
}

const unsafeTutorOutput = validateTutorOutput(
  { tutorReply: "这一定是发育迟缓，需要马上诊断。" },
  { input: "我不喜欢和大家一起玩", currentState: initialState, knowledge: kindergartenKnowledge }
);
if (unsafeTutorOutput.ok) {
  throw new Error("Expected diagnostic or ranking claims to be rejected before merging Qwen output");
}

const unsafeAuxiliaryField = validateTutorOutput(
  { tutorReply: "我们一起看看。", board: { type: "science", note: "这不是诊断，但一定是某种问题。" } },
  { input: "我不喜欢和大家一起玩", currentState: initialState, knowledge: kindergartenKnowledge }
);
if (unsafeAuxiliaryField.ok) {
  throw new Error("Expected sensitive claims in auxiliary fields to be rejected");
}

const invalidBoardType = validateTutorOutput(
  { tutorReply: "我们一起看看。", board: { type: "medical_report" } },
  { input: "我看到了树叶", currentState: initialState, knowledge: kindergartenKnowledge }
);
if (invalidBoardType.ok) {
  throw new Error("Expected board types outside the product contract to be rejected");
}

const ungroundedEvidence = validateTutorOutput(
  { tutorReply: "我们一起看看。", growthEvidence: { sourceQuote: "模型编造的原话", shouldSave: true } },
  { input: "我看到了树叶", currentState: initialState, knowledge: kindergartenKnowledge }
);
if (ungroundedEvidence.ok) {
  throw new Error("Expected fabricated growth quotes to be rejected before saving memory");
}

const summaryContainer = { innerHTML: "" };
renderAdultSummary(summaryContainer, {
  ...initialState,
  profile: { ...initialState.profile, name: "小北", showSessionSummary: true },
  lastSessionSummary: {
    title: "今天聊到了月亮",
    standoutQuote: "月亮是不是跟着我回家？",
    topics: ["月亮"],
    parentPrompt: "可以接着问：你觉得月亮什么时候离我们最近？"
  }
});
if ((summaryContainer.innerHTML.match(/<article class="session-summary-card/g) || []).length !== 3) {
  throw new Error("Expected the parent session result to stay focused on exactly three summary cards");
}

const emptyParentContainer = { innerHTML: "stale" };
renderAdultSummary(emptyParentContainer, {
  ...initialState,
  lastSessionSummary: {
    title: "这次还没有留下成长片段",
    standoutQuote: "",
    topics: [],
    parentPrompt: "可以等孩子下次主动想说时再开始。"
  }
});
if (emptyParentContainer.innerHTML !== "") {
  throw new Error("Expected an evidence-free session to leave the parent summary empty");
}

renderParentTimeline(emptyParentContainer, initialState, []);
if (emptyParentContainer.innerHTML !== "") {
  throw new Error("Expected the parent timeline to stay empty until a real growth moment exists");
}

renderOfflineTask(emptyParentContainer, initialState.offlineTask, null);
if (emptyParentContainer.innerHTML !== "") {
  throw new Error("Expected the offline task area to stay empty until a task is assigned");
}

const siblingModel = createInitialStudentModel({ name: "小北", ageBand: "3-4" }, "child-sibling");
if (siblingModel.studentId !== "child-sibling" || siblingModel.profile.nickname !== "小北") {
  throw new Error("Expected the student model foundation to isolate future child profiles by ID");
}

const voicePhases = ["ready", "listening", "thinking", "speaking", "retry"].map((phase) => createVoiceUiState(phase));
if (voicePhases.some((item) => !item.title || !item.detail || !item.ariaLabel) || createVoiceUiState("unknown").phase !== "ready") {
  throw new Error("Expected every child voice phase to have a complete, safe UI state");
}
if (
  shouldFinishVoiceOnRelease({ pressDurationMs: 120 }) ||
  !shouldFinishVoiceOnRelease({ pressDurationMs: 700 }) ||
  !shouldFinishVoiceOnRelease({ wasAlreadyListening: true, pressDurationMs: 80 })
) {
  throw new Error("Expected tap-to-record, hold-to-send, and tap-again-to-stop voice controls");
}
const voiceActivity = createVoiceActivityDetector({
  threshold: 0.02,
  startFrames: 2,
  silenceDurationMs: 800,
  idleTimeoutMs: 5000,
  minSpeechMs: 300
});
voiceActivity.update(0.005, 0);
voiceActivity.update(0.03, 100);
const speechStart = voiceActivity.update(0.03, 140);
voiceActivity.update(0.04, 500);
const speechEnd = voiceActivity.update(0.005, 1350);
const idleActivity = createVoiceActivityDetector({ idleTimeoutMs: 1000 });
idleActivity.update(0.001, 0);
const idleEnd = idleActivity.update(0.001, 1001);
if (!speechStart.speechStarted || !speechEnd.shouldStop || speechEnd.reason !== "silence" || !idleEnd.idle) {
  throw new Error("Expected voice activity detection to find speech, silence, and idle pauses");
}
if (
  getVoiceStageLayout({ type: "blank" }) !== "voice" ||
  getVoiceStageLayout({ type: "science" }) !== "whiteboard" ||
  getVoiceStageLayout() !== "voice"
) {
  throw new Error("Expected the whiteboard to stay hidden until a visual response exists");
}
if (
  !indexMarkup.includes('data-layout="voice"') ||
  !indexMarkup.includes('id="childWhiteboardPanel"') ||
  !indexMarkup.includes('class="xiaoyu-talk-character"')
) {
  throw new Error("Expected the child stage to start with Xiaoyu as the primary voice control");
}
if (
  !indexMarkup.includes('class="xiaoyu-talk-visual"') ||
  !indexMarkup.includes('class="xiaoyu-listening-shadow"') ||
  !indexMarkup.includes("node_modules/motion/dist/motion.js") ||
  !indexMarkup.includes("node_modules/roughjs/bundled/rough.js") ||
  indexMarkup.includes("xiaoyu-mic-badge") ||
  componentStyles.includes(".xiaoyu-mic-badge") ||
  responsiveStyles.includes(".mobile-talk-action")
) {
  throw new Error("Expected the confirmed Xiaoyu-only listening design without technical microphone badges");
}
if (
  componentStyles.includes("linear-gradient(#f2eadb 1px") ||
  componentStyles.includes("linear-gradient(#edf1ee 1px")
) {
  throw new Error("Expected the child whiteboard to use plain warm paper without a grid");
}

const longTutorReply = "我们先看一看这个现象。太阳光里藏着很多颜色。蓝色的小光更容易被空气散开。所以天空看起来蓝蓝的。你抬头时还看到了什么？";
const youngerReply = adaptTutorReply(longTutorReply, "3-4");
const olderReply = adaptTutorReply(longTutorReply, "6-7");
if (youngerReply.length > 100 || olderReply.length < youngerReply.length || !getAgeInstruction("3-4").includes("1-2")) {
  throw new Error("Expected tutor replies and prompts to adapt to the configured age band");
}

const freeSession = createActiveSession("child-a", new Date("2026-08-23T10:00:00.000Z"));
const laterTime = getSessionTimeState(freeSession, new Date("2026-08-23T11:05:01.000Z"));
if (laterTime.expired || laterTime.elapsedMinutes !== 65 || freeSession.durationMinutes !== null || freeSession.plannedEndAt !== null) {
  throw new Error("Expected family conversations to stay open until someone ends them");
}

let family = createInitialFamily({ name: "小北" });
const primaryChildId = family.members[0].id;
family = addFamilyMember(family, { name: "妈妈", role: "mother" });
const motherId = family.members.find((member) => member.role === "mother")?.id;
family = setActiveSpeaker(family, motherId);
if (family.members.length !== 2 || getActiveSpeaker(family)?.name !== "妈妈") {
  throw new Error("Expected one-time family setup to remember the selected speaker");
}
for (const [name, role] of [["爸爸", "father"], ["奶奶", "grandparent"], ["爷爷", "grandparent"], ["阿姨", "caregiver"], ["叔叔", "other"]]) {
  family = addFamilyMember(family, { name, role });
}
family = addFamilyMember(family, { name: "第七人", role: "other" });
if (family.members.length !== MAX_FAMILY_MEMBERS || family.members.filter((member) => member.role !== "child").length !== MAX_CAREGIVERS) {
  throw new Error("Expected one child profile plus at most six caregiver profiles");
}
family = addFamilyMember(family, { name: "另一个孩子", role: "child" });
if (family.members.filter((member) => member.role === "child").length !== 1) {
  throw new Error("Expected the first version to keep exactly one child profile");
}
const migratedFamily = ensureFamilyState(
  {
    members: [
      { id: "primary-child", name: "小北", role: "child", isPrimaryChild: true },
      { id: "legacy-second-child", name: "小南", role: "child", isPrimaryChild: false },
      { id: "mother", name: "妈妈", role: "mother", isPrimaryChild: false }
    ],
    activeSpeakerId: "legacy-second-child"
  },
  { name: "小北" }
);
if (migratedFamily.members.filter((member) => member.role === "child").length !== 1 || migratedFamily.activeSpeakerId === "legacy-second-child") {
  throw new Error("Expected legacy family data to migrate back to one primary child");
}
family = removeFamilyMember(family, primaryChildId);
if (!family.members.some((member) => member.id === primaryChildId)) {
  throw new Error("Expected the primary child profile to be protected from family-member removal");
}

const adultTurn = createTutorTurn("今天小北主动把玩具分给了朋友", {
  ...initialState,
  activeSpeaker: { id: motherId, name: "妈妈", role: "mother" }
});
if (adultTurn.growthEvidence?.shouldSave !== false || adultTurn.board.type !== "blank" || !adultTurn.messages.at(-1)?.text.includes("家人的观察")) {
  throw new Error("Expected adult input to stay a family observation instead of child growth evidence");
}

const adultOnlySummary = endActiveSession(
  freeSession,
  [{ id: "adult-note", sessionId: freeSession.id, sourceType: "parent_note", speakerRole: "mother", childQuote: "今天愿意分享", createdAt: new Date().toISOString() }]
).summary;
if (adultOnlySummary.standoutQuote || !adultOnlySummary.title.includes("家人的补充")) {
  throw new Error("Expected adult-only sessions not to create a child quote summary");
}

const parentPinHash = await hashParentPin("2468");
if (!parentPinHash || !(await verifyParentPin("2468", parentPinHash)) || await verifyParentPin("1357", parentPinHash)) {
  throw new Error("Expected the optional parent PIN to be hashed and verified locally");
}
if (normalizeParentPin("12a4") || normalizeParentPin("12345")) {
  throw new Error("Expected parent PIN validation to accept exactly four digits");
}

if (initialState.board.type !== "blank" || initialState.messages.length !== 0) {
  throw new Error("Expected a blank whiteboard and no default conversation before the child speaks");
}

if (
  initialState.profile.name ||
  initialState.profile.interest ||
  initialState.profile.consent ||
  initialState.studentModel.misconceptions.length ||
  initialState.studentModel.engagement.recentWins.length ||
  Object.values(initialState.studentModel.skills).some((skill) => skill.mastery !== null || skill.status !== "unobserved")
) {
  throw new Error("Expected a new child profile to contain no fabricated growth data");
}

const migratedLegacyModel = migrateStudentModel({
  ...initialState.studentModel,
  profile: { ageBand: "4-5", nickname: "安安", interests: ["动物", "颜色", "故事"], learningGoal: "愿意表达自己的想法" },
  skills: Object.fromEntries(
    Object.entries(initialState.studentModel.skills).map(([key, skill]) => [key, { ...skill, mastery: 0.42, status: "emerging" }])
  ),
  misconceptions: [
    {
      id: "subtraction_means_count_all",
      skill: "math.subtract_as_takeaway",
      pattern: "旧演示误区",
      evidenceCount: 1,
      lastSeenAt: null
    }
  ],
  engagement: { sessionCount: 1, recentWins: ["能跟随提示说出自己的想法"], attentionNotes: [] }
});
if (migratedLegacyModel.misconceptions.length || migratedLegacyModel.engagement.sessionCount !== 0) {
  throw new Error("Expected the legacy fabricated student seed to migrate to an empty evidence model");
}

const next = createTutorTurn("我想玩 5 以内加减法", initialState);

if (next.board.type !== "math") {
  throw new Error("Expected math board for math input");
}

if (!next.messages.some((message) => message.role === "tutor")) {
  throw new Error("Expected tutor reply");
}

if (!next.activeLesson?.awaitingAnswer) {
  throw new Error("Expected active lesson waiting for student answer");
}

const assessed = createTutorTurn("3", {
  ...next,
  messages: [...next.messages, { role: "child", text: "3" }]
});

if (!assessed.lastAssessment?.correct) {
  throw new Error("Expected correct assessment for answer 3");
}

if (assessed.studentModel.skills["math.subtract_as_takeaway"].evidence.correct < 1) {
  throw new Error("Expected student model evidence to update after answer");
}

const algebraStart = createTutorTurn("我想练 3(x+4)=21", createInitialState());
if (algebraStart.activeLesson?.activity === "algebra" || algebraStart.board?.type === "algebra") {
  throw new Error("Expected the 0-6 product not to start a 7-13 algebra lesson");
}

if (!assessed.offlineTask || assessed.offlineTask.status !== "assigned") {
  throw new Error("Expected offline task after student answer");
}

const afterOffline = applyOfflineObservation(assessed.studentModel, assessed.offlineTask, {
  completion: "completed",
  support: "some_support",
  behavior: "recounted",
  notes: "孩子愿意自己拿走物品，但会重新数一遍。"
});

if (!afterOffline.engagement.offlineObservations?.length) {
  throw new Error("Expected offline observation to be stored in student memory");
}

const story = createTutorTurn("我想听小兔子和月亮的童话故事", createInitialState());

if (story.board.type !== "story" || !story.board.story?.scenes?.length) {
  throw new Error("Expected story mode to render original story scenes");
}

if (story.offlineTask?.id !== "story_retell_draw") {
  throw new Error("Expected story mode to assign retell/draw offline task");
}

if (!story.board.story.domainLabels?.includes("语言") || !story.board.story.dialogicPrompts?.length) {
  throw new Error("Expected story mode to include preschool domains and dialogic prompts");
}

const storyChoice = createTutorTurn("我选择蓝色的门，继续讲", {
  ...story,
  messages: [...story.messages, { role: "child", text: "我选择蓝色的门，继续讲" }]
});

if (!storyChoice.board.story?.ending || storyChoice.board.mode !== "共创 + 离屏") {
  throw new Error("Expected child story choice to create an ending and shift to offline mode");
}

const explore = createTutorTurn("我想找三种颜色，然后去教室里找一找", createInitialState());

if (explore.board.type !== "science" || explore.offlineTask?.id !== "three_colors_leaf") {
  throw new Error("Expected exploration prompt to become a real-world color-finding task");
}

const leafScience = createTutorTurn("为什么树叶是绿色的？", createInitialState());
const unknownScience = createTutorTurn("为什么石头有的亮亮的？", createInitialState());
if (leafScience.board.variant !== "leaf" || leafScience.board.title !== "树叶为什么是绿色的？") {
  throw new Error("Expected leaf questions to use the leaf science fallback");
}
if (unknownScience.board.variant === "moon" || unknownScience.board.items?.includes("月亮")) {
  throw new Error("Expected unknown science questions to avoid an unrelated moon fallback");
}

const colorStory = createTutorTurn("我想听一个找三种颜色的故事", createInitialState());

if (colorStory.board.story?.id !== "color_leaf_walk" || colorStory.offlineTask?.id !== "three_colors_leaf") {
  throw new Error("Expected color story to bridge into color-finding offline task");
}

const socialStory = createTutorTurn("讲一个小熊和朋友分享玩具的故事", createInitialState());

if (socialStory.board.story?.id !== "sharing_bear" || socialStory.offlineTask?.id !== "turn_taking_play") {
  throw new Error("Expected sharing story to bridge into turn-taking offline task");
}

const morningEmotionStory = createTutorTurn("讲一个小朋友早上有点想妈妈但慢慢安心的故事", createInitialState());

if (
  morningEmotionStory.board.story?.id !== "morning_cloud_feelings" ||
  morningEmotionStory.offlineTask?.id !== "emotion_weather_checkin"
) {
  throw new Error("Expected morning emotion story to bridge into emotion weather check-in task");
}

clearLocalStudentDb();
saveLocalStudentDb({
  studentModels: {},
  events: [],
  conversationMoments: [
    {
      id: "legacy-growth-moment",
      studentId: "legacy-student",
      childText: "以前的记录还在吗？",
      tutorText: "还在，会自动迁移。",
      domain: "language",
      saved: true,
      createdAt: new Date().toISOString()
    }
  ]
});
const migratedMoments = getStudentGrowthMoments("legacy-student");
if (migratedMoments.length !== 1 || migratedMoments[0].childQuote !== "以前的记录还在吗？" || !migratedMoments[0].starred) {
  throw new Error("Expected legacy conversation moments to migrate into growth moments");
}

clearLocalStudentDb();
const activeSession = createActiveSession("growth-test-student", new Date("2026-08-23T10:00:00.000Z"));
startStudentSession(activeSession.studentId, activeSession.id, activeSession.startedAt);
const oneTurnSession = incrementSessionTurn(activeSession);
if (oneTurnSession.turnCount !== 1 || getStudentSessions("growth-test-student")[0]?.status !== "active") {
  throw new Error("Expected parent start to create an active local session");
}
const savedMoment = recordGrowthMoment({
  studentId: "growth-test-student",
  sessionId: activeSession.id,
  childQuote: "月亮为什么会变样？",
  tutorResponse: "月亮没有自己变形，是我们看到被太阳照亮的部分不同。",
  domain: "science",
  topics: ["月亮", "太阳"],
  lessonTitle: "月亮的变化",
  evidence: {
    type: "question",
    sourceQuote: "月亮为什么会变样？",
    observation: "孩子主动提出一个自然现象问题。",
    childIntent: "提问",
    confidence: 0.92
  },
  boardSnapshot: {
    type: "science",
    title: "月亮为什么会变样？",
    items: ["太阳", "地球", "月亮"]
  }
});
setGrowthMomentsStarred([savedMoment.id], true);
const storedMoments = getStudentGrowthMoments("growth-test-student");

if (
  storedMoments.length !== 1 ||
  !storedMoments[0].starred ||
  storedMoments[0].sessionId !== activeSession.id ||
  storedMoments[0].boardSnapshot?.items.length !== 3 ||
  storedMoments[0].topics.length !== 2 ||
  storedMoments[0].schemaVersion !== 3 ||
  storedMoments[0].evidence.sourceQuote !== storedMoments[0].childQuote
) {
  throw new Error("Expected rich growth moments to persist locally and support manual saving");
}

const endedSession = endActiveSession(activeSession, storedMoments, new Date("2026-08-23T10:08:00.000Z"));
finishStudentSession(activeSession.id, endedSession.summary, endedSession.session.endedAt);
const savedSession = getStudentSessions("growth-test-student")[0];
if (savedSession.status !== "ended" || savedSession.turnCount !== 1 || !savedSession.summary.standoutQuote) {
  throw new Error("Expected ending a session to create a parent-facing summary backed by its moments");
}

const localBackup = createLocalArchiveExport(initialState, loadLocalStudentDb());
if (localBackup.schemaVersion !== 3 || localBackup.localArchive.growthMoments.length !== 1) {
  throw new Error("Expected a complete local archive export to include growth moments");
}

const qwenEvidence = normalizeGrowthEvidence(
  {
    type: "interest",
    sourceQuote: "模型编造的原话",
    topics: ["月亮"],
    domains: ["science"],
    observation: "孩子主动问月亮。",
    confidence: 0.88,
    shouldSave: true
  },
  "月亮为什么会变样？",
  { type: "science" }
);
if (qwenEvidence.sourceQuote !== "月亮为什么会变样？" || qwenEvidence.domains[0] !== "science") {
  throw new Error("Expected Qwen growth evidence to preserve an exact child quote and valid domains");
}

const crossWeekNow = new Date("2026-08-23T20:00:00.000Z");
const crossWeekMoments = createCrossWeekGrowthMoments(crossWeekNow);
const longitudinal = buildLongitudinalReview(crossWeekMoments, crossWeekNow);
if (
  !longitudinal.beforeNow.ready ||
  !longitudinal.beforeNow.earlier.momentId ||
  !longitudinal.beforeNow.recent.momentId ||
  longitudinal.interestJourney.length < 5 ||
  longitudinal.month.count < 4
) {
  throw new Error("Expected cross-week evidence to create before/now, interest journey, and monthly review data");
}

const renderedGrowthPage = { innerHTML: "" };
renderMemoryDashboard(renderedGrowthPage, {}, initialState.studentModel, null, []);
if (
  !renderedGrowthPage.innerHTML.includes("还没有成长记录") ||
  renderedGrowthPage.innerHTML.includes("定期回看") ||
  renderedGrowthPage.innerHTML.includes("以前与现在")
) {
  throw new Error("Expected an empty growth archive to show one clear starting action without future-data panels");
}

renderMemoryDashboard(renderedGrowthPage, {}, initialState.studentModel, null, storedMoments);
if (
  !renderedGrowthPage.innerHTML.includes("data-growth-range") ||
  !renderedGrowthPage.innerHTML.includes('data-growth-range value="week" checked') ||
  !renderedGrowthPage.innerHTML.includes('growth-record-chart') ||
  renderedGrowthPage.innerHTML.includes("growth-change") ||
  renderedGrowthPage.innerHTML.includes("growth-keepsake")
) {
  throw new Error("Expected one-day data in the selected week without unsupported change claims or keepsakes");
}

renderMemoryDashboard(
  renderedGrowthPage,
  {},
  { ...initialState.studentModel, profile: { ...initialState.studentModel.profile, nickname: "测试孩子" } },
  null,
  crossWeekMoments,
  { range: "all" }
);
if (
  !renderedGrowthPage.innerHTML.includes("话题回看") ||
  !renderedGrowthPage.innerHTML.includes("不同时期，聊过这些") ||
  renderedGrowthPage.innerHTML.includes("表达更丰富") ||
  !renderedGrowthPage.innerHTML.includes("data-growth-range") ||
  !renderedGrowthPage.innerHTML.includes('data-growth-range value="all" checked') ||
  !renderedGrowthPage.innerHTML.includes('growth-record-chart is-months') ||
  renderedGrowthPage.innerHTML.includes("原话时间线") ||
  renderedGrowthPage.innerHTML.includes("查看原话证据") ||
  renderedGrowthPage.innerHTML.includes("掌握度")
) {
  throw new Error("Expected the growth page to show parent-facing change without raw evidence or mastery scoring");
}

const renderedBackupPage = { innerHTML: "" };
renderMemoryArchive(renderedBackupPage, crossWeekMoments, "测试孩子");
if (
  !renderedBackupPage.innerHTML.includes("测试孩子的完整记录") ||
  !renderedBackupPage.innerHTML.includes(crossWeekMoments[0].childQuote) ||
  !renderedBackupPage.innerHTML.includes('data-memory-action="download-selected"')
) {
  throw new Error("Expected the backup page to preserve raw records, selection, and downloads");
}

const growthInsights = buildGrowthInsights([
  storedMoments[0],
  { ...storedMoments[0], id: "story-test", domain: "story" }
]);

if (growthInsights.totalExplorations !== 2 || growthInsights.visibleDomains.length !== 2) {
  throw new Error("Expected growth insights to aggregate available daily domain data");
}

const olderDate = new Date();
olderDate.setDate(olderDate.getDate() - 30);
const olderInsights = buildGrowthInsights([
  { ...storedMoments[0], observedAt: olderDate.toISOString(), createdAt: olderDate.toISOString() }
]);

if (olderInsights.totalExplorations !== 1 || olderInsights.periodLabel !== "最近有记录的日期") {
  throw new Error("Expected sparse older data to fall back to its available recorded dates");
}

console.log("Smoke test passed: tutor flows, structured memory, local growth archives, backups, and adaptive insights work.");
