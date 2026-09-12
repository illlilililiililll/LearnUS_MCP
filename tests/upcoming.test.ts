import { it, expect, vi } from 'vitest';
import { LearnUsClient } from '../src/client/LearnUsClient.js';
import { PlaywrightAuthManager } from '../src/auth/PlaywrightAuthManager.js';
import { calendarBoundary } from '../src/models/CalendarEvent.js';
const from = '2026-09-30', to = '2026-10-02';
const start = calendarBoundary(from,false), end = calendarBoundary(to,true);
const event = (id: number, time = start, courseId = 7) => ({id,timesort:time,course:{id:courseId},name:'Synthetic',eventtype:'future-module'});
function harness(pages: unknown[], statuses: number[] = []) {
  const auth = new PlaywrightAuthManager({getCredentials:vi.fn()});
  auth.session.sesskey = 'synthetic-first';
  const ensure = vi.spyOn(auth,'ensureAuthenticated').mockImplementation(async generation => {
    if (generation !== undefined) { auth.session.generation++; auth.session.sesskey = 'synthetic-refreshed'; }
  });
  const disposals = pages.map(() => vi.fn());
  let index = 0;
  const post = vi.fn(async () => {
    const i = index++, status = statuses[i] ?? 200;
    return {ok:() => status < 400,status:() => status,url:() => 'https://ys.learnus.org/lib/ajax/service.php',
      text:async () => JSON.stringify(pages[i]),dispose:disposals[i]};
  });
  vi.spyOn(auth.session,'getContext').mockResolvedValue({request:{post}} as never);
  return {client:new LearnUsClient(auth),post,ensure,disposals};
}
const page = (events: unknown[]) => [{error:false,data:{events}}];
it('paginates across a month boundary and course filters before applying the result limit', async () => {
  const first = Array.from({length:50},(_,i) => event(i+1,start,8));
  const h = harness([page(first),page([event(51,start),event(52,end),event(53,end+1)])]);
  const result = await h.client.upcoming({from,to,courseId:7,limit:2});
  expect(result.events.map(e => e.id)).toEqual([51,52]);
  expect(result.warnings).toEqual([]);
  expect(h.post).toHaveBeenCalledTimes(2);
  const calls = h.post.mock.calls as unknown as [string,{data:{methodname:string;args:Record<string,unknown>}[]}][];
  expect(calls[1][1].data[0]).toEqual({index:0,methodname:'core_calendar_get_action_events_by_timesort',args:{timesortfrom:start,timesortto:end,aftereventid:50,limitnum:50,limittononsuspendedevents:true}});
  expect(start).toBe(Date.parse('2026-09-29T15:00:00Z')/1000);
  expect(end).toBe(Date.parse('2026-10-02T14:59:59Z')/1000);
});
it('keeps distinct equal-time events, removes duplicates and retains unknown event types', async () => {
  const h = harness([page([event(1),event(1),event(2),{id:3,timesort:start},null,{id:4}])]);
  const result = await h.client.upcoming({from,to});
  expect(result.events.map(e => e.id)).toEqual([1,2,3]);
  expect(result.events[0].type).toBe('future-module');
  expect(result.events[2].name).toBeUndefined();
  expect(result.warnings).toEqual(['INVALID_EVENT_SKIPPED']);
});
it('stops a repeated cursor rather than looping forever', async () => {
  const repeated = page(Array.from({length:50},(_,i) => event(i+1)));
  const h = harness([repeated,repeated]);
  const result = await h.client.upcoming({from,to,limit:100});
  expect(h.post).toHaveBeenCalledTimes(2);
  expect(result.events).toHaveLength(50);
  expect(result).toMatchObject({truncated:true,warnings:['PAGINATION_STALLED']});
});
it('respects exact timestamp bounds and rejects invalid ranges before network access', async () => {
  const h = harness([page([event(1,start),event(2,start+1),event(3,end),event(4,end+1)])]);
  const result = await h.client.upcoming({from:'2026-09-30T00:00:00.100+09:00',to:'2026-10-02T23:59:59+09:00'});
  expect(result.events.map(e => e.id)).toEqual([2,3]);
  for (const input of [{from:to,to:from},{from:'invalid',to},{from,to,limit:0},{from,to,courseId:-1}]) {
    await expect(h.client.upcoming(input)).rejects.toThrow('PARSE_ERROR');
  }
  expect(h.post).toHaveBeenCalledOnce();
});
it.each(['invalidsesskey','requireloginerror'])('reuses session retry with a fresh key for %s', async code => {
  const h = harness([[{error:true,exception:{errorcode:code,message:'synthetic-private'}}],page([])]);
  expect((await h.client.upcoming({from,to})).events).toEqual([]);
  expect(h.ensure.mock.calls).toEqual([[],[0]]);
  expect(h.post).toHaveBeenCalledTimes(2);
  const urls = (h.post.mock.calls as unknown as [string][]).map(([url])=>new URL(url).searchParams.get('sesskey'));
  expect(urls).toEqual(['synthetic-first','synthetic-refreshed']);
  expect(h.disposals.every(dispose=>dispose.mock.calls.length===1)).toBe(true);
});
it('does not retry more than once on repeated authentication failures', async () => {
  const failure = [{error:true,exception:{errorcode:'invalidsesskey'}}];
  const h = harness([failure,failure]);
  await expect(h.client.upcoming({from,to})).rejects.toThrow('SESSION_EXPIRED');
  expect(h.post).toHaveBeenCalledTimes(2);
});
it('rejects malformed and non-auth API errors without leaking the server message', async () => {
  for (const payload of [[{data:{wrong:[]}}],[{error:true,exception:{errorcode:'nopermissions',message:'synthetic-private'}}]]) {
    const h = harness([payload]);
    const error = await h.client.upcoming({from,to}).catch(error=>error);
    expect(['PARSE_ERROR','NETWORK_ERROR']).toContain(error.code);
    expect(error.message).not.toContain('synthetic-private');
    expect(h.post).toHaveBeenCalledOnce();
  }
});
it('reports truncation when the caller limit is reached', async () => {
  const h = harness([page([event(1),event(2)])]);
  expect(await h.client.upcoming({from,to,limit:1})).toMatchObject({events:[{id:1}],truncated:true});
});
it('bounds sparse course searches and reports incomplete results', async () => {
  const pages = Array.from({length:100},(_,i)=>page(Array.from({length:50},(_,j)=>event(i*50+j+1,start,8))));
  const h = harness(pages);
  expect(await h.client.upcoming({from,to,courseId:7})).toMatchObject({events:[],truncated:true,warnings:['PAGE_LIMIT_REACHED']});
  expect(h.post).toHaveBeenCalledTimes(100);
});
it.each([403,500])('handles HTTP %s without unbounded retries', async status => {
  const h = harness([page([]),page([])],[status]);
  await expect(h.client.upcoming({from,to})).rejects.toThrow('NETWORK_ERROR');
  expect(h.post).toHaveBeenCalledOnce();
  expect(h.ensure).toHaveBeenCalledTimes(1);
});
