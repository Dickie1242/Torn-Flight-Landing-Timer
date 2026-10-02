const pad = (n) => String(n).padStart(2, '0');

function hms(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * Time left: `m:ss` under an hour, `h:mm:ss` from an hour. Rounded up, so it
 * reads 0:00 only once the moment has come. Negative counts as zero.
 */
export function formatCountdown(ms) {
  return hms(Math.max(0, Math.ceil(ms / 1000)));
}

/** Time gone by, in the same shape, rounded down. */
export function formatElapsed(ms) {
  return hms(Math.max(0, Math.floor(ms / 1000)));
}

/** A local wall-clock time, `HH:MM` (24-hour). */
export function formatClock(epochMs) {
  const date = new Date(epochMs);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Whole minutes the way Torn's wiki writes them: `27 min`, `2h 7min`, `3h`. */
export function formatMinutes(minutes) {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${hours}h ${rest}min` : `${hours}h`;
}
