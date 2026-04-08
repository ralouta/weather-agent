import type SceneView from "@arcgis/core/views/SceneView.js";
import type { AppDom } from "../app/dom.js";
import type { AppSettings } from "../config/settings.js";
import type { LocationClockController } from "../ui/locationClockController.js";
import { SceneManager } from "./sceneManager.js";
import { loadSanitizedWebScene } from "./webScene.js";
import { createBasemapGallerySource } from "./basemapGallery.js";
import { bindClockToSceneCenter } from "./sceneClockSync.js";

export interface SceneBootstrapResult {
  view: SceneView;
  sceneManager: SceneManager;
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
    console.warn("[sceneBootstrap] Unable to apply initial zoom adjustment:", error);
  }
}

export async function bootstrapScene(
  dom: AppDom,
  settings: AppSettings,
  locationClock: LocationClockController
): Promise<SceneBootstrapResult> {
  const { scene, removedLayerTitles, usedFallbackScene } = await loadSanitizedWebScene(
    settings.sceneId
  );

  dom.scene.map = scene;

  const sceneManager = new SceneManager();

  await dom.scene.viewOnReady();
  dom.scene.classList.remove("is-loading");
  dom.scene.classList.add("is-ready");
  dom.scene.setAttribute("aria-busy", "false");

  sceneManager.setView(dom.scene.view);
  sceneManager.setDaylight(dom.daylight);

  const view = dom.scene.view;

  if (removedLayerTitles.length || usedFallbackScene) {
    if (view.map) {
      view.map.basemap = "satellite";
    }

    view.environment.atmosphereEnabled = true;
    view.environment.starsEnabled = false;
    view.qualityProfile = "high";
  }

  if (removedLayerTitles.length) {
    console.warn("[sceneBootstrap] Removed failing integrated mesh layer(s):", removedLayerTitles);
  }

  await applyInitialViewAdjustment(view);
  await bindClockToSceneCenter(view, locationClock);

  dom.compass.view = view;
  dom.basemap.gallery.view = view;
  dom.basemap.gallery.source = await createBasemapGallerySource();

  return {
    view,
    sceneManager,
  };
}
