import type { AppSettings } from "../config/settings.js";
import { isDev } from "../app/runtime.js";
import type { SceneUpdate } from "../types.js";
import { createWeatherAgent } from "./weatherAgent.js";

type AssistantElement = HTMLElement & {
  suggestedPrompts?: string[];
};

export async function mountWeatherAssistant(options: {
  mountElement: HTMLElement;
  settings: AppSettings;
  applySceneUpdate: (sceneUpdate: SceneUpdate) => Promise<void>;
}): Promise<void> {
  const weatherAgent = createWeatherAgent(options.applySceneUpdate);

  await customElements.whenDefined("arcgis-assistant");
  await customElements.whenDefined("arcgis-assistant-agent");

  const assistantEl = document.createElement("arcgis-assistant") as AssistantElement;
  assistantEl.id = "assistant";
  assistantEl.setAttribute("heading", options.settings.title);
  assistantEl.setAttribute("description", "Ask about the weather anywhere in the world.");
  assistantEl.setAttribute(
    "entry-message",
    "Hi! Ask me about current weather at any location — I'll fly you there and apply the conditions in the 3D scene."
  );

  if (isDev) {
    assistantEl.setAttribute("log-enabled", "");
  }

  const agentEl = document.createElement("arcgis-assistant-agent");
  (agentEl as unknown as { agent: typeof weatherAgent }).agent = weatherAgent;
  assistantEl.appendChild(agentEl);
  assistantEl.suggestedPrompts = options.settings.suggestedPrompts;

  if (isDev) {
    assistantEl.addEventListener("arcgisError" as never, (event: Event) => {
      console.error("[assistant] arcgisError:", (event as CustomEvent).detail);
    });
  }

  options.mountElement.replaceChildren(assistantEl);
}
