import "@arcgis/core/assets/esri/themes/dark/main.css";
import "@esri/calcite-components/main.css";
import "@arcgis/ai-components/main.css";
import "./style.css";
import { bootstrapApp } from "./app/bootstrapApp.js";

bootstrapApp().catch((error) => {
  console.error("[main] Fatal init error:", error);
});
