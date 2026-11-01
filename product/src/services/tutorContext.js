import { safeConversationMessages } from "./safety.js";

const text = (value, max) => typeof value === "string" ? value.slice(0, max) : "";
const texts = (value, count, max) => Array.isArray(value)
  ? value.filter(item => typeof item === "string").slice(-count).map(item => text(item, max)) : [];

// Text conversation context, not an application snapshot or a household identity.
// Drawing has its own API; student assessment and durable memory stay on the device.
export function createTutorContext(state = {}) {
  const profile = state.profile || {};
  const speaker = state.activeSpeaker || {};
  const safety = state.safetyContext;
  return {
    profile: {
      name: text(profile.name, 80), ageBand: text(profile.ageBand, 10),
      interest: text(profile.interest, 200), goal: text(profile.goal, 200)
    },
    activeSpeaker: { name: text(speaker.name || profile.name, 80), role: text(speaker.role, 30) || "child" },
    messages: safeConversationMessages((Array.isArray(state.messages) ? state.messages : [])
      .filter(message => message && typeof message.text === "string"))
      .filter(message => ["child", "tutor"].includes(message.role)).slice(-12).map(message => ({
        role: message.role, text: text(message.text, 4000),
        speakerName: text(message.speakerName, 80), speakerRole: text(message.speakerRole, 30),
        ...(message.role === "tutor" && message.interrupted === true ? { interrupted: true } : {})
      })),
    memory: { interests: texts(state.memory?.interests, 6, 80), recentWins: texts(state.memory?.recentWins, 4, 100) },
    board: { type: "blank" },
    activeLesson: state.activeLesson ? {
      activity: text(state.activeLesson.activity, 30), awaitingAnswer: state.activeLesson.awaitingAnswer === true
    } : null,
    safetyContext: safety ? {
      category: text(safety.category, 40), remaining: Number(safety.remaining), expiresAt: Number(safety.expiresAt)
    } : undefined
  };
}

export function createTutorRequest(payload) {
  return {
    input: payload.input, state: createTutorContext(payload.state),
    fallbackReply: text(payload.fallbackReply, 600), spokenReply: text(payload.spokenReply, 600)
  };
}

export function tutorEnrichmentResult(result, memory = {}) {
  return {
    ...(result.memory ? { memory: { ...memory,
      interests: texts(result.memory.interests, 6, 80), recentWins: texts(result.memory.recentWins, 4, 100)
    } } : {}),
    growthEvidence: result.growthEvidence,
    llmStatus: result.llmStatus
  };
}
