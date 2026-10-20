/*
 * A due date out of the words a note uses ("fri", "next monday", "oct 31", "tomorrow"),
 * counted from the day the note was written. A small model reads the words well and counts
 * days badly: it gives the words, this gives the date.
 */

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export function resolveDue(words: string | null, written: string): string | null {
  if (!words) {
    return null;
  }
  const text = words.toLowerCase().trim();
  const base = new Date(`${written}T12:00:00Z`);
  const plus = (days: number) => iso(new Date(base.getTime() + days * 86_400_000));

  const iso8601 = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso8601) {
    return iso8601[0];
  }
  if (/\btoday\b|\btonight\b/.test(text)) {
    return written;
  }
  if (/\btomorrow\b/.test(text)) {
    return plus(1);
  }
  const weekday = WEEKDAYS.findIndex((day) => new RegExp(`\\b${day}`).test(text));
  if (weekday >= 0) {
    // The next such day after the note; "next friday" is the one a week after that.
    let ahead = (weekday - base.getUTCDay() + 7) % 7 || 7;
    if (/\bnext\b/.test(text) && ahead < 7) {
      ahead += 7;
    }
    return plus(ahead);
  }
  const month = MONTHS.findIndex((name) => new RegExp(`\\b${name}`).test(text));
  const day = /\b(\d{1,2})(st|nd|rd|th)?\b/.exec(text.replace(/\d{4}/, ''));
  if (month >= 0 && day) {
    let year = base.getUTCFullYear();
    const date = () => `${year}-${pad(month + 1)}-${pad(Number(day[1]))}`;
    // "jan 10" written in November is next January.
    if (date() < written) {
      year++;
    }
    return Number(day[1]) <= 31 ? date() : null;
  }
  const slash = /\b(\d{1,2})\/(\d{1,2})\b/.exec(text);
  if (slash) {
    let year = base.getUTCFullYear();
    const date = () => `${year}-${pad(Number(slash[1]))}-${pad(Number(slash[2]))}`;
    if (date() < written) {
      year++;
    }
    return date();
  }
  return null;
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
