import { it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { load } from 'cheerio';
import { EnvironmentCredentialProvider } from '../src/auth/CredentialProvider.js';
import { PlaywrightAuthManager } from '../src/auth/PlaywrightAuthManager.js';
import { LearnUsClient } from '../src/client/LearnUsClient.js';
import { createServer } from '../src/tools/index.js';
import { authenticatedHtml } from '../src/parser/session.js';
import { ORIGIN, localUrl } from '../src/parser/dashboard.js';
import { checkIntegration, integrationFailure, mcpError } from './support/integration.js';
import type { Course } from '../src/models/Course.js';
import type { Activity } from '../src/models/Activity.js';
import type { Assignment } from '../src/models/Assignment.js';
import type { UpcomingResult } from '../src/models/CalendarEvent.js';
import { record } from '../src/client/MoodleAjaxClient.js';
const enabled = process.env.LEARNUS_INTEGRATION === '1' && !!process.env.LEARNUS_ID && !!process.env.LEARNUS_PASSWORD;

// One sequential test deliberately gates course verification on all M2 session checks.
it.skipIf(!enabled)('M2/M3/M4: real MCP sessions, assignments and upcoming API', async () => {
  let phase = 'setup', checkpoint = 'setup', credentialReads = 0, loginPosts = 0;
  const check = (ok: boolean, label: string) => { checkpoint = label; checkIntegration(ok,label); };
  const environment = new EnvironmentCredentialProvider();
  const auth = new PlaywrightAuthManager({getCredentials:async () => { credentialReads++; return environment.getCredentials(); }});
  const server = createServer(new LearnUsClient(auth,{cacheEnabled:false}));
  const mcp = new Client({name:'learnus-integration',version:'1'});
  const [a,b] = InMemoryTransport.createLinkedPair();
  const call = async (name: string, args = {}) => {
    const response = await mcp.callTool({name,arguments:args},undefined,{timeout:120000});
    checkpoint = name;
    if (response.isError) throw mcpError((response.content as {text?:string}[])?.[0]?.text);
    const blocks = response.content as {type:string;text?:string}[];
    check(Array.isArray(blocks) && blocks[0]?.type === 'text','tool_content');
    return JSON.parse(blocks[0].text!);
  };
  const courses = async (): Promise<Course[]> => {
    const result = await call('learnus_list_courses');
    check(Array.isArray(result.courses) && result.courses.length > 0,'nonempty_courses');
    check(result.courses.every((c: Course) => Number.isSafeInteger(c.id) && c.id > 0 && c.url === `${ORIGIN}/course/view.php?id=${c.id}`),'course_schema');
    return result.courses;
  };
  try {
    await server.connect(a); await mcp.connect(b);
    const context = await auth.session.getContext();
    context.on('request', request => {
      const url = new URL(request.url());
      if (url.origin === 'https://infra.yonsei.ac.kr' && url.pathname === '/sso/PmSSOAuthService' && request.method() === 'POST') loginPosts++;
    });
    phase = 'initial_courses';
    const first = await courses();
    check(auth.session.generation === 1 && credentialReads === 1 && loginPosts === 1,'one_initial_login');

    phase = 'same_process_reuse';
    await courses();
    check(auth.session.generation === 1 && credentialReads === 1 && loginPosts === 1,'no_second_login');
    check(await auth.session.getContext() === context,'same_context');

    phase = 'expired_request_retry';
    const ensure = auth.ensureAuthenticated.bind(auth);
    const get = context.request.get.bind(context.request);
    let armed = true, afterExpiry = false, retryCalls = 0, httpReads = 0, expiredResponses = 0;
    // Expire *after* the successful preflight so the original HTTP request really fails.
    const ensureSpy = vi.spyOn(auth,'ensureAuthenticated').mockImplementation(async generation => {
      if (generation !== undefined) retryCalls++;
      await ensure(generation);
      if (armed) { armed = false; await context.clearCookies(); afterExpiry = true; }
    });
    const getSpy = vi.spyOn(context.request,'get').mockImplementation(async (...args) => {
      const response = await get(...args); // Real server response, never fabricated.
      if (afterExpiry) {
        httpReads++;
        if (!authenticatedHtml(await response.text(), response.url())) expiredResponses++;
      }
      return response;
    });
    try {
      await courses();
      check(retryCalls === 1 && expiredResponses === 1,'one_expired_response_one_retry');
      // Expired original GET + post-login verification GET + retried original GET.
      check(httpReads === 3,'exact_http_retry_budget');
      check(auth.session.generation === 2 && credentialReads === 2 && loginPosts === 2,'one_relogin');
    } finally { ensureSpy.mockRestore(); getSpy.mockRestore(); }

    phase = 'three_concurrent_requests';
    await context.clearCookies();
    // All three MCP calls share the same server/client/auth/context in this process.
    const concurrent = await Promise.allSettled([courses(),courses(),courses()]);
    check(concurrent.every(r => r.status === 'fulfilled'),'all_three_succeeded');
    check(auth.session.generation === 3 && credentialReads === 3 && loginPosts === 3,'single_flight_one_login');
    check(await auth.session.getContext() === context,'context_preserved_after_expiry');

    phase = 'course_html_after_m2';
    const course = await call('learnus_get_course',{courseId:String(first[0].id)}) as {name?:string;activities:Activity[]};
    check(Array.isArray(course.activities),'activity_array');
    // Read only the course page; never open/start individual activities.
    const response = await context.request.get(`${ORIGIN}/course/view.php?id=${first[0].id}`);
    try {
      const html = await response.text();
      check(response.ok() && authenticatedHtml(html,response.url()),'authenticated_course_html');
      const $ = load(html);
      const expected = new Set<number>();
      $('.activity').each((_, element) => {
        const container = $(element);
        let id = Number(container.attr('id')?.match(/^module-(\d+)$/)?.[1]);
        if (!id) container.find('a[href]').each((_, link) => {
          const url = localUrl($(link).attr('href') || '');
          if (/^\/mod\/[^/]+\/view\.php$/.test(url?.pathname || '')) id ||= Number(url?.searchParams.get('id'));
        });
        if (Number.isSafeInteger(id) && id > 0) expected.add(id);
      });
      check(expected.size > 0,'course_has_activity_containers');
      check(course.activities.length === expected.size,'one_result_per_module');
      check([...expected].every(id => course.activities.some(a => a.id === id)),'all_module_ids_preserved');
      check(course.activities.every(a => ['assign','quiz','ubboard','vod','unknown'].includes(a.type)),'activity_types');
    } finally { await response.dispose(); }
    check(auth.session.generation === 3 && loginPosts === 3,'course_reuses_session');

    phase = 'm3_assignment_discovery';
    let assignmentActivity: Activity | undefined;
    for (const enrolled of first) {
      const listed = await call('learnus_list_activities',{courseId:String(enrolled.id)}) as {activities:Activity[]};
      check(Array.isArray(listed.activities),'listed_activity_array');
      assignmentActivity = listed.activities.find(activity => activity.type === 'assign' && Number.isSafeInteger(activity.id) && activity.id! > 0);
      if (assignmentActivity) break;
    }
    // A course with no assignments must not silently pass the real-detail check.
    check(!!assignmentActivity,'assignment_activity_found');
    phase = 'm3_assignment_details';
    const assignment = await call('learnus_get_assignment',{cmid:assignmentActivity!.id}) as Assignment;
    check(assignment.cmid === assignmentActivity!.id,'assignment_identity');
    check(assignment.url === `${ORIGIN}/mod/assign/view.php?id=${assignmentActivity!.id}`,'assignment_url');
    check(Array.isArray(assignment.extraFields) && Array.isArray(assignment.warnings),'assignment_schema');
    check([assignment.submissionStatus,assignment.gradingStatus,assignment.dueDate].some(value => typeof value === 'string' && value.length > 0),'assignment_status_observed');
    check(assignment.warnings.length === 0,'assignment_status_parsed');
    check(auth.session.generation === 3 && credentialReads === 3 && loginPosts === 3,'assignment_reuses_session');
    check(await auth.session.getContext() === context,'assignment_same_context');

    phase = 'm4_upcoming_api';
    const from = new Date(Date.now()-7*86400000).toISOString();
    const to = new Date(Date.now()+60*86400000).toISOString();
    const currentGeneration = auth.session.generation, currentLogins = loginPosts;
    let validApiPages = 0, invalidKeySeen = false;
    const realPost = context.request.post.bind(context.request);
    const postSpy = vi.spyOn(context.request,'post').mockImplementation(async (...args) => {
      const response = await realPost(...args);
      // Inspect in memory; never expose response contents, request args or URLs.
      const payload: unknown = await response.json().catch(() => null);
      const envelope = record(Array.isArray(payload) ? payload[0] : payload);
      if (Array.isArray(record(envelope.data).events)) validApiPages++;
      if ((record(envelope.exception).errorcode ?? envelope.errorcode) === 'invalidsesskey') invalidKeySeen = true;
      return response;
    });
    try {
      const upcoming = await call('learnus_upcoming',{from,to,limit:5}) as UpcomingResult;
      check(validApiPages > 0,'actual_action_events_api_shape');
      check(Array.isArray(upcoming.events) && upcoming.events.length <= 5,'upcoming_limit');
      check(upcoming.events.every(event => event.timesort*1000 >= Date.parse(from) && event.timesort*1000 <= Date.parse(to)),'upcoming_date_range');
      check(upcoming.warnings.length === 0,'upcoming_parser_warnings');
      const filtered = await call('learnus_upcoming',{from,to,limit:5,courseId:String(first[0].id)}) as UpcomingResult;
      check(filtered.events.every(event=>event.courseId === first[0].id),'upcoming_course_filter');
      check(auth.session.generation === currentGeneration && loginPosts === currentLogins,'upcoming_reuses_session');

      phase = 'm4_expired_sesskey';
      const realEnsure = auth.ensureAuthenticated.bind(auth);
      let inject = true, retryCount = 0;
      const ensureSpy = vi.spyOn(auth,'ensureAuthenticated').mockImplementation(async generation => {
        if (generation !== undefined) retryCount++;
        await realEnsure(generation);
        if (inject) { inject = false; auth.session.sesskey = 'invalid-test-key'; }
      });
      try {
        await call('learnus_upcoming',{from,to,limit:5});
        check(invalidKeySeen,'actual_invalidsesskey_response');
        check(retryCount === 1 && auth.session.generation === currentGeneration+1,'ajax_single_reauth_retry');
        check(await auth.session.getContext() === context,'ajax_context_preserved');
      } finally { ensureSpy.mockRestore(); }
    } finally { postSpy.mockRestore(); }
  } catch (error) {
    // Only static phase/check names and allowlisted auth diagnostics; no received values/stacks.
    throw new Error(integrationFailure('INTEGRATION',`${phase}/${checkpoint}`,error,auth.loginDiagnostics));
  } finally {
    await mcp.close().catch(() => undefined);
    await server.close().catch(() => undefined);
    await auth.close();
  }
}, 480000);
