import { it, expect, vi, afterEach } from 'vitest';
import { EnvironmentCredentialProvider } from '../src/auth/CredentialProvider.js';
import { PlaywrightAuthManager } from '../src/auth/PlaywrightAuthManager.js';
import { LearnUsClient } from '../src/client/LearnUsClient.js';
import { safeCode } from '../src/errors.js';
afterEach(() => vi.unstubAllEnvs());
it('reports missing credentials without revealing values', async () => {
  vi.stubEnv('LEARNUS_ID',''); vi.stubEnv('LEARNUS_PASSWORD','');
  await expect(new EnvironmentCredentialProvider().getCredentials()).rejects.toThrow('CREDENTIALS_MISSING');
});
it('status does not start a browser or request credentials', async () => {
  const provider = {getCredentials:vi.fn()};
  expect(await new PlaywrightAuthManager(provider).status()).toEqual({authenticated:false});
  expect(provider.getCredentials).not.toHaveBeenCalled();
});
it('coalesces concurrent login attempts', async () => {
  const provider = {getCredentials:vi.fn(async () => {await new Promise(r => setTimeout(r, 10)); throw new Error('secret');})};
  const auth = new PlaywrightAuthManager(provider);
  const results = await Promise.allSettled(Array.from({length:10}, () => auth.ensureAuthenticated()));
  expect(provider.getCredentials).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(results)).not.toContain('secret');
});
it('sanitizes unexpected errors', () => expect(safeCode(new Error('Cookie password secret'))).toBe('NETWORK_ERROR'));
it('retries an expired request exactly once', async () => {
  const response = {text:async () => '<input name="password">',status:() => 200,ok:() => true,url:() => 'https://ys.learnus.org/login/index.php',dispose:vi.fn()};
  const get = vi.fn(async () => response);
  const auth = new PlaywrightAuthManager({getCredentials:vi.fn()});
  const ensure = vi.spyOn(auth,'ensureAuthenticated').mockResolvedValue();
  vi.spyOn(auth.session,'getContext').mockResolvedValue({request:{get}} as never);
  await expect(new LearnUsClient(auth).listCourses()).rejects.toThrow('SESSION_EXPIRED');
  expect(get).toHaveBeenCalledTimes(2);
  expect(ensure).toHaveBeenCalledTimes(2);
  expect(response.dispose).toHaveBeenCalledTimes(2);
});
it('returns the original result after one successful reauthentication', async () => {
  const expired = {text:async () => '<input name="password">',status:() => 200,ok:() => true,url:() => 'https://ys.learnus.org/login/index.php',dispose:async () => {}};
  const valid = {...expired, url:() => 'https://ys.learnus.org/', text:async () => '<script>M.cfg={sesskey:"fixture"}</script><a href="/login/logout.php">Logout</a><a href="/course/view.php?id=9">Example</a>'};
  const get = vi.fn().mockResolvedValueOnce(expired).mockResolvedValueOnce(valid);
  const auth = new PlaywrightAuthManager({getCredentials:vi.fn()});
  vi.spyOn(auth,'ensureAuthenticated').mockResolvedValue();
  vi.spyOn(auth.session,'getContext').mockResolvedValue({request:{get}} as never);
  expect((await new LearnUsClient(auth).listCourses()).courses[0].id).toBe(9);
  expect(get).toHaveBeenCalledTimes(2);
});
it('does not log in again for a stale failure from an older session generation', async () => {
  const provider = {getCredentials:vi.fn()};
  const auth = new PlaywrightAuthManager(provider);
  auth.session.generation = 2;
  auth.session.sesskey = 'fixture';
  await auth.ensureAuthenticated(1);
  expect(provider.getCredentials).not.toHaveBeenCalled();
});
it('trusts an active in-memory session until a data request reports expiry',async()=>{
  const provider={getCredentials:vi.fn()},auth=new PlaywrightAuthManager(provider),get=vi.fn();
  auth.session.sesskey='fixture';vi.spyOn(auth.session,'active','get').mockReturnValue(true);
  vi.spyOn(auth.session,'getContext').mockResolvedValue({request:{get}} as never);
  await auth.ensureAuthenticated();expect(get).not.toHaveBeenCalled();expect(provider.getCredentials).not.toHaveBeenCalled();
});
