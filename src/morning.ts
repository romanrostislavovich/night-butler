import { join } from 'node:path';
import type { Config } from './config.ts';
import { readStatements, type Transaction } from './jobs/bank.ts';
import { doubleCharges, subscriptions, unusual } from './jobs/money.ts';
import { resolveDue } from './jobs/due.ts';
import { readNotes, slug, type Note, type NoteReading } from './jobs/notes.ts';
import { forgotten, likeness, maybeTwice, readTasks, writeTasks, type Task } from './jobs/tasks.ts';
import type { Answer } from './model.ts';
import { SAME, type Question, type State, writeText } from './state.ts';
import {
  merchantWork,
  morningWork,
  noteWork,
  pairKey,
  projectWork,
  sameTaskWork,
  type MerchantReading,
  type MorningNote,
  type ProjectChoice,
  type SameTask,
} from './work.ts';

/*
 * The morning: everything the night's answers come to, put together without the model — the
 * sorted statement, the tidy notes, the cleaned to-do list and the facts of the briefing. It
 * runs at the end of a shift and again after every answer on the review page, so an answer
 * changes the files at once.
 */

export interface Inbox {
  transactions: Transaction[];
  notes: Note[];
  tasks: Task[];
}

export type DecidedBy = 'model' | 'you' | 'ask' | 'pending';

export interface Sorted extends Transaction {
  merchant: string;
  category: string | null;
  by: DecidedBy;
}

export interface Recurring {
  merchant: string;
  amount: number;
  roseFrom: number | null;
}

/** Repeating charges of these categories are bills, not subscriptions. */
const BILLS = new Set(['Housing', 'Utilities']);

export interface Morning {
  date: string;
  transactions: Sorted[];
  month: string | null;
  spending: { category: string; amount: number }[];
  subscriptions: Recurring[];
  /** Rent and utilities: they repeat too, but nobody cancels them. */
  bills: Recurring[];
  doubles: { merchant: string; amount: number; dates: [string, string] }[];
  unusual: { merchant: string; amount: number; usual: number; date: string }[];
  notes: { file: string; title: string; kind: string; tags: string[]; path: string }[];
  tasks: Task[];
  merged: [string, string][];
  newTasks: Task[];
  forgotten: Task[];
  questions: Question[];
  /** Pieces of work the shift has not come to yet. */
  pending: number;
  note: MorningNote | null;
  facts: object;
}

export function readInbox(config: Config): Inbox {
  return {
    transactions: readStatements(join(config.inbox, 'bank')),
    notes: readNotes(join(config.inbox, 'notes')),
    tasks: readTasks(join(config.inbox, 'tasks.md')),
  };
}

/** The keys of the merchants with a few lines of each, in the order they first appear. */
export function merchants(transactions: Transaction[]): Map<string, Transaction[]> {
  const groups = new Map<string, Transaction[]>();
  for (const one of transactions) {
    groups.set(one.key, [...(groups.get(one.key) ?? []), one]);
  }
  return groups;
}

/** The to-dos found in notes, as tasks: the date counted from the note's words. */
export function tasksFromNotes(read: { note: Note; reading: NoteReading }[]): Task[] {
  return read.flatMap(({ note, reading }) =>
    reading.tasks.map((task) => {
      const due = resolveDue(task.when, note.date);
      const text = task.text.charAt(0).toUpperCase() + task.text.slice(1);
      return {
        text: due ? `${text} (due ${due})` : text,
        done: false,
        project: null,
        added: note.date,
        from: note.file,
      };
    }),
  );
}

export function projectsOf(tasks: Task[]): string[] {
  return [...new Set(tasks.flatMap((task) => (task.project ? [task.project] : [])))].sort();
}

