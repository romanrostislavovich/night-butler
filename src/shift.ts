import { existsSync } from 'node:fs';
import { setPriority } from 'node:os';
import { join } from 'node:path';
import type { Config } from './config.ts';
import { handTags, type NoteReading } from './jobs/notes.ts';
import { maybeTwice, type Task } from './jobs/tasks.ts';
import { check, type Answer } from './model.ts';
import {
  merchants,
  morning,
  projectsOf,
  readInbox,
  tasksFromNotes,
  writeMorning,
  type Morning,
} from './morning.ts';
import { DIFFERENT, SAME, State, writeText } from './state.ts';
import {
  merchantWork,
  morningWork,
  noteWork,
  pairKey,
  projectWork,
  sameTaskWork,
  type MerchantReading,
  type SameTask,
  type Work,
} from './work.ts';

/*
 * The night shift: one piece of work at a time, each saved the moment it is done, at the
 * lowest priority of the computer — slow and steady. It stops at `until` with work left over
 * (tomorrow goes on from there), and a shift run again skips everything already done.
 */

export interface ShiftOptions {
  /** "HH:MM": stop at this time, even with work left. */
  until?: string;
  /** The date the morning is for (tests); today by default. */
  today?: string;
  log?: (line: string) => void;
}

export interface ShiftReport {
  morning: Morning;
  asked: number;
  remembered: number;
  seconds: number;
  stoppedAt: string | null;
}

export async function nightShift(config: Config, options: ShiftOptions = {}): Promise<ShiftReport> {
  const print = options.log ?? ((line: string) => console.log(line));
  // The last shift's log is kept for the morning page.
  const lines: string[] = [];
  const log = (line: string) => {
    lines.push(line);
    print(line);
  };
  const problem = await check(config.model);
  if (problem) {
    throw new Error(problem);
  }
  try {
    // The computer is someone's: the butler works only with what nobody else needs.
    setPriority(19);
  } catch {
    // Not allowed here: it simply runs at the usual priority.
  }
  const state = new State(config.out);
  const inbox = readInbox(config);
  const today = options.today ?? localDate(new Date());
  const deadline = options.until ? deadlineOf(options.until) : null;
  const started = performance.now();
  let asked = 0;
  let remembered = 0;
  let stoppedAt: string | null = null;

  log(
    `🌙 ${clock()} The shift begins: ${inbox.transactions.length} transactions, ` +
      `${inbox.notes.length} notes, ${inbox.tasks.length} tasks. Model: ${config.model.name}.`,
  );

  /** One piece of work: skipped when done before; false — the shift is over. */
  const work = async <T>(icon: string, item: Work<T>, said: (value: T) => string) => {
    if (state.done(item.id)) {
      remembered++;
      return true;
    }
    if (deadline && Date.now() >= deadline) {
      stoppedAt ??= clock();
      return false;
    }
    const answer: Answer<T> = await item.run();
    state.record(item.id, answer);
    asked++;
    log(`${icon} ${clock()} ${item.label} → ${said(answer.value)} · ${answer.seconds.toFixed(1)}s`);
    return true;
  };

  // 1. What each merchant is. A merchant you sorted yourself needs no model at all.
  for (const [key, lines] of merchants(inbox.transactions)) {
    if (state.memory.categories[key]) {
      continue;
    }
    const item = merchantWork(config, key, lines);
    const going = await work('🧾', item, (reading: MerchantReading) => {
      if (!reading.known) {
        state.ask({
          id: item.id,
          kind: 'category',
          text: `What is "${lines[0].description}" (${lines[0].amount.toFixed(2)} ${config.currency})?`,
          guess: reading.category,
          options: config.categories,
          key,
        });
        return `does not know it (${reading.category}?) — will ask you in the morning`;
      }
      return `${reading.merchant} (${reading.sells}) · ${reading.category}`;
    });
    if (!going) break;
  }

  // 2. Notes: a title, tags, the to-dos inside.
  const tags = new Set(inbox.notes.flatMap((note) => handTags(note.text)));
  for (const note of inbox.notes) {
    const item = noteWork(config, note, [...tags]);
    const going = await work('📝', item, (reading) => {
      reading.tags.forEach((tag) => tags.add(tag));
      const found = reading.tasks.length ? `, ${reading.tasks.length} to-do` : '';
      return `"${reading.title}" [${reading.tags.join(', ')}]${found}`;
    });
    if (!going) break;
  }

  // 3. Tasks written twice, then a project for the ones without.
  const tasks: Task[] = inbox.tasks;
  for (const [i, j] of maybeTwice(tasks)) {
    const key = pairKey(tasks[i], tasks[j]);
    if (state.memory.same.includes(key) || state.memory.different.includes(key)) {
      continue;
    }
    const item = sameTaskWork(config, tasks[i], tasks[j]);
    const going = await work('✅', item, (verdict: SameTask) => {
      if (verdict.same && !verdict.sure) {
        state.ask({
          id: item.id,
          kind: 'duplicate',
          text: `Are these one task? "${tasks[i].text}" and "${tasks[j].text}"`,
          guess: SAME,
          options: [SAME, DIFFERENT],
          key,
        });
        return `maybe the same (${verdict.reason}) — will ask you`;
      }
      return verdict.same ? `the same task, merged: ${verdict.reason}` : 'different tasks';
    });
    if (!going) break;
  }
  // The to-dos found in the notes get a project too.
  const read = inbox.notes.flatMap((note) => {
    const reading = state.done<Answer<NoteReading>>(noteWork(config, note, []).id)?.value;
    return reading ? [{ note, reading }] : [];
  });
  const projects = projectsOf(tasks);
  const homeless = [...tasks, ...tasksFromNotes(read)].filter((one) => !one.project && !one.done);
  for (const task of homeless) {
    if (!projects.length) break;
    const going = await work('📁', projectWork(config, task, projects), (choice) =>
      choice.project === 'none' ? 'no project fits' : `#${choice.project}`,
    );
    if (!going) break;
  }

  // 4. The morning note, from what the night came to.
  let report = morning(config, state, inbox, today);
  if (!stoppedAt && !report.note) {
    const done = await work('☕', morningWork(config, report.facts), (note) => note.headline);
    if (done) {
      report = morning(config, state, inbox, today);
    }
  }
  writeMorning(config, inbox, report);

  const seconds = (performance.now() - started) / 1000;
  log(
    stoppedAt
      ? `⏰ ${stoppedAt} The shift is over with ${report.pending} pieces left for tomorrow night.`
      : `☀️ ${clock()} Done in ${minutes(seconds)}: ${asked} things decided by the model, ` +
          `${remembered} already known. ${report.questions.length} questions for you.`,
  );
  // A shift with nothing new to do keeps the log of the night that did the work.
  if (asked > 1 || !existsSync(join(config.out, 'night-log.txt'))) {
    writeText(join(config.out, 'night-log.txt'), `${lines.join('\n')}\n`);
  }
  return { morning: report, asked, remembered, seconds, stoppedAt };
}

function clock(): string {
  return new Date().toTimeString().slice(0, 8);
}

export function localDate(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

/** The next time the clock shows `hh:mm` — tonight's 07:00 is tomorrow's date. */
export function deadlineOf(time: string, now = new Date()): number {
  const [hours, minutes] = time.split(':').map(Number);
  const at = new Date(now);
  at.setHours(hours, minutes, 0, 0);
  if (at.getTime() <= now.getTime()) {
    at.setDate(at.getDate() + 1);
  }
  return at.getTime();
}

function minutes(seconds: number): string {
  return seconds < 90 ? `${Math.round(seconds)} s` : `${Math.round(seconds / 60)} min`;
}
