// Evaluation-only stdio entrypoint. It exposes aggregate counters, never response bodies.
delete process.env.DEBUG;delete process.env.PWDEBUG;delete process.env.NODE_DEBUG;
const {StdioServerTransport}=await import('@modelcontextprotocol/sdk/server/stdio.js');
const {z}=await import('zod');
const {EnvironmentCredentialProvider}=await import('../dist/auth/CredentialProvider.js');
const {PlaywrightAuthManager}=await import('../dist/auth/PlaywrightAuthManager.js');
const {LearnUsClient}=await import('../dist/client/LearnUsClient.js');
const {createServer}=await import('../dist/tools/index.js');

const marker='<script>M.cfg={sesskey:"synthetic"}</script><a href="/login/logout.php">Logout</a>';
const dashboard=marker+'<main><a href="/course/view.php?id=7">Synthetic course</a></main>';
const course=marker+`<h1 class="coursename">Synthetic course (TST1000.01-00) 2026-2학기</h1><div class="course-content">
<li class="section"><h3 class="sectionname">1주차 [9월 1일 - 9월 30일]</h3><ul>
<li class="activity modtype_assign" id="module-11"><a href="/mod/assign/view.php?id=11"><span class="instancename">Synthetic assignment</span></a></li>
<li class="activity modtype_vod" id="module-12"><a href="/mod/vod/view.php?id=12"><span class="instancename">Synthetic video</span></a><span class="autocompletion"><img src="/completion-auto-n" title="Incomplete"></span></li>
<li class="activity modtype_ubfile" id="module-13"><a href="/mod/ubfile/view.php?id=13"><span class="instancename">Synthetic file</span></a></li></ul></li>
<section class="course-article"><header class="course-article-header"><h5>Announcements</h5></header><div class="actions"><a href="/mod/ubboard/view.php?id=10">More</a></div><div class="article-list-item"><a href="/mod/ubboard/article.php?id=10&amp;bwid=21"><span class="article-subject">Synthetic announcement</span></a><span class="article-date">2026-09-04</span></div></section></div>`;
const assignment=marker+'<nav aria-label="breadcrumb"><a href="/course/view.php?id=7">Course</a></nav><main><h2>Synthetic assignment</h2><div class="assignmentintro"><p>'+('Synthetic details. '.repeat(40))+'</p><a target="_blank" href="/pluginfile.php/123/mod_assign/introattachment/0/synthetic.pdf?forcedownload=1">Synthetic attachment</a></div><table><tr><th>Due date</th><td>2026-09-12 23:59</td></tr><tr><th>Submission status</th><td>Not submitted</td></tr></table></main>';
const board='<main><article><a href="/mod/ubboard/article.php?id=10&amp;bwid=21">Synthetic announcement</a><time datetime="2026-09-04">Date</time></article></main>';
const article=marker+'<main><h2>Synthetic announcement</h2><div class="article-content"><p>'+('Synthetic announcement detail. '.repeat(20))+'</p></div><time datetime="2026-09-04">Date</time></main>';
const notifications='<div class="media-lists"><a class="media unread" data-id="31" href="/mod/assign/view.php?id=11"><div class="media-body"><div class="text-title">Synthetic notification</div><div class="text-truncate">'+('Synthetic notification text. '.repeat(16))+'</div><small>2026-09-05 10:00</small></div></a></div>';
const completion='<table class="user_progress"><tr><th>Week</th><th>Content</th><th>Length</th><th>Position</th><th>Progress</th></tr><tr><td>1</td><td><a href="/mod/vod/view.php?id=12">Synthetic video</a></td><td>10:00</td><td>05:00<button data-modname="vod" data-modid="901"></button></td><td>50%</td></tr></table>';
const response=(url,body,status=200)=>({url:()=>url,status:()=>status,ok:()=>status<400,text:async()=>body,dispose:async()=>{}});
const networkDelay=()=>new Promise(resolve=>setTimeout(resolve,15));

function syntheticAuth(){
  const auth=new PlaywrightAuthManager({getCredentials:async()=>{throw new Error('unused');}});auth.session.sesskey='synthetic';auth.ensureAuthenticated=async()=>{};
  const request={
    get:async url=>{await networkDelay();const path=new URL(url).pathname;return response(url,path==='/'?dashboard:path==='/course/view.php'?course:path==='/mod/assign/view.php'?assignment:path==='/report/ubcompletion/progress.php'?completion:path==='/mod/ubboard/view.php'?board:path==='/mod/ubboard/article.php'?article:marker+'<main></main>');},
    post:async(url,options)=>{await networkDelay();return response(url,options?.form?JSON.stringify({code:'100',html:notifications}):JSON.stringify([{error:false,data:{events:[{id:41,timesort:1788278400,course:{id:7},name:'Synthetic event',eventtype:'due'}]}}]));},
  };
  auth.session.getContext=async()=>({request});return auth;
}

const integration=process.env.LEARNUS_EVALUATION_MODE==='integration';
// The synthetic fixture is a September 2026 course; keep its week and payload stable.
if(!integration){const NativeDate=Date;globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:['2026-09-12T00:00:00Z']));}static now(){return NativeDate.parse('2026-09-12T00:00:00Z');}};}
const auth=integration?new PlaywrightAuthManager(new EnvironmentCredentialProvider()):syntheticAuth();
const client=new LearnUsClient(auth),server=createServer(client);
server.registerTool('__learnus_evaluation_control',{description:'Evaluation-only aggregate counters.',inputSchema:{action:z.enum(['reset','snapshot']),clearCaches:z.boolean().optional()},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},({action,clearCaches})=>{
  if(action==='reset')client.resetEvaluationState(clearCaches);return {content:[{type:'text',text:JSON.stringify(client.performanceMetrics())}]};
});
let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;await auth.close();await server.close();};
process.on('SIGINT',()=>{void stop();});process.on('SIGTERM',()=>{void stop();});process.stdin.on('end',()=>{void stop();});
try{if(integration)await auth.ensureAuthenticated();await server.connect(new StdioServerTransport());}
catch{process.stderr.write('EVALUATION_SERVER_START_FAILED\n');await stop();process.exitCode=1;}
