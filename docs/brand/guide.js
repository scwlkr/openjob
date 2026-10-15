// Local concept behavior only. No network, storage, or provider actions.
const workspace = document.querySelector("#workspace");
const themeToggle = document.querySelector("#theme-toggle");
themeToggle.addEventListener("click", () => {
  const dark = workspace.dataset.theme !== "dark";
  workspace.dataset.theme = dark ? "dark" : "light";
  themeToggle.setAttribute("aria-pressed", String(dark));
  themeToggle.innerHTML = `${dark ? "Light" : "Dark"} appearance <span aria-hidden="true">◐</span>`;
});

document.querySelectorAll("[data-module]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-module]").forEach((item) => {
      item.setAttribute("aria-pressed", String(item === button));
    });
    document.querySelectorAll("[data-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.panel !== button.dataset.module;
    });
  });
});

document.querySelector("#create-task").addEventListener("click", (event) => {
  document.querySelector("#linked-task").hidden = false;
  document.querySelector("#task-count").textContent = "3";
  document.querySelector("#task-feedback").textContent = "Task created in this concept. Find it in Tasks.";
  event.currentTarget.textContent = "✓  Task created";
  event.currentTarget.disabled = true;
});

const permissions = [
  ["#allow-read", "read this mailbox"],
  ["#allow-draft", "create drafts"],
  ["#allow-send", "send from this mailbox"],
];
function describePermissions() {
  const allowed = permissions.filter(([id]) => document.querySelector(id).checked)
    .map(([, action]) => action);
  const actions = allowed.length > 1
    ? `${allowed.slice(0, -1).join(", ")} and ${allowed.at(-1)}`
    : allowed[0];
  const description = actions ? `Can ${actions}.` : "No mailbox access is enabled.";
  const sending = document.querySelector("#allow-send").checked ? "" : " Sending is off.";
  document.querySelector("#permission-summary").textContent = description + sending;
}
permissions.forEach(([id]) => document.querySelector(id).addEventListener("change", describePermissions));
