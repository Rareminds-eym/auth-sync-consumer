import { afterEach, describe, it, expect, vi } from 'vitest';
import { deliverCandidateProjection } from '../src/lib/zoho-candidate-delivery';
import { processSsoMessage } from '../src/handlers/event-processor';
import { sortMessagesByDependency } from '../src/handlers/message-router';
import transport from '../src/index';
const id = '10000000-0000-4000-8000-000000000001';
const reference = { operationId: id, sourceHash: 'a'.repeat(64), emailPolicy: 'forbidden' };
const event = { type: 'zoho.candidate.canonical_committed', payload: reference };
const confirmed = () => Response.json({ success: true, data: { ...reference, completed: true } });
afterEach(() => vi.unstubAllGlobals());
describe('existing auth-sync candidate-reference transport', () => {
  it('sends only a reference to a fixed authenticated endpoint', async () => {
    const fetcher = vi.fn(async () => confirmed());
    await deliverCandidateProjection('https://app.fixture.example','fixture-secret',reference,fetcher);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('https://app.fixture.example/sync/zoho-candidate', expect.objectContaining({
      method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fixture-secret' }, body: JSON.stringify({ action: 'project', data: reference }),
    }));
  });
  it.each([301,302,307,308])('does not follow HTTP %i with the sync secret', async status => {
    const fetcher=vi.fn(async()=>new Response(null,{status,headers:{Location:'https://untrusted.example'}}));
    await expect(deliverCandidateProjection('https://app.fixture.example','fixture-secret',reference,fetcher)).rejects.toThrow('not confirmed');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1].redirect).toBe('manual');
  });
  it.each(['https://app.fixture.example', 'https://app.fixture.example/', 'http://localhost:8790', 'http://127.0.0.1:8790/', 'http://[::1]:8790'])
    ('uses the exact fixed path for a configured origin %s', async base => {
      const fetcher = vi.fn(async () => confirmed());
      await deliverCandidateProjection(base, 'fixture-secret', reference, fetcher);
      const destination = new URL(fetcher.mock.calls[0][0]);
      expect(destination.origin).toBe(new URL(base).origin);
      expect(destination.pathname).toBe('/sync/zoho-candidate');
      expect(destination.search).toBe(''); expect(destination.hash).toBe('');
    });
  it.each(['https://app.fixture.example?mode=other', 'https://app.fixture.example#fragment',
    'https://app.fixture.example/other', 'https://user:password@app.fixture.example',
    'ftp://app.fixture.example', 'http://app.fixture.example', 'invalid-url'])
    ('rejects a non-origin or unsafe destination before sending the reference or secret: %s', async base => {
      const fetcher = vi.fn();
      await expect(deliverCandidateProjection(base, 'fixture-secret', reference, fetcher)).rejects.toMatchObject({ name: 'RetryableError' });
      expect(fetcher).not.toHaveBeenCalled();
    });
  it.each([400,401,404,409,500])('retains HTTP %i instead of acknowledging failed projections', async status => {
    await expect(deliverCandidateProjection('https://app.fixture.example','fixture-secret',reference,async () => new Response('private detail',{status}))).rejects.toThrow('not confirmed');
  });
  it('retains invalid destination configuration and oversized confirmations', async () => {
    await expect(deliverCandidateProjection('invalid-url','fixture-secret',reference)).rejects.toMatchObject({ name: 'RetryableError' });
    await expect(deliverCandidateProjection('https://app.fixture.example','fixture-secret',reference,async () => new Response('x'.repeat(8193)))).rejects.toThrow('not confirmed');
  });
  it('does not accept a successful HTTP status as proof of matching postconditions', async () => {
    for (const body of [{ success: true }, { success: true, data: { ...reference, completed: false } }, { success: true, data: { ...reference, operationId: 'other', completed: true } }])
      await expect(deliverCandidateProjection('https://app.fixture.example','fixture-secret',reference,async () => Response.json(body))).rejects.toThrow('not confirmed');
  });
  it('rejects payload/plan/email-policy overrides before transport', async () => {
    const fetcher = vi.fn();
    for (const value of [{ ...reference, emailPolicy: 'allowed' }, { ...reference, planCode: 'premium' }, { ...reference, email: 'private@fixture.example' }])
      await expect(deliverCandidateProjection('https://app.fixture.example','fixture-secret',value,fetcher)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('keeps candidate references in the existing dependency pipeline', async () => {
    const message = { body: event, ack: vi.fn(), retry: vi.fn() };
    const [entity,dependent,destructive] = await sortMessagesByDependency([message]);
    expect(entity).toEqual([]); expect(dependent).toEqual([message]); expect(destructive).toEqual([]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Unavailable',{status:404})));
    await processSsoMessage(message,'https://app.fixture.example','fixture-secret');
    expect(message.retry).toHaveBeenCalledOnce(); expect(message.ack).not.toHaveBeenCalled();
  });
  it('retains DLQ messages until reference-only archival succeeds', async () => {
    const message = { id: 'fixture-message', body: JSON.stringify(event), ack: vi.fn(), retry: vi.fn() };
    await transport.queue({ queue: 'auth-db-sync-dlq', messages: [message] }, {});
    expect(message.retry).toHaveBeenCalledOnce(); expect(message.ack).not.toHaveBeenCalled();
    const put = vi.fn(async () => {});
    await transport.queue({ queue: 'auth-db-sync-dlq', messages: [message] }, { REVIEW_DLQ_BUCKET: { put } });
    expect(put).toHaveBeenCalledWith('zoho-review-dlq/fixture-message.json', expect.any(String));
    expect(JSON.parse(put.mock.calls[0][1]).reference).toEqual(reference); expect(message.ack).toHaveBeenCalledOnce();
  });
  it('retains unexpected projection failures instead of acknowledging an unconfirmed effect', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => null));
    const message = { body: event, ack: vi.fn(), retry: vi.fn() };
    await processSsoMessage(message,'https://app.fixture.example','fixture-secret');
    expect(message.retry).toHaveBeenCalledOnce(); expect(message.ack).not.toHaveBeenCalled();
  });
});
