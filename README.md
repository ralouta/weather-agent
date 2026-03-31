# Weather Agent 3D

## Disclaimer

This is a vibe-coded ArcGIS weather app.

Built with a Vite client, an Express MCP proxy, ArcGIS Maps SDK for JavaScript AI Components, and weather tooling powered by the weather-mcp project: https://github.com/weather-mcp/weather-mcp

## Run

Copy the local config files before editing.

macOS / Linux:

```bash
cp .env.example .env
cp settings.example.json settings.json
```

Windows Command Prompt:

```bat
copy .env.example .env
copy settings.example.json settings.json
```

Required in `.env`:

- `ARCGIS_CLIENT_ID`

Create the OAuth app and client ID by following [this ArcGIS OAuth credential tutorial](https://developers.arcgis.com/documentation/security-and-authentication/app-authentication/tutorials/create-oauth-credentials-app-auth/online/), then add `http://localhost:5173` as a redirect URI.

Optional in `.env`:

- `PORTAL_URL`
- `SERVER_PORT`

App settings are loaded from `settings.json` at the project root and served at `/settings.json`.
The repo includes `settings.example.json` as the tracked starter file.
If `settings.json` is missing, the app falls back to `settings.example.json` during development and production builds.

Settings fields:

- `title`: Header text and browser title for the app.
- `subtitle`: Secondary label shown under the main title.
- `suggestedPrompts`: Starter prompts shown in the AI panel.
- `sceneId`: ArcGIS web scene item ID to load on startup.

```bash
npm install
npm run start
```

Client only:

```bash
npm run dev
```

Server only:

```bash
npm run server
```

## Production

```bash
npm run build
npm run preview
```