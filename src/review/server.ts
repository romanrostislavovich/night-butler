import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import type { Config } from '../config.ts';
import { morning, readInbox, writeMorning } from '../morning.ts';
import { localDate } from '../shift.ts';
import { State } from '../state.ts';
import { page } from './page.ts';

/*
 * The morning page on this computer only (127.0.0.1): an answer is kept as a rule and the
 * sorted files are written again at once — no model, so it is instant.
 */

export function review(config: Config, port: number): Server {
  const server = createServer((request, response) => {
    const state = new State(config.out);
    const inbox = readInbox(config);
    const today = localDate(new Date());
    if (request.method === 'POST' && request.url === '/answer') {
      let body = '';
      request.on('data', (chunk: Buffer) => {
        body += chunk.toString();
        if (body.length > 10_000) request.destroy();
      });
      request.on('end', () => {
        const form = new URLSearchParams(body);
        state.answer(form.get('id') ?? '', form.get('value') ?? '');
        writeMorning(config, inbox, morning(config, state, inbox, today));
        response.writeHead(303, { Location: '/' }).end();
      });
      return;
    }
    if (request.method !== 'GET' || (request.url ?? '/') !== '/') {
      response.writeHead(404).end('Not found');
      return;
    }
    const logFile = join(config.out, 'night-log.txt');
    const log = existsSync(logFile) ? readFileSync(logFile, 'utf8').trimEnd().split('\n') : [];
    response
      .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      .end(page(morning(config, state, inbox, today), config.currency, log));
  });
  server.listen(port, '127.0.0.1');
  return server;
}
