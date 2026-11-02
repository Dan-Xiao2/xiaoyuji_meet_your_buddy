import { createInitialState } from "./data/studentModel.js";
import { createAppStore } from "./app/appStore.js";
import { createApplicationPersistence } from "./app/applicationPersistence.js";
import { updateProfileState, startSessionState, endSessionState, normalizeApplicationState } from "./app/applicationState.js";
import { runtimeDiagnostics } from "./app/runtimeDiagnostics.js";
import { createDrawingRequestTracker } from "./features/drawing/drawingRequestTracker.js";
import { captureGrowthTurnContext } from "./features/growth/growthTurnContext.js";
import { APP_EVENT } from "./app/appEvents.js";
import { callDrawingPlanApi } from "./services/llmClient.js";
import { createConversationTurn as createTutorTurn } from "./services/tutorEngine.js";
import { checkChildSafety, checkTutorSafetyOutput, createSafetyTurn } from "./services/safety.js";
import { loadState, exportState, exportConversationMoments, clearState } from "./services/storage.js";
import { renderMessages } from "./ui/chat.js";
import { renderWhiteboard, presentWhiteboardStep, replayWhiteboard, stopWhiteboardPlayback, prepareWhiteboardPlayback } from "./ui/whiteboard.js";
import { relevantBoard, validVisualScene } from "./whiteboard/visualPlan.js";
import { validImageBoard, imageBoard, undoImageBoard, createDrawingJob, drawingRequestInput } from "./whiteboard/openDrawing.js";
import { isDrawingRetry, isInteractionControl, conversationEndReply, isTopicChange, topicChangeDrawingInput } from "./services/conversationIntent.js";
import { routeDrawing, snapshotDrawing, requestImage } from "./services/openDrawingClient.js";
import { deriveVoiceUiState, getVoiceStageLayout, shouldFinishVoiceOnRelease } from "./ui/voiceState.js";
import { renderMemoryArchive, renderMemoryDashboard } from "./ui/memoryPanel.js";
import { mountArchiveControls } from "./ui/archiveControls.js";
import { mountMicrophoneSettings } from "./ui/microphoneSettings.js";
import { recognitionCorpus } from "./features/voice/recognitionCorpus.js";
import { getBargeInEnabled, setBargeInEnabled, getRealtimeEnabled, setRealtimeEnabled } from "./services/microphoneInput.js";
import { createPilotLog } from "./services/pilotLog.js";
import { bindPilotLogPanel } from "./ui/pilotLogPanel.js";
import { REVISION_KEY } from "./services/localPersistence.js";
import { getDurableArchiveStatus, subscribeDurableArchive } from "./services/indexedArchive.js";
import { renderAdultSummary, renderParentTimeline } from "./ui/summary.js";
import { renderOfflineTask } from "./ui/offlineTask.js";
import { createParentNoteText } from "./ui/parentNote.js";
import { applyOfflineObservation, createObservationSummary } from "./student/offlineObservationUpdater.js";
import { migrateStudentModel } from "./student/studentSchema.js";
import {
  createIdleSession,
  incrementSessionTurn
} from "./session/sessionManager.js";
import { createVoiceSession } from "./features/voice/voiceSession.js";
import { createConversationController } from "./features/conversation/conversationController.js";
import { findTutorMessage, latestTutorReply, replaceLatestTutorReply, cancelPendingConversationState, recoverInterruptedConversationState } from "./features/conversation/conversationState.js";
import { createDrawingGuard, mergeDrawingTurn, retainUpdatedDrawing, drawingContinuationBaseline } from "./features/drawing/drawingState.js";
import { captureEnrichmentBaseline } from "./session/enrichmentState.js";
import {
  clearLocalStudentDb,
  getStudentGrowthMoments,
  loadLocalStudentDb
} from "./data/localStudentDb.js";
import { domainLabel } from "./data/growthInsights.js";
import { syncLegacyMemory } from "./student/memoryUpdater.js";
import { createVoiceController } from "./services/voiceService.js";
import { hashParentPin, normalizeParentPin, verifyParentPin } from "./services/parentAccess.js";
import { createNavigationMarkup, getNavigationItem } from "./ui/appNavigation.js";
import {
  MAX_CAREGIVERS,
  addFamilyMember,
  ensureFamilyState,
  familyRoleLabel,
  getActiveSpeaker,
  removeFamilyMember,
  setActiveSpeaker
} from "./data/familyModel.js";

const UI_STATE_VERSION = 4;
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

document.querySelector("#desktopNavigation").innerHTML = createNavigationMarkup("desktop");
document.querySelector("#mobileDrawerNavigation").innerHTML = createNavigationMarkup("drawer");

const dom = {
  workspace: document.querySelector(".workspace"),
  childStage: document.querySelector("#childStage"),
  sessionGate: document.querySelector("#sessionGate"),
  childSessionName: document.querySelector("#childSessionName"),
  endChildSession: document.querySelector("#endChildSession"),
  parentSessionPanel: document.querySelector("#parentSessionPanel"),
  parentTodayPanel: document.querySelector("#parentTodayPanel"),
  offlinePanel: document.querySelector("#offlinePanel"),
  parentRecent: document.querySelector("#parentRecent"),
  startChildName: document.querySelector("#startChildName"),
  startAgeBand: document.querySelector("#startAgeBand"),
  startConsent: document.querySelector("#startConsent"),
  startChildSession: document.querySelector("#startChildSession"),
  endParentSession: document.querySelector("#endParentSession"),
  sessionFormStatus: document.querySelector("#sessionFormStatus"),
  navButtons: document.querySelectorAll("[data-nav-action]"),
  askForm: document.querySelector("#askForm"),
  childInput: document.querySelector("#childInput"),
  messageList: document.querySelector("#messageList"),
  whiteboard: document.querySelector("#whiteboard"),
  childWhiteboardPanel: document.querySelector("#childWhiteboardPanel"),
  adultSummary: document.querySelector("#adultSummary"),
  parentTimeline: document.querySelector("#parentTimeline"),
  parentGreeting: document.querySelector("#parentGreeting"),
  parentHeadline: document.querySelector("#parentHeadline"),
  copyParentNote: document.querySelector("#copyParentNote"),
  offlineTask: document.querySelector("#offlineTask"),
  observationForm: document.querySelector("#observationForm"),
  observationDrawer: document.querySelector(".observation-drawer"),
  saveObservation: document.querySelector("#saveObservation"),
  memoryDashboard: document.querySelector("#memoryDashboard"),
  backupDashboard: document.querySelector("#backupDashboard"),
  backupExportData: document.querySelector("#backupExportData"),
  profileForm: document.querySelector("#profileForm"),
  saveProfile: document.querySelector("#saveProfile"),
  parentPin: document.querySelector("#parentPin"),
  clearParentPin: document.querySelector("#clearParentPin"),
  profileSaveStatus: document.querySelector("#profileSaveStatus"),
  resetSession: document.querySelector("#resetSession"),
  exportData: document.querySelector("#exportData"),
  mainVoiceButton: document.querySelector("#mainVoiceButton"),
  xiaoyuTalkVisual: document.querySelector(".xiaoyu-talk-visual"),
  xiaoyuListeningShadow: document.querySelector(".xiaoyu-listening-shadow"),
  voicePromptTitle: document.querySelector("#voicePromptTitle"),
  voicePromptDetail: document.querySelector("#voicePromptDetail"),
  voiceStatus: document.querySelector("#voiceStatus"),
  voiceTranscript: document.querySelector("#voiceTranscript"),
  voiceSupportText: document.querySelector("#voiceSupportText"),
  voiceDiagnostic: document.querySelector("#voiceDiagnostic"),
  speakReplies: document.querySelector("#speakReplies"),
  connectionStatus: document.querySelector("#connectionStatus"),
  mobileMenuButton: document.querySelector("#mobileMenuButton"),
  mobileDrawer: document.querySelector("#mobileDrawer"),
  mobileDrawerBackdrop: document.querySelector("#mobileDrawerBackdrop"),
  mobileDrawerPanel: document.querySelector("#mobileDrawerPanel"),
  mobileDrawerClose: document.querySelector("#mobileDrawerClose"),
  mobileDrawerNav: document.querySelector(".mobile-drawer-nav"),
  mobileDrawerProfile: document.querySelector("#mobileDrawerProfile"),
  mobileDrawerStatus: document.querySelector("#mobileDrawerStatus"),
  activeSpeaker: document.querySelector("#activeSpeaker"),
  speakerPickerWrap: document.querySelector("#speakerPickerWrap"),
  familyMemberList: document.querySelector("#familyMemberList"),
  familyMemberForm: document.querySelector("#familyMemberForm"),
  familyMemberName: document.querySelector("#familyMemberName"),
  familyMemberRole: document.querySelector("#familyMemberRole"),
  familyMemberStatus: document.querySelector("#familyMemberStatus"),
  parentMore: document.querySelector(".parent-more"),
  parentLock: document.querySelector("#parentLock"),
  parentUnlockForm: document.querySelector("#parentUnlockForm"),
  parentUnlockPin: document.querySelector("#parentUnlockPin"),
  parentLockStatus: document.querySelector("#parentLockStatus"),
  cancelParentUnlock: document.querySelector("#cancelParentUnlock")
};

