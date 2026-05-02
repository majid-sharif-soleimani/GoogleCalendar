/**
 * ICS file parser — converts RFC 5545 calendar data to Google Calendar API event objects.
 */

/**
 * Parse an ICS text and return an array of raw VEVENT property maps.
 * @param {string} text - Raw ICS file content
 * @returns {Object[]} Array of event objects (keyed by property name)
 */
export function parseICS(text) {
  // RFC 5545 §3.1: unfold lines (CRLF + whitespace continuation)
  const unfolded = text
    .replace(/\r\n([ \t])/g, '$1')
    .replace(/\n([ \t])/g, '$1');

  const lines = unfolded.split(/\r?\n/);
  const events = [];
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line) continue;

    if (line === 'BEGIN:VEVENT') {
      current = {};
    } else if (line === 'END:VEVENT') {
      if (current) events.push(current);
      current = null;
    } else if (current !== null) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;

      const propFull = line.substring(0, colonIdx);
      const value = line.substring(colonIdx + 1);

      // Split property name from parameters (e.g. DTSTART;TZID=America/New_York)
      const semiIdx = propFull.indexOf(';');
      const propName = semiIdx !== -1 ? propFull.substring(0, semiIdx) : propFull;
      const params = {};

      if (semiIdx !== -1) {
        const paramStr = propFull.substring(semiIdx + 1);
        for (const param of paramStr.split(';')) {
          const eqIdx = param.indexOf('=');
          if (eqIdx !== -1) {
            params[param.substring(0, eqIdx).toUpperCase()] = param.substring(eqIdx + 1);
          }
        }
      }

      // EXDATE can appear multiple times
      if (propName === 'EXDATE' || propName === 'RDATE') {
        if (!current[propName]) current[propName] = [];
        current[propName].push({ value, params });
      } else {
        // Keep first occurrence for other properties
        if (!current[propName]) {
          current[propName] = { value, params };
        }
      }
    }
  }

  return events;
}

/**
 * Parse an ICS date/datetime property to a Google Calendar API date object.
 * @param {{ value: string, params: Object }} prop
 * @returns {{ date: string } | { dateTime: string, timeZone?: string } | null}
 */
export function parseICSDate(prop) {
  if (!prop) return null;
  const { value, params } = prop;

  // All-day date: VALUE=DATE or plain YYYYMMDD
  if (params.VALUE === 'DATE' || /^\d{8}$/.test(value)) {
    return {
      date: `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
    };
  }

  // DateTime: YYYYMMDDTHHmmss[Z]
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (m) {
    const dt = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
    if (m[7] === 'Z') {
      return { dateTime: `${dt}Z`, timeZone: 'UTC' };
    } else if (params.TZID) {
      return { dateTime: dt, timeZone: params.TZID };
    } else {
      return { dateTime: dt };
    }
  }

  return null;
}

/**
 * Add a DURATION to a start date/datetime.
 * Supports P[nD]T[nH][nM][nS] and P[nW] formats.
 */
function applyDuration(start, durationStr) {
  const m = durationStr.match(
    /^(-?)P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/
  );
  if (!m) return null;

  const sign = m[1] === '-' ? -1 : 1;
  const weeks = parseInt(m[2] || '0');
  const days = parseInt(m[3] || '0');
  const hours = parseInt(m[4] || '0');
  const minutes = parseInt(m[5] || '0');
  const seconds = parseInt(m[6] || '0');

  const totalDays = sign * (weeks * 7 + days);
  const totalMs = sign * ((hours * 3600 + minutes * 60 + seconds) * 1000);

  if (start.date) {
    const d = new Date(start.date + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + totalDays);
    return { date: d.toISOString().slice(0, 10) };
  } else if (start.dateTime) {
    const isUTC = start.dateTime.endsWith('Z');
    const d = new Date(isUTC ? start.dateTime : start.dateTime + 'Z');
    d.setUTCDate(d.getUTCDate() + totalDays);
    const adjusted = new Date(d.getTime() + totalMs);
    const dt = adjusted.toISOString().slice(0, 19);
    if (start.timeZone === 'UTC') return { dateTime: `${dt}Z`, timeZone: 'UTC' };
    return { dateTime: dt, timeZone: start.timeZone };
  }
  return null;
}

function unescapeText(text) {
  return text
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/**
 * Convert a parsed ICS event object to a Google Calendar API event object.
 * @param {Object} icsEvent - Raw event from parseICS()
 * @returns {Object} Google Calendar API event body
 */
export function icsEventToGoogleEvent(icsEvent) {
  const event = {};

  if (icsEvent.SUMMARY) {
    event.summary = unescapeText(icsEvent.SUMMARY.value);
  }

  if (icsEvent.DESCRIPTION) {
    event.description = unescapeText(icsEvent.DESCRIPTION.value);
  }

  if (icsEvent.LOCATION) {
    event.location = unescapeText(icsEvent.LOCATION.value);
  }

  if (icsEvent.UID) {
    event.iCalUID = icsEvent.UID.value;
  }

  // Dates
  const start = parseICSDate(icsEvent.DTSTART);
  let end = null;

  if (icsEvent.DTEND) {
    end = parseICSDate(icsEvent.DTEND);
  } else if (icsEvent.DURATION && start) {
    end = applyDuration(start, icsEvent.DURATION.value);
  }

  // Default end: +1 day for all-day, +1 hour for timed events
  if (!end && start) {
    if (start.date) {
      const d = new Date(start.date + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + 1);
      end = { date: d.toISOString().slice(0, 10) };
    } else if (start.dateTime) {
      end = applyDuration(start, 'PT1H');
    }
  }

  if (start) event.start = start;
  if (end) event.end = end;

  // Recurrence
  if (icsEvent.RRULE) {
    event.recurrence = [`RRULE:${icsEvent.RRULE.value}`];
    if (icsEvent.EXDATE) {
      for (const ex of icsEvent.EXDATE) {
        const tzid = ex.params.TZID ? `;TZID=${ex.params.TZID}` : '';
        event.recurrence.push(`EXDATE${tzid}:${ex.value}`);
      }
    }
  }

  // Status
  if (icsEvent.STATUS) {
    const s = icsEvent.STATUS.value.toUpperCase();
    if (s === 'CANCELLED') event.status = 'cancelled';
    else if (s === 'TENTATIVE') event.status = 'tentative';
    else event.status = 'confirmed';
  }

  // Transparency (show as busy/free)
  if (icsEvent.TRANSP) {
    event.transparency =
      icsEvent.TRANSP.value.toUpperCase() === 'TRANSPARENT' ? 'transparent' : 'opaque';
  }

  // URL
  if (icsEvent.URL) {
    event.source = { url: icsEvent.URL.value, title: event.summary || 'Event' };
  }

  return event;
}
