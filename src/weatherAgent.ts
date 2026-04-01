/**
 * src/weatherAgent.ts
 *
 * Custom ArcGIS AI agent built with LangGraph + @arcgis/ai-components.
 *
 * Architecture
 * ────────────
 * The agent is registered to <arcgis-assistant> via <arcgis-assistant-agent>.
 * It runs entirely in the browser; the ArcGIS-hosted LLM (no external API key)
 * is invoked through the invokeToolPrompt / invokeTextPrompt helpers from
 * @arcgis/ai-components.  Weather data is fetched from the backend MCP proxy
 * at /api/mcp/:toolName.
 *
 * Graph flow
 * ──────────
 *   START → callAgent → [tool calls?] → YES → executeTools → callAgent (loop)
 *                                      → NO  → END
 *
 * Tools available to the LLM
 * ───────────────────────────
 *   search_location         – geocode a place name → lat/lon/timezone
 *   get_current_conditions  – real-time US weather observations
 *   get_forecast            – worldwide hourly/daily forecast
 *   update_scene            – side-effect: apply SceneUpdate to the 3D view
 */

import { Annotation, END, START, StateGraph } from "@langchain/langgraph/web";
import { messagesStateReducer } from "@langchain/langgraph/web";
import { isAIMessage, ToolMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  invokeTextPrompt,
  invokeToolPrompt,
  sendTraceMessage,
  type ChatHistory,
} from "@arcgis/ai-components/utils/index.js";
import type { AgentRegistration } from "@arcgis/ai-components/utils/index.js";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { SceneUpdate, WindPayload } from "./types.js";

// ── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a 3D weather visualization assistant embedded in an ArcGIS SceneView.

When the user asks about weather at any location:
1. Call search_location to resolve the place to coordinates and timezone.
2. For US locations call get_current_conditions for real-time observations.
   For non-US locations (or as a fallback) call get_forecast with
   granularity="hourly" and days=1.
3. After you have the weather data, call update_scene with the full structured
  payload to navigate the 3D scene and apply the correct weather visualization.
  Always pass the IANA timezone from search_location into navigate.timezone.
  If the weather tool output includes wind information, include weather.wind.
  Convert wind speeds to meters per second when needed.
  For weather.wind.directionDegrees, return the direction the wind travels toward
  in the scene, not the meteorological "from" bearing. Examples: a west wind
  or "wind W" should render toward the east (90). "Eastward breeze" is also 90.
4. Reply with a concise, conversational 2-4 sentence weather report. Always mention wind speed and direction if the data includes it.

Weather type selection guide:
  sunny  → clear or mostly clear sky (cloud cover < 25 %)
  cloudy → overcast, partly cloudy (cloud cover 25 %–100 %, no precipitation)
  rainy  → rain, drizzle, showers, thunderstorms
  snowy  → snowfall, blizzard, freezing rain
  foggy  → fog, mist, dense haze

Scale guidelines for the navigate payload:
  city / urban area  → 50 000 – 150 000
  county / region    → 200 000 – 500 000
  country / wide     → 1 000 000 – 5 000 000`;

const FINAL_RESPONSE_PROMPT = `You are a concise weather assistant.

Write a short response for the end user based on the tool outputs already gathered.
Requirements:
1. Mention the resolved place name.
2. Summarize the current weather conditions in plain language, including wind speed and direction if the data includes it.
3. Mention that the 3D scene has been updated.
4. Keep it to 1-3 short sentences.
5. Do not include JSON, markdown headings, or tool names.`;

// ── LangGraph state ──────────────────────────────────────────────────────────

const WeatherAgentState = Annotation.Root({
  messages: Annotation<ChatHistory>({
    reducer: messagesStateReducer as (a: ChatHistory, b: ChatHistory) => ChatHistory,
    default: () => [],
  }),
  outputMessage: Annotation<string>({
    reducer: (_current: string, update: string) => update,
    default: () => "",
  }),
  toolTranscript: Annotation<string>({
    reducer: (_current: string, update: string) => update,
    default: () => "",
  }),
  sceneUpdate: Annotation<SceneUpdate | null>({
    reducer: (_current: SceneUpdate | null, update: SceneUpdate | null) =>
      update ?? null,
    default: () => null,
  }),
  latestWind: Annotation<WindPayload | null>({
    reducer: (_current: WindPayload | null, update: WindPayload | null) =>
      update ?? null,
    default: () => null,
  }),
});

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

function inferWindPayload(content: string): WindPayload | null {
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
    gustMps: gustMatch
      ? convertSpeedToMps(Number(gustMatch[1]), gustMatch[2])
      : undefined,
    directionDegrees: extractTravelDirectionDegrees(content),
  };
}

function mergeInferredWind(sceneUpdate: unknown, inferredWind: WindPayload | null): unknown {
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

// ── Helper: call MCP proxy ────────────────────────────────────────────────────

async function callMcpTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<string> {
  const res = await fetch(`/api/mcp/${toolName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const { error } = (await res.json().catch(() => ({ error: res.statusText }))) as { error: string };
    throw new Error(`MCP tool '${toolName}' failed: ${error}`);
  }
  const { result } = (await res.json()) as { result: string };
  return result;
}