let state = hydrateState(loadState());
const appStore = createAppStore(state, { normalize: normalizeApplicationState });
state = appStore.getState();
const persistence = createApplicationPersistence({
  onFailure: () => { document.querySelector("#storageWarning").hidden = false; }
});
const voice = createVoiceController();
// Device switches and system interruptions, recorded with the turn in progress (numbers only).
voice.onAudioEvent?.(timing => recordVoiceTiming(timing));
const trace = runtimeDiagnostics.record;
const conversation = createConversationController({ trace, onChange: requestVoiceRender });
const drawingRequests = createDrawingRequestTracker({ trace, onChange: requestVoiceRender });
let voiceCloudStatus = null;
const drawingJob = createDrawingJob({ trace });
const drawingGuard = createDrawingGuard();
let drawingPending = false;
let pendingDrawingBase = null;

function drawingStatus(text = "") {
  const node = document.querySelector("#drawingStatus");
  node.textContent = text; node.hidden = !text;
}

function cancelOpenDrawing() {
  drawingJob.cancel(); drawingPending = false; pendingDrawingBase = null; drawingStatus();
}

function startOpenDrawing(route, previous, turn) {
  const base = drawingGuard.capture(state);
  cancelOpenDrawing(); drawingPending = true; pendingDrawingBase = previous;
  drawingStatus("正在画，你可以继续说话");
  // Capture before another turn can replace the SVG. Only this picture and instruction leave the device.
  const original = route.operation === "edit" ? snapshotDrawing(previous, dom.whiteboard) : Promise.resolve(undefined);
  void drawingJob.run(async signal => requestImage(route, await original, signal), image => {
    drawingPending = false; pendingDrawingBase = null;
    if (!drawingGuard.matches(state, base)) {
      drawingStatus(state.session?.status === "active" ? "画面已更新，这次生成的图没有替换当前画面" : "");
      return false;
    }
    state = { ...state, board: imageBoard(image, previous, route.instruction), visualPlan: null, drawingRequest: null };
    drawingStatus("图画来了");
    commitState();
    return true;
  }, () => {
    drawingPending = false; pendingDrawingBase = null;
    if (state.session?.id !== base.sessionId || state.session?.status !== "active") return;
    drawingStatus(drawingGuard.matches(state, base)
      ? "这次没画出来，原来的画没有改动" : "这次没画出来，当前画面保留不变");
  }, { sessionId: base.sessionId, baseRevision: base.revision, turnId: turn.turnId });
}
const recentVoiceTimings = [];
let voiceRenderQueued = false;
let parentUnlockedUntil = 0;
let pendingParentAction = null;
let mobileDrawerTimer = null;
let growthSelection = { range: "week", offset: 0, bucket: null };
let profileSaving = false;
let childLayoutTimer = null;
let listeningAnimations = [];
let hasLiveVoiceLevel = false;
let voicePressStartedAt = 0;
let voicePointerStopsExisting = false;
const microphoneSettings = mountMicrophoneSettings({ beforeCapture: () => stopInteraction() });
const realtimeToggle = document.querySelector("[data-realtime-asr]");
if (realtimeToggle) {
  realtimeToggle.checked = getRealtimeEnabled();
  realtimeToggle.addEventListener("change", () => setRealtimeEnabled(realtimeToggle.checked));
}
const bargeInToggle = document.querySelector("[data-barge-in]");
// Replies the child spoke over. The next request marks them, so the model does not assume the child
// heard (or accepted) the rest. Marked only in the next request's history, never on the reply that
// is still the current turn's target, so in-flight commits are not disturbed.
// Replies the child cut short, by message id: { heard } is the whole sentences actually played
// (streamed replies), absent when that is unknown.
const interruptedReplies = new Map();
if (bargeInToggle) {
  bargeInToggle.checked = getBargeInEnabled();
  bargeInToggle.addEventListener("change", () => setBargeInEnabled(bargeInToggle.checked));
}
const pilotLog = (() => { try { return createPilotLog({ storage: window.sessionStorage }); } catch { return createPilotLog(); } })();
bindPilotLogPanel(document.querySelector("#pilotSettings"), pilotLog, {
  getContext: () => ({ userAgent: navigator.userAgent, viewport: { width: window.innerWidth, height: window.innerHeight } })
});
const voiceSession = createVoiceSession({
  voice, trace, onChange: requestVoiceRender,
  getContext: () => ({
    sessionId: state.session?.id,
    active: state.session?.status === "active",
    canListen: dom.workspace.dataset.activeView === "learn" && !document.hidden,
    pending: conversation.getSnapshot().awaitingReply || drawingRequests.getSnapshot().phase === "pending",
    cloudTranscription: voiceCloudStatus?.cloudTranscription,
    realtimeTranscription: voiceCloudStatus?.realtimeTranscription && realtimeToggle?.checked !== false,
    bargeIn: Boolean(bargeInToggle?.checked),
    // A getter: getContext() runs on every audio frame, the corpus is needed once per capture.
    get asrCorpus() { return recognitionCorpus(state.messages); }
  }),
  ui: {
    beforeListen: () => microphoneSettings.reset(),
    captureStart: (details) => {
      microphoneSettings.noteConversationInput(details.inputLabel);
      dom.voiceTranscript.textContent = details.mode === "recording" ? "说完会自动处理，也可以再点一下结束。" : "请慢慢说一句话。";
    },
    transcript: text => { dom.voiceTranscript.textContent = text; },
    captureError: message => {
      dom.voiceTranscript.textContent = message;
    },
    clearSpeechError: () => { document.querySelector("#speechFailure").hidden = true; },
    speechError: replyMessageId => {
      document.querySelector("#speechFailureText").textContent = findTutorMessage(state, replyMessageId)?.text || "";
      document.querySelector("#speechFailure").hidden = false;
    }
  },
  narration: {
    stop: () => stopWhiteboardPlayback(dom.whiteboard),
    prepare: () => prepareWhiteboardPlayback(dom.whiteboard),
    step: index => presentWhiteboardStep(dom.whiteboard, index),
    replay: () => replayWhiteboard(dom.whiteboard)
  },
  onInput: (text, source) => { dom.childInput.value = text; sendChildInput(text, source); },
  onTiming: recordVoiceTiming,
  onLevel: applyVoiceLevel,
  onBargeIn: (replyMessageId, delivery = {}) => interruptedReplies.set(replyMessageId, delivery)
});
runtimeDiagnostics.register("conversation", conversation.getSnapshot);
runtimeDiagnostics.register("drawingPlan", drawingRequests.getSnapshot);
runtimeDiagnostics.register("drawingImage", drawingJob.getSnapshot);
runtimeDiagnostics.register("media", voiceSession.getSnapshot);
const archiveControls = mountArchiveControls({
  getState: () => state,
  requestAccess: requestParentAccess,
  onCommitted: (nextState) => applyReplacedArchive(nextState, "backup"),
  onClear: () => {
    clearState();
    clearLocalStudentDb();
    parentUnlockedUntil = 0;
    pendingParentAction = null;
    applyReplacedArchive(createInitialState(), "parent");
    document.querySelector("#archiveControlStatus").textContent = "";
  }
});

// Invalidate business work before stopping media, so no late result can start a new playback.
function stopInteraction({ detail = "点一下小宇，继续聊", persist = true } = {}) {
  trace("interaction.stopped", { sessionId: state.session?.id });
  conversation.cancel();
  cancelOpenDrawing();
  voiceSession.pause({ detail });
  microphoneSettings.reset();
  voicePressStartedAt = 0;
  voicePointerStopsExisting = false;
  const nextState = cancelPendingConversationState(state);
  if (nextState !== state) {
    state = nextState;
    if (persist) commitState(state, { type: APP_EVENT.INTERACTION_STOPPED });
  }
}

function applyReplacedArchive(nextState, view) {
  // Archive replacement has already rotated the storage generation. Never save the old state here.
  stopInteraction({ detail: "", persist: false });
  state = nextState;
  syncProfileForm();
  renderVoiceState();
  commitState();
  switchView(view);
}
window.addEventListener("storage", (event) => {
  if (event.key === REVISION_KEY) window.location.reload();
});

function showDurableArchiveWarning(result) {
  document.querySelector("#durableStorageWarning").hidden = !["error", "unavailable"].includes(result.status);
}
subscribeDurableArchive(showDurableArchiveWarning);
showDurableArchiveWarning(getDurableArchiveStatus());

function requestVoiceRender() {
  if (voiceRenderQueued) return;
  voiceRenderQueued = true;
  queueMicrotask(() => { voiceRenderQueued = false; renderVoiceState(); });
}

