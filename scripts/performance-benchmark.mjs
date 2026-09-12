import { LearnUsClient } from '../dist/client/LearnUsClient.js';
import { PlaywrightAuthManager } from '../dist/auth/PlaywrightAuthManager.js';

const marker='<script>M.cfg={sesskey:"synthetic"}</script><a href="/login/logout.php">Logout</a>';
const dashboard=marker+'<a href="/course/view.php?id=7">Synthetic</a>';
const course=marker+'<main class="course-content"><li class="activity modtype_assign" id="module-11"><a href="/mod/assign/view.php?id=11">Synthetic</a></li><section class="course-article"><header class="course-article-header"><h5>Announcements</h5></header><div class="article-list-item"><a href="/mod/ubboard/article.php?id=10&amp;bwid=21"><span class="article-subject">Synthetic</span></a><span class="article-date">2026-09-04</span></div></section></main>';
const assignment=marker+'<main><h1>Synthetic</h1><table><tr><th>Due date</th><td>2026-09-03</td></tr></table></main>';
function client(cacheEnabled){
  const auth=new PlaywrightAuthManager({getCredentials:async()=>{throw new Error('unused');}});auth.session.sesskey='synthetic';auth.ensureAuthenticated=async()=>{};
  const response=(url,body)=>({url:()=>url,status:()=>200,ok:()=>true,text:async()=>body,dispose:async()=>{}});
  const request={get:async url=>response(url,new URL(url).pathname==='/'?dashboard:new URL(url).pathname==='/course/view.php'?course:assignment),post:async url=>response(url,JSON.stringify([{error:false,data:{events:[]}}]))};
  auth.session.getContext=async()=>({request});return new LearnUsClient(auth,{cacheEnabled});
}
async function timed(instance,label,work){instance.resetPerformanceMetrics();const start=performance.now();await work();return {label,elapsedMs:Number((performance.now()-start).toFixed(2)),...instance.performanceMetrics()};}
for(const [mode,enabled] of [['baseline-no-cache',false],['optimized',true]]){
  const overview=client(enabled),courseClient=client(enabled),concurrent=client(enabled);
  const rows=[];
  rows.push(await timed(overview,`${mode}:overview-cold`,()=>overview.getOverview({from:'2026-09-01',to:'2026-09-07',maxItemsPerSection:1})));
  rows.push(await timed(overview,`${mode}:overview-warm`,()=>overview.getOverview({from:'2026-09-01',to:'2026-09-07',maxItemsPerSection:1})));
  rows.push(await timed(courseClient,`${mode}:get-course-twice`,async()=>{await courseClient.getCourse(7);await courseClient.getCourse(7);}));
  rows.push(await timed(concurrent,`${mode}:get-course-concurrent-3`,()=>Promise.all([concurrent.getCourse(7),concurrent.getCourse(7),concurrent.getCourse(7)])));
  for(const row of rows)console.log(JSON.stringify(row));
}
