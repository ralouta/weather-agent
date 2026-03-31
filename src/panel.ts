// src/panel.ts
// Collapse / expand behaviour for the assistant panel.

const collapseBtn  = document.getElementById("collapseBtn")!;
const panelBody    = document.getElementById("panelBody")!;
const assistantPanel = document.getElementById("assistantPanel")!;
const assistantLauncher = document.getElementById("assistantLauncher")!;
const assistantLaunchBtn = document.getElementById("assistantLaunchBtn")!;

let collapsed = false;

function renderCollapseState() {
  panelBody.classList.toggle("collapsed", collapsed);
  assistantPanel.classList.toggle("collapsed", collapsed);
  assistantLauncher.toggleAttribute("hidden", !collapsed);
}

collapseBtn.addEventListener("click", () => {
  collapsed = true;
  renderCollapseState();
});

assistantLaunchBtn.addEventListener("click", () => {
  collapsed = false;
  renderCollapseState();
});

renderCollapseState();

export {};
