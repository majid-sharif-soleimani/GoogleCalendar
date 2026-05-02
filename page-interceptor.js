/**
 * Runs in the page's MAIN world at document_start.
 * Uses multiple strategies to intercept ICS downloads before they hit disk.
 */
(function () {

  function dispatchICS(text) {
    if (text && text.trimStart().startsWith('BEGIN:VCALENDAR')) {
      window.dispatchEvent(
        new CustomEvent('__ics_importer_detected__', { detail: { icsText: text } })
      );
    }
  }

  // ── Strategy 1: Intercept URL.createObjectURL ──────────────────────────────
  // Catches blob ICS data at creation time, before the URL can be revoked.
  const _createObjectURL = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function (object) {
    const url = _createObjectURL(object);
    if (object instanceof Blob) {
      const reader = new FileReader();
      reader.onload = (e) => dispatchICS(e.target.result);
      reader.readAsText(object);
    }
    return url;
  };

  // ── Strategy 2: Intercept HTMLAnchorElement.click() ───────────────────────
  // Catches programmatic anchor clicks (e.g. link.click()) used by many SPAs.
  const _anchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    interceptAnchor(this);
    return _anchorClick.call(this);
  };

  // ── Strategy 3: Intercept user clicks on <a download> elements ───────────
  document.addEventListener('click', (e) => {
    const a = e.composedPath().find(
      (el) => el instanceof HTMLAnchorElement && el.hasAttribute('download')
    );
    if (a) interceptAnchor(a);
  }, true);

  function interceptAnchor(a) {
    if (!a.hasAttribute('download') || !a.href) return;
    const href = a.href;

    if (href.startsWith('blob:')) {
      // Fetch now — before revokeObjectURL is called by the page
      fetch(href)
        .then((r) => r.text())
        .then(dispatchICS)
        .catch(() => {});
    } else if (href.startsWith('data:')) {
      // data:text/calendar;charset=utf-8,...
      try {
        const comma = href.indexOf(',');
        if (comma !== -1) {
          const encoded = href.slice(comma + 1);
          const text = href.includes(';base64,')
            ? atob(encoded)
            : decodeURIComponent(encoded);
          dispatchICS(text);
        }
      } catch {}
    }
  }

})();
