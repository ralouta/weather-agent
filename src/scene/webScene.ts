import WebScene from "@arcgis/core/WebScene.js";
import PortalItem from "@arcgis/core/portal/PortalItem.js";
import Portal from "@arcgis/core/portal/Portal.js";

const PLACEHOLDER_SCENE_ID = "YOUR_WEBSCENE_ITEM_ID_HERE";

interface LoadedWebScene {
  scene: WebScene;
  removedLayerTitles: string[];
  usedFallbackScene: boolean;
}

function shouldRemoveLayer(layer: Record<string, unknown>): boolean {
  const title = typeof layer.title === "string" ? layer.title.toLowerCase() : "";
  const typeCandidates = [layer.layerType, layer.type]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.toLowerCase());

  return (
    title === "google mesh" ||
    typeCandidates.some(
      (value) => value.includes("integrated-mesh-3dtiles") || value.includes("integratedmesh3dtiles")
    )
  );
}

function createFallbackScene(): LoadedWebScene {
  return {
    scene: new WebScene({
      basemap: "satellite",
      ground: "world-elevation",
    }),
    removedLayerTitles: [],
    usedFallbackScene: true,
  };
}

export async function loadSanitizedWebScene(sceneId: string): Promise<LoadedWebScene> {
  if (!sceneId || sceneId === PLACEHOLDER_SCENE_ID) {
    return createFallbackScene();
  }

  try {
    const portal = Portal.getDefault();
    if (!portal.loaded) {
      await portal.load();
    }

    const portalItem = new PortalItem({ id: sceneId, portal });
    await portalItem.load();

    const data = (await portalItem.fetchData()) as Record<string, unknown>;
    const operationalLayers = Array.isArray(data.operationalLayers)
      ? (data.operationalLayers as Record<string, unknown>[])
      : [];

    const removedLayerTitles: string[] = [];
    const sanitizedOperationalLayers = operationalLayers.filter((layer) => {
      if (!shouldRemoveLayer(layer)) {
        return true;
      }

      const title = typeof layer.title === "string" && layer.title.trim()
        ? layer.title.trim()
        : "Unnamed layer";
      removedLayerTitles.push(title);
      return false;
    });

    const scene = WebScene.fromJSON({
      ...data,
      operationalLayers: sanitizedOperationalLayers,
    });

    scene.portalItem = portalItem;
    await scene.load();

    return {
      scene,
      removedLayerTitles,
      usedFallbackScene: false,
    };
  } catch (error) {
    console.warn("[scene] Failed to load configured WebScene. Using fallback scene instead:", error);
    return createFallbackScene();
  }
}
