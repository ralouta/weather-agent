export interface AppSettings {
  title: string;
  subtitle: string;
  suggestedPrompts: string[];
  sceneId: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  title: "Weather Agent",
  subtitle: "ArcGIS Geospatial AI",
  suggestedPrompts: [
    "What's the weather like in Tokyo right now?",
    "Show me current conditions in New York City",
    "Is it raining in London today?",
    "What's the weather in Sydney, Australia?",
  ],
  sceneId: "",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const response = await fetch("/settings.json", { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const raw = (await response.json()) as unknown;
    if (!isRecord(raw)) {
      throw new Error("settings.json must contain an object");
    }

    return {
      title:
        typeof raw.title === "string" && raw.title.trim()
          ? raw.title.trim()
          : DEFAULT_SETTINGS.title,
      subtitle:
        typeof raw.subtitle === "string" && raw.subtitle.trim()
          ? raw.subtitle.trim()
          : DEFAULT_SETTINGS.subtitle,
      suggestedPrompts: Array.isArray(raw.suggestedPrompts)
        ? raw.suggestedPrompts.filter(
            (prompt): prompt is string => typeof prompt === "string" && Boolean(prompt.trim())
          )
        : DEFAULT_SETTINGS.suggestedPrompts,
      sceneId:
        typeof raw.sceneId === "string" ? raw.sceneId.trim() : DEFAULT_SETTINGS.sceneId,
    };
  } catch (error) {
    console.warn("[settings] Falling back to default settings:", error);
    return DEFAULT_SETTINGS;
  }
}
