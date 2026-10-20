import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Bank statements as most banks export them: a CSV with a date, a description and an amount
 * (minus — money out). The columns are found by their names, the separator by the first line.
 */

export interface Transaction {
  date: string;
  description: string;
  /** Negative — money out. */
  amount: number;
  /** The same shop under every description it comes with (see merchantKey). */
  key: string;
}

// The column names of English and Polish exports (mBank, PKO BP, ING, Santander, Revolut\u2026).
const DATE =
  /^(date|transaction date|posted|booking date|completed date|started date|data( operacji| transakcji| ksi\u0119gowania| ksiegowania)?)$/i;
const DESCRIPTION =
  /^(description|details|merchant|payee|name|title|opis( operacji| transakcji)?|tytu\u0142|tytul|dane kontrahenta)$/i;
const AMOUNT = /^(amount|value|sum|kwota( operacji| transakcji)?)$/i;
/** Some banks put a few lines about the account before the table. */
const HEADER_SEARCH = 40;

export function readStatements(folder: string): Transaction[] {
  let files: string[];
  try {
    files = readdirSync(folder).filter((name) => name.toLowerCase().endsWith('.csv'));
  } catch {
    return [];
  }
  return files
    .flatMap((name) => parseStatement(decode(readFileSync(join(folder, name)))))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** UTF-8 when the bytes are UTF-8; otherwise the Central European code page older exports use. */
function decode(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1250').decode(bytes);
  }
}

export function parseStatement(text: string): Transaction[] {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim());
  for (let at = 0; at < Math.min(lines.length - 1, HEADER_SEARCH); at++) {
    const separator = [';', '\t', ','].find((one) => lines[at].includes(one)) ?? ',';
    // "#Data operacji" (mBank) and "Data operacji" are one name.
    const header = splitLine(lines[at], separator).map((name) => name.trim().replace(/^#/, ''));
    const column = (pattern: RegExp) => header.findIndex((name) => pattern.test(name));
    const [date, description, amount] = [column(DATE), column(DESCRIPTION), column(AMOUNT)];
    if (date >= 0 && description >= 0 && amount >= 0) {
      return lines
        .slice(at + 1)
        .flatMap((line) => row(splitLine(line, separator), date, description, amount));
    }
  }
  return [];
}

function row(cells: string[], date: number, description: number, amount: number): Transaction[] {
  // "-1 234,56 PLN" \u2192 -1234.56
  const value = Number(
    (cells[amount] ?? '')
      .replace(/[^\d,.-]/g, '')
      .replace(/\.(?=\d{3}\b)/g, '')
      .replace(',', '.'),
  );
  const day = isoDate(cells[date] ?? '');
  const what = (cells[description] ?? '').trim();
  if (!what || !day || !Number.isFinite(value) || cells[amount]?.trim() === '') {
    return [];
  }
  return [{ date: day, description: what, amount: value, key: merchantKey(what) }];
}

/** "2026-10-18", "18-10-2026", "18.10.2026" or "18/10/2026" \u2192 "2026-10-18". */
function isoDate(text: string): string | null {
  const value = text.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso) {
    return iso[0];
  }
  const european = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/.exec(value);
  return european
    ? `${european[3]}-${european[2].padStart(2, '0')}-${european[1].padStart(2, '0')}`
    : null;
}

/** One line of CSV: quoted cells may hold the separator and doubled quotes. */
function splitLine(line: string, separator: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === separator && !quoted) {
      cells.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }
  return [...cells, cell];
}

/**
 * A shop's name without what changes from one charge to the next: the card processor's prefix
 * ("SQ *", "PAYPAL *"), store numbers, references, the city — so the model is asked once a
 * shop, not once a coffee.
 */
export function merchantKey(description: string): string {
  return (
    description
      .toUpperCase()
      // A processor's prefix comes with its "*" ("SQ *"): "SPOTIFY" does not start with "SP *".
      .replace(/^(SQ|TST|SP|PY|PAYPAL)\s?\*\s*/, '')
      .replace(/^(POS|CARD|DEBIT|PURCHASE)\s+/, '')
      .replace(/\*.*$/, '')
      // A reference, a store number, a date or a card's last digits.
      .replace(/[#\d][\w/.-]*/g, ' ')
      // A US city and state at the end ("SAN FRANCISCO CA").
      .replace(/\s{2,}[A-Z ]+\s[A-Z]{2}$/, '')
      .replace(/\b(INC|LLC|LTD|CO|COM|WWW|HTTPS?)\b/g, ' ')
      // Letters of any language: "ŻABKA" stays "ŻABKA".
      .replace(/[^\p{L}&' ]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      // A lone letter is what is left of a store number ("Z5521").
      .filter((word) => word.length > 1)
      .slice(0, 3)
      .join(' ') || description.trim().toUpperCase()
  );
}
