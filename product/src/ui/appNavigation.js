export const APP_NAV_ITEMS = Object.freeze([
  { action: "talk", view: "learn", label: "一起聊", icon: "talk", protected: false },
  { action: "growth", view: "memory", label: "成长记录", icon: "growth", protected: true },
  { action: "parent", view: "parent", label: "家庭设置", icon: "parent", protected: true },
  { action: "backup", view: "backup", label: "备份记录", icon: "export", protected: true }
]);

// The parent area's sections: top tabs on wide screens, bottom tabs on phones. "Back to Xiaoyu" is
// its own button, so the child's screen has no navigation at all.
export function createNavigationMarkup(mode = "desktop") {
  const icons = { talk: "messages-square", growth: "sprout", parent: "users", export: "archive" };
  const buttonClass = mode === "tabs" ? "tab-button" : "nav-button";
  return APP_NAV_ITEMS.filter((item) => item.protected).map(
    (item) => `
      <button
        class="${buttonClass}"
        type="button"
        data-nav-action="${item.action}"
        data-view="${item.view}"
      >
        <i data-lucide="${icons[item.icon]}" aria-hidden="true"></i>
        <span>${item.label}</span>
      </button>
    `
  ).join("");
}

export function getNavigationItem(action) {
  return APP_NAV_ITEMS.find((item) => item.action === action) || null;
}
