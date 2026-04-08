import type SceneView from "@arcgis/core/views/SceneView.js";
import type LocalBasemapsSource from "@arcgis/core/widgets/BasemapGallery/support/LocalBasemapsSource.js";

export type SceneElement = HTMLElement & {
  map: import("@arcgis/core/Map.js").default;
  view: SceneView;
  viewOnReady(): Promise<void>;
};

export type BasemapGalleryElement = HTMLElement & {
  view: SceneView;
  source: LocalBasemapsSource;
};

export type DaylightElement = HTMLElement & {
  localDate?: Date | string;
  utcOffset?: number;
  timeSliderPosition?: number;
};

export type CompassElement = HTMLElement & {
  view: SceneView;
};

export interface AppDom {
  shell: HTMLElement;
  compassShell: HTMLElement;
  scene: SceneElement;
  daylight: DaylightElement;
  compass: CompassElement;
  basemap: {
    button: HTMLElement;
    popover: HTMLDivElement;
    gallery: BasemapGalleryElement;
  };
  header: {
    root: HTMLElement;
    title: HTMLElement;
    subtitle: HTMLElement;
    userButton: HTMLButtonElement;
    userButtonLabel: HTMLElement;
    userPopover: HTMLDivElement;
    userFullName: HTMLElement;
    userName: HTMLElement;
    userAvatarCard: HTMLElement;
    signOutButton: HTMLButtonElement;
  };
  assistant: {
    root: HTMLElement;
    tab: HTMLElement;
    collapseButton: HTMLElement;
    body: HTMLElement;
    mount: HTMLElement;
    launcherShell: HTMLElement;
    launcherButton: HTMLElement;
  };
  clock: {
    root: HTMLElement;
    hourHand: HTMLElement;
    minuteHand: HTMLElement;
    digitalTime: HTMLElement;
    timezoneLabel: HTMLElement;
  };
}

function requiredById<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);

  if (!(element instanceof HTMLElement)) {
    throw new Error(`[dom] Missing required element #${id}`);
  }

  return element as T;
}

function requiredSelector<T extends Element>(selector: string): T {
  const element = document.querySelector(selector);

  if (!element) {
    throw new Error(`[dom] Missing required element ${selector}`);
  }

  return element as T;
}

export function resolveAppDom(): AppDom {
  return {
    shell: requiredById("appShell"),
    compassShell: requiredSelector<HTMLElement>(".compass-shell"),
    scene: requiredById<SceneElement>("mainScene"),
    daylight: requiredById<DaylightElement>("sceneDaylight"),
    compass: requiredById<CompassElement>("sceneCompass"),
    basemap: {
      button: requiredById("basemapSwitchBtn"),
      popover: requiredById<HTMLDivElement>("basemapPopover"),
      gallery: requiredSelector<BasemapGalleryElement>("arcgis-basemap-gallery"),
    },
    header: {
      root: requiredSelector<HTMLElement>(".app-header"),
      title: requiredById("appTitle"),
      subtitle: requiredById("appSubtitle"),
      userButton: requiredById<HTMLButtonElement>("userMenuButton"),
      userButtonLabel: requiredById("userMenuButtonLabel"),
      userPopover: requiredById<HTMLDivElement>("userMenuPopover"),
      userFullName: requiredById("userFullName"),
      userName: requiredById("userName"),
      userAvatarCard: requiredById("userAvatarCard"),
      signOutButton: requiredById<HTMLButtonElement>("signOutBtn"),
    },
    assistant: {
      root: requiredById("assistantPanel"),
      tab: requiredById("panelTab"),
      collapseButton: requiredById("collapseBtn"),
      body: requiredById("panelBody"),
      mount: requiredById("assistantMount"),
      launcherShell: requiredById("assistantLauncher"),
      launcherButton: requiredById("assistantLaunchBtn"),
    },
    clock: {
      root: requiredById("locationClock"),
      hourHand: requiredById("clockHourHand"),
      minuteHand: requiredById("clockMinuteHand"),
      digitalTime: requiredById("clockDigitalTime"),
      timezoneLabel: requiredById("clockTimezoneLabel"),
    },
  };
}
