/**
 * src/main.ts
 *
 * Application entry point:
 *   1. ArcGIS OAuth authentication
 *   2. Wait for <arcgis-scene> to be ready → attach SceneManager
 *   3. Build the weather agent (LangGraph) and register it to <arcgis-assistant>
 *
 * IMPORTANT: arcgis-assistant-agent is created programmatically and .agent is
 * set BEFORE it is appended to the DOM. This prevents the component's load()
 * lifecycle from firing with agent === undefined.
 */

import "@arcgis/core/assets/esri/themes/dark/main.css";
import "@esri/calcite-components/calcite/calcite.css";
import "@arcgis/ai-components/main.css";
import "./style.css";
import type Basemap from "@arcgis/core/Basemap.js";
import type { ArcgisScene } from "@arcgis/map-components/components/arcgis-scene";
import type SceneView from "@arcgis/core/views/SceneView.js";
import type LocalBasemapsSource from "@arcgis/core/widgets/BasemapGallery/support/LocalBasemapsSource.js";

const IS_DEV = import.meta.env.DEV;

type SceneElement = ArcgisScene &
  HTMLElement & {
    map: import("@arcgis/core/Map.js").default;
    view: SceneView;
    viewOnReady(): Promise<void>;
  };

type BasemapGalleryElement = HTMLElementTagNameMap["arcgis-basemap-gallery"] & {
  view: SceneView;
  source: LocalBasemapsSource;
};

type DaylightElement = HTMLElement & {
  localDate?: string;
  utcOffset?: number;
};

interface LocationClockController {
  update(update: { timezone?: string }): void;
}

async function loadUiModules(): Promise<void> {
  await Promise.all([
    import("./panel.js"),
    import("@esri/calcite-components/components/calcite-action"),
    import("@esri/calcite-components/components/calcite-button"),
    import("@arcgis/map-components/components/arcgis-scene"),
    import("@arcgis/map-components/components/arcgis-basemap-gallery"),
    import("@arcgis/map-components/components/arcgis-daylight"),
    import("@arcgis/map-components/components/arcgis-compass"),
    import("@arcgis/ai-components/components/arcgis-assistant"),
    import("@arcgis/ai-components/components/arcgis-assistant-agent"),
  ]);
}

function loadAppShellModules() {
  return Promise.all([
    import("./auth.js"),
    import("./clockWidget.js"),
    import("./header.js"),
    import("./settings.js"),
  ]);
}

function loadSceneModules() {
  return Promise.all([
    import("./sceneManager.js"),
    import("./webScene.js"),
  ]);
}

function loadWeatherAgentModule() {
  return import("./weatherAgent.js");
}

async function bindClockToSceneCenter(
  view: SceneView,
  locationClock: LocationClockController
): Promise<void> {
  const [reactiveUtils, { default: tzLookup }] = await Promise.all([
    import("@arcgis/core/core/reactiveUtils.js"),
    import("tz-lookup"),
  ]);

  let lastCenterKey = "";

  const refreshClock = () => {
    const center = view.center;

    if (!center) {
      return;
    }

    const latitude = center.latitude;
    const longitude = center.longitude;

    if (latitude == null || longitude == null) {
      return;
    }

    const centerKey = `${latitude.toFixed(3)},${longitude.toFixed(3)}`;

    if (centerKey === lastCenterKey) {
      return;
    }

    lastCenterKey = centerKey;

    try {
      locationClock.update({
        timezone: tzLookup(latitude, longitude),
      });
    } catch (error) {
      if (IS_DEV) {
        console.warn("[main] Unable to resolve timezone for scene center:", error);
      }
    }
  };

  reactiveUtils.watch(
    () => view.stationary,
    (stationary: boolean) => {
      if (stationary) {
        refreshClock();
      }
    }
  );

  refreshClock();
}

