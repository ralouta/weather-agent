import { setupAuth, signOut } from "../auth.js";
import { loadSettings } from "../config/settings.js";
import { mountWeatherAssistant } from "../agent/assistantMount.js";
import { bootstrapScene } from "../scene/sceneBootstrap.js";
import { createAssistantPanelController } from "../ui/assistantPanelController.js";
import { createBasemapPopoverController } from "../ui/basemapPopoverController.js";
import { createHeaderController } from "../ui/headerController.js";
import { createLocationClockController } from "../ui/locationClockController.js";
import { createViewPaddingController } from "../ui/viewPaddingController.js";
import { resolveAppDom } from "./dom.js";
import { loadUiModules } from "./runtime.js";

export async function bootstrapApp(): Promise<void> {
  await loadUiModules();

  const dom = resolveAppDom();
  const settings = await loadSettings();

  const header = createHeaderController(dom.header, {
    title: settings.title,
    subtitle: settings.subtitle,
    onSignOut: async () => {
      signOut();
    },
  });

  createAssistantPanelController(dom.assistant);
  createBasemapPopoverController(dom.basemap);
  const locationClock = createLocationClockController(dom.clock);

  header.setUser({
    fullName: "Signing in...",
    username: "ArcGIS account",
  });

  try {
    const signedInUser = await setupAuth();
    header.setUser(signedInUser);
  } catch (error) {
    header.setUser({
      fullName: "Sign in failed",
      username: "Reload to try again",
    });
    throw error;
  }

  const { view, sceneManager } = await bootstrapScene(dom, settings, locationClock);
  const viewPadding = createViewPaddingController({
    view,
    header: dom.header.root,
    assistantPanel: dom.assistant.root,
    assistantLauncher: dom.assistant.launcherShell,
    compassShell: dom.compassShell,
  });

  await mountWeatherAssistant({
    mountElement: dom.assistant.mount,
    settings,
    applySceneUpdate: async (sceneUpdate) => {
      await sceneManager.applySceneUpdate(sceneUpdate);
      viewPadding.sync();
    },
  });

  viewPadding.sync();
}
