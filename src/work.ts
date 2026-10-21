import type { Config } from './config.ts';
import type { Transaction } from './jobs/bank.ts';
import { cleanTag, NOTE_KINDS, type Note, type NoteReading } from './jobs/notes.ts';
import type { Task } from './jobs/tasks.ts';
import { ask, type Answer } from './model.ts';
import { idOf } from './state.ts';

/*
 * Every question the butler asks the model: what it says, the shape of the answer, and the id
 * the answer is remembered by — the same question is never asked twice, not even after the
 * shift was stopped. The id includes the model, so a better model looks at everything again.
 */

export interface Work<T> {
  id: string;
  /** What the night log says while it works on it. */
  label: string;
  run: () => Promise<Answer<T>>;
}

export interface MerchantReading {
  merchant: string;
  /** What it sells or what the payment is for, in a few words: the model says it first. */
  sells: string;
  /** The model knows the business, or the line says plainly what it is: else it asks you. */
  known: boolean;
  category: string;
}

export interface SameTask {
  /** Why, first: a small model decides better after saying it. */
  reason: string;
  same: boolean;
  /** Sure enough to merge without asking. */
  sure: boolean;
}

export interface ProjectChoice {
  project: string;
  sure: boolean;
}

/**
 * What the default categories hold: a small model sorts far better with a line about each
 * than with a bare name ("Subscriptions" alone does not say a gym is one).
 */
const CATEGORY_HINTS: Record<string, string> = {
  Groceries: 'supermarkets and food stores',
  'Eating out': 'restaurants, cafés, coffee shops, fast food, food delivery',
  Transport: 'taxis and rides, fuel, public transit, parking, tolls',
  Housing: 'rent, mortgage, home repairs',
  Utilities: 'electricity, gas, water, internet, mobile phone',
  Subscriptions: 'recurring services: streaming, music, software, cloud storage, gym memberships',
  Shopping: 'online and retail stores, clothes, electronics, household goods',
  Health: 'pharmacies, doctors, dentists, insurance',
  Entertainment: 'cinema, concerts, events, games, books',
  Travel: 'flights, hotels, rentals for trips',
  Income: 'salary, payments from clients, refunds',
  Transfers: 'money sent to or received from a person (Venmo, Zelle, PayPal to a person)',
  Other: 'anything that fits nowhere else',
};

/** Money in can be only income or a transfer: the model is not even offered "Groceries". */
const MONEY_IN = new Set(['Income', 'Transfers', 'Other']);

export interface MorningNote {
  headline: string;
  paragraphs: string[];
}

export function merchantWork(
  config: Config,
  key: string,
  samples: Transaction[],
): Work<MerchantReading> {
  const lines = samples
    .slice(0, 3)
    .map(
      (one) =>
        `${one.date}  ${one.description}  ${one.amount.toFixed(2)} ${config.currency}` +
        (one.hint ? `  [the bank's category: ${one.hint}]` : ''),
    );
  const bankHints = [...new Set(samples.flatMap((one) => (one.hint ? [one.hint] : [])))];
  const moneyIn = samples.every((one) => one.amount > 0);
  const categories = config.categories.filter(
    (category) => MONEY_IN.has(category) === moneyIn || category === 'Other',
  );
  const hints = categories
    .map(
      (category) =>
        `- ${category}${CATEGORY_HINTS[category] ? `: ${CATEGORY_HINTS[category]}` : ''}`,
    )
    .join('\n');
  return {
    id: idOf('merchant', key, categories, bankHints, config.model.name),
    label: key,
    run: () =>
      ask<MerchantReading>(
        config.model,
        'You sort the bank transactions of one person. You get the lines of one merchant as ' +
          `they appear on a bank statement (${moneyIn ? 'money received' : 'money spent'}). ` +
          'Answer with: the merchant name as a person would write it; what it sells or what ' +
          'the payment is for, in a few words; whether you know this business or the line says ' +
          'plainly what it is (false for a business name you cannot place, like a small shop ' +
          'with a vague name — then it is better to ask than to guess; but a payment to or from ' +
          'a person, a first and a last name, is plainly a transfer: known); and its category. A ' +
          "line may carry the bank's own category in [brackets], in any language: when it says " +
          'plainly what the payment is, trust it and count the merchant as known. Categories:\n' +
          hints,
        lines.join('\n'),
        {
          type: 'object',
          properties: {
            merchant: { type: 'string' },
            sells: { type: 'string' },
            known: { type: 'boolean' },
            category: { type: 'string', enum: categories },
          },
          required: ['merchant', 'sells', 'known', 'category'],
        },
      ),
  };
}