async function createBasemapGallerySource() {
  const [{ default: BasemapCtor }, { default: LocalBasemapsSource }] = await Promise.all([
    import("@arcgis/core/Basemap.js"),
    import("@arcgis/core/widgets/BasemapGallery/support/LocalBasemapsSource.js"),
  ]);

  const basemapIds = [
    "satellite",
    "hybrid",
    "topo-3d",
    "streets-navigation-vector",
    "dark-gray-vector",
  ];

  const basemaps = basemapIds
    .map((id) => BasemapCtor.fromId(id))
    .filter((basemap): basemap is Basemap => basemap !== null);

  return new LocalBasemapsSource({ basemaps });
}

function setupViewPadding(view: SceneView): void {
  const header = document.querySelector<HTMLElement>(".app-header");
  const assistantPanel = document.getElementById("assistantPanel") as HTMLElement | null;
  const assistantLauncher = document.getElementById("assistantLauncher") as HTMLElement | null;

  if (!header) {
    return;
  }

  const syncPadding = () => {
    const headerRect = header.getBoundingClientRect();
    const topPadding = Math.ceil(headerRect.bottom + 12);

    let rightPadding = 16;

    if (assistantPanel && !assistantPanel.classList.contains("collapsed")) {
      const panelRect = assistantPanel.getBoundingClientRect();
      rightPadding = Math.max(16, Math.ceil(window.innerWidth - panelRect.left + 12));
    } else if (assistantLauncher && !assistantLauncher.hasAttribute("hidden")) {
      const launcherRect = assistantLauncher.getBoundingClientRect();
      rightPadding = Math.max(16, Math.ceil(window.innerWidth - launcherRect.left + 12));
    }

    view.padding = {
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
  resizeObserver.observe(header);

  if (assistantPanel) {
    resizeObserver.observe(assistantPanel);
  }

  if (assistantLauncher) {
    resizeObserver.observe(assistantLauncher);
  }

  const mutationObserver = new MutationObserver(scheduleSync);

  if (assistantPanel) {
    mutationObserver.observe(assistantPanel, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }

  if (assistantLauncher) {
    mutationObserver.observe(assistantLauncher, {
      attributes: true,
      attributeFilter: ["hidden"],
    });
  }

  window.addEventListener("resize", scheduleSync);
  scheduleSync();
}

async function applyInitialViewAdjustment(view: SceneView): Promise<void> {
  try {
    await view.goTo(
      {
        scale: view.scale * 0.82,
      },
      {
        animate: false,
      }
    );
  } catch (error) {
    console.warn("[main] Unable to apply initial zoom adjustment:", error);
  }
}

function setupBasemapPopover(): void {
  const switchButton = document.getElementById("basemapSwitchBtn") as HTMLButtonElement | null;
  const popover = document.getElementById("basemapPopover") as HTMLDivElement | null;

  if (!switchButton || !popover) {
    return;
  }

  const closePopover = () => {
    popover.hidden = true;
    switchButton.setAttribute("aria-expanded", "false");
  };

  const openPopover = () => {
    popover.hidden = false;
    switchButton.setAttribute("aria-expanded", "true");
  };

  switchButton.addEventListener("click", (event) => {
    event.stopPropagation();

    if (popover.hidden) {
      openPopover();
      return;
    }

    closePopover();
  });

  popover.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  document.addEventListener("click", () => {
    closePopover();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closePopover();
    }
  });
}

async function init() {
  await loadUiModules();

  const [
    { setupAuth, signOut },
    { setupLocationClock },
    { setupHeader },
    { loadSettings },
  ] = await loadAppShellModules();

  const settings = await loadSettings();
  const header = setupHeader({
    title: settings.title,
    subtitle: settings.subtitle,
    onSignOut: async () => {
      signOut();
    },
  });
  header.setUser({
    fullName: "Signing in...",
    username: "ArcGIS account",
  });
  const locationClock = setupLocationClock();

  // ── 1. Auth ──────────────────────────────────────────────────────────────
  let signedInUser: Awaited<ReturnType<typeof setupAuth>>;

  try {
    signedInUser = await setupAuth();
    header.setUser(signedInUser);
  } catch (err) {
    header.setUser({
      fullName: "Sign in failed",
      username: "Reload to try again",
    });
    console.error("[main] Authentication failed:", err);
    throw err;
  }

  // ── 2. Scene ─────────────────────────────────────────────────────────────
  const sceneEl = document.querySelector<SceneElement>("arcgis-scene")!;
  const [{ SceneManager }, { loadSanitizedWebScene }] = await loadSceneModules();
  const { scene, removedLayerTitles, usedFallbackScene } = await loadSanitizedWebScene(
    settings.sceneId
  );
  sceneEl.map = scene;

  const sceneManager = new SceneManager();
  const daylightEl = document.getElementById("sceneDaylight") as DaylightElement | null;

  await sceneEl.viewOnReady();
  sceneEl.classList.remove("is-loading");
  sceneEl.classList.add("is-ready");
  sceneEl.setAttribute("aria-busy", "false");

  sceneManager.setView(sceneEl.view);
  sceneManager.setDaylight(daylightEl);
  const view = sceneEl.view;

  if (removedLayerTitles.length || usedFallbackScene) {
    if (view.map) {
      view.map.basemap = "satellite";
    }

    view.environment.atmosphereEnabled = true;
    view.environment.starsEnabled = false;
    view.qualityProfile = "high";
  }

  if (removedLayerTitles.length) {
    console.warn("[main] Removed failing integrated mesh layer(s):", removedLayerTitles);
  }

  setupViewPadding(view);
  await applyInitialViewAdjustment(view);
  await bindClockToSceneCenter(view, locationClock);
  setupBasemapPopover();

  const compassEl = document.getElementById("sceneCompass") as (HTMLElement & { view: SceneView }) | null;
  if (compassEl) {
    compassEl.view = view;
  }

  const basemapGalleryEl = document.querySelector<BasemapGalleryElement>("arcgis-basemap-gallery");
  if (basemapGalleryEl) {
    basemapGalleryEl.view = view;
    basemapGalleryEl.source = await createBasemapGallerySource();
  }

  // ── 3. Weather Agent ─────────────────────────────────────────────────────
  const { createWeatherAgent } = await loadWeatherAgentModule();
  const weatherAgent = createWeatherAgent(
    async (sceneUpdate) => {
      await sceneManager.applySceneUpdate(sceneUpdate);
    }
  );

  // Build the assistant and its custom agent together, before the assistant
  // enters the DOM. The assistant initializes only once; if it boots with an
  // empty agent registry it shows "No agents found" and won't self-recover.
  await customElements.whenDefined("arcgis-assistant");
  await customElements.whenDefined("arcgis-assistant-agent");

  const assistantMount = document.getElementById("assistantMount")!;
  const assistantEl = document.createElement("arcgis-assistant");

  assistantEl.id = "assistant";
  assistantEl.setAttribute("heading", settings.title);
  assistantEl.setAttribute(
    "description",
    "Ask about the weather anywhere in the world."
  );
  assistantEl.setAttribute(
    "entry-message",
    "Hi! Ask me about current weather at any location — I'll fly you there and apply the conditions in the 3D scene."
  );
  if (IS_DEV) {
    assistantEl.setAttribute("log-enabled", "");
  }

  // Create the agent element, set .agent BEFORE appending to the DOM.
  // Then append the agent to the assistant before the assistant itself is
  // mounted, so the initial orchestrator load sees a non-empty agent registry.
  const agentEl = document.createElement("arcgis-assistant-agent");
  (agentEl as unknown as { agent: typeof weatherAgent }).agent = weatherAgent;
  assistantEl.appendChild(agentEl);

  // Suggest prompts so users know what to ask.
  (assistantEl as unknown as { suggestedPrompts: string[] }).suggestedPrompts =
    settings.suggestedPrompts;

  if (IS_DEV) {
    assistantEl.addEventListener("arcgisError" as never, (e: Event) => {
      console.error("[assistant] arcgisError:", (e as CustomEvent).detail);
    });
  }

  assistantMount.replaceChildren(assistantEl);
}

init().catch((err) => console.error("[main] Fatal init error:", err));
