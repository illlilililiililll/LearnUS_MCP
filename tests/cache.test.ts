import { it,expect,vi } from 'vitest';
import { MemoryCache } from '../src/client/MemoryCache.js';
it('caches normalized values, expires them, and shares concurrent refreshes',async()=>{
  vi.useFakeTimers();const cache=new MemoryCache();let calls=0;const load=async()=>({value:++calls});
  expect(await Promise.all([cache.get('x',100,false,load),cache.get('x',100,false,load)])).toEqual([{value:1},{value:1}]);
  expect((await cache.get('x',100,false,load)).value).toBe(1);vi.advanceTimersByTime(101);expect((await cache.get('x',100,false,load)).value).toBe(2);vi.useRealTimers();
});
