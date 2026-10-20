import type { Morning } from '../morning.ts';
import type { Question } from '../state.ts';

/*
 * The morning page: the butler's note, what needs you (one click each), and what it did. Plain
 * HTML from the server, no script: it works in any browser and with JavaScript off.
 */

export function page(report: Morning, currency: string, nightLog: string[]): string {
  const money = (value: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);
  const headline = report.note?.headline ?? 'The butler has not finished the night yet';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Night Butler · ${esc(report.date)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
  <p class="date">☀️ Good morning · ${esc(longDate(report.date))}</p>
  <h1>${esc(headline)}</h1>
  ${(report.note?.paragraphs ?? []).map((text) => `<p class="note">${esc(text)}</p>`).join('\n  ')}
  ${report.pending ? `<p class="warn">⏰ ${report.pending} pieces of work are left for tomorrow night.</p>` : ''}

  ${
    report.questions.length
      ? `<section class="ask">
    <h2>🙋 ${report.questions.length} ${report.questions.length === 1 ? 'question' : 'questions'} for you</h2>
    <p class="hint">Answer once — the butler remembers it and never asks again.</p>
    ${report.questions.map(question).join('\n    ')}
  </section>`
      : `<section class="ask done"><h2>🙌 Nothing needs you today</h2></section>`
  }

  <section>
    <h2>💸 Money</h2>
    <div class="grid">
      ${card(
        `Spending in ${monthName(report.month)}`,
        report.spending
          .slice(0, 6)
          .map((one) => row(one.category, money(one.amount)))
          .join(''),
      )}
      ${card(
        `${report.subscriptions.length} subscriptions · ${money(report.subscriptions.reduce((sum, one) => sum + one.amount, 0))} a month`,
        report.subscriptions
          .map((one) =>
            row(
              one.merchant,
              one.roseFrom
                ? `<span class="up">${money(one.roseFrom)} → ${money(one.amount)}</span>`
                : money(one.amount),
            ),
          )
          .join(''),
      )}
      ${card(
        `Bills · ${money(report.bills.reduce((sum, one) => sum + one.amount, 0))} last month`,
        report.bills.map((one) => row(one.merchant, money(one.amount))).join(''),
      )}
      ${
        report.doubles.length || report.unusual.length
          ? card(
              '⚠️ Worth a look',
              [
                ...report.doubles.map((one) =>
                  row(
                    `${one.merchant} charged twice`,
                    `${money(one.amount)} · ${one.dates.map(shortDate).join(' & ')}`,
                  ),
                ),
                ...report.unusual.map((one) =>
                  row(
                    `${one.merchant} far above usual`,
                    `${money(one.amount)} <small>usually ${money(one.usual)}</small>`,
                  ),
                ),
              ].join(''),
            )
          : ''
      }
    </div>
  </section>

  <section>
    <h2>📝 Notes tidied</h2>
    <div class="grid">
      ${report.notes
        .map((note) =>
          card(
            note.title,
            `<p class="tags">${note.tags.map((tag) => `<span>#${esc(tag)}</span>`).join(' ')}</p>
             <p class="muted">${esc(note.kind)} · from ${esc(note.file)}</p>`,
          ),
        )
        .join('')}
    </div>
  </section>

  <section>
    <h2>✅ Your to-do list</h2>
    <div class="grid">
      ${card(
        `${report.newTasks.length} tasks found in your notes`,
        report.newTasks
          .map((task) => row(task.text, `<small>${esc(task.from ?? '')}</small>`))
          .join(''),
      )}
      ${card(
        `${report.merged.length} written twice — merged`,
        report.merged.map(([a, b]) => `<p class="pair">${esc(a)}<br><s>${esc(b)}</s></p>`).join(''),
      )}
      ${card(
        `${report.forgotten.length} forgotten for a month or more`,
        report.forgotten
          .map((task) => row(task.text, `<small>since ${shortDate(task.added ?? '')}</small>`))
          .join(''),
      )}
    </div>
  </section>

  ${
    nightLog.length
      ? `<section>
    <h2>🌙 The night log</h2>
    <pre>${esc(nightLog.join('\n'))}</pre>
  </section>`
      : ''
  }
  <footer>Night Butler · a local model on this computer · nothing left it</footer>
</main>
</body>
</html>`;
}

function question(q: Question): string {
  const buttons = q.options
    .map(
      (option) =>
        `<button name="value" value="${esc(option)}"${option === q.guess ? ' class="guess"' : ''}>${esc(option)}</button>`,
    )
    .join('');
  return `<form method="post" action="/answer" class="question">
      <input type="hidden" name="id" value="${esc(q.id)}">
      <p>${esc(q.text)}</p>
      <div class="options">${buttons}</div>
    </form>`;
}

function card(title: string, body: string): string {
  return `<article class="card"><h3>${esc(title)}</h3>${body || '<p class="muted">Nothing here.</p>'}</article>`;
}

/** A row: the label is escaped, the value is HTML made here. */
function row(label: string, value: string): string {
  return `<div class="row"><span>${esc(label)}</span><b>${value}</b></div>`;
}

export function esc(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function longDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function shortDate(date: string): string {
  return date
    ? new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '';
}

function monthName(month: string | null): string {
  return month
    ? new Date(`${month}-15T12:00:00`).toLocaleDateString('en-US', { month: 'long' })
    : 'the month';
}

const STYLE = `
:root { color-scheme: dark; --bg: #0e1220; --card: #171c2e; --line: #262d45; --text: #e8eaf3;
  --muted: #8f97b3; --accent: #f5c46b; --up: #ff8a7a; --ok: #7fd6a6; }
* { box-sizing: border-box; }
body { margin: 0; background: radial-gradient(circle at 80% -10%, #2a2f55 0, var(--bg) 45%);
  color: var(--text); font: 16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1040px; margin: 0 auto; padding: 40px 16px 64px; }
.date { color: var(--accent); margin: 0; font-weight: 600; }
h1 { font-size: clamp(28px, 5vw, 44px); line-height: 1.15; margin: 8px 0 16px; }
.note { font-size: 18px; max-width: 760px; color: #d4d8e8; }
.warn { color: var(--accent); }
h2 { font-size: 20px; margin: 36px 0 12px; }
h3 { font-size: 15px; margin: 0 0 10px; color: var(--accent); }
.grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
.card, .question { background: var(--card); border: 1px solid var(--line); border-radius: 14px;
  padding: 16px; }
.row { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0;
  border-bottom: 1px dashed var(--line); }
.row:last-child { border-bottom: 0; }
.row b { font-weight: 600; white-space: nowrap; }
small, .muted, .hint { color: var(--muted); }
.up { color: var(--up); }
.tags span { display: inline-block; background: #232a44; border-radius: 999px; padding: 1px 10px;
  margin: 0 4px 4px 0; font-size: 13px; }
.pair s { color: var(--muted); }
.ask .question { margin-bottom: 10px; }
.ask.done h2 { color: var(--ok); }
.options { display: flex; flex-wrap: wrap; gap: 6px; }
button { border: 1px solid var(--line); background: #222944; color: var(--text); border-radius: 999px;
  padding: 6px 14px; font: inherit; font-size: 14px; cursor: pointer; }
button:hover { border-color: var(--accent); }
button.guess { border-color: var(--accent); color: var(--accent); }
pre { background: #0a0d18; border: 1px solid var(--line); border-radius: 14px; padding: 16px;
  overflow-x: auto; font-size: 13px; color: #b9c0d9; }
footer { margin-top: 48px; color: var(--muted); font-size: 13px; text-align: center; }
`;
