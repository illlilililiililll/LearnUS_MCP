import {it} from 'vitest';
import {EnvironmentCredentialProvider} from '../src/auth/CredentialProvider.js';
import {PlaywrightAuthManager} from '../src/auth/PlaywrightAuthManager.js';
import {LearnUsClient} from '../src/client/LearnUsClient.js';
import {load} from 'cheerio';
const enabled=process.env.LEARNUS_INTEGRATION==='1'&&!!process.env.LEARNUS_ID&&!!process.env.LEARNUS_PASSWORD;
it.skipIf(!enabled)('M8.6 validates optional real completion and video evidence without logging content',async()=>{
  const auth=new PlaywrightAuthManager(new EnvironmentCredentialProvider()),client=new LearnUsClient(auth);
  try{const courses=await client.listCourses();const course=courses.courses[0];if(!course)return;
    const detail=await client.getCourse(course.id);
    const response=await (await auth.session.getContext()).request.get(`https://ys.learnus.org/course/view.php?id=${course.id}`,{timeout:30000});
    try{const $=load(await response.text());$('.activity[id]').each((_,node)=>{const cmid=Number($(node).attr('id')?.match(/^module-(\d+)$/)?.[1]);const icons=$(node).find('img').toArray().map(n=>$(n).attr('src')??'');const yes=icons.some(s=>s.includes('completion-auto-y')),no=icons.some(s=>s.includes('completion-auto-n'));if(yes!==no&&detail.activities.find(a=>a.id===cmid)?.completionState!==(yes?'complete':'incomplete'))throw Error();});}finally{await response.dispose();}
    if(!detail.activities.every(a=>['complete','incomplete','unknown','not_tracked'].includes(a.completionState??'')))throw Error();
    const overview=await client.getOverview({courseId:course.id,includeLearning:true});
    if(overview.resources?.some(r=>r.completionState==='complete'&&r.classification==='actionable'))throw Error();
    if(overview.learning?.actionable.some(v=>v.attendanceTarget!=='yes'||v.state==='completed'))throw Error();
    for(const v of [...overview.learning?.actionable??[],...overview.learning?.completed??[],...overview.learning?.unknown??[]])if(v.effectiveDueAt&&!['attendance','calendar_progress_stop','instructor'].includes(v.effectiveDueSource??''))throw Error();
    // Accounts without tracked activities or calendar deadlines do not fabricate evidence.
  }catch{throw new Error('M86_INTEGRATION_CHECK_FAILED');}finally{await auth.close();}
},420000);
