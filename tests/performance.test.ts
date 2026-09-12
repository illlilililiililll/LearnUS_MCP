import { expect,it,vi } from 'vitest';
import { DataRequestCoordinator, maxConcurrentRequests, requestIdentity } from '../src/client/DataRequestCoordinator.js';
import { MemoryCache } from '../src/client/MemoryCache.js';
import { LearnUsClient } from '../src/client/LearnUsClient.js';
import { PlaywrightAuthManager } from '../src/auth/PlaywrightAuthManager.js';

const input=(id=1,generation=1)=>({method:'GET',url:`https://ys.learnus.org/course/view.php?id=${id}`,generation,category:'page' as const});

it('bounds ten data requests and releases every permit',async()=>{
  const requests=new DataRequestCoordinator(4);let active=0,peak=0;
  await Promise.all(Array.from({length:10},(_,index)=>requests.run(input(index+1),async()=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,5));active--;return index;})));
  expect(peak).toBe(4);expect(requests.snapshot()).toMatchObject({networkRequestsStarted:10,networkRequestsCompleted:10,networkRequestsFailed:0,activeRequests:0,peakConcurrentRequests:4});
});

it('coalesces identical requests but keeps distinct course identities',async()=>{
  const requests=new DataRequestCoordinator();let calls=0;
  const work=async()=>{const value=++calls;await new Promise(resolve=>setTimeout(resolve,5));return {value};};
  const values=await Promise.all([requests.run(input(),work),requests.run(input(),work),requests.run(input(),work),requests.run(input(2),work)]);
  expect(calls).toBe(2);expect(values.slice(0,3)).toEqual([{value:1},{value:1},{value:1}]);
  expect(requests.snapshot()).toMatchObject({networkRequestsStarted:2,coalescedRequests:2});
});

it('clears a failed flight so the next request reaches the network',async()=>{
  const requests=new DataRequestCoordinator();let calls=0;
  await expect(requests.run(input(),async()=>{calls++;throw new Error('synthetic');})).rejects.toThrow('synthetic');
  await expect(requests.run(input(),async()=>++calls)).resolves.toBe(2);
  expect(requests.snapshot()).toMatchObject({networkRequestsStarted:2,networkRequestsFailed:1,networkRequestsCompleted:1,activeRequests:0});
});

it('caches normalized values by TTL and session generation',async()=>{
  let now=0,generation=1,calls=0;const requests=new DataRequestCoordinator();
  const cache=new MemoryCache({metrics:requests,now:()=>now,generation:()=>generation});
  const load=()=>requests.run(input(1,generation),async()=>({value:++calls}));
  expect((await cache.get('course:1',100,false,load)).value).toBe(1);
  expect((await cache.get('course:1',100,false,load)).value).toBe(1);
  now=101;expect((await cache.get('course:1',100,false,load)).value).toBe(2);
  generation=2;expect((await cache.get('course:1',100,false,load)).value).toBe(3);
  expect(requests.snapshot()).toMatchObject({networkRequestsStarted:3,cacheHits:1,cacheMisses:3});
});

it('canonicalizes request identity without session secrets',()=>{
  const left=requestIdentity('post','https://ys.learnus.org/lib/ajax/service.php?b=2&sesskey=private&a=1',{z:2,sesskey:'private',a:1},3);
  const right=requestIdentity('POST','https://ys.learnus.org/lib/ajax/service.php?a=1&b=2&sesskey=other',{a:1,sesskey:'other',z:2},3);
  expect(left).toBe(right);expect(left).not.toContain('private');expect(requestIdentity('GET','https://ys.learnus.org/course/view.php?id=1',undefined,1)).not.toBe(requestIdentity('GET','https://ys.learnus.org/course/view.php?id=2',undefined,1));
});

it('validates the concurrency setting',()=>{
  expect(maxConcurrentRequests(undefined)).toBe(4);expect(maxConcurrentRequests('4')).toBe(4);
  for(const value of ['0','33','4.5','invalid'])expect(maxConcurrentRequests(value)).toBe(4);
});

it('applies normalized caching and coalescing through LearnUsClient',async()=>{
  const auth=new PlaywrightAuthManager({getCredentials:vi.fn()}),client=new LearnUsClient(auth);
  auth.session.sesskey='synthetic';vi.spyOn(auth,'ensureAuthenticated').mockResolvedValue();
  const get=vi.fn(async(url:string)=>({url:()=>url,status:()=>200,ok:()=>true,text:async()=>'<main class="course-content"></main>',dispose:vi.fn()}));
  vi.spyOn(auth.session,'getContext').mockResolvedValue({request:{get}} as never);
  await client.getCourse(1);await client.getCourse(1);
  expect(client.performanceMetrics()).toMatchObject({networkRequestsStarted:1,cacheHits:1,cacheMisses:1});
  client.resetPerformanceMetrics();
  await Promise.all([client.getCourse(2),client.getCourse(2),client.getCourse(2)]);
  expect(client.performanceMetrics()).toMatchObject({networkRequestsStarted:1,coalescedRequests:2,cacheMisses:1});
  auth.session.generation++;await client.getCourse(2);
  expect(client.performanceMetrics().networkRequestsStarted).toBe(2);
});
