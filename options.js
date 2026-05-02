/**
 * Options page script for ICS Calendar Importer.
 */

// ── Element refs ──────────────────────────────────────────────────────────────

const signedInCard    = document.getElementById('signedInCard');
const signedOutCard   = document.getElementById('signedOutCard');
const optAvatar       = document.getElementById('optAvatar');
const optName         = document.getElementById('optName');
const optEmail        = document.getElementById('optEmail');
const signInBtn       = document.getElementById('signInBtn');
const signOutBtn      = document.getElementById('signOutBtn');
const authStatus      = document.getElementById('authStatus');

const defaultCalendar = document.getElementById('defaultCalendar');
const saveBtn         = document.getElementById('saveBtn');
const saveStatus      = document.getElementById('saveStatus');

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const status = await sendMessage({ action: 'getAuthStatus' });
  if (status.signedIn) {
    renderSignedIn(status);
    await loadCalendars();
  } else {
    renderSignedOut();
  }
}

init();

// ── Auth ──────────────────────────────────────────────────────────────────────

function renderSignedIn(status) {
  signedInCard.classList.remove('hidden');
  signedOutCard.classList.add('hidden');
  optEmail.textContent = status.email || '';
  optName.textContent  = status.name  || status.email || 'Google User';
  optAvatar.textContent = (status.email || 'G')[0].toUpperCase();
}

function renderSignedOut() {
  signedInCard.classList.add('hidden');
  signedOutCard.classList.remove('hidden');
  defaultCalendar.disabled = true;
  saveBtn.disabled = true;
  defaultCalendar.innerHTML = '<option value="">Sign in to load calendars…</option>';
}

signInBtn.addEventListener('click', async () => {
  signInBtn.disabled = true;
  signInBtn.textContent = 'Signing in…';
  setAuthStatus('info', 'Opening Google sign-in…');
  try {
    await sendMessage({ action: 'signIn' });
    const status = await sendMessage({ action: 'getAuthStatus' });
    if (status.signedIn) {
      renderSignedIn(status);
      clearAuthStatus();
      await loadCalendars();
    } else {
      setAuthStatus('error', 'Sign-in did not complete. Please try again.');
    }
  } catch (err) {
    setAuthStatus('error', `Sign-in failed: ${err.message}`);
  } finally {
    signInBtn.disabled = false;
    signInBtn.textContent = 'Sign in with Google';
  }
});

signOutBtn.addEventListener('click', async () => {
  await sendMessage({ action: 'signOut' });
  renderSignedOut();
  setAuthStatus('info', 'Signed out successfully.');
});

// ── Calendars ─────────────────────────────────────────────────────────────────

async function loadCalendars() {
  defaultCalendar.disabled = true;
  defaultCalendar.innerHTML = '<option value="">Loading…</option>';
  saveBtn.disabled = true;

  try {
    const { calendars } = await sendMessage({ action: 'getCalendars' });
    defaultCalendar.innerHTML = '';

    for (const cal of calendars) {
      const opt = document.createElement('option');
      opt.value = cal.id;
      opt.textContent = cal.primary ? `${cal.summary} (primary)` : cal.summary;
      defaultCalendar.appendChild(opt);
    }

    // Restore saved preference
    const { defaultCalendarId } = await chrome.storage.sync.get('defaultCalendarId');
    if (defaultCalendarId) {
      defaultCalendar.value = defaultCalendarId;
    }
    if (!defaultCalendar.value && defaultCalendar.options.length > 0) {
      defaultCalendar.selectedIndex = 0;
    }

    defaultCalendar.disabled = false;
    saveBtn.disabled = false;
  } catch (err) {
    defaultCalendar.innerHTML = '<option value="primary">Primary Calendar</option>';
    defaultCalendar.disabled = false;
    saveBtn.disabled = false;
    setSaveStatus('error', `Could not load calendars: ${err.message}`);
  }
}

// ── Save ──────────────────────────────────────────────────────────────────────

saveBtn.addEventListener('click', async () => {
  const calId = defaultCalendar.value;
  if (!calId) return;

  saveBtn.disabled = true;
  try {
    await chrome.storage.sync.set({ defaultCalendarId: calId });
    setSaveStatus('success', '✓ Default calendar saved.');
  } catch (err) {
    setSaveStatus('error', `Failed to save: ${err.message}`);
  } finally {
    saveBtn.disabled = false;
    setTimeout(clearSaveStatus, 3000);
  }
});

// ── Status helpers ────────────────────────────────────────────────────────────

function setAuthStatus(type, msg) {
  authStatus.className = `status-msg ${type}`;
  authStatus.textContent = msg;
}
function clearAuthStatus() {
  authStatus.className = 'status-msg hidden';
}
function setSaveStatus(type, msg) {
  saveStatus.className = `status-msg ${type}`;
  saveStatus.textContent = msg;
}
function clearSaveStatus() {
  saveStatus.className = 'status-msg hidden';
}

// ── Messaging ─────────────────────────────────────────────────────────────────

function sendMessage(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(resp);
      }
    });
  });
}
