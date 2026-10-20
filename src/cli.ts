#!/usr/bin/env node
import { cpSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from './config.ts';
import { review } from './review/server.ts';
import { schedule, unschedule } from './schedule.ts';
import { nightShift } from './shift.ts';

const HELP = `Night Butler — a slow local AI that works the night shift.

  night-butler shift      [--dir .] [--until 07:00]   work through the inbox now
  night-butler review     [--dir .] [--port 4545]     the morning page: the briefing, your answers
  night-butler schedule   [--dir .] [--at 02:00] [--until 07:00]   every night
  night-butler unschedule
  night-butler demo       [--dir ./night-butler-demo]  a folder with a made-up month to try it on

The folder holds night-butler.json (optional) and inbox/: bank/*.csv, notes/*.md, tasks.md.
The model runs in Ollama on this computer (https://ollama.com; default qwen2.5:7b).`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    dir: { type: 'string', default: '.' },
    until: { type: 'string' },
    at: { type: 'string', default: '02:00' },
    port: { type: 'string', default: '4545' },
    help: { type: 'boolean', short: 'h' },
  },
});

const command = positionals[0];

try {
  switch (command) {
    case 'shift': {
      const report = await nightShift(loadConfig(values.dir), { until: values.until });
      console.log(`\nThe morning page: night-butler review --dir ${values.dir}`);
      process.exitCode = report.stoppedAt ? 2 : 0;
      break;
    }
    case 'review': {
      const port = Number(values.port);
      review(loadConfig(values.dir), port);
      console.log(`☀️  The morning page: http://127.0.0.1:${port}  (Ctrl+C to stop)`);
      break;
    }
    case 'schedule':
      console.log(schedule(values.dir, values.at, values.until ?? '07:00'));
      break;
    case 'unschedule':
      console.log(unschedule());
      break;
    case 'demo': {
      const target = resolve(values.dir === '.' ? 'night-butler-demo' : values.dir);
      if (existsSync(join(target, 'inbox'))) {
        console.log(`${target} has an inbox already: nothing copied.`);
      } else {
        cpSync(resolve(import.meta.dirname, '..', 'demo'), target, { recursive: true });
        console.log(`A made-up month is in ${target}.`);
      }
      console.log(`Now: night-butler shift --dir "${target}"`);
      break;
    }
    default:
      console.log(HELP);
  }
} catch (error) {
  console.error(`✋ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
