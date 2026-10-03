/** Bundle with esbuild for Node; dry-run unless --send is explicitly supplied. */
import { readFile } from 'node:fs/promises';
import { decodeEventBody } from '../src/handlers/message-codec';
import { syncReview } from '../src/lib/lte/review-sync-client';

const file = process.argv.slice(2).find(arg => !arg.startsWith('--'));
if (!file) throw new Error('Usage: replay-review-deadletter <downloaded-archive.json> [--send]');
const archive = JSON.parse(await readFile(file, 'utf8')) as { body?: unknown };
const event = await decodeEventBody(archive.body);
const allowed = new Set([
  'lte.review_assigned',
  'lte.review_completed',
  'lte.artifact_reviewed_pass',
  'lte.review_due_soon',
  'lte.review_overdue',
]);
if (!event || !allowed.has(event.type) || typeof event.payload?.eventId !== 'string')
  throw new Error('Archive does not contain a supported review event');
if (!process.argv.includes('--send')) {
  process.stdout.write(
    JSON.stringify({
      dryRun: true,
      type: event.type,
      eventId: event.payload.eventId,
    }) + '\n'
  );
} else {
  const base = process.env.SKILLPASSPORT_SYNC_URL;
  const secret = process.env.LTE_INTERNAL_SECRET;
  if (!base || !secret)
    throw new Error(
      'Set SKILLPASSPORT_SYNC_URL and LTE_INTERNAL_SECRET in the operator environment'
    );
  const url = new URL(base);
  if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(url.hostname))
    throw new Error('Replay requires HTTPS outside local development');
  await syncReview(url.origin, event.type, event.payload, secret);
  process.stdout.write(JSON.stringify({ delivered: true, eventId: event.payload.eventId }) + '\n');
}
