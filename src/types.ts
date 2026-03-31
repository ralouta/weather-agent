/**
 * src/types.ts
 *
 * Shared types consumed by both the weather agent (graph nodes)
 * and the scene manager (view updates).
 */

export interface NavigatePayload {
  lat: number;
  lon: number;
  locationName: string;
  timezone?: string;
  /** Scene camera scale, e.g. 80000 for city level. */
  scale: number;
}

export type WeatherType = "sunny" | "cloudy" | "rainy" | "snowy" | "foggy";

export interface WindPayload {
  /** Sustained wind speed in meters per second. */
  speedMps: number;
  /** Optional wind gust speed in meters per second. */
  gustMps?: number;
  /** Optional wind travel direction in degrees, 0-360, suitable for rendering. */
  directionDegrees?: number;
}

export interface WeatherPayload {
  /** ArcGIS SceneView weather type. */
  type: WeatherType;
  /** 0–1 cloud cover fraction (used for sunny / cloudy / rainy / snowy). */
  cloudCover: number;
  /** 0–1 precipitation intensity (used for rainy / snowy). */
  precipitation: number;
  /** 0–1 fog density (used for foggy). */
  fogStrength: number;
  /** Whether to show ground snow cover ("enabled" | "disabled"). */
  snowCover: "enabled" | "disabled";
  /** Optional near-surface wind payload for flow visualization. */
  wind?: WindPayload;
  /** One-line human-readable weather summary shown in the chat. */
  description: string;
}

export interface SceneUpdate {
  navigate: NavigatePayload;
  weather: WeatherPayload;
  /**
   * ISO-8601 UTC datetime string used to set the scene's sun position
   * and lighting angle (converted to local time for display purposes).
   */
  datetime: string;
}
