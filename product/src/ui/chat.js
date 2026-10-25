export function renderMessages(container, messages) {
  container.innerHTML = messages
    .map(
      (message) => `
        <div class="message message-${message.role}">
          <span>${labelForMessage(message)}</span>
          <p>${escapeHtml(message.text)}</p>
        </div>
      `
    )
    .join("");
  container.scrollTop = container.scrollHeight;
}

function labelForMessage(message) {
  if (message.role === "child") return escapeHtml(message.speakerName || "家人");
  if (message.role === "system") return "系统";
  return "小宇";
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
