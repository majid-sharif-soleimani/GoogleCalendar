/**
 * Background service worker for ICS Calendar Importer.
 * Handles: context menus, download detection, OAuth, Google Calendar API calls.
 */

import { parseICS, icsEventToGoogleEvent } from './ics-parser.js';

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const USERINFO_API = 'https://www.googleapis.com/oauth2/v2/userinfo';
const DL_KEY_PREFIX = 'ics_dl_';

// Deduplication: page-interceptor fires up to 3 times for the same download
const recentlyImported = new Map(); // key -> timestamp

// ─── Setup ────────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'import-ics',
    title: 'Import to Google Calendar',
    contexts: ['link']
  });
});

// ─── Context Menu ─────────────────────────────────────────────────────────────

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== 'import-ics') return;
  let url = info.linkUrl;
  if (!url) return;
  // Convert webcal:// to https://
  url = url.replace(/^webcal:\/\//i, 'https://');
  importFromUrl(url).catch((err) => {
    console.error('ICS import failed:', err);
    notifyActiveTab(err.message, 'error');
  });
});

// ─── Download Detection ───────────────────────────────────────────────────────

chrome.downloads.onCreated.addListener((item) => {
  const url = (item.url || '').toLowerCase();
  const filename = (item.filename || '').toLowerCase();
  // Store source URL for every download temporarily so onChanged can check it later
  chrome.storage.local.set({ [`${DL_KEY_PREFIX}url_${item.id}`]: item.url || '' });
  // If already identifiable as .ics, mark it now
  if (filename.endsWith('.ics') || url.includes('.ics')) {
    chrome.storage.local.set({ [`${DL_KEY_PREFIX}${item.id}`]: item.url || '' });
  }
});

chrome.downloads.onChanged.addListener(async (delta) => {
  // Chrome often resolves the filename after creation — catch .ics files here
  if (delta.filename?.current?.toLowerCase().endsWith('.ics')) {
    const tracked = await chrome.storage.local.get(`${DL_KEY_PREFIX}${delta.id}`);
    if (tracked[`${DL_KEY_PREFIX}${delta.id}`] === undefined) {
      const urlStored = await chrome.storage.local.get(`${DL_KEY_PREFIX}url_${delta.id}`);
      const sourceUrl = urlStored[`${DL_KEY_PREFIX}url_${delta.id}`] || '';
      chrome.storage.local.set({ [`${DL_KEY_PREFIX}${delta.id}`]: sourceUrl });
    }
  }

  if (!delta.state || delta.state.current !== 'complete') return;

  chrome.storage.local.remove(`${DL_KEY_PREFIX}url_${delta.id}`);

  const key = `${DL_KEY_PREFIX}${delta.id}`;
  const stored = await chrome.storage.local.get(key);
  const sourceUrl = stored[key];
  if (sourceUrl === undefined) return;

  chrome.storage.local.remove(key);

  const sourceIsBlob = sourceUrl.startsWith('blob:');

  if (!sourceIsBlob) {
    // Real HTTP URL — fetch and auto-import
    importFromUrl(sourceUrl).catch((err) =>
      notifyActiveTab(err.message, 'error')
    );
  }
  // Blob URL: page-interceptor already handled it — nothing to do here
});


// ─── Message Handler (from popup / options) ───────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handle = async () => {
    switch (msg.action) {
      case 'signIn':
        await getAuthToken(true);
        return { success: true };

      case 'signOut':
        await signOut();
        return { success: true };

      case 'getAuthStatus':
        return getAuthStatus();

      case 'getCalendars':
        return { calendars: await getCalendars() };

      case 'importFromUrl': {
        const url = (msg.url || '').replace(/^webcal:\/\//i, 'https://');
        const result = await importFromUrl(url, msg.calendarId);
        return { success: true, result };
      }

      case 'importFromICS': {
        const result = await importFromICSText(msg.icsText, msg.calendarId);
        return { success: true, result };
      }

      case 'autoImportFromICS': {
        // Triggered automatically when a page downloads an ICS blob
        autoImport(msg.icsText).catch(console.error);
        return { success: true };
      }

      default:
        return { success: false, error: 'Unknown action' };
    }
  };

  handle()
    .then(sendResponse)
    .catch((err) => sendResponse({ success: false, error: err.message }));

  return true; // Keep message channel open for async response
});

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function getAuthToken(interactive = false) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!token) {
        reject(new Error('Could not obtain auth token.'));
      } else {
        resolve(token);
      }
    });
  });
}

