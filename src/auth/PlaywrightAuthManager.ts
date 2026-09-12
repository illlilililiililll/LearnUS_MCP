import type { Page } from 'playwright';
import type { CredentialProvider } from './CredentialProvider.js';
import { SessionManager } from './SessionManager.js';
import { authenticatedHtml, extractSesskey } from '../parser/session.js';
import { ORIGIN } from '../parser/dashboard.js';
import { LearnUsError, safeCode } from '../errors.js';
type LoginStage = 'starting' | 'sso_entry' | 'sso_login' | 'sso_result' | 'callback' | 'learnus' | 'other';
type LoginReason = 'pending' | 'authenticated' | 'challenge' | 'dialog' | 'submit_not_sent' | 'redirect_timeout' | 'login_page_timeout' | 'unexpected_origin' | 'browser_error' | 'http_error';
function loginStage(value: string): LoginStage {
  const url = new URL(value);
  if (url.origin === 'https://infra.yonsei.ac.kr') return url.pathname === '/sso/PmSSOService' ? 'sso_login' : url.pathname === '/sso/PmSSOAuthService' ? 'sso_result' : 'other';
  if (url.origin !== ORIGIN) return 'other';
  if (url.pathname === '/passni/sso/spLogin2.php') return 'sso_entry';
  return url.pathname.startsWith('/passni/') ? 'callback' : 'learnus';
}
export class PlaywrightAuthManager {
  private flight?: Promise<void>;
  // Only enums, booleans and counts: never URLs, HTML, dialogs or exception text.
  private diagnostic = {stage:'starting' as LoginStage, reason:'pending' as LoginReason,
    clicked:false, ssoPostSent:false, callbackSeen:false, pageErrors:0, requestFailures:0, httpErrors:0, documentStatus:0};
  get loginDiagnostics() { return {...this.diagnostic}; }
  constructor(private credentials: CredentialProvider, readonly session = new SessionManager()) {}
  async status() {
    if (!this.session.active) return {authenticated:false};
    try { return {authenticated:await this.probe()}; }
    catch { throw new LearnUsError('NETWORK_ERROR'); }
  }
  private async probe(): Promise<boolean> {
    const context = await this.session.getContext();
    const response = await context.request.get(ORIGIN, {timeout:30000});
    try {
      if (response.status() >= 500) throw new LearnUsError('NETWORK_ERROR');
      const html = await response.text();
      const valid = response.ok() && authenticatedHtml(html, response.url());
      this.session.sesskey = valid ? extractSesskey(html) : undefined;
      return valid;
    } finally { await response.dispose(); }
  }
  async ensureAuthenticated(expiredGeneration?: number): Promise<void> {
    if (this.flight) return this.flight;
    this.flight = (async () => {
      if (expiredGeneration !== undefined && this.session.generation !== expiredGeneration && this.session.sesskey) return;
      if (expiredGeneration === undefined && this.session.active && this.session.sesskey) return;
      if (expiredGeneration === undefined && this.session.active && await this.probe()) return;
      this.session.invalidate();
      await this.login();
      this.session.generation++;
    })().catch((error: unknown) => { this.session.invalidate(); throw error instanceof LearnUsError ? error : new LearnUsError(safeCode(error)); })
      .finally(() => { this.flight = undefined; });
    return this.flight;
  }
  private async challenge(page: Page) {
    // A recaptcha script alone is not a challenge. Only visible interactive UI counts.
    return await page.locator('iframe[src*="recaptcha/api2/bframe"]:visible, .g-recaptcha:visible, #g-recaptcha:visible, input[autocomplete="one-time-code"]:visible, input[name="otp"]:visible, input[name="captcha"]:visible, #captcha:visible').count() > 0;
  }
  private async login() {
    this.diagnostic = {stage:'starting', reason:'pending', clicked:false, ssoPostSent:false,
      callbackSeen:false, pageErrors:0, requestFailures:0, httpErrors:0, documentStatus:0};
    const credentials = await this.credentials.getCredentials();
    const page = await (await this.session.getContext()).newPage();
    let dialogChallenge = false;
    let dialogSeen = false;
    page.on('pageerror', () => { this.diagnostic.pageErrors++; });
    page.on('requestfailed', () => { this.diagnostic.requestFailures++; });
    page.on('response', response => {
      if (response.status() >= 400) this.diagnostic.httpErrors++;
      if (response.request().isNavigationRequest() && response.frame() === page.mainFrame()) {
        this.diagnostic.documentStatus = response.status();
        this.diagnostic.stage = loginStage(response.url());
      }
    });
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.origin === 'https://infra.yonsei.ac.kr' && url.pathname === '/sso/PmSSOAuthService' && request.method() === 'POST') this.diagnostic.ssoPostSent = true;
      if (url.origin === ORIGIN && url.pathname === '/passni/sso/spLoginData.php') this.diagnostic.callbackSeen = true;
    });
    page.on('dialog', async dialog => {
      dialogSeen = true;
      dialogChallenge ||= /captcha|인증번호|추가 인증|자동.?입력|보안.?문자|multi.factor|one.time/i.test(dialog.message());
      await dialog.dismiss().catch(() => undefined);
    });
    const checkHttp = () => {
      if (this.diagnostic.documentStatus >= 400) {
        this.diagnostic.reason = 'http_error';
        throw new LearnUsError('NETWORK_ERROR');
      }
    };
    try {
      // The entry endpoint requires the homepage Referer, even in a fresh context.
      await page.goto(`${ORIGIN}/passni/sso/spLogin2.php`, {
        referer: `${ORIGIN}/`, waitUntil:'domcontentloaded', timeout:45000,
      });
      const deadline = Date.now() + 60000;
      let submitted = false;
      while (Date.now() < deadline) {
        this.diagnostic.stage = loginStage(page.url());
        if (dialogChallenge || await this.challenge(page)) {
          this.diagnostic.reason = 'challenge';
          throw new LearnUsError('AUTH_CHALLENGE_REQUIRED');
        }
        checkHttp();
        if (dialogSeen) { this.diagnostic.reason = 'dialog'; throw new LearnUsError('AUTH_FAILED'); }
        const html = await page.content().catch(() => '');
        if (authenticatedHtml(html, page.url())) {
          if (await this.probe()) { this.diagnostic.reason = 'authenticated'; return; }
        }
        if (!submitted && await page.locator('#loginId').isVisible()) {
          // Never enter credentials on an unexpected host.
          if (new URL(page.url()).origin !== 'https://infra.yonsei.ac.kr') {
            this.diagnostic.reason = 'unexpected_origin'; throw new LearnUsError('AUTH_FAILED');
          }
          // The captured SSO page initializes in body.onload, after DOMContentLoaded.
          const ready = await page.evaluate(() => document.readyState === 'complete').catch(() => false);
          if (!ready) { await page.waitForTimeout(250); continue; }
          await page.locator('#loginId').fill(credentials.id);
          await page.locator('#loginPasswd').fill(credentials.password);
          await page.locator('#loginBtn').click();
          submitted = true;
          this.diagnostic.clicked = true;
        }
        await page.waitForTimeout(250);
      }
      this.diagnostic.reason = !submitted ? 'login_page_timeout' : !this.diagnostic.ssoPostSent ? 'submit_not_sent' : 'redirect_timeout';
      throw new LearnUsError('AUTH_FAILED');
    } catch (error) {
      if (error instanceof LearnUsError) throw error;
      this.diagnostic.reason = 'browser_error';
      throw new LearnUsError('AUTH_FAILED');
    } finally { await page.close().catch(() => undefined); }
  }
  async close() { await this.flight?.catch(() => undefined); await this.session.close(); }
}
