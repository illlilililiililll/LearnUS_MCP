import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const root=new URL('../',import.meta.url),reportUrl=new URL('../docs/m8-performance-evaluation.md',import.meta.url);
const text=response=>{try{return JSON.parse(response.content?.find(block=>block.type==='text')?.text||'{}');}catch{throw new Error('NON_JSON_RESULT');}};
const size=value=>Buffer.byteLength(JSON.stringify(value));
const sectionKeys=['courses','upcoming','assignments','announcements','notifications'];
function counts(value){
  const warnings=Array.isArray(value?.warnings)?value.warnings:[],arrays=['courses','activities','events','items','requiredIncomplete'].map(key=>value?.[key]).filter(Array.isArray);
  const sections=Object.fromEntries(sectionKeys.map(key=>[key,Array.isArray(value?.[key])?value[key].length:0]));
  return {warningsCount:warnings.length,itemCount:arrays[0]?.length??sectionKeys.reduce((sum,key)=>sum+sections[key],0),sectionCounts:sections};
}
function payloadAnalysis(value){
  const occurrences={courseId:[],courseName:[],courseUrl:[],module:[],warning:[],url:[]},empty={count:0},long={count:0,bytes:0};
  const walk=(item,path=[])=>{
    if(item===null||item===''||(Array.isArray(item)&&!item.length)){empty.count++;return;}
    if(Array.isArray(item)){item.forEach((child,index)=>walk(child,[...path,String(index)]));return;}
    if(!item||typeof item!=='object')return;
    for(const [key,child] of Object.entries(item)){
      if(['text','content','description'].includes(key)&&typeof child==='string'&&child.length>=160){long.count++;long.bytes+=size(child);}
      if(key==='courseId'&&(typeof child==='string'||typeof child==='number'))occurrences.courseId.push(String(child));
      if(key==='name'&&path.at(-2)==='courses'&&typeof child==='string')occurrences.courseName.push(child);
      if(key==='url'&&typeof child==='string'){occurrences.url.push(child);if(child.includes('/course/view.php'))occurrences.courseUrl.push(child);}
      if(['module','cmid'].includes(key)&&(typeof child==='string'||typeof child==='number'))occurrences.module.push(String(child));
      if(key==='warnings'&&Array.isArray(child))occurrences.warning.push(...child.filter(value=>typeof value==='string'));
      walk(child,[...path,key]);
    }
  };walk(value);
  const repeat=values=>{const seen=new Map();for(const value of values)seen.set(value,(seen.get(value)||0)+1);let count=0,bytes=0;for(const [value,n] of seen)if(n>1){count+=n-1;bytes+=(n-1)*size(value);}return {occurrences:count,estimatedBytes:bytes};};
  const urlBytes=occurrences.url.reduce((sum,value)=>sum+size(value),0),origin='https://ys.learnus.org';
  return {repeatedCourseIds:repeat(occurrences.courseId),repeatedCourseNames:repeat(occurrences.courseName),repeatedCourseUrls:repeat(occurrences.courseUrl),repeatedModuleMetadata:repeat(occurrences.module),repeatedWarnings:repeat(occurrences.warning),emptyOptionalFields:empty.count,longTextFields:long,urlCount:occurrences.url.length,urlBytes,estimatedRepeatedUrlOriginBytes:Math.max(0,occurrences.url.length-1)*size(origin)};
}
async function open(mode){
  const env={...process.env,LEARNUS_EVALUATION_MODE:mode};for(const key of ['DEBUG','PWDEBUG','NODE_DEBUG'])delete env[key];if(mode==='synthetic')for(const key of ['LEARNUS_ID','LEARNUS_PASSWORD','LEARNUS_INTEGRATION'])delete env[key];
  const transport=new StdioClientTransport({command:process.execPath,args:['scripts/evaluation-server.mjs'],cwd:fileURLToPath(root),env,stderr:'pipe'}),client=new Client({name:'learnus-performance-evaluation',version:'1'});
  await client.connect(transport);return {client,close:()=>client.close()};
}
async function control(client,action,clearCaches=false){return text(await client.callTool({name:'__learnus_evaluation_control',arguments:{action,clearCaches}}));}
async function call(client,name,args){return client.callTool({name,arguments:args},undefined,{timeout:300000});}
async function measure(client,toolName,args,variant,{clearCaches=false,logicalCalls=1}={}){
  await control(client,'reset',clearCaches);const started=performance.now();
  const responses=await Promise.all(Array.from({length:logicalCalls},()=>call(client,toolName,args)));const elapsedMs=Number((performance.now()-started).toFixed(2)),metrics=await control(client,'snapshot');
  const value=text(responses[0]),summary=counts(value);
  const sectionBytes=toolName==='learnus_get_overview'?Object.fromEntries(sectionKeys.map(key=>[key,size(value?.[key]??[])])):undefined;
  if(sectionBytes){sectionBytes.warnings=size(value?.warnings??[]);sectionBytes.other=Math.max(0,size(value)-Object.values(sectionBytes).reduce((sum,bytes)=>sum+bytes,0));}
  return {toolName,variant,status:responses[0].isError?'ERROR':'OK',logicalCalls,elapsedMs,responseBytes:size(responses[0]),bodyBytes:size(value),totalResponseBytes:responses.reduce((sum,response)=>sum+size(response),0),networkRequests:metrics.networkRequestsStarted,cacheHits:metrics.cacheHits,cacheMisses:metrics.cacheMisses,coalescedRequests:metrics.coalescedRequests,peakConcurrentRequests:metrics.peakConcurrentRequests,...summary,analysis:toolName==='learnus_get_overview'?payloadAnalysis(value):undefined,sectionBytes};
}
async function resolveInputs(client){
  const listed=text(await call(client,'learnus_list_courses',{})),courses=Array.isArray(listed.courses)?listed.courses:[],courseId=String(courses.find(course=>Number.isSafeInteger(course.id)&&course.id>0)?.id||'')||undefined;
  let cmid;
  for(const course of courses.slice(0,10)){const activities=text(await call(client,'learnus_list_activities',{courseId:String(course.id)})).activities;if(Array.isArray(activities)){cmid=activities.find(item=>item.type==='assign'&&Number.isSafeInteger(item.id))?.id;if(cmid)break;}}
  return {courseId,cmid};
}
const dates=()=>{const now=new Date(),from=new Date(now.getTime()-7*86400000).toISOString().slice(0,10),to=new Date(now.getTime()+30*86400000).toISOString().slice(0,10);return {from,to};};
async function evaluate(mode){
  const session=await open(mode),rows=[],overview=[];try{
    const ids=await resolveInputs(session.client),range=mode==='synthetic'?{from:'2026-09-03',to:'2026-10-10'}:dates();
    const tools=[
      ['learnus_list_courses',{}],
      ['learnus_get_course',ids.courseId&&{courseId:ids.courseId}],
      ['learnus_list_activities',ids.courseId&&{courseId:ids.courseId}],
      ['learnus_get_assignment',ids.cmid&&{cmid:ids.cmid}],
      ['learnus_upcoming',{...range,limit:10}],
      ['learnus_list_announcements',ids.courseId&&{courseId:String(ids.courseId),limit:10}],
      ['learnus_list_notifications',{limit:10}],
      ['learnus_get_overview',{...range,maxItemsPerSection:10}],
      ['learnus_get_weekly_tasks',{...range}],
      ['learnus_list_videos',ids.courseId&&{courseId:String(ids.courseId)}],
      ['learnus_get_video_attendance',ids.courseId&&{courseId:String(ids.courseId)}],
      ['learnus_get_learning_overview',ids.courseId&&{courseId:String(ids.courseId),week:'current'}],
      ['learnus_list_files',ids.courseId&&{courseId:String(ids.courseId),scope:'course'}],
    ];
    for(const [name,args] of tools){if(!args){rows.push({toolName:name,variant:'cold',status:'SKIPPED_NO_INPUT'});continue;}rows.push(await measure(session.client,name,args,'cold',{clearCaches:true}));rows.push(await measure(session.client,name,args,'warm'));}
    rows.push(await measure(session.client,'learnus_get_course',{courseId:ids.courseId},'concurrent-3',{clearCaches:true,logicalCalls:3}));
    rows.push(await measure(session.client,'learnus_get_overview',{...range,maxItemsPerSection:10},'concurrent-3',{clearCaches:true,logicalCalls:3}));
    rows.push(await measure(session.client,'learnus_get_overview',{...range,includeLearning:true},'weekly-equivalent-cold',{clearCaches:true}));
    rows.push(await measure(session.client,'learnus_get_weekly_tasks',{...range},'after-equivalent-overview'));
    rows.push(await measure(session.client,'learnus_get_weekly_tasks',{...range},'concurrent-3',{clearCaches:true,logicalCalls:3}));
    if(mode==='synthetic'){
      const weekly=rows.find(row=>row.toolName==='learnus_get_weekly_tasks'&&row.variant==='cold');
      const equivalent=rows.find(row=>row.variant==='weekly-equivalent-cold');
      if(weekly.status!=='OK'||weekly.networkRequests!==equivalent.networkRequests||rows.some(row=>row.toolName==='learnus_get_weekly_tasks'&&['warm','after-equivalent-overview'].includes(row.variant)&&row.networkRequests!==0))throw new Error('WEEKLY_EVALUATION_REGRESSION');
    }
    for(const [variant,args] of [
      ['default',{...range,maxItemsPerSection:10}],
      ['courses-upcoming',{...range,includeCourses:true,includeAssignments:false,includeAnnouncements:false,maxItemsPerSection:10}],
      ['upcoming-assignments-announcements',{...range,includeUpcoming:true,includeAssignments:true,includeAnnouncements:true,maxItemsPerSection:10}],
      ['with-notifications',{...range,includeNotifications:true,maxItemsPerSection:10}],
    ])overview.push(await measure(session.client,'learnus_get_overview',args,variant,{clearCaches:true}));
    return {mode,rows,overview};
  }finally{await session.close();}
}
const cell=value=>value===undefined?'—':String(value),table=(headers,rows)=>`| ${headers.join(' | ')} |\n| ${headers.map(()=> '---').join(' | ')} |\n${rows.map(row=>`| ${row.map(cell).join(' | ')} |`).join('\n')}`;
function modeReport(result){
  const measured=result.rows.filter(row=>row.status!=='SKIPPED_NO_INPUT'),pairs=new Map();for(const row of measured)if(['cold','warm'].includes(row.variant)){const pair=pairs.get(row.toolName)||{};pair[row.variant]=row;pairs.set(row.toolName,pair);}
  const concurrent=measured.filter(row=>row.variant==='concurrent-3'),overview=result.overview,representative=overview.find(row=>row.variant==='with-notifications')||overview[0];
  const coldWarm=table(['Tool','Cold req','Warm req','Cold ms','Warm ms','Cold bytes','Warm bytes','Warm cache hits'],[...pairs].map(([name,pair])=>[name,pair.cold?.networkRequests,pair.warm?.networkRequests,pair.cold?.elapsedMs,pair.warm?.elapsedMs,pair.cold?.responseBytes,pair.warm?.responseBytes,pair.warm?.cacheHits]));
  const all=table(['Tool','Phase','Status','Requests','Cache hit/miss','Coalesced','Peak','Bytes','Warnings','Items'],result.rows.map(row=>[row.toolName,row.variant,row.status,row.networkRequests, row.cacheHits===undefined?'—':`${row.cacheHits}/${row.cacheMisses}`,row.coalescedRequests,row.peakConcurrentRequests,row.responseBytes,row.warningsCount,row.itemCount]));
  const concurrency=table(['Tool','Logical calls','Network requests','Coalesced','Peak concurrency','Response bytes/call'],concurrent.map(row=>[row.toolName,row.logicalCalls,row.networkRequests,row.coalescedRequests,row.peakConcurrentRequests,row.responseBytes]));
  const overviewTable=table(['Combination','Bytes','Requests','Cache hits','Elapsed ms','courses/upcoming/assignments/announcements/notifications'],overview.map(row=>[row.variant,row.responseBytes,row.networkRequests,row.cacheHits,row.elapsedMs,sectionKeys.map(key=>row.sectionCounts[key]).join('/') ]));
  const contributions=table(['Combination','MCP bytes','Result bytes',...sectionKeys,'warnings','other'],overview.map(row=>[row.variant,row.responseBytes,row.bodyBytes,...sectionKeys.map(key=>row.sectionBytes[key]),row.sectionBytes.warnings,row.sectionBytes.other]));
  const a=representative.analysis;
  const duplicates=table(['Signal','Occurrences beyond first','Estimated bytes'],[
    ['courseId',a.repeatedCourseIds.occurrences,a.repeatedCourseIds.estimatedBytes],['course name',a.repeatedCourseNames.occurrences,a.repeatedCourseNames.estimatedBytes],['course URL',a.repeatedCourseUrls.occurrences,a.repeatedCourseUrls.estimatedBytes],['activity/module metadata',a.repeatedModuleMetadata.occurrences,a.repeatedModuleMetadata.estimatedBytes],['warning strings',a.repeatedWarnings.occurrences,a.repeatedWarnings.estimatedBytes],['shared URL origin',Math.max(0,a.urlCount-1),a.estimatedRepeatedUrlOriginBytes],['null/empty values',a.emptyOptionalFields,'structural count'],['long text fields',a.longTextFields.count,a.longTextFields.bytes],
  ]);
  return {all,coldWarm,concurrency,overviewTable,contributions,duplicates,representative};
}
async function main(){
const synthetic=await evaluate('synthetic');let integration;
if(process.env.LEARNUS_INTEGRATION==='1'&&process.env.LEARNUS_ID&&process.env.LEARNUS_PASSWORD)integration=await evaluate('integration');
const syn=modeReport(synthetic),int=integration&&modeReport(integration),largest=sectionKeys.map(key=>[key,syn.representative.sectionBytes[key]]).sort((a,b)=>b[1]-a[1])[0],analysis=syn.representative.analysis;
const report=`# M8 Performance Evaluation

## Environment

- Runtime: Node ${process.version}, ${process.platform}/${process.arch}
- Transport: MCP SDK client → spawned stdio server → production \`createServer\` Tool handlers
- Synthetic evaluation: RUN
- Integration evaluation: ${integration?'RUN':'NOT RUN'}
- Download evaluation: excluded because \`learnus_download_file\` creates a local file
- Auth login/probe requests are excluded from M8 data-request counters. Integration startup authenticates before timed calls.

## Methodology

Each cold measurement clears normalized in-memory caches but retains the authenticated process session. Each warm measurement repeats the same Tool and arguments. Elapsed time covers the MCP \`tools/call\` round trip. \`responseBytes\` is the UTF-8 size of the serialized MCP Tool response envelope. Tool results are analyzed in memory and are never written to this report.

The \`cacheHits/cacheMisses\` counters describe the M8 general TTL cache. Existing feature-specific course/video, completion, and file caches can reduce warm network requests without incrementing those two counters.

## Synthetic Results

${syn.all}

## Integration Results

${integration?int.all:'Integration evaluation: NOT RUN'}

## Cold vs Warm

${syn.coldWarm}

${integration?'### Integration\n\n'+int.coldWarm:''}

## Coalescing

${syn.concurrency}

Identical concurrent calls share normalized cache flights or canonical data-request flights. The identity contains session generation, method, normalized path, sorted query, and stable body while excluding sesskey/token values.

The three concurrent synthetic overview calls used ${synthetic.rows.find(row=>row.toolName==='learnus_get_overview'&&row.variant==='concurrent-3')?.networkRequests??'—'} network requests instead of three independent sets of underlying requests. An overview contains several distinct endpoint identities, so the target is one request per distinct underlying identity rather than one total network request.

## Overview Analysis

${syn.overviewTable}

${integration?'### Integration\n\n'+int.overviewTable:''}

## Payload Size

Section sizes are approximate serialized values. \`other\` includes the range and JSON object-key overhead; the MCP envelope is shown separately.

${syn.contributions}

Duplicate candidates for the synthetic \`with-notifications\` overview:

${syn.duplicates}

## Network Request Analysis

The warm overview should normally reuse the short source caches. A Tool whose warm row still performs network work either returned warnings that are intentionally not cached, paginated into a distinct request identity, or relies on a feature-specific refresh boundary. Authentication navigation is intentionally outside the data limiter and counters.

## M9 Candidates

These rankings are provisional because only synthetic account data was available in this run.

HIGH

- Largest overview section: \`${largest[0]}\`, currently about ${largest[1]} synthetic serialized bytes. Benchmark narrower list summaries before changing it. Expected saving: potentially 20–50% of that section. Meaning-loss risk: medium. External schema compatibility impact: high if fields are removed; keep the current schema until an opt-in compatible representation is measured.
- Repeated URL origin/path material: ${analysis.estimatedRepeatedUrlOriginBytes} estimated bytes across ${analysis.urlCount} URLs. Expected saving: up to that repeated-prefix estimate. Meaning-loss risk: low if clients can reconstruct canonical URLs. External schema compatibility impact: high, so no change is made in M8.5.

MEDIUM

- Repeated course IDs/module metadata: ${analysis.repeatedCourseIds.estimatedBytes+analysis.repeatedModuleMetadata.estimatedBytes} estimated bytes. Expected saving: small on synthetic data, potentially larger for multi-course accounts. Meaning-loss risk: medium. Compatibility impact: high for relational/dictionary conversion.
- Long notification/content text: ${analysis.longTextFields.bytes} bytes in ${analysis.longTextFields.count} long fields. Expected saving: high only when notifications are included. Meaning-loss risk: high because truncation can remove context. Compatibility impact: low if the existing overview summary cap is only tightened after real-account measurement.

LOW

- Empty optional values and repeated warnings: ${analysis.emptyOptionalFields} empty structures and ${analysis.repeatedWarnings.estimatedBytes} repeated-warning bytes. Expected saving: low. Meaning-loss risk: low. Compatibility impact: medium if omission semantics change.

## Tool Description Observations

Descriptions explicitly require LearnUs or established academic context and exclude generic personal todo routing. weekly_tasks is the primary weekly coursework entry point; overview is a configurable broad summary while individual Tools support drill-down. Auth status is diagnostic, not a prerequisite, and browser/computer control is an explicit-unsupported/challenge fallback. Informational notifications are not required tasks. These are static expectations, not observed host-model behavior.

Expected scenarios:

- “이번 주 해야 할 일 정리해줘” → do not automatically prefer LearnUs without established academic context
- “LearnUs에서 이번 주 해야 할 일 정리해줘” → \`learnus_get_weekly_tasks\`
- “런어스 이번 주 할 일 알려줘” → \`learnus_get_weekly_tasks\`
- “이번 주 강의에서 해야 할 일 정리해줘” → \`learnus_get_weekly_tasks\`
- “이번 주 출석해야 할 영상 있어?” → \`learnus_get_weekly_tasks\` or \`learnus_get_learning_overview\`
- “LearnUs 공지만 보여줘” → \`learnus_list_announcements\`
- “이 과제 상세 알려줘” → \`learnus_get_assignment\` with established assignment context
- “강의자료 새로 올라온 것 보여줘” → \`learnus_list_files\`
- “OO 과목에서 앞으로 해야 할 게 뭐야?” → resolve the course, then overview or the smallest required individual Tool set
- “새로운 알림과 공지 있어?” → overview with \`includeNotifications=true\`

Actual host-model Tool selection, one-call behavior, interpretation, and final answer quality: **NOT_AUTOMATICALLY_VERIFIED**.

## Remaining Manual Verification

Run these in a real MCP Host and inspect its Tool trace without copying sensitive Tool results:

1. “이번 주 해야 할 일 정리해줘.” — do not automatically prefer LearnUs without academic context
2. “LearnUs에서 이번 주 해야 할 일 정리해줘.”
3. “내 강의 중 하나에서 앞으로 해야 할 일을 알려줘.”
4. “새로운 알림과 공지가 있는지 확인해줘.”
5. Repeat question 2 immediately and confirm the second call is warm and semantically equivalent.
`;
await mkdir(new URL('../docs/',import.meta.url),{recursive:true});await writeFile(reportUrl,report,'utf8');
console.log(JSON.stringify({evaluation:'complete',syntheticTools:new Set(synthetic.rows.filter(row=>row.status!=='SKIPPED_NO_INPUT').map(row=>row.toolName)).size,integration:integration?'RUN':'NOT RUN',report:'docs/m8-performance-evaluation.md'}));
}
main().catch(()=>{console.error('MCP_EVALUATION_FAILED');process.exitCode=1;});