export function morning(config: Config, state: State, inbox: Inbox, today: string): Morning {
  let pending = 0;
  const answer = <T>(id: string): T | null => {
    const done = state.done<Answer<T>>(id);
    if (!done) {
      pending++;
    }
    return done?.value ?? null;
  };

  // Money.
  // The work of today: a question left by an older way of asking is not shown.
  const current = new Set<string>();
  const readings = new Map<string, MerchantReading | null>();
  for (const [key, lines] of merchants(inbox.transactions)) {
    const { id } = merchantWork(config, key, lines);
    current.add(id);
    readings.set(key, answer<MerchantReading>(id));
  }
  const sorted: Sorted[] = inbox.transactions.map((one) => {
    const reading = readings.get(one.key) ?? null;
    const learned = state.memory.categories[one.key];
    const merchant = reading?.merchant ?? one.key;
    if (learned) {
      return { ...one, merchant, category: learned, by: 'you' };
    }
    if (!reading) {
      return { ...one, merchant, category: null, by: 'pending' };
    }
    return reading.known
      ? { ...one, merchant, category: reading.category, by: 'model' }
      : { ...one, merchant, category: null, by: 'ask' };
  });
  const nameOf = (key: string) => readings.get(key)?.merchant ?? key;
  const month = inbox.transactions.at(-1)?.date.slice(0, 7) ?? null;
  const totals = new Map<string, number>();
  for (const one of sorted.filter((t) => t.amount < 0 && t.date.startsWith(month ?? '-'))) {
    const category = one.category ?? 'Not sorted yet';
    totals.set(category, (totals.get(category) ?? 0) - one.amount);
  }

  // Notes.
  const notes = inbox.notes.flatMap((note) => {
    const reading = answer<NoteReading>(noteWork(config, note, []).id);
    return reading ? [{ note, reading }] : [];
  });

  // Tasks: the ones written twice merged, projects given, the to-dos of the notes added.
  const tasks = inbox.tasks.map((task) => ({ ...task }));
  const removed = new Set<number>();
  const merged: [string, string][] = [];
  for (const [i, j] of maybeTwice(tasks)) {
    const key = pairKey(tasks[i], tasks[j]);
    const pair = sameTaskWork(config, tasks[i], tasks[j]);
    current.add(pair.id);
    const verdict = answer<SameTask>(pair.id);
    const same =
      state.memory.same.includes(key) ||
      (!state.memory.different.includes(key) && !!verdict?.same && verdict.sure);
    if (same && !removed.has(i) && !removed.has(j)) {
      removed.add(j);
      tasks[i].project ??= tasks[j].project;
      tasks[i].added = [tasks[i].added, tasks[j].added].filter(Boolean).sort()[0] ?? null;
      merged.push([tasks[i].text, tasks[j].text]);
    }
  }
  const kept = tasks.filter((_, index) => !removed.has(index));
  const newTasks = tasksFromNotes(notes).filter(
    (task) => !kept.some((one) => likeness(one.text, task.text) >= 0.8),
  );
  const projects = projectsOf(inbox.tasks);
  for (const task of [...kept, ...newTasks].filter((one) => !one.project && !one.done)) {
    const choice = projects.length
      ? answer<ProjectChoice>(projectWork(config, task, projects).id)
      : null;
    if (choice && choice.project !== 'none' && choice.sure) {
      task.project = choice.project;
    }
  }
  const finalTasks = [...kept, ...newTasks];

  const categoryOf = (key: string) =>
    state.memory.categories[key] ?? (readings.get(key)?.known ? readings.get(key)!.category : null);
  const repeating = subscriptions(inbox.transactions);
  const recurring = (bills: boolean) =>
    repeating
      .filter((one) => BILLS.has(categoryOf(one.key) ?? '') === bills)
      .map((one) => ({ merchant: nameOf(one.key), amount: one.amount, roseFrom: one.roseFrom }));
  const subs = recurring(false);
  const bills = recurring(true).map((one) => ({ ...one, roseFrom: null }));
  // Charged twice is news only for what is billed: two cash withdrawals in a day or two
  // transfers to a friend are just a day.
  const billed = new Set(['Subscriptions', ...BILLS]);
  const doubles = doubleCharges(inbox.transactions)
    .filter((one) => billed.has(categoryOf(one.key) ?? ''))
    .map((one) => ({ merchant: nameOf(one.key), amount: one.amount, dates: one.dates }));
  const odd = unusual(inbox.transactions).map((one) => ({
    merchant: nameOf(one.key),
    amount: one.amount,
    usual: one.usual,
    date: one.date,
  }));
  const stale = forgotten(finalTasks, today, config.staleDays);
  const questions = state.open().filter((question) => current.has(question.id));
  const spending = [...totals]
    .map(([category, amount]) => ({ category, amount: round(amount) }))
    .sort((a, b) => b.amount - a.amount);

  // The facts as finished sentences: a small model retells sentences faithfully, while from
  // bare numbers it mixes up a count with an amount of money.
  const money = (value: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: config.currency }).format(value);
  const day = (date: string) =>
    new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const asking = questions.filter((one) => one.kind === 'category').length;
  const facts = {
    date: today,
    overnight: [
      `Sorted ${sorted.filter((one) => one.by !== 'ask' && one.by !== 'pending').length} of ` +
        `${sorted.length} bank transactions into categories.`,
      notes.length ? `Tidied ${notes.length} notes: a title and tags for each.` : '',
      newTasks.length
        ? `Found ${newTasks.length} to-dos hidden in the notes and added them to the list.`
        : '',
      merged.length
        ? `Merged ${merged.length} task(s) written twice: ${merged.map(([a, b]) => `"${a}" and "${b}"`).join('; ')}.`
        : '',
    ].filter(Boolean),
    needsAttention: [
      ...subs
        .filter((one) => one.roseFrom)
        .map(
          (one) =>
            `${one.merchant} went up from ${money(one.roseFrom!)} to ${money(one.amount)} a month.`,
        ),
      ...doubles.map(
        (one) =>
          `${one.merchant} charged ${money(one.amount)} twice (${day(one.dates[0])} and ${day(one.dates[1])}).`,
      ),
      ...odd.map(
        (one) =>
          `The ${one.merchant} bill is ${money(one.amount)}, usually about ${money(one.usual)}.`,
      ),
      asking
        ? `${asking} merchants the butler does not know: one click each on the review page.`
        : '',
    ].filter(Boolean),
    context: [
      `Subscriptions: ${subs.length}, ${money(subs.reduce((sum, one) => sum + one.amount, 0))} a month in total.`,
      spending.length
        ? `Biggest spending in ${month}: ${spending
            .slice(0, 3)
            .map((one) => `${one.category} ${money(one.amount)}`)
            .join(', ')}.`
        : '',
      stale.length
        ? `Tasks open for over a month: ${stale.map((task) => `"${task.text}"`).join(', ')}.`
        : '',
    ].filter(Boolean),
  };
  const note = answer<MorningNote>(morningWork(config, facts).id);
  // The note is the last piece of work: it is not "pending" when only it is missing.
  if (!note) {
    pending--;
  }

  return {
    date: today,
    transactions: sorted,
    month,
    spending,
    subscriptions: subs,
    bills,
    doubles,
    unusual: odd,
    notes: notes.map(({ note: one, reading }) => ({
      file: one.file,
      title: reading.title,
      kind: reading.kind,
      tags: reading.tags,
      path: `notes/${one.date}-${slug(reading.title)}.md`,
    })),
    tasks: finalTasks,
    merged,
    newTasks,
    forgotten: stale,
    questions,
    pending,
    note,
    facts,
  };
}