function renderVoiceState() {
  const speaker = getActiveSpeaker(state.family, state.profile);
  const media = voiceSession.getSnapshot();
  const voiceUiState = deriveVoiceUiState({ active: state.session?.status === "active",
    visible: dom.workspace.dataset.activeView === "learn" && !document.hidden,
    media, conversation: conversation.getSnapshot(), drawingPlan: drawingRequests.getSnapshot()
  }, { name: speaker?.name || state.profile?.name });
  dom.voicePromptTitle.textContent = voiceUiState.title;
  dom.voicePromptDetail.textContent = voiceUiState.detail;
  dom.voiceStatus.textContent = voiceUiState.status;
  dom.mainVoiceButton.setAttribute("aria-label", voiceUiState.ariaLabel);
  dom.mainVoiceButton.disabled = voiceUiState.phase === "thinking";
  dom.mainVoiceButton.closest(".child-voice-dock").dataset.voicePhase = voiceUiState.phase;
  const listening = voiceUiState.phase === "listening";
  if (dom.mainVoiceButton.classList.contains("is-listening") !== listening) {
    dom.mainVoiceButton.classList.toggle("is-listening", listening);
    if (listening) startListeningMotion(); else stopListeningMotion();
  }
  dom.connectionStatus.textContent = createConnectionStatusText();
}

function startListeningMotion() {
  stopListeningMotion();
  hasLiveVoiceLevel = false;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const animate = window.Motion?.animate;
  if (!animate || !dom.xiaoyuTalkVisual || !dom.xiaoyuListeningShadow) return;

  listeningAnimations = [
    animate(dom.xiaoyuTalkVisual, { scale: [1, 1.055, 1], y: [0, -3, 0] }, {
      duration: 1.08,
      repeat: Infinity,
      ease: "easeInOut"
    }),
    animate(dom.xiaoyuListeningShadow, { scaleX: [1, 1.16, 1], opacity: [0.62, 0.92, 0.62] }, {
      duration: 1.08,
      repeat: Infinity,
      ease: "easeInOut"
    })
  ];
}

function applyVoiceLevel(level) {
  if (voiceSession.getSnapshot().input !== "capturing" || !Number.isFinite(level)) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (!dom.xiaoyuTalkVisual || !dom.xiaoyuListeningShadow) return;

  if (!hasLiveVoiceLevel) {
    listeningAnimations.forEach((animation) => animation.stop());
    listeningAnimations = [];
    hasLiveVoiceLevel = true;
  }

  const scale = 1 + Math.min(0.06, Math.max(0, level) * 0.84);
  const lift = -Math.min(3, Math.max(0, level) * 42);
  const shadowScale = 1 + Math.min(0.16, Math.max(0, level) * 2.1);
  const shadowOpacity = 0.62 + Math.min(0.3, Math.max(0, level) * 3.8);
  dom.xiaoyuTalkVisual.style.transform = `translateY(${lift.toFixed(2)}px) scale(${scale.toFixed(4)})`;
  dom.xiaoyuListeningShadow.style.transform = `translateX(-50%) scaleX(${shadowScale.toFixed(4)})`;
  dom.xiaoyuListeningShadow.style.opacity = shadowOpacity.toFixed(3);
}

function stopListeningMotion() {
  listeningAnimations.forEach((animation) => animation.stop());
  listeningAnimations = [];
  hasLiveVoiceLevel = false;
  if (dom.xiaoyuTalkVisual) dom.xiaoyuTalkVisual.style.transform = "";
  if (dom.xiaoyuListeningShadow) {
    dom.xiaoyuListeningShadow.style.transform = "";
    dom.xiaoyuListeningShadow.style.opacity = "";
  }
}

function hydrateState(savedState) {
  const freshState = createInitialState();
  if (!savedState) return freshState;
  savedState = recoverInterruptedConversationState(savedState);
  const resetVisualSession = savedState.uiVersion !== UI_STATE_VERSION;
  const profile = migrateLegacyProfile(savedState.profile, savedState.uiVersion);
  const studentModel = migrateStudentModel(savedState.studentModel || freshState.studentModel, profile);
  const memory = syncLegacyMemory(resetVisualSession ? freshState.memory : { ...freshState.memory, ...(savedState.memory || {}) }, studentModel);

  return {
    ...freshState,
    ...savedState,
    uiVersion: UI_STATE_VERSION,
    profile,
    family: ensureFamilyState(savedState.family, profile),
    memory,
    studentModel,
    messages: resetVisualSession ? freshState.messages : savedState.messages || freshState.messages,
    board: resetVisualSession ? freshState.board : savedState.board || freshState.board,
    activeLesson: resetVisualSession ? null : savedState.activeLesson,
    lastAssessment: resetVisualSession ? null : savedState.lastAssessment,
    llmStatus: resetVisualSession ? undefined : savedState.llmStatus,
    offlineTask: resetVisualSession ? freshState.offlineTask : savedState.offlineTask || freshState.offlineTask,
    session: resetVisualSession ? createIdleSession() : savedState.session || createIdleSession(),
    lastSessionSummary: savedState.lastSessionSummary || null,
    growthEvidence: null
  };
}

function migrateLegacyProfile(profile = {}, version = 0) {
  const fresh = createInitialState().profile;
  const isLegacySeed =
    version < 3 &&
    profile.name === "安安" &&
    profile.interest === "动物、颜色、故事" &&
    profile.goal === "愿意表达自己的想法";
  return isLegacySeed ? fresh : { ...fresh, ...profile, configured: Boolean(profile.configured || profile.name) };
}

function syncProfileForm() {
  dom.profileForm.studentName.value = state.profile.name;
  dom.profileForm.ageBand.value = state.profile.ageBand;
  dom.profileForm.interest.value = state.profile.interest;
  dom.profileForm.goal.value = state.profile.goal;
  dom.profileForm.consent.checked = state.profile.consent;
  dom.profileForm.showSessionSummary.checked = state.profile.showSessionSummary !== false;
  dom.startChildName.value = state.profile.name;
  dom.startAgeBand.value = state.profile.ageBand;
  dom.startConsent.checked = state.profile.consent;
  dom.parentPin.value = "";
  dom.clearParentPin.hidden = !state.profile.parentPinHash;
}

function render() {
  const conversationMoments = getStudentGrowthMoments(state.studentModel?.studentId);
  renderMessages(dom.messageList, state.messages);
  renderWhiteboard(dom.whiteboard, state.board);
  renderChildStageLayout();
  renderMemoryDashboard(dom.memoryDashboard, state.memory, state.studentModel, state.activeLesson, conversationMoments, growthSelection);
  renderMemoryArchive(dom.backupDashboard, conversationMoments, state.profile.name || "孩子");
  renderAdultSummary(dom.adultSummary, state);
  renderParentTimeline(dom.parentTimeline, state, conversationMoments.filter((item) => item.reviewEligible !== false));
  renderOfflineTask(dom.offlineTask, state.offlineTask, state.lastOfflineObservation);
  renderSessionFlow();
  renderFamilyControls();
  renderParentContentVisibility(conversationMoments);
  dom.observationDrawer.hidden = !["assigned", "observed"].includes(state.offlineTask?.status);
  renderParentHeading();
  window.lucide?.createIcons();
  dom.connectionStatus.textContent = createConnectionStatusText();
  dom.voiceSupportText.textContent = createVoiceSupportText();
  dom.voiceDiagnostic.innerHTML = createVoiceDiagnosticHtml();
  dom.clearParentPin.hidden = !state.profile.parentPinHash;
  dom.mobileDrawerProfile.textContent = state.profile.configured
    ? `${state.family.members.length || 1} 位家人 · ${state.profile.name}`
    : "第一次使用，请大人先设置";
  renderVoiceState();
}

appStore.subscribe((nextState) => {
  state = nextState;
  drawingGuard.observe(state.board);
  persistence.saveSnapshot(state);
  render();
});

function commitState(nextState = state, event = { type: APP_EVENT.STATE_COMMITTED }) {
  return appStore.commit(nextState, event);
}

function renderChildStageLayout() {
  const nextLayout = getVoiceStageLayout(state.board);
  const previousLayout = dom.childStage.dataset.layout || "voice";
  const previousButtonBounds = previousLayout === "voice" ? dom.mainVoiceButton.getBoundingClientRect() : null;
  dom.childStage.dataset.layout = nextLayout;
  dom.childWhiteboardPanel.hidden = nextLayout !== "whiteboard";

  if (previousLayout === "voice" && nextLayout === "whiteboard") {
    window.clearTimeout(childLayoutTimer);
    dom.childStage.classList.remove("is-revealing-board");
    window.requestAnimationFrame(() => {
      dom.childStage.classList.add("is-revealing-board");
      animateVoiceButtonToCorner(previousButtonBounds);
    });
    childLayoutTimer = window.setTimeout(() => dom.childStage.classList.remove("is-revealing-board"), 460);
  }
}

function animateVoiceButtonToCorner(previousBounds) {
  if (!previousBounds?.width || typeof dom.mainVoiceButton.animate !== "function") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const nextBounds = dom.mainVoiceButton.getBoundingClientRect();
  if (!nextBounds.width) return;
  const offsetX = previousBounds.left - nextBounds.left;
  const offsetY = previousBounds.top - nextBounds.top;
  const scaleX = previousBounds.width / nextBounds.width;
  const scaleY = previousBounds.height / nextBounds.height;

  dom.mainVoiceButton.animate(
    [
      {
        transformOrigin: "top left",
        transform: `translate(${offsetX}px, ${offsetY}px) scale(${scaleX}, ${scaleY})`
      },
      { transformOrigin: "top left", transform: "translate(0, 0) scale(1)" }
    ],
    { duration: 420, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }
  );
}

