/**
 * src/weatherAgent.ts
 *
 * Custom ArcGIS AI agent built with LangGraph + @arcgis/ai-components.
 */

import { Annotation, END, START, StateGraph } from "@langchain/langgraph/web";
import { messagesStateReducer } from "@langchain/langgraph/web";
import { isAIMessage, ToolMessage } from "@langchain/core/messages";
import {
  invokeTextPrompt,
  invokeToolPrompt,
  sendTraceMessage,
  type ChatHistory,
} from "@arcgis/ai-components/utils/index.js";
import type { AgentRegistration } from "@arcgis/ai-components/utils/index.js";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { SceneUpdate, WindPayload } from "../types.js";
import { FINAL_RESPONSE_PROMPT, SYSTEM_PROMPT } from "./prompts.js";
import {
  buildWeatherTools,
  inferWindPayload,
  mergeInferredWind,
} from "./weatherTools.js";

const MAX_AGENT_STEPS = 6;

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
    reducer: (_current: SceneUpdate | null, update: SceneUpdate | null) => update ?? null,
    default: () => null,
  }),
  latestWind: Annotation<WindPayload | null>({
    reducer: (_current: WindPayload | null, update: WindPayload | null) => update ?? null,
    default: () => null,
  }),
  stepCount: Annotation<number>({
    reducer: (_current: number, update: number) => update,
    default: () => 0,
  }),
});

function buildGraph(applySceneUpdate: (su: SceneUpdate) => Promise<void> | void) {
  const { searchLocation, getCurrentConditions, getForecast, updateScene } =
    buildWeatherTools(applySceneUpdate);

  const allTools = [searchLocation, getCurrentConditions, getForecast, updateScene];
  const toolIndex = Object.fromEntries(allTools.map((toolDef) => [toolDef.name, toolDef]));

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

    return {
      messages: [response],
      stepCount: state.stepCount + 1,
    };
  }

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

      const toolDef = toolIndex[call.name];
      let content: string;

      if (!toolDef) {
        content = `Error: Unsupported tool '${call.name}'.`;
      } else {
        try {
          const toolArgs =
            call.name === "update_scene"
              ? mergeInferredWind(call.args, latestWind)
              : call.args;

          content = String(
            await (toolDef.invoke as (args: unknown) => Promise<unknown>)(toolArgs)
          );
        } catch (error) {
          content = `Error: ${error instanceof Error ? error.message : String(error)}`;
        }
      }

      if (call.name === "get_current_conditions" || call.name === "get_forecast") {
        latestWind = inferWindPayload(content) ?? latestWind;
      }

      toolTranscriptParts.push(`Tool: ${call.name}\n${content}`);
      toolMessages.push(new ToolMessage({ content, tool_call_id: call.id ?? "" }));
    }

    return {
      messages: toolMessages,
      toolTranscript: toolTranscriptParts.join("\n\n"),
      latestWind,
    };
  }

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

  function shouldContinue(state: typeof WeatherAgentState.State) {
    if (state.stepCount >= MAX_AGENT_STEPS) {
      return "done";
    }

    const last = state.messages[state.messages.length - 1];
    return isAIMessage(last) && last.tool_calls?.length ? "executeTools" : "done";
  }

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
    createGraph: () => buildGraph(applySceneUpdate) as never,
    workspace: WeatherAgentState,
  };
}
