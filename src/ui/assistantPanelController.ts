interface AssistantPanelElements {
  root: HTMLElement;
  collapseButton: HTMLElement;
  body: HTMLElement;
  launcherShell: HTMLElement;
  launcherButton: HTMLElement;
}

export interface AssistantPanelController {
  destroy(): void;
}

export function createAssistantPanelController(
  elements: AssistantPanelElements
): AssistantPanelController {
  let collapsed = false;

  const render = () => {
    elements.body.classList.toggle("collapsed", collapsed);
    elements.root.classList.toggle("collapsed", collapsed);
    elements.launcherShell.toggleAttribute("hidden", !collapsed);
  };

  const onCollapse = () => {
    collapsed = true;
    render();
  };

  const onExpand = () => {
    collapsed = false;
    render();
  };

  elements.collapseButton.addEventListener("click", onCollapse);
  elements.launcherButton.addEventListener("click", onExpand);
  render();

  return {
    destroy() {
      elements.collapseButton.removeEventListener("click", onCollapse);
      elements.launcherButton.removeEventListener("click", onExpand);
    },
  };
}
