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

const DATE = /^(date|transaction date|posted|booking date|data)$/i;
const DESCRIPTION = /^(description|details|merchant|payee|name|title|opis)$/i;
const AMOUNT = /^(amount|value|sum|kwota)$/i;

export function readStatements(folder: string): Transaction[] {
  let files: string[];
  try {
    files = readdirSync(folder).filter((name) => name.toLowerCase().endsWith('.csv'));
  } catch {
    return [];
  }
  return files
    .flatMap((name) => parseStatement(readFileSync(join(folder, name), 'utf8')))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function parseStatement(text: string): Transaction[] {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim());
  if (lines.length < 2) {
    return [];
  }
  const separator = [';', '\t', ','].find((one) => lines[0].includes(one)) ?? ',';
  const header = splitLine(lines[0], separator);
  const column = (pattern: RegExp) => header.findIndex((name) => pattern.test(name.trim()));
  const [date, description, amount] = [column(DATE), column(DESCRIPTION), column(AMOUNT)];
  if (date < 0 || description < 0 || amount < 0) {
    return [];
  }
  return lines.slice(1).flatMap((line) => {
    const cells = splitLine(line, separator);
    const value = Number(cells[amount]?.replace(/\s/g, '').replace(',', '.'));
    if (!cells[description] || !Number.isFinite(value)) {
      return [];
    }
    return [
      {
        date: cells[date].trim().slice(0, 10),
        description: cells[description].trim(),
        amount: value,
        key: merchantKey(cells[description]),
      },
    ];
  });
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
      .replace(/[^A-Z&' ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .slice(0, 3)
      .join(' ') || description.trim().toUpperCase()
  );
}
