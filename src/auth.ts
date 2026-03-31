/**
 * src/auth.ts
 *
 * ArcGIS Online OAuth 2.0 authentication.
 * Must be called before any SDK requests that require a signed-in user
 * (particularly the @arcgis/ai-components LLM calls).
 */

import OAuthInfo from "@arcgis/core/identity/OAuthInfo.js";
import esriId from "@arcgis/core/identity/IdentityManager.js";
import Portal from "@arcgis/core/portal/Portal.js";

const CLIENT_ID = import.meta.env.ARCGIS_CLIENT_ID as string;
const PORTAL_URL = (import.meta.env.PORTAL_URL as string) || "https://www.arcgis.com";

export interface AuthUser {
  fullName: string;
  username: string;
}

if (!CLIENT_ID || CLIENT_ID === "YOUR_ARCGIS_CLIENT_ID_HERE") {
  console.warn(
    "[auth] ARCGIS_CLIENT_ID is not set. " +
      "Copy .env.example to .env and fill in your OAuth client ID."
  );
}

/**
 * Register the OAuth app and trigger sign-in if the user is not already
 * authenticated. Returns the signed-in portal user profile.
 */
export async function setupAuth(): Promise<AuthUser> {
  if (!CLIENT_ID || CLIENT_ID === "YOUR_ARCGIS_CLIENT_ID_HERE") {
    throw new Error(
      "Missing ARCGIS_CLIENT_ID. Update .env with a valid ArcGIS OAuth client ID."
    );
  }

  const info = new OAuthInfo({
    appId: CLIENT_ID,
    portalUrl: PORTAL_URL,
    popup: false,
  });

  esriId.registerOAuthInfos([info]);

  // Attempt silent sign-in first (uses stored credential / cookie).
  try {
    await esriId.checkSignInStatus(`${PORTAL_URL}/sharing`);
  } catch {
    // No stored credential – prompt the user to sign in.
    await esriId.getCredential(`${PORTAL_URL}/sharing`);
  }

  const portal = new Portal({ url: PORTAL_URL });
  await portal.load();

  // The @arcgis/ai-orchestrator reads Portal.getDefault().helperServices.aiModels
  // at the moment invokeToolPrompt is called. Load the default portal now so
  // helperServices (including aiModels.url) is populated before any LLM call.
  const defaultPortal = Portal.getDefault();
  if (!defaultPortal.loaded) {
    await defaultPortal.load();
  }

  const username = portal.user?.username ?? "unknown";
  const fullName = portal.user?.fullName?.trim() || username;

  return {
    fullName,
    username,
  };
}

export function signOut(): void {
  esriId.destroyCredentials();
  window.location.reload();
}
