import type SceneView from "@arcgis/core/views/SceneView.js";
import type { LocationClockController } from "../ui/locationClockController.js";
import { isDev } from "../app/runtime.js";

export async function bindClockToSceneCenter(
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
      if (isDev) {
        console.warn("[sceneClockSync] Unable to resolve timezone for scene center:", error);
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
