import esriConfig from "@arcgis/core/config.js";
import { setAssetPath as setAiComponentsAssetPath } from "@arcgis/ai-components";
import { setAssetPath as setMapComponentsAssetPath } from "@arcgis/map-components";

export const isDev = import.meta.env.DEV;

let arcgisAssetsConfigured = false;

function configureArcgisAssetPaths(): void {
  if (arcgisAssetsConfigured) {
    return;
  }

  const appBaseUrl = new URL(import.meta.env.BASE_URL, window.location.origin);
  // esriConfig.assetsPath must point to the folder that contains esri/themes,
  // esri/core/workers, etc. — i.e. the "assets/" sub-folder we copy from @arcgis/core.
  const coreAssetsUrl = new URL("assets/", appBaseUrl).toString();
  esriConfig.assetsPath = coreAssetsUrl;

  // setAssetPath for map & ai components must point to the directory that
  // CONTAINS the "assets/" folder (the app root), because those components
  // internally build paths like: "<assetPath>assets/<component>/t9n/messages.en.json".
  const appRootUrl = appBaseUrl.toString();
  setMapComponentsAssetPath(appRootUrl);
  setAiComponentsAssetPath(appRootUrl);
  arcgisAssetsConfigured = true;
}

export async function loadUiModules(): Promise<void> {
  configureArcgisAssetPaths();

  await Promise.all([
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