async function signOut() {
  let token;
  try {
    token = await getAuthToken(false);
  } catch {
    return; // Already signed out
  }
  // Revoke on Google's side
  await fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, { method: 'POST' });
  // Remove from Chrome's cache
  await new Promise((resolve) => chrome.identity.removeCachedAuthToken({ token }, resolve));
}

async function getAuthStatus() {
  try {
    const token = await getAuthToken(false);
    const resp = await fetch(USERINFO_API, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (resp.ok) {
      const info = await resp.json();
      return { signedIn: true, email: info.email, name: info.name };
    }
  } catch {}
  return { signedIn: false };
}

// ─── Calendar API ─────────────────────────────────────────────────────────────

async function getCalendars() {
  const token = await getAuthToken(true);
  const resp = await fetch(`${CALENDAR_API}/users/me/calendarList?maxResults=250`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Failed to load calendars: ${resp.status} ${body}`);
  }
  const data = await resp.json();
  return (data.items || [])
    .filter((c) => c.accessRole === 'owner' || c.accessRole === 'writer')
    .map((c) => ({ id: c.id, summary: c.summary, primary: c.primary || false }))
    .sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0));
}

async function importFromUrl(url, calendarId) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Could not fetch ICS (${resp.status}): ${url}`);
  const contentType = resp.headers.get('content-type') || '';
  // Accept text/calendar, text/plain, application/octet-stream, etc.
  if (contentType.includes('text/html')) {
    throw new Error('URL returned an HTML page, not an ICS file.');
  }
  const text = await resp.text();
  if (!text.includes('BEGIN:VCALENDAR') && !text.includes('BEGIN:VEVENT')) {
    throw new Error('The URL does not appear to contain a valid ICS calendar.');
  }
  return importFromICSText(text, calendarId);
}

async function importFromICSText(icsText, calendarId) {
  const icsEvents = parseICS(icsText);
  if (icsEvents.length === 0) {
    throw new Error('No events (VEVENT) found in the ICS file.');
  }

  if (!calendarId) {
    const stored = await chrome.storage.sync.get('defaultCalendarId');
    calendarId = stored.defaultCalendarId || 'primary';
  }

  const token = await getAuthToken(true);
  let imported = 0;
  let failed = 0;
  const errors = [];

  for (const icsEvent of icsEvents) {
    try {
      const googleEvent = icsEventToGoogleEvent(icsEvent);
      if (!googleEvent.start) {
        failed++;
        errors.push(`Skipped event "${googleEvent.summary}" — missing start date.`);
        continue;
      }

      const resp = await fetch(
        `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(googleEvent)
        }
      );

      if (resp.ok) {
        imported++;
      } else {
        const errBody = await resp.json().catch(() => ({}));
        const msg = errBody.error?.message || `HTTP ${resp.status}`;
        errors.push(`"${googleEvent.summary}": ${msg}`);
        failed++;
      }
    } catch (e) {
      failed++;
      errors.push(e.message);
    }
  }

  const summary =
    failed === 0
      ? `Imported ${imported} event${imported !== 1 ? 's' : ''} successfully.`
      : `Imported ${imported}, failed ${failed} of ${icsEvents.length} events.`;

  notifyActiveTab(summary, failed === 0 ? 'success' : 'error');
  return { imported, failed, total: icsEvents.length, errors };
}

async function autoImport(icsText) {
  // Deduplicate: all 3 interceptor strategies can fire for the same download
  const key = icsText.trim().slice(0, 300);
  const now = Date.now();
  if (recentlyImported.has(key) && now - recentlyImported.get(key) < 5000) return;
  recentlyImported.set(key, now);
  for (const [k, t] of recentlyImported) {
    if (now - t > 30000) recentlyImported.delete(k);
  }

  // Check if signed in (non-interactive — don't prompt)
  let token;
  try { token = await getAuthToken(false); } catch { token = null; }

  if (!token) {
    notifyActiveTab('Sign in to ICS Calendar Importer to import events.', 'info');
    return;
  }

  await importFromICSText(icsText);
}

async function notifyActiveTab(text, type) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { action: 'showToast', text, type }).catch(() => {});
  }
}