function renderParentContentVisibility(conversationMoments) {
  const hasChildMessage = (state.messages || []).some(
    (message) => message.role === "child" && (!message.speakerRole || message.speakerRole === "child")
  );
  const hasSessionEvidence = Boolean(state.lastSessionSummary?.standoutQuote);
  const hasSummary = Boolean(hasSessionEvidence || state.activeLesson || hasChildMessage);
  const hasOfflineTask = ["assigned", "observed"].includes(state.offlineTask?.status);
  const hasTimeline = Boolean(
    conversationMoments.length ||
      state.lastOfflineObservation ||
      hasSessionEvidence ||
      state.activeLesson
  );

  dom.parentTodayPanel.hidden = !hasSummary;
  dom.offlinePanel.hidden = !hasOfflineTask;
  dom.parentRecent.hidden = !hasTimeline;
  document.querySelector("#familyRecap").hidden = !(hasSummary || hasOfflineTask || hasTimeline);
}

function renderSessionFlow() {
  const status = state.session?.status || "idle";
  const active = status === "active";
  const speaker = getActiveSpeaker(state.family, state.profile);
  const name = speaker?.name || state.profile.name || "家人";
  dom.childStage.hidden = !active;
  dom.sessionGate.hidden = active;
  dom.childSessionName.textContent = name;
  dom.startChildName.disabled = active;
  dom.startAgeBand.disabled = active;
  dom.startConsent.disabled = active;
  dom.endParentSession.hidden = !active;
  dom.startChildSession.textContent = active ? "回到聊天" : "开始聊天";
  dom.parentSessionPanel.dataset.profileStatus = state.profile.configured ? "configured" : "new";
  dom.parentSessionPanel.hidden = state.profile.configured && !active && state.profile.consent;
  dom.parentMore.hidden = !state.profile.configured;

  if (active) {
    dom.parentSessionPanel.dataset.sessionStatus = "active";
    dom.sessionFormStatus.textContent = `已经聊了 ${state.session.turnCount || 0} 轮，可以随时结束。`;
    return;
  }

  const ended = status === "ended";
  dom.parentSessionPanel.dataset.sessionStatus = ended ? "ended" : "idle";
  dom.sessionFormStatus.textContent = ended && state.lastSessionSummary
    ? `${state.lastSessionSummary.title}。${state.lastSessionSummary.parentPrompt}`
    : "";
  const homeDetail = state.profile.configured ? "开始聊天" : "请大人先设置";
  const homeAction = state.profile.configured ? "quick-start" : "show-parent";
  dom.sessionGate.innerHTML = `
    <div class="app-home">
      <button class="app-talk-launch" type="button" data-session-action="${homeAction}" aria-label="${homeDetail}">
        <img class="app-talk-character" src="./assets/xiaoyu-planet.png" alt="" />
      </button>
      <div class="app-home-instruction">
        <strong>${homeDetail}</strong>
      </div>
    </div>
  `;
}

function renderFamilyControls() {
  const family = ensureFamilyState(state.family, state.profile);
  const activeSpeaker = getActiveSpeaker(family, state.profile);
  dom.speakerPickerWrap.hidden = family.members.length < 2;
  dom.childSessionName.hidden = family.members.length > 1;
  dom.activeSpeaker.innerHTML = family.members
    .map(
      (member) => {
        const role = familyRoleLabel(member.role);
        const label = member.name === role ? member.name : `${member.name} · ${role}`;
        return `<option value="${escapeUi(member.id)}"${member.id === activeSpeaker?.id ? " selected" : ""}>${escapeUi(label)}</option>`;
      }
    )
    .join("");

  dom.familyMemberList.innerHTML = family.members.length
    ? family.members
        .map(
          (member) => `
            <article class="family-member-row">
              <span class="family-member-initial" aria-hidden="true">${escapeUi(member.name.slice(0, 1))}</span>
              <div><strong>${escapeUi(member.name)}</strong><small>${escapeUi(familyRoleLabel(member.role))}</small></div>
              <span class="voice-profile-state">${member.voiceEnrollment.status === "enrolled" ? "声音已录入" : "聊天可选择"}</span>
              ${member.isPrimaryChild ? '<span class="primary-child-label">成长档案</span>' : `<button class="quiet-link" type="button" data-family-action="remove" data-member-id="${escapeUi(member.id)}">移除</button>`}
            </article>
          `
        )
        .join("")
    : '<p class="family-member-empty">完成孩子资料后，这里会建立第一个家庭成员。</p>';

  const caregiverCount = family.members.filter((member) => member.role !== "child").length;
  const full = caregiverCount >= MAX_CAREGIVERS;
  dom.familyMemberName.disabled = full;
  dom.familyMemberRole.disabled = full;
  dom.familyMemberForm.querySelector("button").disabled = full;
  if (full && !dom.familyMemberStatus.textContent) dom.familyMemberStatus.textContent = "已经登记 6 位家长或照护者。";
}

function renderParentHeading() {
  dom.parentHeadline.textContent = "家庭设置";
}

function createConnectionStatusText() {
  const task = conversation.getSnapshot();
  if (task.awaitingReply || drawingRequests.getSnapshot().phase === "pending") return "正在想一想";
  if (task.phase === "failed" && !task.replyAccepted) return "回应暂未完成";
  if (task.replyAccepted || ["complete", "protected"].includes(task.phase)) return "小宇已回应";
  return "可以开始";
}

function createVoiceSupportText() {
  if (voice.recognitionSupported || (voiceCloudStatus?.cloudTranscription && voice.recordingSupported)) {
    return "说完后，等小宇回应。";
  }
  if (voice.recordingSupported) return "如果没有听清，可以让大人帮忙输入一句。";
  return "可以让大人帮忙输入一句。";
}

function createVoiceDiagnosticHtml() {
  const items = [
    { label: "自动听写", ok: voice.recognitionSupported },
    { label: "麦克风录音", ok: voice.recordingSupported && voice.secureEnough },
    { label: "语音转文字", ok: Boolean(voiceCloudStatus?.cloudTranscription) }
  ];

  return `
    ${items
      .map((item) => `<span class="${item.ok ? "is-ok" : "is-warn"}">${item.label}${item.ok ? "可用" : "待接"}</span>`)
      .join("")}
  `;
}

function saveOfflineObservation() {
  if (!state.offlineTask || !["assigned", "observed"].includes(state.offlineTask.status)) return;

  const observation = {
    completion: dom.observationForm.elements.completion.value,
    support: dom.observationForm.elements.support.value,
    behavior: dom.observationForm.elements.behavior.value,
    notes: dom.observationForm.elements.observationNotes.value.trim()
  };

  const studentModel = applyOfflineObservation(state.studentModel, state.offlineTask, observation);
  const observationSummary = createObservationSummary(observation, state.offlineTask);

  const saved = persistence.saveObservation({ ...state, studentModel }, state.offlineTask.id, observation);
  if (!saved.ok) return;

  state = { ...state, studentModel, memory: syncLegacyMemory(state.memory, studentModel),
    lastOfflineObservation: observationSummary,
    offlineTask: { ...state.offlineTask, status: "observed", lastObservedAt: observationSummary.createdAt } };
  commitState();
  if (!persistence.isSnapshotSaved(state)) return;
  dom.observationForm.observationNotes.value = "";
  dom.observationDrawer.open = false;
}

