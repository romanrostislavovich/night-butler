import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Quick notes dropped into the inbox as they came: no title, no tags, a to-do buried in the
 * middle. The model reads each one and gives it a title, a few tags (the ones already used
 * where they fit, so the tags do not multiply) and the to-dos hidden in it.
 */

export interface Note {
  file: string;
  text: string;
  /** When it was written: the file's time. */
  date: string;
}

export interface NoteReading {
  title: string;
  kind: 'idea' | 'journal' | 'todo' | 'reference' | 'meeting';
  tags: string[];
  /** `when`: the words of the note that say when (see resolveDue), not a date. */
  tasks: { text: string; when: string | null }[];
}

export const NOTE_KINDS = ['idea', 'journal', 'todo', 'reference', 'meeting'] as const;

export function readNotes(folder: string): Note[] {
  let files: string[];
  try {
    files = readdirSync(folder).filter((name) => /\.(md|txt)$/i.test(name));
  } catch {
    return [];
  }
  return files.sort().map((name) => {
    const path = join(folder, name);
    return {
      file: name,
      text: readFileSync(path, 'utf8').trim(),
      // A date at the start of the name ("2026-10-14 dentist.md") wins: a copy keeps it.
      date: /^\d{4}-\d{2}-\d{2}/.exec(name)?.[0] ?? statSync(path).mtime.toISOString().slice(0, 10),
    };
  });
}

/** The tags written in a note by hand (#tag). */
export function handTags(text: string): string[] {
  return [...text.matchAll(/(?:^|\s)#([\p{L}\d-]{2,30})/gu)].map((match) => match[1].toLowerCase());
}

/** A tag as one form: lower case, words joined by a hyphen, no leading #. */
export function cleanTag(tag: string): string {
  return tag
    .toLowerCase()
    .replace(/^#/, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{L}\d-]/gu, '');
}

/** A file name out of a title: "Ideas for the garden" → "ideas-for-the-garden". */
export function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{L}\d]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'note'
  );
}
