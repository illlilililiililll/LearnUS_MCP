import { it,vi } from 'vitest';
import { EnvironmentCredentialProvider } from '../src/auth/CredentialProvider.js';
import { PlaywrightAuthManager } from '../src/auth/PlaywrightAuthManager.js';
import { LearnUsClient } from '../src/client/LearnUsClient.js';
import { checkIntegration as check, integrationFailure } from './support/integration.js';
const enabled=process.env.LEARNUS_INTEGRATION==='1'&&!!process.env.LEARNUS_ID&&!!process.env.LEARNUS_PASSWORD;

it.skipIf(!enabled)('M8: reuses normalized data and retries an expired sesskey without exposing content',async()=>{
  const auth=new PlaywrightAuthManager(new EnvironmentCredentialProvider()),client=new LearnUsClient(auth);let checkpoint='setup';
  const diagnostics={courseCount:0,repeatRequests:0,cacheHits:0,overviewWarnings:0,retryCount:0};
  try{
    checkpoint='courses';const listed=await client.listCourses();diagnostics.courseCount=listed.courses.length;check(listed.courses.length>0,'course_available');
    const generation=auth.session.generation,courseId=listed.courses[0].id;client.resetPerformanceMetrics();
    checkpoint='repeat_course';await client.getCourse(courseId);await client.getCourse(courseId);const repeat=client.performanceMetrics();diagnostics.repeatRequests=repeat.networkRequestsStarted;diagnostics.cacheHits=repeat.cacheHits;
    check(repeat.networkRequestsStarted===1&&repeat.cacheHits===1,'repeat_course_cached');check(auth.session.generation===generation,'same_session');
    checkpoint='overview';const first=await client.getOverview({maxItemsPerSection:1}),second=await client.getOverview({maxItemsPerSection:1});diagnostics.overviewWarnings=second.warnings.length;
    check(Array.isArray(first.upcoming)&&Array.isArray(first.assignments)&&Array.isArray(first.announcements),'overview_sections');
    check(Array.isArray(second.upcoming)&&Array.isArray(second.assignments)&&Array.isArray(second.announcements),'warm_overview_sections');
    checkpoint='expired_sesskey';const expiryGeneration=auth.session.generation,ensure=auth.ensureAuthenticated.bind(auth);let retries=0;
    const spy=vi.spyOn(auth,'ensureAuthenticated').mockImplementation(async expired=>{if(expired!==undefined)retries++;return ensure(expired);});
    try{
      auth.session.sesskey='invalid-test-key';const from=new Date(Date.now()+86400000).toISOString(),to=new Date(Date.now()+2*86400000).toISOString();
      await client.upcoming({from,to,limit:1});diagnostics.retryCount=retries;check(retries===1&&auth.session.generation===expiryGeneration+1,'single_retry');
    }finally{spy.mockRestore();}
  }catch(error){throw new Error(integrationFailure('M8',checkpoint,error,diagnostics));}
  finally{await auth.close();}
},420000);
