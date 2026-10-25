export const MAX_CAREGIVERS = 6;
export const MAX_FAMILY_MEMBERS = MAX_CAREGIVERS + 1;

export const familyRoles = {
  child: "孩子",
  mother: "妈妈",
  father: "爸爸",
  grandparent: "祖辈",
  caregiver: "照护者",
  other: "其他家人"
};

export function createInitialFamily(profile = {}) {
  const family = {
    members: [],
    activeSpeakerId: "",
    speakerRecognition: {
      mode: "manual_fallback",
      status: "not_connected"
    }
  };
  return syncPrimaryChild(family, profile);
}

export function ensureFamilyState(value = {}, profile = {}) {
  const normalizedMembers = Array.isArray(value.members)
    ? value.members.map(normalizeFamilyMember).filter((item) => item.name)
    : [];
  const primaryCandidate =
    normalizedMembers.find((item) => item.isPrimaryChild) || normalizedMembers.find((item) => item.role === "child");
  const caregivers = normalizedMembers
    .filter((item) => item.id !== primaryCandidate?.id && item.role !== "child")
    .slice(0, MAX_CAREGIVERS);
  const members = primaryCandidate
    ? [{ ...primaryCandidate, role: "child", isPrimaryChild: true }, ...caregivers]
    : caregivers;
  const family = {
    members,
    activeSpeakerId: members.some((item) => item.id === value.activeSpeakerId)
      ? value.activeSpeakerId
      : members[0]?.id || "",
    speakerRecognition: {
      mode: "manual_fallback",
      status: value.speakerRecognition?.status === "connected" ? "connected" : "not_connected"
    }
  };
  return syncPrimaryChild(family, profile);
}

export function syncPrimaryChild(family, profile = {}) {
  const name = cleanText(profile.name, 24);
  const current = ensureFamilyShape(family);
  if (!name) return current;

  const index = current.members.findIndex((item) => item.isPrimaryChild);
  if (index >= 0) {
    const members = [...current.members];
    members[index] = { ...members[index], name, role: "child", isPrimaryChild: true };
    return { ...current, members, activeSpeakerId: current.activeSpeakerId || members[index].id };
  }

  const member = createFamilyMember({ name, role: "child", isPrimaryChild: true });
  return {
    ...current,
    members: [member, ...current.members],
    activeSpeakerId: current.activeSpeakerId || member.id
  };
}

export function addFamilyMember(family, input = {}) {
  const current = ensureFamilyShape(family);
  if (input.role === "child") return current;
  const caregiverCount = current.members.filter((item) => item.role !== "child").length;
  if (caregiverCount >= MAX_CAREGIVERS) return current;
  const member = createFamilyMember(input);
  if (!member.name) return current;
  return {
    ...current,
    members: [...current.members, member],
    activeSpeakerId: current.activeSpeakerId || member.id
  };
}

export function removeFamilyMember(family, memberId) {
  const current = ensureFamilyShape(family);
  const target = current.members.find((item) => item.id === memberId);
  if (!target || target.isPrimaryChild) return current;
  const members = current.members.filter((item) => item.id !== memberId);
  return {
    ...current,
    members,
    activeSpeakerId: current.activeSpeakerId === memberId ? members[0]?.id || "" : current.activeSpeakerId
  };
}

export function setActiveSpeaker(family, memberId) {
  const current = ensureFamilyShape(family);
  if (!current.members.some((item) => item.id === memberId)) return current;
  return { ...current, activeSpeakerId: memberId };
}

export function getActiveSpeaker(family, profile = {}) {
  const current = ensureFamilyState(family, profile);
  return current.members.find((item) => item.id === current.activeSpeakerId) || current.members[0] || null;
}

export function familyRoleLabel(role) {
  return familyRoles[role] || familyRoles.other;
}

function createFamilyMember(input = {}) {
  return normalizeFamilyMember({
    id: input.id || createId(),
    name: input.name,
    role: input.role,
    isPrimaryChild: Boolean(input.isPrimaryChild),
    voiceEnrollment: { status: "not_enrolled" }
  });
}

function normalizeFamilyMember(value = {}) {
  const role = Object.hasOwn(familyRoles, value.role) ? value.role : "other";
  return {
    id: cleanText(value.id, 80) || createId(),
    name: cleanText(value.name, 24),
    role,
    isPrimaryChild: Boolean(value.isPrimaryChild),
    voiceEnrollment: {
      status: value.voiceEnrollment?.status === "enrolled" ? "enrolled" : "not_enrolled"
    }
  };
}

function ensureFamilyShape(value = {}) {
  const members = Array.isArray(value.members) ? value.members : [];
  return {
    members,
    activeSpeakerId: value.activeSpeakerId || members[0]?.id || "",
    speakerRecognition: value.speakerRecognition || { mode: "manual_fallback", status: "not_connected" }
  };
}

function createId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return `family_${crypto.randomUUID()}`;
  return `family_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function cleanText(value, limit) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}