async function sendChildInput(text, source = {}) {
  const cleanText = text.trim();
  if (!cleanText || state.session?.status !== "active") return;
  if (!drawingPending) drawingStatus();
  const speaker = getActiveSpeaker(state.family, state.profile);

  const turn = conversation.begin({ sessionId: state.session.id, captureRevision: source.captureRevision });
  state = cancelPendingConversationState(state);
  voiceSession.prepareTurn();
  const turnSignal = turn.signal;
  const drawingBase = drawingGuard.capture(state);
  const evidenceBaseline = captureEnrichmentBaseline(state);
  const isLiveTurn = () => conversation.isCurrent(turn) && state.session?.status === "active" && state.session.id === drawingBase.sessionId;
  let pendingImageRoute = null;

  const stateForRequest = {
    ...state,
    messages: [
      ...state.messages.map(message => (interruptedReplies.has(message.id) && !message.interrupted
        ? { ...message, interrupted: true, ...(typeof interruptedReplies.get(message.id).heard === "string" ? { heard: interruptedReplies.get(message.id).heard } : {}) } : message)),
      {
        role: "child",
        id: `${turn.turnId}:child`,
        turnId: turn.turnId,
        text: cleanText,
        speakerId: speaker?.id || "",
        speakerName: speaker?.name || state.profile.name || "家人",
        speakerRole: speaker?.role || "child"
      }
    ],
    activeSpeaker: speaker
  };

  const drawingInput = drawingRequestInput(cleanText, stateForRequest);
  const retryDrawing = isDrawingRetry(cleanText);
  const localStudentEvents = [];
  let localTurn = createTutorTurn(drawingInput || cleanText, stateForRequest, {
    onStudentEvent: (...event) => localStudentEvents.push(event)
  });
  if (localTurn.safetyDecision?.protected) {
    cancelOpenDrawing();
    localTurn.drawingRequest = null;
    state = localTurn;
    dom.childInput.value = "";
    commitState();
    conversation.settle(turn, true, "protected");
    speakLatestTutorReply();
    return;
  }
  const farewell = conversationEndReply(cleanText);
  if (farewell) {
    state = { ...localTurn, drawingRequest: null };
    dom.childInput.value = "";
    finishCurrentSession({ farewell });
    return;
  }
  if (isTopicChange(cleanText)) {
    cancelOpenDrawing();
    stateForRequest.drawingRequest = null;
    localTurn = { ...localTurn, drawingRequest: null };
  }
  if (/^(?:请|先|这次)?(?:别画了|不要画了|不用画了|停止画画|取消画画|不用了)[。！!\s]*$/.test(cleanText)) {
    cancelOpenDrawing();
    localTurn = replaceLatestTutorReply({ ...localTurn, drawingRequest: null, activeLesson: null, offlineTask: null, board: stateForRequest.board, visualPlan: { changed: false } }, "好，先不画了。");
  } else if (retryDrawing && !drawingInput) {
    localTurn = replaceLatestTutorReply({ ...localTurn, activeLesson: null, offlineTask: null, board: stateForRequest.board, visualPlan: { changed: false } }, "你想画什么？告诉我画里的东西就可以。");
  } else if (retryDrawing && drawingPending) {
    localTurn = replaceLatestTutorReply({ ...localTurn, activeLesson: null, offlineTask: null, board: stateForRequest.board, visualPlan: { changed: false } }, "这幅还在画，画好就会显示出来。");
  } else if (validImageBoard(stateForRequest.board) && /^(?:请|帮我)?(?:撤销|退回|撤回|恢复上一版)[。！!\s]*$/.test(cleanText)) {
    cancelOpenDrawing();
    const previous = undoImageBoard(stateForRequest.board);
    localTurn = replaceLatestTutorReply({ ...localTurn, board: previous || stateForRequest.board,
      visualPlan: { changed: Boolean(previous) } }, previous ? "回到上一幅了。" : "已经是最开始的这幅了。");
  } else if ((!isTopicChange(cleanText) || topicChangeDrawingInput(cleanText)) && (retryDrawing || localTurn.visualPlan?.needsPlanner || (!localTurn.visualPlan && stateForRequest.drawingRequest?.sessionId === stateForRequest.session?.id && stateForRequest.drawingRequest) || (!localTurn.visualPlan && validImageBoard(stateForRequest.board)) ||
      (!localTurn.visualPlan && stateForRequest.board?.scene?.kind === "illustration"))) {
    state = { ...state, messages: stateForRequest.messages };
    renderVoiceState(); commitState();
    const pendingRequest = stateForRequest.drawingRequest?.sessionId === stateForRequest.session?.id ? stateForRequest.drawingRequest?.input : undefined;
    const request = drawingRequests.begin(turn, drawingBase, "route");
    let route;
    try { route = await routeDrawing(drawingInput, stateForRequest.board, stateForRequest.messages, turnSignal, pendingRequest); }
    catch {
      drawingRequests.finish(request, "request-failed");
      conversation.settle(turn, false, request.stage, "request-failed");
      return;
    }
    drawingRequests.finish(request, isLiveTurn() ? null : "stale-turn");
    if (!isLiveTurn()) return;
    localTurn = mergeDrawingTurn(state, localTurn, evidenceBaseline);
    const boardChanged = !drawingGuard.matches(state, drawingBase);
    if (boardChanged && route.mode !== "chat" && route.mode !== "clarify") {
      trace("drawing.rejected", { ...request, reason: "base-changed" });
      localTurn = retainUpdatedDrawing(state, localTurn);
    } else {
      localTurn.drawingRequest = { input: drawingInput, sessionId: stateForRequest.session?.id };
      localTurn.activeLesson = null; localTurn.offlineTask = null; localTurn.growthEvidence = null;
      if (route.mode === "image") {
        localTurn.drawingRequest.input = route.instruction;
        const waitingForBase = drawingPending && route.operation === "edit";
        if (waitingForBase) localTurn.drawingRequest = stateForRequest.drawingRequest;
        const reply = waitingForBase ? "这幅还在画，等它出来我们再接着改。" : route.available
          ? "我来试着画，你可以继续跟我说。" : "我记住你想画的内容了。不过现在图片功能还没开启，这次没能画出来。";
        localTurn = replaceLatestTutorReply({ ...localTurn, board: state.board, visualPlan: { changed: false } }, reply);
        if (route.available && !waitingForBase) pendingImageRoute = route;
        else if (!route.available) drawingStatus("图片功能未开启，这次没有生成新图");
      } else if (route.mode === "clarify") {
        localTurn = replaceLatestTutorReply({ ...localTurn, board: state.board,
          drawingRequest: boardChanged ? state.drawingRequest : localTurn.drawingRequest,
          visualPlan: { changed: false } }, route.reply);
      } else if (route.mode === "chat") {
        localTurn.visualPlan = null;
        localTurn.board = state.board;
        localTurn.drawingRequest = null;
        stateForRequest.drawingRequest = null;
      } else if (validImageBoard(stateForRequest.board)) {
        localTurn = replaceLatestTutorReply({ ...localTurn, board: state.board, visualPlan: { changed: false } }, "这幅图需要整体编辑，原图先留着。");
      } else {
        localTurn.visualPlan = { needsPlanner: true };
      }
    }
  }
  const fallbackReply = latestTutorReply(localTurn);
  if (localTurn.visualPlan?.needsPlanner) {
    state = { ...state, messages: stateForRequest.messages };
    dom.childInput.value = "";
    renderVoiceState();
    commitState();
    const request = drawingRequests.begin(turn, drawingBase, "plan");
    let planned;
    try { planned = await callDrawingPlanApi({ input: drawingInput, state: stateForRequest }, { signal: turnSignal }); }
    catch {
      drawingRequests.finish(request, "request-failed");
      conversation.settle(turn, false, request.stage, "request-failed");
      return;
    }
    drawingRequests.finish(request, isLiveTurn() ? null : "stale-turn");
    if (!isLiveTurn()) return;
    localTurn = mergeDrawingTurn(state, localTurn, evidenceBaseline);
    if (!drawingGuard.matches(state, drawingBase)) {
      trace("drawing.rejected", { ...request, reason: "base-changed" });
      localTurn = retainUpdatedDrawing(state, localTurn);
    } else if (planned?.plan) {
      localTurn = replaceLatestTutorReply({ ...localTurn, visualPlan: planned.plan,
        board: planned.plan.board, llmStatus: planned.llmStatus }, planned.plan.reply);
    } else {
      localTurn.llmStatus = planned?.llmStatus || { provider: "qwen", used: false, fallback: true };
    }
  }
  if (localTurn.visualPlan) {
    if (localTurn.visualPlan.changed) localTurn.drawingRequest = null;
    if (isInteractionControl(cleanText) || localTurn.visualPlan.needsPlanner || localTurn.visualPlan.changed === false) {
      const message = [...localTurn.messages].reverse().find(m => m.role === "child");
      if (message) message.growthEligible = false;
    }
    if (localTurn.visualPlan.changed && !validImageBoard(localTurn.board)) cancelOpenDrawing();
    state = mergeDrawingTurn(state, localTurn, evidenceBaseline);
    state = { ...state, session: incrementSessionTurn(state.session) };
    persistence.saveTurn(state, {
      moment: createGrowthMomentInput(cleanText, state, speaker, captureGrowthTurnContext(localTurn, state)),
      events: localStudentEvents.splice(0)
    });
    dom.childInput.value = "";
    commitState();
    conversation.settle(turn, true, "complete");
    if (pendingImageRoute) startOpenDrawing(pendingImageRoute, state.board, turn);
    speakLatestTutorReply();
    return;
  }
  let savedMoment = null;
  let growthContext = null;
  const submissionEvents = {
    pending: APP_EVENT.CONVERSATION_PENDING,
    quick: APP_EVENT.CONVERSATION_QUICK_REPLY,
    complete: APP_EVENT.CONVERSATION_COMPLETED,
    protected: APP_EVENT.CONVERSATION_PROTECTED
  };
  // All ordinary conversation stages cross the same receive boundary before effects.
  function acceptSubmission(submission, beforeCommit = () => {}) {
    if (!isLiveTurn()) { conversation.settle(turn, false, submission.kind); return false; }
    const applied = conversation.accept(turn, state, submission);
    if (!applied.accepted) { conversation.settle(turn, false, submission.kind, applied.reason); return false; }
    state = applied.state;
    beforeCommit();
    const accepted = commitState(state, { type: submissionEvents[submission.kind] });
    conversation.settle(turn, true, submission.kind);
    return accepted;
  }
  // Speak the quick reply sentence by sentence as it arrives, instead of after the whole reply is
  // written and committed. Any sentence failing the local output check stops this early playback;
  // the committed reply then takes the usual path, which replaces unsafe text.
  let earlyReply = null, earlyBlocked = false;
  const onQuickSentence = text => {
    if (earlyBlocked || !dom.speakReplies.checked) return;
    if (!checkTutorSafetyOutput(text).ok) { earlyBlocked = true; earlyReply?.cancel(); earlyReply = null; return; }
    earlyReply ||= voiceSession.playStreamingReply();
    earlyReply.push(text);
  };
  const outcome = await conversation.run({
    turn,
    input: cleanText,
    onQuickSentence,
    stateForRequest,
    localTurn,
    fallbackReply,
    evidenceBaseline: drawingContinuationBaseline(state, localTurn, evidenceBaseline),
    getState: () => state,
    onPending: submission => {
      const accepted = acceptSubmission(submission, () => {
        dom.childInput.value = "";
        renderVoiceState();
      });
      if (accepted) growthContext = captureGrowthTurnContext(localTurn, accepted);
      return accepted;
    },
    onQuickReply: (submission, { quickLatencyMs, replyMessageId }) => {
      const accepted = acceptSubmission(submission, () => {
        console.info("[小宇记耗时] 快速回答", quickLatencyMs, "ms");
        recordVoiceTiming({ stage: "quick-reply", latencyMs: quickLatencyMs });
        const saved = persistence.saveTurn(state, {
          moment: createGrowthMomentInput(cleanText, state, speaker, growthContext, undefined, replyMessageId),
          events: localStudentEvents.splice(0)
        });
        // A later model/event failure does not undo a moment that was already written.
        savedMoment = saved.moment;
      });
      if (!accepted) { earlyReply?.cancel(); return false; }
      if (earlyReply) {
        document.querySelector("#speechFailure").hidden = true;
        earlyReply.attach(replyMessageId);
        earlyReply.end();
      } else speakLatestTutorReply(replyMessageId);
      return state;
    }
  });

  if (outcome.status === "cancelled") return;
  const accepted = acceptSubmission(outcome.commit, () => {
    if (!outcome.enriched) return;
    console.info("[小宇记耗时] 完整回合", state.llmStatus.totalLatencyMs, "ms", {
      quickReplyMs: state.llmStatus.quickLatencyMs,
      enrichmentMs: state.llmStatus.latencyMs || 0
    });
    const saved = persistence.saveTurn(state, {
      moment: savedMoment ? createGrowthMomentInput(cleanText, state, speaker, growthContext, savedMoment, outcome.replyMessageId) : null
    });
    if (!saved.ok) voiceSession.suspendAutoListen();
  });
  if (!accepted) return;
  if (outcome.status === "protected") {
    speakLatestTutorReply();
    return;
  }
  if (!outcome.enriched) return;
  if (dom.workspace.dataset.activeView === "learn" && !document.hidden) {
    voiceSession.schedule();
  } else {
    renderVoiceState();
  }
}

