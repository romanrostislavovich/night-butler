import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/*
 * What the butler remembers between nights, as JSON files in `<out>/.state`:
 *
 * - progress: every piece of work done, by the hash of what it was given — a shift that was
 *   stopped goes on where it stopped, and nothing is asked of the model twice;
 * - memory: the rules it learned from your answers ("BLUE BOTTLE" is Eating out) — the next
 *   night they decide without the model, so every night is faster than the one before;
 * - questions: what it was not sure of, for the morning.
 *
 * A file is written whole into a temporary one and renamed: a shift killed mid-write (the
 * computer went to sleep) never leaves half a file.
 */

/** The answers to "are these two tasks one?". */
export const SAME = 'Same task';
export const DIFFERENT = 'Different';

export interface Question {
  id: string;
  /** What it is about: a transaction, a note, a task. */
  kind: 'category' | 'duplicate';
  /** The words the person sees. */
  text: string;
  /** What the butler would choose. */
  guess: string;
  options: string[];
  /** The memory key an answer is kept under. */
  key: string;
  answer?: string;
}

export interface Memory {
  /** A merchant key → its category, from the person's answers. */
  categories: Record<string, string>;
  /** Pairs of tasks the person said are one task, and the ones they said are not. */
  same: string[];
  different: string[];
}

export class State {
  readonly progress: Record<string, unknown>;
  readonly memory: Memory;
  readonly questions: Record<string, Question>;

  private readonly dir: string;

  constructor(out: string) {
    this.dir = join(out, '.state');
    this.progress = read(join(this.dir, 'progress.json'), {});
    this.memory = {
      categories: {},
      same: [],
      different: [],
      ...read(join(this.dir, 'memory.json'), {}),
    };
    this.questions = read(join(this.dir, 'questions.json'), {});
  }

  /** What a piece of work came to, if it was done before. */
  done<T>(id: string): T | undefined {
    return this.progress[id] as T | undefined;
  }

  record(id: string, result: unknown): void {
    this.progress[id] = result;
    this.save();
  }

  ask(question: Question): void {
    const known = this.questions[question.id];
    this.questions[question.id] = known?.answer ? known : question;
    this.save();
  }

  /** An answer from the morning: kept as a rule for the following nights. */
  answer(id: string, value: string): Question | null {
    const question = this.questions[id];
    if (!question || !question.options.includes(value)) {
      return null;
    }
    question.answer = value;
    if (question.kind === 'category') {
      this.memory.categories[question.key] = value;
    } else {
      (value === SAME ? this.memory.same : this.memory.different).push(question.key);
    }
    this.save();
    return question;
  }

  open(): Question[] {
    return Object.values(this.questions).filter((question) => !question.answer);
  }

  save(): void {
    write(join(this.dir, 'progress.json'), this.progress);
    write(join(this.dir, 'memory.json'), this.memory);
    write(join(this.dir, 'questions.json'), this.questions);
  }
}

/** A short stable id of anything: the same input, the same id. */
export function idOf(...parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
}

function read<T>(file: string, fallback: T): T {
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : fallback;
}

export function write(file: string, value: unknown): void {
  writeText(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeText(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, text);
  renameSync(temporary, file);
}
