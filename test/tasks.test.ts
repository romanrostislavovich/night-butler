import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { cleanTag, handTags, slug } from '../src/jobs/notes.ts';
import { forgotten, likeness, maybeTwice, readTasks, writeTasks } from '../src/jobs/tasks.ts';
import { deadlineOf } from '../src/shift.ts';

function tasksOf(text: string) {
  const file = join(mkdtempSync(join(tmpdir(), 'nb-')), 'tasks.md');
  writeFileSync(file, text);
  return readTasks(file);
}

test('a task line gives its text, project, date and whether it is done', () => {
  assert.deepEqual(
    tasksOf(
      '# To do\n- [ ] Renew the passport #home (2026-06-02)\n- [x] Pay the ticket\nnot a task',
    ),
    [
      { text: 'Renew the passport', done: false, project: 'home', added: '2026-06-02' },
      { text: 'Pay the ticket', done: true, project: null, added: null },
    ],
  );
});

test('the list is written back by project, open tasks first', () => {
  const tasks = tasksOf('- [x] B #work\n- [ ] A #work\n- [ ] C');
  assert.equal(
    writeTasks(tasks),
    '## work\n\n- [ ] A #work\n- [x] B #work\n\n## No project\n\n- [ ] C\n',
  );
});

test('tasks sharing a word that matters go to the model as maybe twice', () => {
  const tasks = tasksOf(
    '- [ ] Cancel the gym membership\n- [ ] cancel planet fitness\n- [ ] Book a flu shot\n' +
      '- [ ] Renew the passport\n- [ ] Book a passport renewal appointment',
  );
  assert.ok(likeness('Renew the passport', 'Book a passport renewal appointment') >= 0.5);
  assert.deepEqual(maybeTwice(tasks), [
    [0, 1],
    [2, 4],
    [3, 4],
  ]);
  assert.deepEqual(maybeTwice(tasksOf('- [ ] Water the plants\n- [ ] Pay the rent')), []);
});

test('an open task older than the limit is forgotten', () => {
  const tasks = tasksOf('- [ ] Old (2026-08-01)\n- [ ] New (2026-10-15)\n- [x] Done (2026-01-01)');
  assert.deepEqual(
    forgotten(tasks, '2026-10-20', 30).map((task) => task.text),
    ['Old'],
  );
});

test('tags and file names have one form', () => {
  assert.deepEqual(handTags('#health knee hurts #Running'), ['health', 'running']);
  assert.equal(cleanTag('#Home Office'), 'home-office');
  assert.equal(slug('Call the dentist about the crown!'), 'call-the-dentist-about-the-crown');
});

test('the shift ends at the next time the clock shows the hour', () => {
  const night = new Date(2026, 9, 20, 2, 0);
  assert.equal(new Date(deadlineOf('07:00', night)).getHours(), 7);
  assert.equal(new Date(deadlineOf('07:00', night)).getDate(), 20);
  const evening = new Date(2026, 9, 20, 23, 0);
  assert.equal(new Date(deadlineOf('07:00', evening)).getDate(), 21);
});
