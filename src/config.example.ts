/**
 * Zoom OAuth Configuration
 *
 * Copy this file to `config.ts` and fill in your values.
 * NEVER commit config.ts to version control!
 *
 * See docs/ZOOM_OAUTH_SETUP.md for detailed setup instructions.
 */

export interface ZoomConfig {
  /**
   * Your Zoom OAuth app's Client ID
   * Found in: Zoom App Marketplace > Your App > App Credentials
   */
  clientId: string;

  /**
   * Your Zoom OAuth app's Client Secret
   * Found in: Zoom App Marketplace > Your App > App Credentials
   * KEEP THIS SECRET - never share or commit to version control
   */
  clientSecret: string;

  /**
   * OAuth redirect URI for the Chrome extension
   * Format: https://<EXTENSION_ID>.chromiumapp.org/
   *
   * To get your extension ID:
   * 1. Load the extension in Chrome (chrome://extensions)
   * 2. Copy the 32-character ID
   * 3. Use format: https://abcdefghijklmnopqrstuvwxyzabcdef.chromiumapp.org/
   *
   * IMPORTANT: Must match exactly what you configured in Zoom App Marketplace
   */
  redirectUri: string;
}

/**
 * Zoom OAuth scopes required by this extension
 *
 * - user:read  - Read user profile and current presence status
 * - user:write - Update presence status when joining/leaving meetings
 */
export const ZOOM_SCOPES = ['user:read', 'user:write'] as const;

/**
 * Zoom API configuration
 */
export const ZOOM_API = {
  /** Base URL for Zoom API v2 */
  baseUrl: 'https://api.zoom.us/v2',

  /** OAuth authorization endpoint */
  authUrl: 'https://zoom.us/oauth/authorize',

  /** OAuth token endpoint */
  tokenUrl: 'https://zoom.us/oauth/token',
} as const;

/**
 * Your Zoom OAuth configuration
 *
 * Replace the placeholder values with your actual credentials
 * from the Zoom App Marketplace developer portal.
 */
export const ZOOM_CONFIG: ZoomConfig = {
  // Replace with your actual Client ID from Zoom App Marketplace
  clientId: 'YOUR_CLIENT_ID_HERE',

  // Replace with your actual Client Secret from Zoom App Marketplace
  clientSecret: 'YOUR_CLIENT_SECRET_HERE',

  // Replace YOUR_EXTENSION_ID with your Chrome extension's ID
  // Example: 'https://abcdefghijklmnopqrstuvwxyzabcdef.chromiumapp.org/'
  redirectUri: 'https://YOUR_EXTENSION_ID.chromiumapp.org/',
};
