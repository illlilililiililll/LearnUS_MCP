import {expect,it,vi} from 'vitest';
import {PlaywrightAuthManager} from '../src/auth/PlaywrightAuthManager.js';
import {LearnUsClient} from '../src/client/LearnUsClient.js';
import {MemoryCache} from '../src/client/MemoryCache.js';
import {DataRequestCoordinator} from '../src/client/DataRequestCoordinator.js';
import {parseCourse} from '../src/parser/course.js';

it.each([403,404,500])('does not reauthenticate for a normal HTTP %s error',async status=>{
  const auth=new PlaywrightAuthManager({getCredentials:vi.fn()}),ensure=vi.spyOn(auth,'ensureAuthenticated').mockResolvedValue();
  const dispose=vi.fn(),get=vi.fn(async()=>({status:()=>status,ok:()=>false,url:()=> 'https://ys.learnus.org/',text:async()=>'<main>Unavailable</main>',dispose}));
  vi.spyOn(auth.session,'getContext').mockResolvedValue({request:{get}} as never);
  await expect(new LearnUsClient(auth).listCourses()).rejects.toThrow('NETWORK_ERROR');
  expect(get).toHaveBeenCalledTimes(1);expect(ensure).toHaveBeenCalledTimes(1);expect(dispose).toHaveBeenCalledTimes(1);
});

it('retains unknown course modules and excludes navigation in fallback HTML',()=>{
  const parsed=parseCourse('<nav><a href="/mod/ubboard/view.php?id=1">Menu</a></nav><div class="course-content"><section><a href="/mod/future/view.php?id=2">Activity</a></section><footer><a href="/mod/ubboard/view.php?id=3">Footer</a></footer></div>');
  expect(parsed.activities).toHaveLength(1);expect(parsed.activities[0]).toMatchObject({id:2,module:'future',type:'unknown',completionState:'unknown'});
});

it('releases permits and failed cache flights after timeout rejection',async()=>{
  const requests=new DataRequestCoordinator(1),cache=new MemoryCache();let calls=0;
  const work=()=>cache.get('item',100,false,()=>requests.run({method:'GET',url:'https://ys.learnus.org/',generation:1,category:'page'},async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,2));throw new Error('timeout');}));
  const first=await Promise.allSettled([work(),work(),work()]);expect(first.every(value=>value.status==='rejected')).toBe(true);expect(calls).toBe(1);
  await expect(cache.get('item',100,false,()=>requests.run({method:'GET',url:'https://ys.learnus.org/',generation:1,category:'page'},async()=>42))).resolves.toBe(42);
  expect(requests.snapshot()).toMatchObject({activeRequests:0,networkRequestsFailed:1,networkRequestsCompleted:1,peakConcurrentRequests:1});
});

it('clears failed authentication flights for a later attempt',async()=>{
  const getCredentials=vi.fn(async()=>{throw new Error('synthetic-private');}),auth=new PlaywrightAuthManager({getCredentials});
  await Promise.allSettled([auth.ensureAuthenticated(),auth.ensureAuthenticated()]);expect(getCredentials).toHaveBeenCalledTimes(1);
  await expect(auth.ensureAuthenticated()).rejects.toThrow('NETWORK_ERROR');expect(getCredentials).toHaveBeenCalledTimes(2);expect(auth.session.sesskey).toBeUndefined();
});

it('retries one transient GET transport failure without reauthenticating',async()=>{
  const auth=new PlaywrightAuthManager({getCredentials:vi.fn()}),ensure=vi.spyOn(auth,'ensureAuthenticated').mockResolvedValue();
  const dispose=vi.fn(),response={status:()=>200,ok:()=>true,url:()=> 'https://ys.learnus.org/',text:async()=>'<script>M.cfg={sesskey:"fixture"}</script><a href="/login/logout.php">Logout</a><a href="/course/view.php?id=9">Course</a>',dispose};
  const get=vi.fn().mockRejectedValueOnce(new Error('synthetic transport failure')),fallbackGet=vi.fn().mockResolvedValueOnce(response),close=vi.fn();
  vi.spyOn(auth.session,'getContext').mockResolvedValue({request:{get},storageState:vi.fn(async()=>({cookies:[],origins:[]})),browser:()=>({newContext:vi.fn(async()=>({request:{get:fallbackGet},close}))})} as never);
  await expect(new LearnUsClient(auth).listCourses()).resolves.toMatchObject({courses:[{id:9}]});
  expect(get).toHaveBeenCalledTimes(1);expect(fallbackGet).toHaveBeenCalledTimes(1);expect(ensure).toHaveBeenCalledTimes(1);expect(dispose).toHaveBeenCalledTimes(1);expect(close).toHaveBeenCalledTimes(1);
});