export function noteWork(config: Config, note: Note, knownTags: string[]): Work<NoteReading> {
  return {
    // The tags known at the time are not part of the id: a note is read once.
    id: idOf('note', note.text, config.model.name),
    label: note.file,
    run: async () => {
      const answer = await ask<NoteReading>(
        config.model,
        'You tidy the quick notes of one person. For the note, give: a short title that says ' +
          'what the note is about (at most 8 words); its kind; 1 to 3 lower-case tags about its ' +
          'subject (health, books, travel…) — take one of these existing tags only when it truly ' +
          `fits, otherwise make a new one: ${knownTags.join(', ') || 'none yet'}; and every ` +
          'to-do the person still has to do themselves (call, buy, send, "I own…", "I need…"), ' +
          'as a short task starting with a verb that names what it is about ("Call the dentist ' +
          'about the crown"). A meeting that already took place is not a task; an idea or a ' +
          '"maybe" is not a task; never invent one. For each task, "when": the words of the note ' +
          'that say when it is due ("fri", "by oct 31", "before thursday"), as written, or null.',
        note.text,
        {
          type: 'object',
          properties: {
            title: { type: 'string' },
            kind: { type: 'string', enum: [...NOTE_KINDS] },
            tags: { type: 'array', items: { type: 'string' }, maxItems: 4 },
            tasks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  text: { type: 'string' },
                  when: { type: ['string', 'null'] },
                },
                required: ['text', 'when'],
              },
            },
          },
          required: ['title', 'kind', 'tags', 'tasks'],
        },
      );
      // One form for every tag: "Home Office" and "#home-office" are one tag.
      answer.value.tags = [...new Set(answer.value.tags.map(cleanTag).filter(Boolean))];
      return answer;
    },
  };
}

export function pairKey(a: Task, b: Task): string {
  return [a.text, b.text].sort().join(' ⇄ ');
}

export function sameTaskWork(config: Config, a: Task, b: Task): Work<SameTask> {
  return {
    id: idOf('same-task', pairKey(a, b), config.model.name),
    label: `"${a.text}" ⇄ "${b.text}"`,
    run: () =>
      ask<SameTask>(
        config.model,
        'You keep the to-do list of one person. Decide whether two items are the same task ' +
          'written twice: doing one means the other is done too. Think of what each is really ' +
          'about — a brand can name a thing ("Planet Fitness" is a gym), a step can be the task ' +
          'itself ("book a renewal appointment" is how a passport is renewed). Similar words are ' +
          'not enough: "Call the bank about the card" and "Call the bank about the loan" are ' +
          'different. First the reason in one sentence, then the verdict, then whether you are ' +
          'sure.',
        `1. ${a.text}\n2. ${b.text}`,
        {
          type: 'object',
          properties: {
            reason: { type: 'string' },
            same: { type: 'boolean' },
            sure: { type: 'boolean' },
          },
          required: ['reason', 'same', 'sure'],
        },
      ),
  };
}

export function projectWork(config: Config, task: Task, projects: string[]): Work<ProjectChoice> {
  return {
    id: idOf('project', task.text, projects, config.model.name),
    label: task.text,
    run: () =>
      ask<ProjectChoice>(
        config.model,
        'You keep the to-do list of one person. Pick the project this task belongs to, from ' +
          'the list, or "none" when no project fits; and whether you are sure.',
        `Projects: ${projects.join(', ')}\nTask: ${task.text}`,
        {
          type: 'object',
          properties: {
            project: { type: 'string', enum: [...projects, 'none'] },
            sure: { type: 'boolean' },
          },
          required: ['project', 'sure'],
        },
      ),
  };
}

export function morningWork(config: Config, facts: object): Work<MorningNote> {
  return {
    id: idOf('morning', facts, config.model.name),
    label: 'the morning note',
    run: () =>
      ask<MorningNote>(
        config.model,
        'You are a calm, warm butler who worked through the night for one person, written to ' +
          'as "you". Retell the facts as the note they read with their morning coffee: a ' +
          'headline of at most 10 words that names the most important thing; then 2 or 3 short ' +
          'paragraphs — "overnight": what you did; "needsAttention": what needs them today, ' +
          'each item kept; one gentle suggestion from "context". Keep every name, amount and ' +
          'date exactly as written and never add a fact that is not there. Plain English, no ' +
          'lists, no greeting line, no signature.',
        JSON.stringify(facts, null, 2),
        {
          type: 'object',
          properties: {
            headline: { type: 'string' },
            paragraphs: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 3 },
          },
          required: ['headline', 'paragraphs'],
        },
      ),
  };
}
