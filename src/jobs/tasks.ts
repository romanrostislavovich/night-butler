import { existsSync, readFileSync } from 'node:fs';

/*
 * A to-do list as a Markdown file, one task a line:
 *
 *   - [ ] Renew the passport #home (2026-07-02)
 *   - [x] Pay the electricity bill #home
 *
 * `#project` says what it belongs to, a date in brackets when it was added. The butler finds
 * tasks written twice, gives a project to tasks without one and notices the forgotten ones.
 */

export interface Task {
  text: string;
  done: boolean;
  project: string | null;
  added: string | null;
  /** Where it came from when the butler added it (a note). */
  from?: string;
}

export function readTasks(file: string): Task[] {
  if (!existsSync(file)) {
    return [];
  }
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = /^\s*[-*]\s+\[( |x|X)\]\s+(.+)$/.exec(line);
      if (!match) {
        return [];
      }
      let text = match[2].trim();
      const added = /\((\d{4}-\d{2}-\d{2})\)\s*$/.exec(text)?.[1] ?? null;
      text = text.replace(/\s*\(\d{4}-\d{2}-\d{2}\)\s*$/, '');
      const project = /(?:^|\s)#([\w-]+)/.exec(text)?.[1].toLowerCase() ?? null;
      text = text.replace(/\s*#[\w-]+/g, '').trim();
      return [{ text, done: match[1] !== ' ', project, added }];
    });
}

export function writeTasks(tasks: Task[]): string {
  const line = (task: Task) =>
    `- [${task.done ? 'x' : ' '}] ${task.text}${task.project ? ` #${task.project}` : ''}` +
    `${task.added ? ` (${task.added})` : ''}${task.from ? ` <!-- from ${task.from} -->` : ''}`;
  const projects = [...new Set(tasks.map((task) => task.project ?? ''))].sort((a, b) =>
    a === '' ? 1 : b === '' ? -1 : a.localeCompare(b),
  );
  return (
    projects
      .map((project) => {
        const own = tasks.filter((task) => (task.project ?? '') === project);
        const open = own.filter((task) => !task.done);
        const done = own.filter((task) => task.done);
        return [`## ${project || 'No project'}`, '', ...open.map(line), ...done.map(line)].join(
          '\n',
        );
      })
      .join('\n\n') + '\n'
  );
}

const STOP = new Set(
  'a an the to of for and or in on at with my our me your by from up out off is be do get'.split(
    ' ',
  ),
);

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\d]+/u)
      .filter((word) => word.length > 1 && !STOP.has(word))
      // "renewing" and "renew" are one word here.
      .map((word) => word.replace(/(ing|ed|es|s)$/, '')),
  );
}

/** How alike two tasks are in their words: 0 — nothing in common, 1 — the same words. */
export function likeness(a: string, b: string): number {
  const [x, y] = [words(a), words(b)];
  const common = [...x].filter((word) => y.has(word)).length;
  return common / Math.max(1, Math.min(x.size, y.size));
}

/**
 * Pairs of open tasks worth asking the model about: sharing a word that matters is enough —
 * "Cancel the gym membership" and "cancel Planet Fitness" share only "cancel", and only the
 * model knows Planet Fitness is a gym. The night is long: asking about a few more pairs is fine.
 */
export function maybeTwice(tasks: Task[], threshold = 0.3): [number, number][] {
  const pairs: [number, number][] = [];
  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      if (!tasks[i].done && !tasks[j].done && likeness(tasks[i].text, tasks[j].text) >= threshold) {
        pairs.push([i, j]);
      }
    }
  }
  return pairs;
}

/** Open tasks added more than `days` days before `today`. */
export function forgotten(tasks: Task[], today: string, days: number): Task[] {
  return tasks.filter(
    (task) =>
      !task.done && task.added && (Date.parse(today) - Date.parse(task.added)) / 86_400_000 > days,
  );
}
