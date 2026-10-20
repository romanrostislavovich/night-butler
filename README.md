# 🌙 Night Butler

**My AI is slow. That's why it works the night shift.**

Night Butler is a small open-weight model on your own computer that does your boring paperwork
while you sleep. At 2 a.m. it goes through your bank statement, your scribbled notes and your
to-do list — one thing at a time, at the lowest CPU priority — and in the morning you get a short
note from the butler and a page where every open question is one click.

![The morning page](docs/morning.png)

## What it does overnight

| Inbox                         | What the butler does                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bank/*.csv` — any bank's CSV | names every merchant and sorts it into a category; finds subscriptions, a price that crept up, a charge taken twice, a bill far above its usual   |
| `notes/*.md` — quick notes    | gives each note a title and tags (reusing yours), pulls out the to-dos hidden in it; "before thursday" becomes a real date                        |
| `tasks.md` — your to-do list  | merges tasks written twice ("Cancel the gym membership" = "cancel planet fitness"), gives tasks a project, notices the ones forgotten for a month |

Then it writes the morning note — what it did, what needs you today, one gentle suggestion —
from facts it computed, not from its imagination.

## Slow and steady, on purpose

- **One small model, no GPU.** Qwen2.5 7B in [Ollama](https://ollama.com) on a laptop CPU takes
  about 8 seconds an answer. During the day that is annoying; at night nobody is waiting.
- **It never forgets where it stopped.** Every answer is saved the moment it is given. Stop the
  shift, close the laptop, run it again: it goes on from there and never asks the model twice.
- **It knows when it does not know.** For every merchant it first says what the shop sells and
  whether it actually knows it. "PAYPAL \*JSMITHDESIGN" is not guessed — it becomes a morning
  question.
- **It learns from you.** Answer once and that merchant is decided by your rule from then on,
  without the model. Every night is faster than the one before.
- **The arithmetic is not the model's.** Subscriptions, price rises, double charges, unusual
  bills and due dates are plain code: exact and free. The model reads; the code counts.
- **Your files are never touched.** It writes sorted copies into `butler/`.
- **Nothing leaves your computer.** No account, no API key, no cloud.

## Try it

You need [Node.js](https://nodejs.org) 23.6 or newer and [Ollama](https://ollama.com).

```bash
ollama pull qwen2.5:7b
git clone https://github.com/romanrostislavovich/night-butler && cd night-butler
node src/cli.ts demo                       # a made-up month in ./night-butler-demo
node src/cli.ts shift --dir night-butler-demo
node src/cli.ts review --dir night-butler-demo   # http://127.0.0.1:4545
```

Every night, for real:

```bash
node src/cli.ts schedule --dir ~/butler --at 02:00 --until 07:00
```

On Windows this adds a Task Scheduler task; on macOS and Linux it prints the crontab line.
`--until 07:00` ends the shift at seven even with work left — tomorrow night goes on from there.

## Your folder

```
night-butler.json      optional: { "model": { "name": "qwen2.5:7b" }, "currency": "EUR", ... }
inbox/
  bank/*.csv           a Date, a Description and an Amount column (names in English or Polish)
  notes/*.md           anything; a date at the start of the name is the day it was written
  tasks.md             - [ ] Renew the passport #home (2026-06-02)
butler/                written by the butler: transactions.csv, notes/, tasks.md, briefing.md
```

Any model Ollama runs works: `qwen2.5:3b` is three times faster and good enough for tasks and
notes; `qwen2.5:7b` knows far more merchants.

## How it is built

Zero runtime dependencies: Node runs the TypeScript directly, Ollama's structured outputs give
JSON of a schema, `node:http` serves the morning page. Under 2,000 lines, tests included.

- `src/shift.ts` — the night shift: the queue, the deadline, the low priority
- `src/work.ts` — every question to the model, its JSON schema and the id it is remembered by
- `src/morning.ts` — everything the answers come to, without the model
- `src/jobs/` — the plain code: CSV, merchants, money checks, notes, tasks, due dates
- `src/review/` — the morning page

```bash
npm install && npm test && npm run typecheck
```

Night Butler will become the night shift of
[Personal Dashboard](https://github.com/romanrostislavovich/personal-dashboard), a self-hosted
dashboard of a whole life.

## License

[MIT](LICENSE)
