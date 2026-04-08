import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { SceneUpdate, WindPayload } from "../types.js";
import { callMcpTool } from "./mcpClient.js";

const CARDINAL_TO_DEGREES: Record<string, number> = {
  N: 0,
  NNE: 22.5,
  NE: 45,
  ENE: 67.5,
  E: 90,
  ESE: 112.5,
  SE: 135,
  SSE: 157.5,
  S: 180,
  SSW: 202.5,
  SW: 225,
  WSW: 247.5,
  W: 270,
  WNW: 292.5,
  NW: 315,
  NNW: 337.5,
};

const TOWARD_WORD_TO_DEGREES: Record<string, number> = {
  northward: 0,
  eastward: 90,
  southward: 180,
  westward: 270,
};

function convertSpeedToMps(value: number, unit: string): number {
  return unit.toLowerCase() === "mph" ? value * 0.44704 : value;
}

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function cardinalToTravelDegrees(directionLabel: string): number | undefined {
  const meteorologicalDegrees = CARDINAL_TO_DEGREES[directionLabel.toUpperCase()];

  if (meteorologicalDegrees === undefined) {
    return undefined;
  }

  return normalizeDegrees(meteorologicalDegrees + 180);
}

function extractTravelDirectionDegrees(content: string): number | undefined {
  const towardWordMatch = content.match(/\b(northward|eastward|southward|westward)\b/i);
  if (towardWordMatch) {
    return TOWARD_WORD_TO_DEGREES[towardWordMatch[1].toLowerCase()];
  }

  const fromWordMatch = content.match(/\bfrom\s+the\s+(north|east|south|west)\b/i);
  if (fromWordMatch) {
    return cardinalToTravelDegrees(fromWordMatch[1]);
  }

  const windLineMatch = content.match(/\*\*Wind:\*\*\s*[\d.]+\s*(?:mph|m\/s)\s*([A-Z]{1,3})?/i);
  const directionLabel = windLineMatch?.[1]?.toUpperCase();

  return directionLabel ? cardinalToTravelDegrees(directionLabel) : undefined;
}

export function inferWindPayload(content: string): WindPayload | null {
  const windMatch = content.match(/\*\*Wind:\*\*\s*([\d.]+)\s*(mph|m\/s)\s*([A-Z]{1,3})?/i);

  const narrativeWindMatch = content.match(
    /\b([\d.]+)\s*(mph|m\/s)\b(?:[^.\n]*?)\b(?:breeze|wind)\b/i
  );

  const speedMatch = windMatch ?? narrativeWindMatch;

  if (!speedMatch) {
    return null;
  }

  const speedMps = convertSpeedToMps(Number(speedMatch[1]), speedMatch[2]);
  const gustMatch = content.match(/\*\*Wind Gusts:\*\*\s*([\d.]+)\s*(mph|m\/s)/i);

  return {
    speedMps,
    gustMps: gustMatch ? convertSpeedToMps(Number(gustMatch[1]), gustMatch[2]) : undefined,
    directionDegrees: extractTravelDirectionDegrees(content),
  };
}

export function mergeInferredWind(sceneUpdate: unknown, inferredWind: WindPayload | null): unknown {
  if (!inferredWind || typeof sceneUpdate !== "object" || sceneUpdate === null) {
    return sceneUpdate;
  }

  const candidate = sceneUpdate as SceneUpdate;

  if (candidate.weather?.wind) {
    return sceneUpdate;
  }

  return {
    ...candidate,
    weather: {
      ...candidate.weather,
      wind: inferredWind,
    },
  } satisfies SceneUpdate;
}

