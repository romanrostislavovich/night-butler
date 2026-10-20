import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ModelConfig } from './model.ts';

/*
 * Where the butler works and how: `night-butler.json` in its folder. Everything has a default,
 * so an empty folder with an `inbox` is enough.
 */

export interface Config {
  /** The folder of the butler: the config, the inbox and what it writes. */
  dir: string;
  /** What it sorts (read only — never changed): bank/*.csv, notes/*.md, tasks.md. */
  inbox: string;
  /** What it writes: the sorted copies, the briefing, its memory. */
  out: string;
  model: ModelConfig;
  /** The shift ends at this time ("07:00") even with work left: the rest waits for tomorrow. */
  until: string;
  currency: string;
  categories: string[];
  /** A task left open this many days is mentioned as forgotten. */
  staleDays: number;
}

const DEFAULTS = {
  inbox: 'inbox',
  out: 'butler',
  model: { url: 'http://127.0.0.1:11434', name: 'qwen2.5:7b' },
  until: '07:00',
  currency: 'USD',
  categories: [
    'Groceries',
    'Eating out',
    'Transport',
    'Housing',
    'Utilities',
    'Subscriptions',
    'Shopping',
    'Health',
    'Entertainment',
    'Travel',
    'Income',
    'Transfers',
    'Other',
  ],
  staleDays: 30,
};

export function loadConfig(dir: string): Config {
  const root = resolve(dir);
  const file = join(root, 'night-butler.json');
  const own = existsSync(file)
    ? (JSON.parse(readFileSync(file, 'utf8')) as Partial<typeof DEFAULTS>)
    : {};
  const merged = { ...DEFAULTS, ...own, model: { ...DEFAULTS.model, ...own.model } };
  return {
    ...merged,
    dir: root,
    inbox: resolve(root, merged.inbox),
    out: resolve(root, merged.out),
  };
}
