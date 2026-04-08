/**
 * src/sceneManager.ts
 *
 * Wraps the <arcgis-scene> web component and exposes an applySceneUpdate()
 * method that the weather agent calls after gathering data.
 *
 * Weather mapping
 * ───────────────
 *   sunny  → SunnyWeather  { cloudCover }
 *   cloudy → CloudyWeather { cloudCover }
 *   rainy  → RainyWeather  { cloudCover, precipitation }
 *   snowy  → SnowyWeather  { cloudCover, precipitation, snowCover }
 *   foggy  → FoggyWeather  { fogStrength }
 */

import type SceneView from "@arcgis/core/views/SceneView.js";
import Graphic from "@arcgis/core/Graphic.js";
import SunnyWeather from "@arcgis/core/views/3d/environment/SunnyWeather.js";
import CloudyWeather from "@arcgis/core/views/3d/environment/CloudyWeather.js";
import RainyWeather from "@arcgis/core/views/3d/environment/RainyWeather.js";
import SnowyWeather from "@arcgis/core/views/3d/environment/SnowyWeather.js";
import FoggyWeather from "@arcgis/core/views/3d/environment/FoggyWeather.js";
import SunLighting from "@arcgis/core/views/3d/environment/SunLighting.js";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer.js";
import Polyline from "@arcgis/core/geometry/Polyline.js";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol.js";
import type { SceneUpdate, WeatherType, WindPayload } from "../types.js";

const LOCAL_WIND_LAYER_ID = "weather-agent-local-wind";
const LOCAL_WIND_OFFSET_METERS = 260;
const MAX_SCENE_TIME_DRIFT_MS = 15 * 60 * 1000;

interface DaylightElement {
  localDate?: Date | string;
  utcOffset?: number;
}

export class SceneManager {
  private view: SceneView | null = null;
  private localWindLayer: GraphicsLayer | null = null;
  private daylightElement: DaylightElement | null = null;
  private windEmphasisTimer: number | null = null;
  private windAnimationTimer: number | null = null;
  private windAnimationPhase = 0;
  private windLabelElement: HTMLDivElement | null = null;

  /**
   * Resolve the SceneView from the <arcgis-scene> element.
   * Call after viewOnReady() resolves.
   */
  setView(view: SceneView) {
    this.view = view;
  }

  setDaylight(daylightElement: DaylightElement | null) {
    this.daylightElement = daylightElement;
  }