export function buildWeatherTools(applySceneUpdate: (su: SceneUpdate) => Promise<void> | void) {
  const searchLocation = tool(
    async ({ query, limit }) => callMcpTool("search_location", { query, limit: limit ?? 1 }),
    {
      name: "search_location",
      description:
        "Geocode a place name to coordinates. Returns lat, lon, timezone, elevation, and location details. Always call this first to resolve the location.",
      schema: z.object({
        query: z.string().describe('Location name, e.g. "Paris", "Tokyo", "New York, NY"'),
        limit: z.number().optional().describe("Max results to return (default 1)"),
      }),
    }
  );

  const getCurrentConditions = tool(
    async ({ latitude, longitude }) =>
      callMcpTool("get_current_conditions", { latitude, longitude }),
    {
      name: "get_current_conditions",
      description:
        "Fetch real-time weather observations for a US location (temperature, humidity, wind, conditions). Use for US locations.",
      schema: z.object({
        latitude: z.number().describe("Decimal latitude"),
        longitude: z.number().describe("Decimal longitude"),
      }),
    }
  );

  const getForecast = tool(
    async ({ latitude, longitude, days, granularity }) =>
      callMcpTool("get_forecast", {
        latitude,
        longitude,
        days: days ?? 1,
        granularity: granularity ?? "hourly",
      }),
    {
      name: "get_forecast",
      description:
        "Fetch weather forecast for any global location. Use for non-US locations or as a fallback. Prefer granularity='hourly' and days=1 for current conditions.",
      schema: z.object({
        latitude: z.number().describe("Decimal latitude"),
        longitude: z.number().describe("Decimal longitude"),
        days: z.number().optional().describe("Number of forecast days, 1–16 (default 1)"),
        granularity: z
          .enum(["daily", "hourly"])
          .optional()
          .describe("Forecast granularity (default 'hourly')"),
      }),
    }
  );

  const updateScene = tool(
    async (su) => {
      await applySceneUpdate(su as SceneUpdate);
      return `Scene updated: navigating to ${su.navigate.locationName}, weather set to ${su.weather.type}.`;
    },
    {
      name: "update_scene",
      description:
        "Apply weather conditions to the 3D ArcGIS scene and navigate to the location. Call this once you have gathered weather data.",
      schema: z.object({
        navigate: z.object({
          lat: z.number().describe("Decimal latitude of the location"),
          lon: z.number().describe("Decimal longitude of the location"),
          locationName: z.string().describe("Human-readable location name, e.g. 'Paris, France'"),
          timezone: z
            .string()
            .optional()
            .describe("IANA timezone from search_location, e.g. 'Asia/Tokyo'"),
          scale: z.number().describe("Camera scale in scene units (50000–5000000)"),
        }),
        weather: z.object({
          type: z
            .enum(["sunny", "cloudy", "rainy", "snowy", "foggy"])
            .describe("ArcGIS scene weather type"),
          cloudCover: z.number().min(0).max(1).describe("Cloud cover fraction 0–1"),
          precipitation: z
            .number()
            .min(0)
            .max(1)
            .describe("Precipitation intensity 0–1 (for rainy/snowy)"),
          fogStrength: z.number().min(0).max(1).describe("Fog density 0–1 (for foggy)"),
          snowCover: z
            .enum(["enabled", "disabled"])
            .describe("Ground snow cover visibility"),
          wind: z
            .object({
              speedMps: z.number().min(0).describe("Sustained wind speed in meters per second"),
              gustMps: z
                .number()
                .min(0)
                .optional()
                .describe("Optional wind gust speed in meters per second"),
              directionDegrees: z
                .number()
                .min(0)
                .max(360)
                .optional()
                .describe(
                  "Optional wind travel direction in degrees, 0-360, where the air moves toward in the rendered scene"
                ),
            })
            .optional()
            .describe("Include when the weather data contains wind information"),
          description: z.string().describe("One-line weather summary for the chat UI"),
        }),
        datetime: z
          .string()
          .describe("Current UTC ISO-8601 datetime at this location, used for scene sun position"),
      }),
    }
  );

  return {
    searchLocation,
    getCurrentConditions,
    getForecast,
    updateScene,
  };
}