// ── Tool definitions ─────────────────────────────────────────────────────────

function buildTools(applySceneUpdate: (su: SceneUpdate) => Promise<void> | void) {
  const searchLocation = tool(
    async ({ query, limit }) =>
      callMcpTool("search_location", { query, limit: limit ?? 1 }),
    {
      name: "search_location",
      description:
        "Geocode a place name to coordinates. Returns lat, lon, timezone, elevation, and location details. Always call this first to resolve the location.",
      schema: z.object({
        query: z
          .string()
          .describe('Location name, e.g. "Paris", "Tokyo", "New York, NY"'),
        limit: z
          .number()
          .optional()
          .describe("Max results to return (default 1)"),
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
        days: z
          .number()
          .optional()
          .describe("Number of forecast days, 1–16 (default 1)"),
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
          locationName: z
            .string()
            .describe("Human-readable location name, e.g. 'Paris, France'"),
          timezone: z
            .string()
            .optional()
            .describe("IANA timezone from search_location, e.g. 'Asia/Tokyo'"),
          scale: z
            .number()
            .describe("Camera scale in scene units (50000–5000000)"),
        }),
        weather: z.object({
          type: z
            .enum(["sunny", "cloudy", "rainy", "snowy", "foggy"])
            .describe("ArcGIS scene weather type"),
          cloudCover: z
            .number()
            .min(0)
            .max(1)
            .describe("Cloud cover fraction 0–1"),
          precipitation: z
            .number()
            .min(0)
            .max(1)
            .describe("Precipitation intensity 0–1 (for rainy/snowy)"),
          fogStrength: z
            .number()
            .min(0)
            .max(1)
            .describe("Fog density 0–1 (for foggy)"),
          snowCover: z
            .enum(["enabled", "disabled"])
            .describe("Ground snow cover visibility"),
          wind: z
            .object({
              speedMps: z
                .number()
                .min(0)
                .describe("Sustained wind speed in meters per second"),
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
          description: z
            .string()
            .describe("One-line weather summary for the chat UI"),
        }),
        datetime: z
          .string()
          .describe(
            "Current UTC ISO-8601 datetime at this location, used for scene sun position"
          ),
      }),
    }
  );

  return { searchLocation, getCurrentConditions, getForecast, updateScene };
}

// ── Graph factory ────────────────────────────────────────────────────────────