  /** Apply a full SceneUpdate payload (navigate + weather + datetime). */
  async applySceneUpdate(su: SceneUpdate): Promise<void> {
    if (!this.view) {
      console.warn("[SceneManager] View not ready – skipping scene update.");
      return;
    }

    await this.navigate(su.navigate.lat, su.navigate.lon, su.navigate.scale);
    this.applyDateTime(su.datetime, su.navigate.timezone);
    this.applyWeather(su);
    this.applyWind(su);
    this.applySceneTone(su);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async navigate(lat: number, lon: number, scale: number): Promise<void> {
    const zoomedScale = Math.max(Math.round(scale * 0.7), 20000);
    const heading = this.view!.camera?.heading ?? 0;
    const tilt = Math.max(this.view!.camera?.tilt ?? 0, 78);

    try {
      await this.view!.goTo(
        {
          center: [lon, lat],
          scale: zoomedScale,
          tilt,
          heading,
        },
        { animate: true, speedFactor: 0.5 }
      );
    } catch (err) {
      if ((err as { name?: string })?.name !== "AbortError") {
        console.warn("[SceneManager] goTo error:", err);
      }
    }
  }

  private applyWeather(su: SceneUpdate): void {
    const { type, cloudCover, precipitation, fogStrength, snowCover } =
      su.weather;

    switch (type) {
      case "sunny":
        this.view!.environment.weather = new SunnyWeather({ cloudCover });
        break;
      case "cloudy":
        this.view!.environment.weather = new CloudyWeather({ cloudCover });
        break;
      case "rainy":
        this.view!.environment.weather = new RainyWeather({
          cloudCover,
          precipitation,
        });
        break;
      case "snowy":
        this.view!.environment.weather = new SnowyWeather({
          cloudCover,
          precipitation,
          snowCover,
        });
        break;
      case "foggy":
        this.view!.environment.weather = new FoggyWeather({ fogStrength });
        break;
    }
  }

  private applyWind(su: SceneUpdate): void {
    if (!this.view?.map) {
      return;
    }

    const wind = su.weather.wind;

    if (!wind || wind.speedMps <= 0) {
      if (this.localWindLayer) {
        this.localWindLayer.visible = false;
        this.localWindLayer.removeAll();
      }

      if (this.windEmphasisTimer !== null) {
        window.clearTimeout(this.windEmphasisTimer);
        this.windEmphasisTimer = null;
      }

      if (this.windAnimationTimer !== null) {
        window.clearInterval(this.windAnimationTimer);
        this.windAnimationTimer = null;
      }

      this.removeWindLabel();
      return;
    }

    const localWindLayer = this.ensureLocalWindLayer();
    localWindLayer.visible = true;
    localWindLayer.opacity = 1;
    this.startWindAnimation(su.navigate.lat, su.navigate.lon, wind, localWindLayer);
    this.emphasizeWindLayer(localWindLayer);
    this.updateWindLabel(wind);
  }

  private applyDateTime(iso: string, timeZone?: string): void {
    const date = this.resolveSceneDate(iso);
    const lighting = this.view!.environment.lighting;
    const utcOffset = this.getUtcOffsetHours(date, timeZone);
    const localDate = this.getLocalCalendarDate(date, utcOffset);
    const localMinutesSinceMidnight = this.getLocalMinutesSinceMidnight(date, utcOffset);

    if (!(lighting instanceof SunLighting)) {
      this.view!.environment.lighting = new SunLighting({
        date,
        cameraTrackingEnabled: false,
        displayUTCOffset: utcOffset,
        directShadowsEnabled: true,
      });
    } else {
      lighting.date = date;
      lighting.cameraTrackingEnabled = false;
      lighting.displayUTCOffset = utcOffset;
      lighting.directShadowsEnabled = true;
    }

    if (this.daylightElement) {
      this.daylightElement.localDate = localDate;
      this.daylightElement.utcOffset = utcOffset;
      (this.daylightElement as DaylightElement & { timeSliderPosition?: number }).timeSliderPosition =
        localMinutesSinceMidnight;
    }
  }

  private applySceneTone(su: SceneUpdate): void {
    const container = this.view?.container as HTMLElement | null;

    if (!container) {
      return;
    }

    const sceneHour = this.getSceneHour(su.datetime, su.navigate.timezone);
    const baseBrightness = this.getTimeBrightness(sceneHour);
    const weatherOffset = this.getWeatherBrightnessOffset(su.weather.type);
    const brightness = Math.max(0.88, Math.min(1.05, baseBrightness + weatherOffset));
    const saturation = su.weather.type === "foggy" ? 0.99 : 1;

    container.style.transition = "filter 420ms ease";
    container.style.filter = `brightness(${brightness.toFixed(2)}) saturate(${saturation.toFixed(2)})`;
  }

  private ensureLocalWindLayer(): GraphicsLayer {
    if (this.localWindLayer) {
      return this.localWindLayer;
    }

    const existingLayer = this.view!.map?.findLayerById(LOCAL_WIND_LAYER_ID);
    if (existingLayer instanceof GraphicsLayer) {
      this.localWindLayer = existingLayer;
      return existingLayer;
    }

    this.localWindLayer = new GraphicsLayer({
      id: LOCAL_WIND_LAYER_ID,
      title: "Local wind",
      visible: false,
      listMode: "hide",
      elevationInfo: {
        mode: "relative-to-ground",
        offset: LOCAL_WIND_OFFSET_METERS,
      },
      opacity: 0.85,
    });

    this.view!.map!.add(this.localWindLayer);
    return this.localWindLayer;
  }

  private startWindAnimation(
    lat: number,
    lon: number,
    wind: WindPayload,
    layer: GraphicsLayer
  ): void {
    const effectiveSpeed = Math.max(wind.gustMps ?? wind.speedMps, wind.speedMps);

    // intervalMs: longer at calm speeds, shorter at storm speeds.
    //   1 m/s  → ~312 ms/frame   (barely drifting)
    //   5 m/s  → ~280 ms/frame   (lazy)
    //  10 m/s  → ~240 ms/frame   (moderate)
    //  25 m/s  → ~120 ms/frame   (fast)
    //  35+ m/s →  80 ms/frame    (storm cap)
    const intervalMs = Math.max(80, Math.round(320 - effectiveSpeed * 8));

    // phaseStep: distance each streamer travels per frame.
    // ~4× smaller than before so visual speed matches the actual m/s value.
    //   1 m/s  → 0.004
    //   5 m/s  → 0.015
    //  10 m/s  → 0.030
    //  25 m/s  → 0.075
    //  27+ m/s → 0.08  (cap)
    const phaseStep = Math.max(0.004, Math.min(0.08, effectiveSpeed * 0.003));

    const renderFrame = () => {
      layer.removeAll();
      layer.addMany(
        this.createAnimatedWindGraphics(lat, lon, wind, this.windAnimationPhase)
      );
      this.windAnimationPhase = (this.windAnimationPhase + phaseStep) % 1;
    };

    if (this.windAnimationTimer !== null) {
      window.clearInterval(this.windAnimationTimer);
    }

    this.windAnimationPhase = 0;
    renderFrame();
    this.windAnimationTimer = window.setInterval(renderFrame, intervalMs);
  }

  private createAnimatedWindGraphics(
    lat: number,
    lon: number,
    wind: WindPayload,
    phase: number
  ): Graphic[] {
    const travelDirection = wind.directionDegrees ?? 225;
    const headingRadians = (travelDirection * Math.PI) / 180;
    const eastUnit = Math.sin(headingRadians);
    const northUnit = Math.cos(headingRadians);
    const speedMps = Math.max(wind.gustMps ?? wind.speedMps, wind.speedMps);
    const trailLengthMeters = 640 + speedMps * 80;
    const travelSpanMeters = 3200 + speedMps * 240;
    const spacingMeters = 1450;
    const symbols = this.createWindSegmentSymbols(speedMps);
    const graphics: Graphic[] = [];
    const anchorOffsets = this.createWindAnchors(spacingMeters);

    anchorOffsets.forEach(([eastOffset, northOffset], index) => {
      const anchor = this.offsetCoordinate(lat, lon, eastOffset, northOffset);
      const progress = (phase + index * 0.059) % 1;
      const centerShift = (progress - 0.5) * travelSpanMeters;
      const center = this.offsetCoordinate(
        anchor.latitude,
        anchor.longitude,
        eastUnit * centerShift,
        northUnit * centerShift
      );
        const tail = this.offsetCoordinate(
          center.latitude,
          center.longitude,
          -eastUnit * trailLengthMeters * 0.5,
          -northUnit * trailLengthMeters * 0.5
        );
        const head = this.offsetCoordinate(
          center.latitude,
          center.longitude,
          eastUnit * trailLengthMeters * 0.5,
          northUnit * trailLengthMeters * 0.5
        );
        const segmentAEnd = this.offsetCoordinate(
          tail.latitude,
          tail.longitude,
          eastUnit * trailLengthMeters * 0.24,
          northUnit * trailLengthMeters * 0.24
        );
        const segmentBEnd = this.offsetCoordinate(
          tail.latitude,
          tail.longitude,
          eastUnit * trailLengthMeters * 0.5,
          northUnit * trailLengthMeters * 0.5
        );
        const segmentCEnd = this.offsetCoordinate(
          tail.latitude,
          tail.longitude,
          eastUnit * trailLengthMeters * 0.76,
          northUnit * trailLengthMeters * 0.76
        );

        graphics.push(
          new Graphic({
            geometry: new Polyline({
              paths: [
                [
                  [tail.longitude, tail.latitude, LOCAL_WIND_OFFSET_METERS],
                  [segmentAEnd.longitude, segmentAEnd.latitude, LOCAL_WIND_OFFSET_METERS],
                ],
              ],
              spatialReference: { wkid: 4326 },
            }),
            symbol: symbols.tail,
          }),
          new Graphic({
            geometry: new Polyline({
              paths: [
                [
                  [segmentAEnd.longitude, segmentAEnd.latitude, LOCAL_WIND_OFFSET_METERS],
                  [segmentBEnd.longitude, segmentBEnd.latitude, LOCAL_WIND_OFFSET_METERS],
                ],
              ],
              spatialReference: { wkid: 4326 },
            }),
            symbol: symbols.mid,
          }),
          new Graphic({
            geometry: new Polyline({
              paths: [
                [
                  [segmentBEnd.longitude, segmentBEnd.latitude, LOCAL_WIND_OFFSET_METERS],
                  [segmentCEnd.longitude, segmentCEnd.latitude, LOCAL_WIND_OFFSET_METERS],
                ],
              ],
              spatialReference: { wkid: 4326 },
            }),
            symbol: symbols.midBright,
          }),
          new Graphic({
            geometry: new Polyline({
              paths: [
                [
                  [segmentCEnd.longitude, segmentCEnd.latitude, LOCAL_WIND_OFFSET_METERS],
                  [head.longitude, head.latitude, LOCAL_WIND_OFFSET_METERS],
                ],
              ],
              spatialReference: { wkid: 4326 },
            }),
            symbol: symbols.head,
          })
        );
    });

    return graphics;
  }

  private createWindAnchors(spacingMeters: number): Array<[number, number]> {
    const anchors: Array<[number, number]> = [];

    for (let eastIndex = -3; eastIndex <= 3; eastIndex += 1) {
      for (let northIndex = -3; northIndex <= 3; northIndex += 1) {
        if (Math.abs(eastIndex) === 3 && Math.abs(northIndex) === 3) {
          continue;
        }

        anchors.push([eastIndex * spacingMeters, northIndex * spacingMeters]);
      }
    }

    return anchors;
  }

  private createWindSegmentSymbols(speedMps: number): {
    tail: SimpleLineSymbol;
    mid: SimpleLineSymbol;
    midBright: SimpleLineSymbol;
    head: SimpleLineSymbol;
  } {
    const width = 2.3 + Math.min(speedMps / 18, 0.9);

    return {
      tail: new SimpleLineSymbol({
        color: [98, 186, 245, 0.24],
        width,
        cap: "round",
        join: "round",
      }),
      mid: new SimpleLineSymbol({
        color: [126, 210, 255, 0.54],
        width,
        cap: "round",
        join: "round",
      }),
      midBright: new SimpleLineSymbol({
        color: [148, 224, 255, 0.72],
        width,
        cap: "round",
        join: "round",
      }),
      head: new SimpleLineSymbol({
        color: [184, 243, 234, 0.96],
        width,
        cap: "round",
        join: "round",
      }),
    };
  }

  private emphasizeWindLayer(layer: GraphicsLayer): void {
    if (this.windEmphasisTimer !== null) {
      window.clearTimeout(this.windEmphasisTimer);
    }

    layer.opacity = 1;
    this.windEmphasisTimer = window.setTimeout(() => {
      layer.opacity = 0.82;
      this.windEmphasisTimer = null;
    }, 4500);
  }

  private offsetCoordinate(
    latitude: number,
    longitude: number,
    eastMeters: number,
    northMeters: number
  ): { latitude: number; longitude: number } {
    const metersPerDegreeLat = 111320;
    const metersPerDegreeLon = Math.max(
      111320 * Math.cos((latitude * Math.PI) / 180),
      1
    );

    return {
      latitude: latitude + northMeters / metersPerDegreeLat,
      longitude: longitude + eastMeters / metersPerDegreeLon,
    };
  }

  private getSceneHour(iso: string, timeZone?: string): number {
    const date = new Date(iso);

    if (!timeZone) {
      return date.getUTCHours() + date.getUTCMinutes() / 60;
    }

    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = Object.fromEntries(
      formatter.formatToParts(date).map((part) => [part.type, part.value])
    );

    const hours = Number(parts.hour ?? "0");
    const minutes = Number(parts.minute ?? "0");

    return hours + minutes / 60;
  }

  private getTimeBrightness(sceneHour: number): number {
    if (sceneHour >= 7 && sceneHour < 17.5) {
      return 1.03;
    }

    if (sceneHour >= 17.5 && sceneHour < 19.75) {
      return 1.03 - ((sceneHour - 17.5) / 2.25) * 0.17;
    }

    if (sceneHour >= 5 && sceneHour < 7) {
      return 0.88 + ((sceneHour - 5) / 2) * 0.15;
    }

    return 0.8;
  }

  private getWeatherBrightnessOffset(type: WeatherType): number {
    switch (type) {
      case "cloudy":
        return 0;
      case "rainy":
        return 0;
      case "snowy":
        return 0;
      case "foggy":
        return -0.005;
      case "sunny":
      default:
        return 0;
    }
  }

  private resolveSceneDate(iso: string): Date {
    const parsed = new Date(iso);
    const now = new Date();

    if (!Number.isNaN(parsed.getTime())) {
      if (Math.abs(parsed.getTime() - now.getTime()) <= MAX_SCENE_TIME_DRIFT_MS) {
        return parsed;
      }

      console.warn(
        "[SceneManager] Scene datetime drifted from current time, using current instant instead:",
        iso
      );
      return now;
    }

    console.warn("[SceneManager] Invalid scene datetime, falling back to current time:", iso);
    return now;
  }

  private getLocalCalendarDate(date: Date, utcOffset: number): string {
    return new Date(date.getTime() + utcOffset * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
  }

  private getLocalMinutesSinceMidnight(date: Date, utcOffset: number): number {
    const localDate = new Date(date.getTime() + utcOffset * 60 * 60 * 1000);

    return localDate.getUTCHours() * 60 + localDate.getUTCMinutes();
  }

  private getUtcOffsetHours(date: Date, timeZone?: string): number {
    if (!timeZone) {
      return -date.getTimezoneOffset() / 60;
    }

    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset",
      hour: "2-digit",
    });
    const timeZoneName = formatter
      .formatToParts(date)
      .find((part) => part.type === "timeZoneName")?.value;

    const match = timeZoneName?.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!match) {
      return -date.getTimezoneOffset() / 60;
    }

