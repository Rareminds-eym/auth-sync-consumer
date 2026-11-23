import { afterEach, describe, expect, it, vi } from 'vitest';
import { processSsoMessage } from '../src/handlers/event-processor';

afterEach(() => vi.unstubAllGlobals());

describe('canonical plan synchronization', () => {
  it.each([200, 503])('delivers the authenticated reference and settles HTTP %s correctly', async status => {
    const request = vi.fn().mockResolvedValue(new Response('{}', { status }));
    vi.stubGlobal('fetch', request);
    const payload = { id: '00000000-0000-4000-8000-000000000001' };
    const message = { body: { type: 'plan.updated', payload }, ack: vi.fn(), retry: vi.fn() };
    await processSsoMessage(message as never, 'https://application.example', 'synthetic-secret');
    expect(request).toHaveBeenCalledWith('https://application.example/sync/plan', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ action: 'updated', data: payload }),
      headers: expect.objectContaining({ Authorization: 'Bearer synthetic-secret' }),
    }));
    expect(message.ack).toHaveBeenCalledTimes(status === 200 ? 1 : 0);
    expect(message.retry).toHaveBeenCalledTimes(status === 503 ? 1 : 0);
  });
});
