import type { APIResponse, BrowserContext } from 'playwright';
import { load } from 'cheerio';
import { ORIGIN } from '../parser/dashboard.js';
import { LearnUsError } from '../errors.js';
import { learnusId } from '../models/Announcement.js';
import { record } from './MoodleAjaxClient.js';
import { getText, type HttpTextResponse } from './HttpText.js';
async function readResponse(response: HttpTextResponse): Promise<string> {
    if (response.status === 401) throw new LearnUsError('SESSION_EXPIRED');
    const url = new URL(response.url);
    if (url.origin !== ORIGIN || /\/(?:login|passni)\//.test(url.pathname)) throw new LearnUsError('SESSION_EXPIRED');
    const text = response.text;
    if (/^\s*</.test(text)) {
      const $ = load(text);
      if ($('#loginId, #loginPasswd, form[action*="/login/"] input[type="password"], body.notloggedin').length) throw new LearnUsError('SESSION_EXPIRED');
    }
    if (!response.ok) throw new LearnUsError('ENDPOINT_UNAVAILABLE');
    return text;
}
async function readApiResponse(response:APIResponse):Promise<string>{
  try{return readResponse({status:response.status(),ok:response.ok(),url:response.url(),text:await response.text()});}
  finally{await response.dispose();}
}
function id(value: string) {
  if (!learnusId.safeParse(value).success) throw new LearnUsError('PARSE_ERROR');
  return value;
}
export class CoursemosClient {
  async getCompletionHtml(context:BrowserContext,courseId:string) {
    const response=await getText(context,`${ORIGIN}/report/ubcompletion/progress.php?id=${id(courseId)}`);
    return {html:await readResponse(response),url:response.url};
  }
  async getCourseHtml(context: BrowserContext, courseId: string): Promise<string> {
    return readResponse(await getText(context,`${ORIGIN}/course/view.php?id=${id(courseId)}`));
  }
  async getBoard(context: BrowserContext, moduleId: string, page = 0): Promise<string> {
    if (!Number.isSafeInteger(page) || page < 0) throw new LearnUsError('PARSE_ERROR');
    return readResponse(await getText(context,`${ORIGIN}/mod/ubboard/view.php?id=${id(moduleId)}${page ? `&page=${page}` : ''}`));
  }
  async getArticle(context: BrowserContext, moduleId: string, articleId: string): Promise<string> {
    return readResponse(await getText(context,`${ORIGIN}/mod/ubboard/article.php?id=${id(moduleId)}&bwid=${id(articleId)}`));
  }
  async getNotificationHtml(context: BrowserContext, sesskey: string | undefined): Promise<string | undefined> {
    if (!sesskey) throw new LearnUsError('SESSION_EXPIRED');
    // This class has no generic action method: state-changing notification actions cannot be selected.
    const text = await readApiResponse(await context.request.post(`${ORIGIN}/theme/coursemosv2/action.php`,{
      form:{type:'userInfoNotifications',sesskey},timeout:30000,
      headers:{Origin:ORIGIN,Referer:`${ORIGIN}/`,'X-Requested-With':'XMLHttpRequest'},
    }));
    if (/^\s*</.test(text)) return text;
    let payload: unknown;
    try { payload = JSON.parse(text); } catch { return; }
    if (typeof payload === 'string') return payload;
    const data = record(payload), error = record(data.exception).errorcode ?? data.errorcode;
    if (['invalidsesskey','requireloginerror','notloggedin','servicerequireslogin'].includes(String(error)) || [401,'401'].includes(data.code as string | number)) throw new LearnUsError('SESSION_EXPIRED');
    if (error || data.error || (data.code !== undefined && String(data.code) !== '100')) throw new LearnUsError('ENDPOINT_UNAVAILABLE');
    return typeof data.html === 'string' ? data.html : undefined;
  }
}