    const sign = match[1] === "-" ? -1 : 1;
    const hours = Number(match[2] ?? "0");
    const minutes = Number(match[3] ?? "0");

    return sign * (hours + minutes / 60);
  }

  // ── Wind speed / direction label ──────────────────────────────────────────

  private ensureWindLabel(): HTMLDivElement {
    if (this.windLabelElement) {
      return this.windLabelElement;
    }

    const container = this.view?.container as HTMLElement | null;
    if (!container) {
      throw new Error("[SceneManager] View container not available for wind label.");
    }

    const el = document.createElement("div");
    el.className = "wind-label";
    el.setAttribute("aria-label", "Wind conditions");

    // Append to document.body so position:fixed works correctly regardless
    // of what positioning context the SceneView container uses internally.
    document.body.appendChild(el);
    this.windLabelElement = el;
    return el;
  }

  private updateWindLabel(wind: WindPayload): void {
    try {
      const el = this.ensureWindLabel();
      const dir = wind.directionDegrees ?? 0;
      const cardinal = this.degreesToCardinal(dir);
      const speedKph = (wind.speedMps * 3.6).toFixed(1);
      const gustLine = wind.gustMps
        ? `<span class="wind-label__gust">gusts ${(wind.gustMps * 3.6).toFixed(0)} km/h</span>`
        : "";

      el.innerHTML =
        `<span class="wind-label__arrow" style="transform:rotate(${dir}deg)">↑</span>` +
        `<span class="wind-label__meta">` +
        `<span class="wind-label__cardinal">${cardinal} wind</span>` +
        `<span class="wind-label__speed">${speedKph} km/h</span>` +
        gustLine +
        `</span>`;

      el.style.opacity = "1";
    } catch {
      // container not ready yet; label will appear on next update
    }
  }

  private removeWindLabel(): void {
    if (!this.windLabelElement) {
      return;
    }

    const el = this.windLabelElement;
    el.style.opacity = "0";
    this.windLabelElement = null;
    window.setTimeout(() => el.remove(), 500);
  }

  /** Convert a travel-direction bearing (0 = N, 90 = E …) to an 8-point cardinal label. */
  private degreesToCardinal(degrees: number): string {
    const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
    const index = Math.round((((degrees % 360) + 360) % 360) / 45) % 8;
    return dirs[index];
  }
}