/** The sorted copies next to the inbox; the originals are never touched. */
export function writeMorning(config: Config, inbox: Inbox, report: Morning): void {
  const csv = [
    'date,description,amount,merchant,category,decided_by',
    ...report.transactions.map((one) =>
      [one.date, one.description, one.amount.toFixed(2), one.merchant, one.category ?? '', one.by]
        .map(csvCell)
        .join(','),
    ),
  ];
  writeText(join(config.out, 'transactions.csv'), `${csv.join('\n')}\n`);
  for (const note of report.notes) {
    const original = inbox.notes.find((one) => one.file === note.file);
    writeText(
      join(config.out, note.path),
      [
        '---',
        `title: ${JSON.stringify(note.title)}`,
        `kind: ${note.kind}`,
        `tags: [${note.tags.join(', ')}]`,
        `source: ${note.file}`,
        '---',
        '',
        original?.text ?? '',
        '',
      ].join('\n'),
    );
  }
  writeText(join(config.out, 'tasks.md'), writeTasks(report.tasks));
  writeText(join(config.out, 'briefing.md'), briefingMarkdown(report));
}

function briefingMarkdown(report: Morning): string {
  const money = (value: number) => value.toFixed(2);
  const lines = [`# ${report.note?.headline ?? `Night shift of ${report.date}`}`, ''];
  for (const paragraph of report.note?.paragraphs ?? []) {
    lines.push(paragraph, '');
  }
  if (report.questions.length) {
    lines.push(
      `**${report.questions.length} questions wait for you:** \`night-butler review\``,
      '',
    );
  }
  return `${lines.join('\n')}\nSubscriptions: ${report.subscriptions
    .map((one) => `${one.merchant} ${money(one.amount)}`)
    .join(', ')}\n`;
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
