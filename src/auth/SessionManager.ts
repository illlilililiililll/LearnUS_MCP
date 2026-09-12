import { chromium, type Browser, type BrowserContext } from 'playwright';
export class SessionManager {
  private browser?: Browser;
  private context?: BrowserContext;
  private opening?: Promise<BrowserContext>;
  sesskey?: string;
  generation = 0;
  get active() { return !!this.context; }
  async getContext(): Promise<BrowserContext> {
    if (this.context) return this.context;
    if (!this.opening) this.opening = (async () => {
      this.browser = await chromium.launch({headless:true});
      this.context = await this.browser.newContext();
      return this.context;
    })().finally(() => {this.opening = undefined;});
    return this.opening;
  }
  invalidate() { this.sesskey = undefined; }
  async close() {
    await this.opening?.catch(() => undefined);
    await this.browser?.close();
    this.browser = undefined; this.context = undefined; this.invalidate();
  }
}