function createGrowthMomentInput(childText, nextState, speaker, context, previousMoment, replyMessageId) {
  if (nextState.safetyDecision?.protected || !checkChildSafety(childText, nextState).ok) return;
  if (isInteractionControl(childText) || !context.eligible) return;
  const latestTutor = findTutorMessage(nextState, replyMessageId);
  if (!latestTutor?.text) return;

  const domain = context.domain;

  const evidence = nextState.growthEvidence || createLocalGrowthEvidence(childText, domain);
  const isChildSpeaker = !speaker || speaker.role === "child";
  return {
    updateId: previousMoment?.id,
    expectedRevision: previousMoment?.revision,
    studentId: nextState.studentModel?.studentId || "local-demo-student",
    sessionId: nextState.session?.id,
    childQuote: childText,
    tutorResponse: latestTutor.text,
    domain,
    domains: [domain],
    topics: evidence.topics?.length ? evidence.topics : collectGrowthTopics(childText, context),
    lessonTitle: context.lessonTitle,
    boardSnapshot: context.boardSnapshot,
    sourceType: isChildSpeaker ? "child_utterance" : "parent_note",
    speakerId: speaker?.id || "",
    speakerName: speaker?.name || nextState.profile.name || "孩子",
    speakerRole: speaker?.role || "child",
    evidence: isChildSpeaker
      ? evidence
      : {
          ...evidence,
          observation: `记录${speaker?.name || "家人"}补充的家庭观察，不作为孩子原话。`,
          inference: ""
        },
    sourceModel: nextState.llmStatus?.used ? nextState.llmStatus.model : "local_rules",
    reviewEligible: isChildSpeaker && evidence.shouldSave !== false,
    confidence: evidence.confidence ?? 1
  };
}

function createLocalGrowthEvidence(childText, domain) {
  return {
    type: childText.includes("?") || childText.includes("？") || /^(为什么|怎么|哪里|什么|谁)/.test(childText)
      ? "question"
      : domain === "story"
        ? "story"
        : "expression",
    sourceQuote: childText,
    observation: "记录孩子本轮主动说出的内容。",
    childIntent: domain === "story" ? "共同讲故事" : "表达或探索",
    inference: "",
    confidence: 1,
    shouldSave: true,
    topics: []
  };
}

function collectGrowthTopics(childText, context) {
  const textTopics = [
    "月亮",
    "太阳",
    "天空",
    "雨",
    "影子",
    "恐龙",
    "昆虫",
    "植物",
    "动物",
    "朋友",
    "分享",
    "颜色",
    "数字",
    "故事",
    "妈妈",
    "爸爸",
    "幼儿园"
  ].filter((topic) => childText.includes(topic));
  return [...new Set([...textTopics, ...context.topics])].slice(0, 12);
}

async function loadVoiceStatus() {
  try {
    const response = await fetch("/api/voice-status");
    voiceCloudStatus = await response.json();
  } catch {
    voiceCloudStatus = {
      cloudTranscription: false,
      message: "当前是静态/文件预览，云端语音转文字未连接。"
    };
  }
  commitState();
}

document.querySelector("#retrySpeech").addEventListener("click", () => {
  voice.preparePlayback();
  speakLatestTutorReply(voiceSession.getSnapshot().replyMessageId);
});

function speakLatestTutorReply(replyMessageId = null) {
  document.querySelector("#speechFailure").hidden = true;
  if (replyMessageId && !findTutorMessage(state, replyMessageId)) {
    renderVoiceState();
    return;
  }
  const publication = !replyMessageId && validVisualScene(state.board) ? state.board : findTutorMessage(state, replyMessageId)?.text;
  if (!checkTutorSafetyOutput(publication).ok) {
    stopWhiteboardPlayback(dom.whiteboard);
    state = createSafetyTurn(state, { protected: true, category: "output", reply: "这句话我需要再确认，不能随便给你建议。" });
    replyMessageId = null;
    commitState();
  }
  voiceSession.playReply({
    replyMessageId,
    enabled: dom.speakReplies.checked,
    ...(!replyMessageId && validVisualScene(state.board)
      ? { steps: state.board.scene.steps }
      : { text: findTutorMessage(state, replyMessageId)?.text })
  });
}

function recordVoiceTiming({ stage, latencyMs, serverLatencyMs = 0, reason, audioSeconds, levels } = {}) {
  if (!stage || !Number.isFinite(Number(latencyMs))) return;
  pilotLog.record({ stage, latencyMs, serverLatencyMs, reason, audioSeconds, levels });
  recentVoiceTimings.push({ stage, latencyMs: Math.round(Number(latencyMs)), serverLatencyMs: Math.round(Number(serverLatencyMs || 0)), at: new Date().toISOString() });
  if (recentVoiceTimings.length > 80) recentVoiceTimings.shift();
  // Timing only: no transcript, identity, credentials or audio is retained.
  window.xiaoyuVoiceTimings = () => recentVoiceTimings.map((item) => ({ ...item }));
  console.info(`[小宇记耗时] ${stage.toUpperCase()}`, Math.round(Number(latencyMs)), "ms", {
    serverLatencyMs: Math.round(Number(serverLatencyMs || 0))
  });
}

