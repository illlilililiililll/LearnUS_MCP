import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { PlaywrightAuthManager } from '../src/auth/PlaywrightAuthManager.js';
let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({headless:true}); });
afterAll(async () => { await browser?.close(); });

it.each(['success', 'rejected', 'challenge', 'http_error'] as const)('runs the actual browser SSO flow: %s', async mode => {
  const context = await browser.newContext();
  const auth = new PlaywrightAuthManager({getCredentials:async () => ({id:'synthetic-id',password:'synthetic-private'})});
  const authenticated = '<script>M.cfg={sesskey:"synthetic-session"}</script><a href="/login/logout.php">Logout</a>';
  vi.spyOn(auth.session,'getContext').mockResolvedValue(context);
  vi.spyOn(context.request,'get').mockResolvedValue({ok:() => true,status:() => 200,text:async () => authenticated,url:() => 'https://ys.learnus.org/',dispose:async () => {}} as never);
  let callbackReached = false;
  let entryFromHome = false;
  const navigations: string[] = [];
  // All browser requests are synthetic; no actual LearnUs/SSO requests or credentials.
  await context.route('**/*', async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().isNavigationRequest()) navigations.push(path);
    if(path === '/passni/sso/spLogin2.php') {
      entryFromHome = route.request().headers().referer === 'https://ys.learnus.org/';
      if (!entryFromHome || mode === 'http_error') return route.fulfill({status:403,body:'Denied'});
      return route.fulfill({contentType:'text/html; charset=utf-8',body:'<body onload="document.forms[0].submit()"><form method="post" action="https://infra.yonsei.ac.kr/sso/PmSSOService"></form></body>'});
    }
    if(path === '/sso/PmSSOService') return route.fulfill({contentType:'text/html; charset=utf-8',body:`
      <form method="post" action="/sso/PmSSOAuthService"><input id="loginId"><input id="loginPasswd" type="password"><a id="loginBtn" href="#">Login</a></form>
      <img src="/delayed-image">
      <script>window.onload=()=>{ document.querySelector('#loginBtn').onclick=()=>{
        ${mode === 'success' ? 'document.querySelector("form").submit();' : `alert('${mode === 'challenge' ? '추가 인증번호' : 'synthetic-private rejection'}');`}
        return false;
      }; };</script>`});
    if(path === '/delayed-image') { await new Promise(resolve => setTimeout(resolve,300)); return route.fulfill({status:204}); }
    if(path === '/sso/PmSSOAuthService') return route.fulfill({contentType:'text/html; charset=utf-8',body:'<body onload="document.forms[0].submit()"><form method="post" action="https://ys.learnus.org/passni/sso/spLoginData.php"></form></body>'});
    if(path === '/passni/sso/spLoginData.php') { callbackReached = true; return route.fulfill({contentType:'text/html; charset=utf-8',body:'<body onload="location.href=\'/\'"></body>'}); }
    if(path === '/') return route.fulfill({contentType:'text/html; charset=utf-8',body:callbackReached ? authenticated : '<a href="/passni/sso/spLogin2.php">Login</a>'});
    return route.abort();
  });
  try {
    if(mode === 'success') {
      await Promise.all([auth.ensureAuthenticated(),auth.ensureAuthenticated(),auth.ensureAuthenticated()]);
      expect(auth.session.generation).toBe(1);
      expect(auth.loginDiagnostics).toMatchObject({reason:'authenticated',ssoPostSent:true,callbackSeen:true});
    } else if (mode === 'http_error') {
      await expect(auth.ensureAuthenticated()).rejects.toThrow('NETWORK_ERROR');
      expect(auth.loginDiagnostics).toMatchObject({stage:'sso_entry',reason:'http_error',documentStatus:403,clicked:false});
    } else {
      await expect(auth.ensureAuthenticated()).rejects.toThrow(mode === 'challenge' ? 'AUTH_CHALLENGE_REQUIRED' : 'AUTH_FAILED');
      expect(auth.loginDiagnostics).toMatchObject({reason:mode === 'challenge' ? 'challenge' : 'dialog',ssoPostSent:false});
    }
    expect(entryFromHome).toBe(true);
    expect(navigations[0]).toBe('/passni/sso/spLogin2.php');
    expect(JSON.stringify(auth.loginDiagnostics)).not.toMatch(/synthetic|password|sesskey/);
  } finally { await context.close(); }
}, 15000);

