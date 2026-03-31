# Weather Agent 3D

## Disclaimer

This is a vibe-coded ArcGIS weather app.

Built with a Vite client, an Express MCP proxy, ArcGIS Maps SDK for JavaScript AI Components, and weather tooling powered by the weather-mcp project: https://github.com/weather-mcp/weather-mcp

## Run

Copy both `.env` and local settings before editing.

macOS / Linux:

```bash
cp .env.example .env
cp public/settings.json public/settings.local.json
```

Windows Command Prompt:

```bat
copy .env.example .env
copy public\settings.json public\settings.local.json
```

Required in `.env`:

- `ARCGIS_CLIENT_ID`

Optional in `.env`:

- `PORTAL_URL`
- `SERVER_PORT`

Local app settings live in `public/settings.json` and should stay untracked.

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