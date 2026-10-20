import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/*
 * The shift every night: Windows Task Scheduler on Windows; on macOS and Linux the crontab
 * line to add (the butler does not edit a crontab it did not write).
 */

const TASK = 'Night Butler';

export function schedule(dir: string, at: string, until: string): string {
  const cli = resolve(import.meta.dirname, 'cli.ts');
  const command = `"${process.execPath}" "${cli}" shift --dir "${resolve(dir)}" --until ${until}`;
  if (process.platform === 'win32') {
    execFileSync('schtasks', [
      '/Create',
      '/F',
      '/SC',
      'DAILY',
      '/ST',
      at,
      '/TN',
      TASK,
      '/TR',
      command,
    ]);
    return `Scheduled "${TASK}" every night at ${at} (Task Scheduler). Remove: night-butler unschedule`;
  }
  const [hours, minutes] = at.split(':');
  return `Add this line to your crontab (crontab -e):\n${Number(minutes)} ${Number(hours)} * * * ${command}`;
}

export function unschedule(): string {
  if (process.platform !== 'win32') {
    return 'Remove the night-butler line from your crontab (crontab -e).';
  }
  execFileSync('schtasks', ['/Delete', '/F', '/TN', TASK]);
  return `Removed "${TASK}".`;
}
