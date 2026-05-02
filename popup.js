/**
 * Popup script for ICS Calendar Importer.
 * Handles the popup UI: auth state, file/URL input, calendar selection, and import.
 */

// ── Element refs ──────────────────────────────────────────────────────────────

const authSection    = document.getElementById('authSection');
const signedInState  = document.getElementById('signedInState');
const signedOutState = document.getElementById('signedOutState');
const userEmail      = document.getElementById('userEmail');
const userAvatar     = document.getElementById('userAvatar');
const signInBtn      = document.getElementById('signInBtn');
const signOutBtn     = document.getElementById('signOutBtn');
const optionsBtn     = document.getElementById('optionsBtn');

const importSection  = document.getElementById('importSection');
const calendarSelect = document.getElementById('calendarSelect');

const fileInput      = document.getElementById('fileInput');
const fileName       = document.getElementById('fileName');
const importFileBtn  = document.getElementById('importFileBtn');

const urlInput       = document.getElementById('urlInput');
const importUrlBtn   = document.getElementById('importUrlBtn');

const statusArea     = document.getElementById('statusArea');
const statusMessage  = document.getElementById('statusMessage');
const progressBar    = document.getElementById('progressBar');
const progressFill   = document.getElementById('progressFill');
const errorList      = document.getElementById('errorList');

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const status = await sendMessage({ action: 'getAuthStatus' });
  if (status.signedIn) {
    showSignedIn(status.email);
    await loadCalendars();
  } else {
    showSignedOut();
  }
}

init();

// ── Auth UI ───────────────────────────────────────────────────────────────────

function showSignedIn(email) {
  signedInState.classList.remove('hidden');
  signedOutState.classList.add('hidden');
  importSection.classList.remove('hidden');
  if (email) {
    userEmail.textContent = email;
    userAvatar.textContent = email[0].toUpperCase();
  }
}

function showSignedOut() {
  signedInState.classList.add('hidden');
  signedOutState.classList.remove('hidden');
  importSection.classList.add('hidden');
}

signInBtn.addEventListener('click', async () => {
  signInBtn.disabled = true;
  signInBtn.textContent = 'Signing in…';
  try {
    await sendMessage({ action: 'signIn' });
    const status = await sendMessage({ action: 'getAuthStatus' });
    if (status.signedIn) {
      showSignedIn(status.email);
      await loadCalendars();
    } else {
      showStatus('error', 'Sign-in failed. Please try again.');
    }
  } catch (err) {
    showStatus('error', `Sign-in error: ${err.message}`);
  } finally {
    signInBtn.disabled = false;
    signInBtn.textContent = 'Sign in with Google';
  }
});

signOutBtn.addEventListener('click', async () => {
  await sendMessage({ action: 'signOut' });
  showSignedOut();
  clearStatus();
});

// ── Options ───────────────────────────────────────────────────────────────────

optionsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// ── Calendars ─────────────────────────────────────────────────────────────────

async function loadCalendars() {
  calendarSelect.disabled = true;
  calendarSelect.innerHTML = '<option value="">Loading calendars…</option>';

  try {
    const { calendars } = await sendMessage({ action: 'getCalendars' });
    calendarSelect.innerHTML = '';

    for (const cal of calendars) {
      const opt = document.createElement('option');
      opt.value = cal.id;
      opt.textContent = cal.primary ? `${cal.summary} (primary)` : cal.summary;
      calendarSelect.appendChild(opt);
    }

    // Restore saved default
    const { defaultCalendarId } = await chrome.storage.sync.get('defaultCalendarId');
    if (defaultCalendarId) {
      calendarSelect.value = defaultCalendarId;
    }
    // If nothing matched, fall back to first option (primary)
    if (!calendarSelect.value && calendarSelect.options.length > 0) {
      calendarSelect.selectedIndex = 0;
    }

    calendarSelect.disabled = false;
  } catch (err) {
    calendarSelect.innerHTML = '<option value="primary">Primary Calendar</option>';
    calendarSelect.disabled = false;
    showStatus('warning', `Could not load calendars: ${err.message}`);
  }
}

// ── File Import ───────────────────────────────────────────────────────────────

let selectedFileContent = null;

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) {
    fileName.textContent = 'No file chosen';
    importFileBtn.disabled = true;
    selectedFileContent = null;
    return;
  }

  fileName.textContent = file.name;
  importFileBtn.disabled = true;
  clearStatus();

  const reader = new FileReader();
  reader.onload = (e) => {
    selectedFileContent = e.target.result;
    importFileBtn.disabled = false;
  };
  reader.onerror = () => {
    showStatus('error', 'Could not read the selected file.');
    importFileBtn.disabled = true;
  };
  reader.readAsText(file);
});

importFileBtn.addEventListener('click', async () => {
  if (!selectedFileContent) return;
  await runImport(() =>
    sendMessage({
      action: 'importFromICS',
      icsText: selectedFileContent,
      calendarId: calendarSelect.value
    })
  );
});

// ── URL Import ────────────────────────────────────────────────────────────────

urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') importUrlBtn.click();
});

importUrlBtn.addEventListener('click', async () => {
  const url = urlInput.value.trim();
  if (!url) {
    showStatus('error', 'Please enter a URL.');
    return;
  }
  await runImport(() =>
    sendMessage({
      action: 'importFromUrl',
      url,
      calendarId: calendarSelect.value
    })
  );
});

// ── Import Runner ─────────────────────────────────────────────────────────────

async function runImport(fn) {
  setImporting(true);
  showStatus('loading', 'Importing events…');
  clearErrors();

  try {
    const resp = await fn();
    if (!resp.success) throw new Error(resp.error || 'Import failed.');

    const { imported, failed, total, errors } = resp.result;
    setProgress(100);

    if (failed === 0) {
      showStatus('success', `✓ Imported ${imported} event${imported !== 1 ? 's' : ''} successfully.`);
    } else {
      showStatus('warning', `Imported ${imported} of ${total} events. ${failed} failed.`);
      if (errors && errors.length > 0) {
        showErrors(errors.slice(0, 5));
      }
    }
  } catch (err) {
    showStatus('error', `Error: ${err.message}`);
  } finally {
    setImporting(false);
  }
}

// ── UI Helpers ────────────────────────────────────────────────────────────────

function setImporting(active) {
  importFileBtn.disabled = active || !selectedFileContent;
  importUrlBtn.disabled = active;
  calendarSelect.disabled = active;
}

function showStatus(type, message) {
  statusArea.className = `status-area ${type}`;
  statusMessage.textContent = message;

  if (type === 'loading') {
    statusMessage.innerHTML = `<span class="spinner"></span> ${message}`;
    progressBar.classList.remove('hidden');
  } else {
    progressBar.classList.add('hidden');
  }
}

function setProgress(pct) {
  progressFill.style.width = `${pct}%`;
}

function clearStatus() {
  statusArea.className = 'status-area hidden';
  statusMessage.textContent = '';
  clearErrors();
}

function showErrors(errors) {
  errorList.classList.remove('hidden');
  errorList.innerHTML = errors
    .map((e) => `<li>${escapeHtml(e)}</li>`)
    .join('');
}

function clearErrors() {
  errorList.classList.add('hidden');
  errorList.innerHTML = '';
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Messaging ─────────────────────────────────────────────────────────────────

function sendMessage(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (resp && resp.success === false) {
        reject(new Error(resp.error || 'Unknown error'));
      } else {
        resolve(resp);
      }
    });
  });
}