async function saveProfileFromForm() {
  if (profileSaving) return false;
  if (!dom.profileForm.studentName.value.trim()) {
    dom.profileSaveStatus.textContent = "先填写孩子昵称。";
    dom.profileForm.studentName.setAttribute("aria-invalid", "true");
    dom.profileForm.studentName.focus();
    return false;
  }
  dom.profileForm.studentName.removeAttribute("aria-invalid");
  const enteredPin = dom.parentPin.value.trim();
  if (enteredPin && !normalizeParentPin(enteredPin)) {
    dom.profileSaveStatus.textContent = "家长码需要是4位数字。";
    return false;
  }
  profileSaving = true;
  dom.saveProfile.disabled = true;
  dom.saveProfile.textContent = "保存中";
  try {
  const parentPinHash = enteredPin ? await hashParentPin(enteredPin) : state.profile.parentPinHash || "";
  appStore.update(current => updateProfileState(current, {
    name: dom.profileForm.studentName.value.trim(),
    ageBand: dom.profileForm.ageBand.value,
    interest: dom.profileForm.interest.value.trim(),
    goal: dom.profileForm.goal.value.trim(),
    consent: dom.profileForm.consent.checked,
    parentPinHash,
    showSessionSummary: dom.profileForm.showSessionSummary.checked,
    configured: Boolean(dom.profileForm.studentName.value.trim())
  }), { type: APP_EVENT.PROFILE_UPDATED });
  if (!persistence.isSnapshotSaved(state) || !persistence.saveProfile(state).ok) {
    dom.profileSaveStatus.textContent = "没能完整保存，请重试或下载备份。";
    return false;
  }
  dom.profileSaveStatus.textContent = enteredPin ? "资料和家长码已保存。" : "资料已保存。";
  syncProfileForm();
  return true;
  } catch {
    dom.profileSaveStatus.textContent = "没能完整保存，请重试或下载备份。";
    return false;
  } finally {
    profileSaving = false;
    dom.saveProfile.disabled = false;
    dom.saveProfile.textContent = "保存资料";
  }
}

function startSessionFromParent() {
  voice.preparePlayback();
  if (state.session?.status === "active") {
    switchView("learn");
    voiceSession.resume();
    return;
  }

  const name = state.profile.configured ? state.profile.name : dom.startChildName.value.trim();
  const consent = state.profile.configured ? state.profile.consent : dom.startConsent.checked;
  if (!name) {
    dom.sessionFormStatus.textContent = "先填写孩子昵称。";
    dom.startChildName.focus();
    return;
  }
  if (!consent) {
    dom.sessionFormStatus.textContent = "需要家长同意后，才能在本机保存成长记录。";
    dom.startConsent.focus();
    return;
  }

  appStore.update(current => startSessionState(current, {
    name,
    ageBand: current.profile.configured ? current.profile.ageBand : dom.startAgeBand.value,
    consent, configured: true
  }), { type: APP_EVENT.SESSION_STARTED });
  const saved = persistence.startSession(state);
  const fullySaved = saved.ok && persistence.isSnapshotSaved(state);
  parentUnlockedUntil = 0;
  syncProfileForm();
  renderVoiceState();
  switchView("learn");
  if (fullySaved) voiceSession.resume();
}

function startSessionFromMobileHome() {
  if (!state.profile.configured || !state.profile.consent) {
    showParentSetup("第一次使用，请大人先完成简单设置。");
    return;
  }
  syncProfileForm();
  startSessionFromParent();
  window.setTimeout(() => dom.mainVoiceButton.focus(), 0);
}

function showParentSetup(message = "") {
  switchView("parent");
  dom.sessionFormStatus.textContent = message;
  window.setTimeout(() => {
    dom.parentSessionPanel.scrollIntoView({ block: "start" });
    if (!state.profile.configured) dom.startChildName.focus();
  }, 0);
}

function finishCurrentSession({ farewell = null } = {}) {
  if (state.session?.status !== "active") return;
  stopInteraction({ persist: false });
  const moments = getStudentGrowthMoments(state.studentModel?.studentId);
  // Include the cleaned stop state in the same lifecycle update.
  const stopped = state;
  appStore.update(() => endSessionState(stopped, moments), { type: APP_EVENT.SESSION_ENDED });
  const saved = persistence.finishSession(state);
  const fullySaved = saved.ok && persistence.isSnapshotSaved(state);

  renderVoiceState();
  switchView("parent");
  if (!fullySaved) dom.sessionFormStatus.textContent = "聊天已结束，但记录未完整保存，请下载已有备份。";
  if (farewell && dom.speakReplies.checked) {
    voiceSession.acknowledgeEnd(farewell);
  }
}

dom.navButtons.forEach((button) => button.addEventListener("click", () => runNavigationAction(button.dataset.navAction)));

document.querySelectorAll("[data-view-link]").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.viewLink));
});

function switchView(view) {
  if (view !== "parent") microphoneSettings.reset();
  if (view !== "learn") stopInteraction();
  dom.navButtons.forEach((item) => {
    const active = item.dataset.view === view;
    item.classList.toggle("is-active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  dom.workspace.dataset.activeView = view;
  requestVoiceRender();
  window.scrollTo({ top: 0, behavior: "auto" });
  closeMobileDrawer();
}

function openMobileDrawer() {
  if (mobileDrawerTimer) window.clearTimeout(mobileDrawerTimer);
  dom.mobileDrawer.hidden = false;
  document.body.classList.add("mobile-menu-open");
  dom.mobileMenuButton.setAttribute("aria-expanded", "true");
  dom.workspace.inert = true;
  document.querySelector(".topbar").inert = true;
  window.requestAnimationFrame(() => {
    dom.mobileDrawer.classList.add("is-open");
    dom.mobileDrawerPanel.focus({ preventScroll: true });
  });
}

function closeMobileDrawer() {
  if (dom.mobileDrawer.hidden) return;
  dom.mobileDrawer.classList.remove("is-open");
  document.body.classList.remove("mobile-menu-open");
  dom.mobileMenuButton.setAttribute("aria-expanded", "false");
  dom.workspace.inert = false;
  document.querySelector(".topbar").inert = false;
  if (dom.mobileDrawer.contains(document.activeElement)) dom.mobileMenuButton.focus();
  if (mobileDrawerTimer) window.clearTimeout(mobileDrawerTimer);
  mobileDrawerTimer = window.setTimeout(() => {
    dom.mobileDrawer.hidden = true;
    mobileDrawerTimer = null;
  }, 240);
}

function runNavigationAction(action) {
  closeMobileDrawer();
  const item = getNavigationItem(action);
  if (!item) return;
  if (!item.protected) {
    parentUnlockedUntil = 0;
    switchView(item.view);
    return;
  }
  if (action === "growth") {
    requestParentAccess(() => switchView(item.view));
    return;
  }
  if (action === "parent") {
    requestParentAccess(() => {
      switchView(item.view);
    });
    return;
  }
  if (action === "backup") {
    requestParentAccess(() => switchView(item.view));
  }
}

dom.askForm.addEventListener("submit", (event) => {
  event.preventDefault();
  sendChildInput(dom.childInput.value);
});

dom.whiteboard.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-prompt]");
  if (!button) return;
  sendChildInput(button.dataset.prompt);
});

dom.mainVoiceButton.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  dom.mainVoiceButton.setPointerCapture?.(event.pointerId);
  voicePointerStopsExisting = voiceSession.getSnapshot().input === "capturing";
  voicePressStartedAt = window.performance.now();
  if (voicePointerStopsExisting) return;
  voiceSession.beginInput();
});

dom.mainVoiceButton.addEventListener("pointerup", (event) => {
  event.preventDefault();
  const pressDuration = window.performance.now() - voicePressStartedAt;
  if (shouldFinishVoiceOnRelease({ wasAlreadyListening: voicePointerStopsExisting, pressDurationMs: pressDuration })) {
    voiceSession.finishInput();
  }
  voicePressStartedAt = 0;
  voicePointerStopsExisting = false;
});

dom.mainVoiceButton.addEventListener("pointercancel", () => {
  voicePressStartedAt = 0;
  voicePointerStopsExisting = false;
  voiceSession.finishInput();
});
dom.mainVoiceButton.addEventListener("contextmenu", (event) => event.preventDefault());

dom.mainVoiceButton.addEventListener("keydown", (event) => {
  if (!["Enter", " "].includes(event.key) || event.repeat) return;
  event.preventDefault();
  voiceSession.beginInput();
});

dom.mainVoiceButton.addEventListener("keyup", (event) => {
  if (!["Enter", " "].includes(event.key)) return;
  event.preventDefault();
  voiceSession.finishInput();
});

