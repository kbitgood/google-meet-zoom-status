# Zoom OAuth App Setup Guide

This guide walks you through creating a Zoom OAuth application to allow the Google Meet to Zoom Status extension to update your Zoom presence status.

## Prerequisites

- A Zoom account (free or paid)
- Your Chrome extension ID (obtained after loading the extension in Chrome)

## Step 1: Get Your Chrome Extension ID

Before creating the Zoom app, you need your extension's unique ID:

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked** and select the extension's `dist/` folder
4. Find your extension in the list and copy the **ID** (a 32-character string like `abcdefghijklmnopqrstuvwxyzabcdef`)

Save this ID - you'll need it for the redirect URI.

## Step 2: Create a Zoom App

1. Go to the [Zoom App Marketplace Developer Portal](https://marketplace.zoom.us/develop/create)
2. Sign in with your Zoom account
3. Click **Develop** in the top navigation, then **Build App**
4. Choose **OAuth** as the app type
5. Click **Create**

## Step 3: Configure App Information

### Basic Information

Fill in the required fields:

| Field | Value |
|-------|-------|
| App Name | `Google Meet Status Sync` (or your preferred name) |
| Short Description | `Syncs Zoom presence status with Google Meet calls` |
| Long Description | `This app allows a Chrome extension to update your Zoom presence status when you join or leave Google Meet calls.` |
| Company Name | Your name or organization |
| Developer Name | Your name |
| Developer Email | Your email address |

### App Credentials

After creating the app, you'll see your credentials:

- **Client ID**: A unique identifier for your app (looks like `aBcDeFgHiJkLmNoPqRsTuVwXyZ`)
- **Client Secret**: A secret key (keep this confidential!)

**Copy both values** - you'll need them to configure the extension.

## Step 4: Configure OAuth Settings

### Redirect URL

This is the most important setting. The redirect URL must match this exact format:

```
https://<YOUR_EXTENSION_ID>.chromiumapp.org/
```

Replace `<YOUR_EXTENSION_ID>` with your actual extension ID from Step 1.

**Example:**
```
https://abcdefghijklmnopqrstuvwxyzabcdef.chromiumapp.org/
```

**Important Notes:**
- The URL must end with a trailing slash (`/`)
- Use `https://` (not `http://`)
- The extension ID must be lowercase
- Do NOT add any path after the trailing slash

### OAuth Allow List (Development)

For development, add your redirect URL to the OAuth Allow List:
1. Go to the **OAuth Allow List** section
2. Add the same redirect URL

## Step 5: Configure Scopes

Scopes define what the extension can access. Navigate to the **Scopes** section and add:

### Required Scopes

| Scope | Description | Purpose |
|-------|-------------|---------|
| `user:read` | View user information | Read your Zoom user profile and current presence status |
| `user:write` | Update user information | Update your Zoom presence status |

### How to Add Scopes

1. Click **Add Scopes**
2. Search for `user:read` and select it
3. Search for `user:write` and select it
4. Click **Done**

## Step 6: Activation (Optional for Development)

For personal use during development:
- Your app works immediately for your own account
- No activation/publishing required

For distributing to others:
- You would need to submit the app for Zoom's review
- This is NOT required for personal use

## Step 7: Configure the Extension

Create a configuration file with your credentials:

1. Copy `src/config.example.ts` to `src/config.ts`
2. Fill in your values:

```typescript
export const ZOOM_CONFIG = {
  clientId: 'YOUR_CLIENT_ID_HERE',
  clientSecret: 'YOUR_CLIENT_SECRET_HERE',
  redirectUri: 'https://YOUR_EXTENSION_ID.chromiumapp.org/',
};
```

**Security Note:** Never commit `src/config.ts` to version control. It's already in `.gitignore`.

## Troubleshooting

### "Invalid redirect URI" Error

- Verify the redirect URI exactly matches what's in Zoom
- Ensure it ends with a trailing slash
- Check that the extension ID is correct and lowercase

### "Invalid client_id" Error

- Double-check you copied the Client ID correctly
- Ensure there are no extra spaces

### "Scope not allowed" Error

- Verify both `user:read` and `user:write` scopes are added
- Save your changes in the Zoom developer portal

### Extension ID Changed

If you reload the unpacked extension, the ID may change. You'll need to:
1. Get the new extension ID
2. Update the redirect URI in Zoom
3. Update `src/config.ts`

**Tip:** Once you pack the extension or install from a `.crx` file, the ID becomes permanent.

## Security Best Practices

1. **Never share your Client Secret** - treat it like a password
2. **Keep `config.ts` out of version control** - it's in `.gitignore`
3. **Use a dedicated Zoom account for development** if possible
4. **Revoke and regenerate credentials** if you suspect they've been compromised

## API Rate Limits

Zoom's presence status API has rate limits:
- Approximately 100 requests per day for presence status updates
- The extension is designed to minimize API calls (only on join/leave events)

## Next Steps

After configuring your Zoom app:

1. Rebuild the extension: `npm run build`
2. Reload the extension in Chrome
3. Click the extension icon and click "Connect Zoom"
4. Authorize the app with your Zoom account
5. Join a Google Meet - your Zoom status should update automatically!

## Reference Links

- [Zoom OAuth Documentation](https://developers.zoom.us/docs/integrations/oauth/)
- [Zoom API Reference - Presence Status](https://developers.zoom.us/docs/api/rest/reference/user/methods/#operation/updatePresenceStatus)
- [Chrome Extension Identity API](https://developer.chrome.com/docs/extensions/reference/identity/)
