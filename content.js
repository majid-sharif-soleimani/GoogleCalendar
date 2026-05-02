/**
 * Runs in the ISOLATED world.
 * 1. Relays ICS detections from page-interceptor.js to the background.
 * 2. Shows an in-page toast when the background reports an import result.
 */

window.addEventListener('__ics_importer_detected__', (e) => {
  chrome.runtime.sendMessage({
    action: 'autoImportFromICS',
    icsText: e.detail.icsText,
    sourceUrl: window.location.href
  });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'showToast') {
    showToast(msg.text, msg.type);
  }
});

function showToast(text, type = 'success') {
  document.getElementById('__ics_toast__')?.remove();

  const bg     = type === 'success' ? '#137333' : type === 'error' ? '#c5221f' : '#1a73e8';
  const border = type === 'success' ? '#0d5726' : type === 'error' ? '#a50e0e' : '#1557b0';
  const icon   = type === 'success' ? '✓'       : type === 'error' ? '✕'       : 'ℹ';

  const toast = document.createElement('div');
  toast.id = '__ics_toast__';
  toast.setAttribute('style', [
    'position:fixed',
    'bottom:24px',
    'right:24px',
    'z-index:2147483647',
    `background:${bg}`,
    `border:1.5px solid ${border}`,
    'color:#fff',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
    'font-size:14px',
    'font-weight:500',
    'padding:12px 18px',
    'border-radius:10px',
    'box-shadow:0 4px 16px rgba(0,0,0,0.3)',
    'display:flex',
    'align-items:center',
    'gap:10px',
    'max-width:320px',
    'line-height:1.4',
    'opacity:1',
    'transition:opacity 0.4s ease',
  ].join('!important;') + '!important');

  const iconEl = document.createElement('span');
  iconEl.textContent = icon;
  iconEl.setAttribute('style', 'font-size:16px!important;flex-shrink:0!important');

  const textEl = document.createElement('span');
  textEl.textContent = text;

  toast.appendChild(iconEl);
  toast.appendChild(textEl);
  document.documentElement.appendChild(toast);

  setTimeout(() => {
    toast.style.setProperty('opacity', '0', 'important');
    setTimeout(() => toast.remove(), 400);
  }, 5000);
}