dom.profileForm.addEventListener("submit", (event) => { event.preventDefault(); saveProfileFromForm(); });
dom.startChildSession.addEventListener("click", startSessionFromParent);
dom.endChildSession.addEventListener("click", () => requestParentAccess(finishCurrentSession));
dom.whiteboard.addEventListener("drawing-undo", () => {
  if (validImageBoard(state.board)) void sendChildInput("撤销");
});
dom.whiteboard.addEventListener("whiteboard-replay", () => {
  stopInteraction();
  replayWhiteboard(dom.whiteboard);
});
dom.endParentSession.addEventListener("click", finishCurrentSession);
dom.activeSpeaker.addEventListener("change", () => {
  appStore.update(current => ({ ...current, family: setActiveSpeaker(current.family, dom.activeSpeaker.value) }),
    { type: APP_EVENT.FAMILY_UPDATED });
  renderVoiceState();
});
dom.familyMemberForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = dom.familyMemberName.value.trim();
  if (!name) {
    dom.familyMemberStatus.textContent = "先填写一个称呼。";
    dom.familyMemberName.focus();
    return;
  }
  const caregiverCount = state.family.members.filter((member) => member.role !== "child").length;
  if (caregiverCount >= MAX_CAREGIVERS) {
    dom.familyMemberStatus.textContent = "一个孩子档案最多可以登记 6 位家长或照护者。";
    return;
  }
  const previousCount = state.family.members.length;
  appStore.update(current => ({ ...current, family: addFamilyMember(current.family, {
    name, role: dom.familyMemberRole.value
  }) }), { type: APP_EVENT.FAMILY_UPDATED });
  if (state.family.members.length === previousCount) {
    dom.familyMemberStatus.textContent = "没有添加成功，请换一个称呼再试。";
    return;
  }
  dom.familyMemberName.value = "";
  dom.familyMemberStatus.textContent = `已添加${name}。聊天时可以选择由谁说话。`;
});
dom.familyMemberList.addEventListener("click", (event) => {
  const button = event.target.closest('[data-family-action="remove"]');
  if (!button) return;
  const target = state.family.members.find((member) => member.id === button.dataset.memberId);
  appStore.update(current => ({ ...current, family: removeFamilyMember(current.family, button.dataset.memberId) }),
    { type: APP_EVENT.FAMILY_UPDATED });
  dom.familyMemberStatus.textContent = target ? `已移除${target.name}。` : "";
});
dom.sessionGate.addEventListener("click", (event) => {
  voice.preparePlayback();
  if (event.target.closest('[data-session-action="show-parent"]')) switchView("parent");
  if (event.target.closest('[data-session-action="quick-start"]')) startSessionFromMobileHome();
  const navigationButton = event.target.closest("[data-nav-action]");
  if (navigationButton) runNavigationAction(navigationButton.dataset.navAction);
});

dom.mobileMenuButton.addEventListener("click", openMobileDrawer);
dom.mobileDrawerBackdrop.addEventListener("click", closeMobileDrawer);
dom.mobileDrawerClose.addEventListener("click", closeMobileDrawer);
document.addEventListener("keydown", (event) => {
  if (event.key === "Tab" && !dom.mobileDrawer.hidden) {
    const controls = [...dom.mobileDrawerPanel.querySelectorAll("button:not(:disabled)")];
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && [dom.mobileDrawerPanel, first].includes(document.activeElement)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  if (event.key === "Escape" && !dom.mobileDrawer.hidden) {
    closeMobileDrawer();
    dom.mobileMenuButton.focus();
  }
});

dom.resetSession.addEventListener("click", () => {
  const fresh = createInitialState();
  commitState({ ...state, messages: fresh.messages, board: fresh.board, activeLesson: null, lastAssessment: null });
});

dom.exportData.addEventListener("click", () => {
  exportState(state, loadLocalStudentDb());
});

dom.backupExportData.addEventListener("click", () => {
  exportState(state, loadLocalStudentDb());
});

dom.copyParentNote.addEventListener("click", async () => {
  const note = createParentNoteText(state);
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(note);
    dom.copyParentNote.textContent = "已复制";
  } else {
    dom.copyParentNote.textContent = "请手动复制";
  }
  setTimeout(() => {
    dom.copyParentNote.textContent = "复制";
  }, 1200);
});

dom.saveObservation.addEventListener("click", saveOfflineObservation);

dom.clearParentPin.addEventListener("click", () => {
  appStore.update(current => updateProfileState(current, { parentPinHash: "" }), { type: APP_EVENT.PROFILE_UPDATED });
  parentUnlockedUntil = 0;
  dom.profileSaveStatus.textContent = "家长码已清除。";
});

dom.parentUnlockForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const correct = await verifyParentPin(dom.parentUnlockPin.value, state.profile.parentPinHash);
  if (!correct) {
    dom.parentLockStatus.textContent = "家长码不对，请再试一次。";
    dom.parentUnlockPin.select();
    return;
  }
  parentUnlockedUntil = Date.now() + 5 * 60_000;
  closeParentLock();
  const action = pendingParentAction;
  pendingParentAction = null;
  action?.();
});

dom.cancelParentUnlock.addEventListener("click", () => {
  pendingParentAction = null;
  closeParentLock();
});

for (const dashboard of [dom.memoryDashboard, dom.backupDashboard]) {
  dashboard.addEventListener("change", (event) => {
    if (event.target.matches("[data-growth-range]")) {
      growthSelection = { range: event.target.value, offset: 0, bucket: null };
      refreshGrowthDashboard('[data-growth-range]:checked');
      return;
    }
    if (event.target.id !== "selectAllMoments") return;
    dashboard.querySelectorAll(".moment-select").forEach((checkbox) => {
      checkbox.checked = event.target.checked;
    });
  });

  dashboard.addEventListener("click", (event) => handleMemoryAction(event, dashboard));
}

function refreshGrowthDashboard(focusSelector) {
  renderMemoryDashboard(dom.memoryDashboard, state.memory, state.studentModel, state.activeLesson,
    getStudentGrowthMoments(state.studentModel?.studentId), growthSelection);
  window.lucide?.createIcons();
  dom.memoryDashboard.querySelector(focusSelector)?.focus({ preventScroll: true });
}

dom.memoryDashboard.addEventListener("click", (event) => {
  const step = event.target.closest("[data-growth-step]");
  const bucket = event.target.closest("[data-growth-bucket]");
  if (step && !step.disabled) {
    growthSelection.offset = Math.max(0, growthSelection.offset + (step.dataset.growthStep === "previous" ? 1 : -1));
    growthSelection.bucket = null;
    refreshGrowthDashboard('[data-growth-step="previous"]');
  } else if (bucket) {
    growthSelection.bucket = bucket.dataset.growthBucket;
    refreshGrowthDashboard(`[data-growth-bucket="${growthSelection.bucket}"]`);
  }
});

function handleMemoryAction(event, dashboard) {
  const button = event.target.closest("[data-memory-action]");
  if (!button) return;
  const action = button.dataset.memoryAction;
  if (action === "edit") {
    archiveControls.openEditor(button.dataset.momentId, button);
    return;
  }
  if (action === "start-first") {
    switchView("learn");
    return;
  }
  if (action === "open-backup") {
    requestParentAccess(() => switchView("backup"));
    return;
  }

  const moments = getStudentGrowthMoments(state.studentModel?.studentId);
  const format = dashboard.querySelector("#momentDownloadFormat")?.value || "text";
  if (action === "toggle-save") {
    const moment = moments.find((item) => item.id === button.dataset.momentId);
    if (!moment) return;
    if (!persistence.starMoments([moment.id], !moment.saved).ok) {
      setMomentActionStatus("未能保存珍藏标记，请重试或下载备份。");
      return;
    }
    const message = moment.saved ? "已取消珍藏" : "已珍藏这句话";
    render();
    setMomentActionStatus(message);
    return;
  }
  if (action === "download-one") {
    const moment = moments.find((item) => item.id === button.dataset.momentId);
    if (!moment) return;
    exportConversationMoments([withDomainLabel(moment)], format, state.profile.name);
    setMomentActionStatus("已经开始下载");
    return;
  }

  const selectedIds = getSelectedMomentIds(dashboard);
  if (!selectedIds.length) {
    setMomentActionStatus("请先勾选想保存的对话");
    return;
  }
  if (action === "save-selected") {
    if (!persistence.starMoments(selectedIds, true).ok) {
      setMomentActionStatus("未能保存珍藏标记，请重试或下载备份。");
      return;
    }
    render();
    setMomentActionStatus(`已珍藏 ${selectedIds.length} 条对话`);
    return;
  }
  if (action === "download-selected") {
    const selected = moments.filter((item) => selectedIds.includes(item.id)).map(withDomainLabel);
    exportConversationMoments(selected, format, state.profile.name);
    setMomentActionStatus(`正在下载 ${selected.length} 条对话`);
  }
}

function getSelectedMomentIds(dashboard) {
  return [...dashboard.querySelectorAll(".moment-select:checked")].map((input) => input.value);
}

function withDomainLabel(moment) {
  return { ...moment, domainLabel: domainLabel(moment.domain) };
}

function setMomentActionStatus(message) {
  const status = dom.backupDashboard.querySelector("#momentActionStatus");
  if (status) status.textContent = message;
}

function requestParentAccess(action) {
  if (!state.profile.parentPinHash || Date.now() < parentUnlockedUntil) {
    action();
    return;
  }
  pendingParentAction = action;
  dom.parentLock.hidden = false;
  dom.parentLockStatus.textContent = "";
  dom.parentUnlockPin.value = "";
  window.setTimeout(() => dom.parentUnlockPin.focus(), 0);
}

function closeParentLock() {
  dom.parentLock.hidden = true;
  dom.parentUnlockPin.value = "";
  dom.parentLockStatus.textContent = "";
}

function escapeUi(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopInteraction();
});

window.addEventListener("pagehide", () => stopInteraction());

syncProfileForm();
if (!state.profile.configured && state.session?.status !== "active" && !window.matchMedia("(max-width: 900px)").matches) {
  switchView("parent");
}
commitState(state, { type: APP_EVENT.INITIALIZED });
document.documentElement.dataset.appReady = "true";
loadVoiceStatus();