function buildGraph(applySceneUpdate: (su: SceneUpdate) => Promise<void> | void) {
  const { searchLocation, getCurrentConditions, getForecast, updateScene } =
    buildTools(applySceneUpdate);

  const allTools = [
    searchLocation,
    getCurrentConditions,
    getForecast,
    updateScene,
  ];

  // Index tools by name for fast lookup in the executeTools node.
  const toolIndex = Object.fromEntries(allTools.map((t) => [t.name, t]));

  // ── Node: callAgent ──────────────────────────────────────────────────────
  async function callAgent(
    state: typeof WeatherAgentState.State,
    config: RunnableConfig
  ) {
    await sendTraceMessage(
      { text: "Analysing weather query…", agentName: "Weather Agent" },
      config
    );

    const response = await invokeToolPrompt({
      promptText: SYSTEM_PROMPT,
      messages: state.messages,
      tools: allTools,
    });

    return { messages: [response] };
  }

  // ── Node: executeTools ───────────────────────────────────────────────────
  async function executeTools(
    state: typeof WeatherAgentState.State,
    config: RunnableConfig
  ) {
    const lastMessage = state.messages[state.messages.length - 1];
    if (!isAIMessage(lastMessage) || !lastMessage.tool_calls?.length) {
      return { messages: [] };
    }

    const toolMessages: ToolMessage[] = [];
    const toolTranscriptParts: string[] = [];
    let latestWind = state.latestWind;

    for (const call of lastMessage.tool_calls) {
      await sendTraceMessage(
        {
          text: `Calling tool: ${call.name}`,
          agentName: "Weather Agent",
          toolName: call.name,
        },
        config
      );

      const t = toolIndex[call.name];
      let content: string;
      try {
        const toolArgs =
          call.name === "update_scene"
            ? mergeInferredWind(call.args, latestWind)
            : call.args;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        content = String(await (t.invoke as (a: unknown) => Promise<unknown>)(toolArgs));
      } catch (err) {
        content = `Error: ${err instanceof Error ? err.message : String(err)}`;
      }

      if (call.name === "get_current_conditions" || call.name === "get_forecast") {
        latestWind = inferWindPayload(content) ?? latestWind;
      }

      toolTranscriptParts.push(
        `Tool: ${call.name}\n${content}`
      );

      toolMessages.push(
        new ToolMessage({ content, tool_call_id: call.id ?? "" })
      );
    }

    return {
      messages: toolMessages,
      toolTranscript: toolTranscriptParts.join("\n\n"),
      latestWind,
    };
  }

  // ── Node: setOutputMessage ───────────────────────────────────────────────
  async function setOutputMessage(
    state: typeof WeatherAgentState.State,
    config: RunnableConfig
  ) {
    const last = state.messages[state.messages.length - 1];
    const directText =
      isAIMessage(last) && typeof last.content === "string"
        ? last.content
        : "";

    if (directText.trim()) {
      return { outputMessage: directText.trim() };
    }

    await sendTraceMessage(
      { text: "Generating final weather response…", agentName: "Weather Agent" },
      config
    );

    const fallbackText = await invokeTextPrompt({
      promptText:
        `${FINAL_RESPONSE_PROMPT}\n\n` +
        `Tool outputs:\n${state.toolTranscript || "No tool transcript available."}`,
      messages: state.messages,
    });

    return {
      outputMessage:
        fallbackText.trim() ||
        state.sceneUpdate?.weather.description ||
        "The 3D scene has been updated with the latest weather conditions.",
    };
  }

  // ── Router ───────────────────────────────────────────────────────────────
  function shouldContinue(state: typeof WeatherAgentState.State) {
    const last = state.messages[state.messages.length - 1];
    return isAIMessage(last) && last.tool_calls?.length
      ? "executeTools"
      : "done";
  }

  // ── Build StateGraph ─────────────────────────────────────────────────────
  return new StateGraph(WeatherAgentState)
    .addNode("callAgent", callAgent)
    .addNode("executeTools", executeTools)
    .addNode("done", setOutputMessage)
    .addEdge(START, "callAgent")
    .addConditionalEdges("callAgent", shouldContinue, {
      executeTools: "executeTools",
      done: "done",
    })
    .addEdge("executeTools", "callAgent")
    .addEdge("done", END);
}

// ── Public factory ───────────────────────────────────────────────────────────

/**
 * Creates an AgentRegistration for the weather agent.
 *
 * @param applySceneUpdate  Callback that receives a SceneUpdate and applies
 *                          it to the live ArcGIS SceneView.
 */
export function createWeatherAgent(
  applySceneUpdate: (su: SceneUpdate) => Promise<void> | void
): AgentRegistration {
  return {
    id: "weather-agent",
    name: "Weather Agent",
    description:
      "Answers weather questions for any location worldwide and updates " +
      "the 3D ArcGIS scene with accurate weather conditions, camera navigation, " +
      "and day/night lighting. Use this agent when the user asks about current " +
      "weather, temperature, rain, snow, fog, or wants to fly to a place and " +
      "see what the weather looks like there.",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createGraph: () => buildGraph(applySceneUpdate) as any,
    workspace: WeatherAgentState,
  };
}
