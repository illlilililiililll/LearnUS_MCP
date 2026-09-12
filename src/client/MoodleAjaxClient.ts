import type { BrowserContext } from 'playwright';
import { LearnUsError } from '../errors.js';
import { ORIGIN } from '../parser/dashboard.js';

export interface ActionEventsArgs {
  timesortfrom: number;
  timesortto: number;
  aftereventid: number;
  limitnum: number;
  limittononsuspendedevents: boolean;
}
export const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export class MoodleAjaxClient {
  // Deliberately expose only this read-only API, not arbitrary Moodle methods.
  async getActionEventsByTimesort(context: BrowserContext, sesskey: string | undefined, args: ActionEventsArgs): Promise<unknown[]> {
    if (!sesskey) throw new LearnUsError('SESSION_EXPIRED');
    const method = 'core_calendar_get_action_events_by_timesort';
    const query = new URLSearchParams({sesskey, info:method});
    const response = await context.request.post(`${ORIGIN}/lib/ajax/service.php?${query}`, {
      data:[{index:0,methodname:method,args}], timeout:30000,
      headers:{'Content-Type':'application/json', Origin:ORIGIN, Referer:`${ORIGIN}/`, 'X-Requested-With':'XMLHttpRequest'},
    });
    try {
      if (response.status() === 401) throw new LearnUsError('SESSION_EXPIRED');
      if (!response.ok()) throw new LearnUsError('NETWORK_ERROR');
      const url = new URL(response.url());
      if (url.origin !== ORIGIN || /\/(login|passni)\//.test(url.pathname)) throw new LearnUsError('SESSION_EXPIRED');
      const text = await response.text();
      let payload: unknown;
      try { payload = JSON.parse(text); }
      catch {
        if (/<(?:html|form|input)\b/i.test(text) && /loginPasswd|name=["']password["']|\/login\/index\.php/.test(text)) throw new LearnUsError('SESSION_EXPIRED');
        throw new LearnUsError('PARSE_ERROR');
      }
      const envelope = record(Array.isArray(payload) ? payload[0] : payload);
      const exception = record(envelope.exception);
      const code = exception.errorcode ?? envelope.errorcode;
      if (['invalidsesskey','requireloginerror','notloggedin','servicerequireslogin'].includes(String(code))) throw new LearnUsError('SESSION_EXPIRED');
      if (envelope.error || code || envelope.exception) throw new LearnUsError('NETWORK_ERROR');
      const events = record(envelope.data).events;
      if (!Array.isArray(payload) || payload.length !== 1 || !Array.isArray(events)) throw new LearnUsError('PARSE_ERROR');
      return events;
    } finally { await response.dispose(); }
  }
}
