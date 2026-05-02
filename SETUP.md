# ICS Calendar Importer — Setup Guide

## Prerequisites

- Google Chrome (version 102 or later)
- A Google account

---

## Step 1 — Generate Icons

1. Open `icons/create_icons.html` in Chrome (File → Open File…)
2. Three PNG files will be downloaded automatically:
   - `icon16.png`, `icon48.png`, `icon128.png`
3. Move all three files into the `icons/` folder of this extension

---

## Step 2 — Create a Google Cloud Project & OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (e.g. "ICS Calendar Importer")
3. In the left menu go to **APIs & Services → Library**
4. Search for **Google Calendar API** and click **Enable**
5. Go to **APIs & Services → OAuth consent screen**
   - Choose **External** user type
   - Fill in App name (e.g. "ICS Calendar Importer") and your email
   - Add scope: `https://www.googleapis.com/auth/calendar`
   - Add scope: `https://www.googleapis.com/auth/userinfo.email`
   - Add yourself as a **Test user**
   - Save and continue
6. Go to **APIs & Services → Credentials**
7. Click **+ Create Credentials → OAuth client ID**
   - Application type: **Chrome Extension**
   - Name: "ICS Calendar Importer"
   - Item ID: your extension's Chrome ID (see Step 3 to find this)
8. Click **Create** and copy the **Client ID**

---

## Step 3 — Find Your Extension ID

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select this folder
4. Your extension ID appears under the extension name (e.g. `abcdefghijklmnopqrstuvwxyz123456`)

> **Tip:** To keep a stable extension ID across reloads, you can generate a key:
> ```
> openssl genrsa 2048 | openssl pkcs8 -topk8 -nocrypt -out key.pem
> openssl rsa -in key.pem -pubout -outform DER | openssl base64 -A
> ```
> Add the base64 output as `"key": "..."` in `manifest.json`. The ID will then remain constant.

---

## Step 4 — Add Your Client ID to manifest.json

Open `manifest.json` and replace the placeholder:

```json
"oauth2": {
  "client_id": "REPLACE_WITH_YOUR_CLIENT_ID.apps.googleusercontent.com",
  ...
}
```

with your actual Client ID from Step 2.

---

## Step 5 — Load the Extension

1. Go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this project folder
4. The "ICS Calendar Importer" extension will appear in your toolbar

---

## How to Use

### Sign In
1. Click the extension icon in your toolbar
2. Click **Sign in with Google** and complete the OAuth flow
3. Your calendars will load automatically

### Configure Default Calendar
1. Click the ⚙ settings button in the popup (or right-click the extension icon → Options)
2. Select your preferred default calendar
3. Click **Save**

### Import from a File
1. Click the extension icon
2. Under **From File**, click **Choose file…** and select an `.ics` file
3. Select the target calendar (or use the default)
4. Click **Import File**

### Import from a URL
1. Click the extension icon
2. Under **From URL**, paste an ICS or webcal:// URL
3. Click **Import**

### Right-Click Import
- Right-click any link on a webpage
- Select **Import to Google Calendar**
- Works with `.ics` links and `webcal://` subscription URLs

### Download Detection
- When Chrome downloads an `.ics` file, a notification appears
- Click **Import Now** to immediately add the events to your calendar

---

## Troubleshooting

| Problem | Solution |
|---|---|
| "Could not obtain auth token" | Make sure the Client ID in `manifest.json` matches your extension ID in Google Cloud Console |
| "No events found in ICS file" | Verify the file is a valid ICS/iCal file (should start with `BEGIN:VCALENDAR`) |
| "URL returned HTML" | The URL points to a webpage, not an ICS file. Check the URL. |
| Sign-in window doesn't open | Reload the extension at `chrome://extensions` |
| Extension ID changes on reload | Add a stable `key` to `manifest.json` (see Step 3) |

---

## Permissions Explained

| Permission | Why it's needed |
|---|---|
| `identity` | OAuth sign-in via `chrome.identity.getAuthToken` |
| `contextMenus` | Right-click menu on links |
| `downloads` | Detect when `.ics` files are downloaded |
| `storage` | Save your default calendar preference |
| `notifications` | Show import success/failure alerts |
| `host_permissions: googleapis.com` | Call Google Calendar API |
| `host_permissions: <all_urls>` | Fetch ICS files from any URL |
