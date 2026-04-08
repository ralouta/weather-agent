import type SceneView from "@arcgis/core/views/SceneView.js";

interface ViewPaddingOptions {
  view: SceneView;
  header: HTMLElement;
  assistantPanel: HTMLElement;
  assistantLauncher: HTMLElement;
  compassShell: HTMLElement;
}

export interface ViewPaddingController {
  sync(): void;
  destroy(): void;
}

export function createViewPaddingController(
  options: ViewPaddingOptions
): ViewPaddingController {
  const positionCompass = (anchorLeft: number, anchorBottom: number | null) => {
    const rightOffset = Math.max(16, Math.ceil(window.innerWidth - anchorLeft + 12));
    options.compassShell.style.right = `${rightOffset}px`;
    if (anchorBottom !== null) {
      // Align compass vertically with the anchor element (panel or launcher)
      options.compassShell.style.bottom = `${anchorBottom}px`;
    } else {
      options.compassShell.style.bottom = "40px";
    }
  };

  const syncPadding = () => {
    const headerRect = options.header.getBoundingClientRect();
    const topPadding = Math.ceil(headerRect.bottom + 12);

    let rightPadding = 16;

    if (!options.assistantPanel.classList.contains("collapsed")) {
      const panelRect = options.assistantPanel.getBoundingClientRect();
      rightPadding = Math.max(16, Math.ceil(window.innerWidth - panelRect.left + 12));
      positionCompass(panelRect.left, null);
    } else if (!options.assistantLauncher.hasAttribute("hidden")) {
      // When minimised, align compass alongside the launcher button without overlap.
      // Place it to the left of the launcher with a small gap.
      const launcherRect = options.assistantLauncher.getBoundingClientRect();
      rightPadding = Math.max(16, Math.ceil(window.innerWidth - launcherRect.left + 12));
      const launcherRight = Math.ceil(window.innerWidth - launcherRect.right);
      const compassWidth = options.compassShell.getBoundingClientRect().width || 40;
      const compassRight = launcherRight + launcherRect.width + 8;
      const launcherBottom = Math.ceil(window.innerHeight - launcherRect.bottom);
      // override positionCompass: align vertically with launcher, sit to its left
      options.compassShell.style.right = `${compassRight}px`;
      options.compassShell.style.bottom = `${launcherBottom}px`;
    } else {
      options.compassShell.style.right = "16px";
      options.compassShell.style.bottom = "40px";
    }

    options.view.padding = {
      top: topPadding,
      right: rightPadding,
      bottom: 16,
      left: 16,
    };
  };

  const scheduleSync = () => {
    window.requestAnimationFrame(syncPadding);
  };

  const resizeObserver = new ResizeObserver(scheduleSync);
  resizeObserver.observe(options.header);
  resizeObserver.observe(options.assistantPanel);
  resizeObserver.observe(options.assistantLauncher);
  resizeObserver.observe(options.compassShell);

  const mutationObserver = new MutationObserver(scheduleSync);
  mutationObserver.observe(options.assistantPanel, {
    attributes: true,
    attributeFilter: ["class"],
  });
  mutationObserver.observe(options.assistantLauncher, {
    attributes: true,
    attributeFilter: ["hidden"],
  });

  window.addEventListener("resize", scheduleSync);
  scheduleSync();

  return {
    sync: scheduleSync,
    destroy() {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", scheduleSync);
    },
  };
}
