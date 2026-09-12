import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const root=new URL('../',import.meta.url);
const reportUrl=new URL('../docs/m9-token-evaluation.md',import.meta.url);
const baselineUrl=new URL('../docs/m9-token-baseline.json',import.meta.url);
const captureBaseline=process.argv.includes('--capture-baseline');
const size=value=>Buffer.byteLength(JSON.stringify(value)??'');
let evaluationMode='synthetic';
const range=()=>{if(evaluationMode==='synthetic')return {from:'2026-09-03',to:'2026-10-10'};const now=Date.now();return {from:new Date(now-7*86400000).toISOString().slice(0,10),to:new Date(now+30*86400000).toISOString().slice(0,10)};};

function body(response,toolName){
  const value=response.content?.find(block=>block.type==='text')?.text;
  if(typeof value!=='string')throw new Error(`MISSING_TEXT_RESULT:${toolName}`);
  try{return JSON.parse(value);}catch{throw new Error(`NON_JSON_RESULT:${toolName}`);}
}
function countWarnings(value){
  let count=0;
  const walk=item=>{if(Array.isArray(item)){for(const child of item)walk(child);return;}if(!item||typeof item!=='object')return;for(const [key,child] of Object.entries(item)){if(key==='warnings'&&Array.isArray(child))count+=child.length;walk(child);}};
  walk(value);return count;
}
function primaryItems(value){
  for(const key of ['courses','activities','events','items','requiredIncomplete','assignments'])if(Array.isArray(value?.[key]))return value[key].length;
  if(value?.item)return 1;
  return undefined;
}
function fieldCategory(key){
  if(/^(?:text|content|description|instructionalDueRule)$/i.test(key))return 'longText';
  if(/url|path/i.test(key))return 'url';
  if(/warning/i.test(key))return 'warnings';
  if(/deadline|due|available|date|time/i.test(key))return 'dates';
  if(/state|status|completion|attendance|applicability|confidence|classification/i.test(key))return 'semantics';
  if(/(?:^id$|Id$|cmid|module)/.test(key))return 'identity';
  if(/title|name|author/i.test(key))return 'labels';
  return 'other';
}
function structuralAnalysis(value){
  const categories=new Map(),seen=new Map(),forbidden=new Map();let emptyFields=0,longTextFields=0,urlCount=0,urlBytes=0;
  const internal=/^(?:html|rawHtml|rawResponse|parserTrace|debug|diagnostics|deadlineCandidates|deadlineBasis|applicabilityBasis|cacheMetadata|sessionMetadata|credential|credentials|cookie|sesskey|token)$/i;
  const walk=item=>{
    if(item===null||item===''||(Array.isArray(item)&&item.length===0)||(item&&typeof item==='object'&&!Array.isArray(item)&&Object.keys(item).length===0)){emptyFields++;return;}
    if(Array.isArray(item)){for(const child of item)walk(child);return;}
    if(!item||typeof item!=='object')return;
    for(const [key,child] of Object.entries(item)){
      if(internal.test(key))forbidden.set(key,(forbidden.get(key)||0)+1);
      if(child===null||typeof child!=='object'||(Array.isArray(child)&&child.every(value=>value===null||typeof value!=='object')))
        categories.set(fieldCategory(key),(categories.get(fieldCategory(key))||0)+size(child));
      if(typeof child==='string'){
        if(child.length>=160&&/text|content|description|rule/i.test(key))longTextFields++;
        if(/url|path/i.test(key)){urlCount++;urlBytes+=size(child);}
        if(['courseId','cmid','moduleId','videoId'].includes(key)){const identity=`${key}:${child}`;seen.set(identity,(seen.get(identity)||0)+1);}
      }else if(typeof child==='number'&&['courseId','cmid','moduleId'].includes(key)){const identity=`${key}:${child}`;seen.set(identity,(seen.get(identity)||0)+1);}
      walk(child);
    }
  };
  walk(value);
  const largest=[...categories].sort((a,b)=>b[1]-a[1])[0]??['none',0];
  return {largestFieldCategory:largest[0],largestFieldCategoryBytes:largest[1],emptyFields,longTextFields,urlCount,urlBytes,repeatedIdentityOccurrences:[...seen.values()].reduce((sum,count)=>sum+Math.max(0,count-1),0),internalFieldCounts:Object.fromEntries([...forbidden].sort())};
}
function contribution(name,value){const bytes=size(value),itemCount=Array.isArray(value)?value.length:value===undefined?0:1;return {name,itemCount,bytes,averageBytesPerItem:itemCount?Math.round(bytes/itemCount):0};}
function overviewSections(value){
  const resources=Array.isArray(value.resources)?value.resources:[],learning=value.learning??{};
  return [
    contribution('range',value.range),
    contribution('actionable assignments',(value.assignments??[]).filter(item=>item.classification==='actionable')),
    contribution('actionable learning/videos',learning.actionable??[]),
    contribution('upcoming/deadlines',value.upcoming??[]),
    contribution('informational announcements',value.announcements??[]),
    contribution('informational notifications',value.notifications??[]),
    contribution('informational resources',resources.filter(item=>item.classification==='informational')),
    contribution('unknown/needs-verification',[...(learning.unknown??[]),...resources.filter(item=>item.classification==='unknown')]),
    contribution('completed',[...(learning.completed??[]),...resources.filter(item=>item.classification==='completed'),...(value.assignments??[]).filter(item=>item.classification==='completed')]),
    contribution('warnings',value.warnings??[]),
    contribution('other metadata',value.sectionSemantics),
  ];
}
function learningSections(value){return ['courses','requiredIncomplete','completed','excludedOrOptional','unknown','warnings'].map(key=>contribution(key,value?.[key]??[]));}

async function open(mode){
  const env={...process.env,LEARNUS_EVALUATION_MODE:mode};for(const key of ['DEBUG','PWDEBUG','NODE_DEBUG'])delete env[key];
  if(mode==='synthetic')for(const key of ['LEARNUS_ID','LEARNUS_PASSWORD','LEARNUS_INTEGRATION'])delete env[key];
  const transport=new StdioClientTransport({command:process.execPath,args:['scripts/evaluation-server.mjs'],cwd:fileURLToPath(root),env,stderr:'pipe'});
  const client=new Client({name:'learnus-token-evaluation',version:'1'});await client.connect(transport);return {client,close:()=>client.close()};
}
const call=(client,name,args)=>client.callTool({name,arguments:args},undefined,{timeout:300000});
const control=async(client,action,clearCaches=false)=>body(await call(client,'__learnus_evaluation_control',{action,clearCaches}),'__learnus_evaluation_control');

async function definitionStats(client){
  const tools=(await client.listTools()).tools.filter(tool=>tool.name.startsWith('learnus_'));
  const rows=tools.map(tool=>{
    const metadata=Object.fromEntries(Object.entries(tool).filter(([key])=>!['description','inputSchema'].includes(key)));
    return {name:tool.name,descriptionBytes:size(tool.description??''),schemaBytes:size(tool.inputSchema??{}),metadataBytes:size(metadata),totalBytes:size(tool)};
  }).sort((a,b)=>b.totalBytes-a.totalBytes);
  return {toolCount:rows.length,totalDefinitionBytes:rows.reduce((sum,row)=>sum+row.totalBytes,0),totalDescriptionBytes:rows.reduce((sum,row)=>sum+row.descriptionBytes,0),totalSchemaBytes:rows.reduce((sum,row)=>sum+row.schemaBytes,0),rows};
}
async function resolveInputs(client){
  const courses=body(await call(client,'learnus_list_courses',{}),'learnus_list_courses').courses??[];
  const courseId=courses.find(course=>Number.isSafeInteger(course.id)&&course.id>0)?.id;
  let cmid,moduleId,articleId;
  if(courseId){
    const activities=body(await call(client,'learnus_list_activities',{courseId:String(courseId)}),'learnus_list_activities').activities??[];
    cmid=activities.find(item=>item.type==='assign'&&Number.isSafeInteger(item.id))?.id;
    const announcements=body(await call(client,'learnus_list_announcements',{courseId:String(courseId),limit:10}),'learnus_list_announcements').items??[];
    moduleId=announcements[0]?.moduleId;articleId=announcements[0]?.id;
  }
  return {courseId:courseId&&String(courseId),cmid,moduleId,articleId};
}
function cases(ids){
  const dates=range(),course=ids.courseId&&{courseId:ids.courseId};
  return [
    ['learnus_list_courses',{},'default'],
    ['learnus_get_course',course,'default'],
    ['learnus_list_activities',course,'default'],
    ['learnus_get_assignment',ids.cmid&&{cmid:ids.cmid},'default'],
    ['learnus_upcoming',{...dates,limit:10},'default'],
    ['learnus_list_announcements',course&&{...course,limit:10},'default'],
    ['learnus_get_announcement',ids.moduleId&&ids.articleId&&{moduleId:ids.moduleId,articleId:ids.articleId},'default'],
    ['learnus_list_notifications',{limit:10},'default'],
    ['learnus_get_overview',{...dates,maxItemsPerSection:10},'default'],
    ['learnus_get_overview',{...dates,maxItemsPerSection:10,includeNotifications:true},'with-notifications'],
    ['learnus_get_overview',{...dates,maxItemsPerSection:10,includeLearning:true},'with-learning'],
    ['learnus_get_overview',course&&{...dates,...course,maxItemsPerSection:10,includeLearning:true},'course-scoped'],
    ['learnus_get_weekly_tasks',{...dates},'default'],
    ['learnus_list_videos',course,'default'],
    ['learnus_get_video_attendance',course,'default'],
    ['learnus_get_learning_overview',course&&{...course,week:'current'},'default'],
    ['learnus_list_files',course&&{...course,scope:'course'},'default'],
  ];
}
async function measure(client,toolName,args,variant,clearCaches){
  await control(client,'reset',clearCaches);const response=await call(client,toolName,args),metrics=await control(client,'snapshot'),value=body(response,toolName);
  return {toolName,variant,status:response.isError?'ERROR':'OK',resultBytes:size(value),mcpEnvelopeBytes:size(response),itemCount:primaryItems(value),warningsCount:countWarnings(value),structuredContent:response.structuredContent!==undefined,...structuralAnalysis(value),networkRequests:metrics.networkRequestsStarted,cacheHits:metrics.cacheHits,cacheMisses:metrics.cacheMisses,coalescedRequests:metrics.coalescedRequests,peakConcurrentRequests:metrics.peakConcurrentRequests,sections:toolName==='learnus_get_weekly_tasks'||toolName==='learnus_get_overview'?overviewSections(value):toolName==='learnus_get_learning_overview'?learningSections(value):undefined};
}
async function run(mode){
  evaluationMode=mode;
  const session=await open(mode);try{
    const definitions=await definitionStats(session.client),ids=await resolveInputs(session.client),rows=[];
    for(const [name,args,variant] of cases(ids)){
      if(!args){rows.push({toolName:name,variant,status:'SKIPPED_NO_INPUT'});continue;}
      rows.push(await measure(session.client,name,args,variant,true));
      rows.push(await measure(session.client,name,args,`${variant}-warm`,false));
    }
    rows.push(await measureConcurrent(session.client,'learnus_get_course',{courseId:ids.courseId},'concurrent-3'));
    rows.push(await measureConcurrent(session.client,'learnus_get_overview',{...range(),maxItemsPerSection:10},'concurrent-3'));
    rows.push(await measureConcurrent(session.client,'learnus_get_weekly_tasks',{...range()},'concurrent-3'));
    return {mode,definitions,rows};
  }finally{await session.close();}
}
async function measureConcurrent(client,toolName,args,variant){
  if(Object.values(args).some(value=>!value))return {toolName,variant,status:'SKIPPED_NO_INPUT'};
  await control(client,'reset',true);const responses=await Promise.all([call(client,toolName,args),call(client,toolName,args),call(client,toolName,args)]),metrics=await control(client,'snapshot'),value=body(responses[0],toolName);
  return {toolName,variant,status:'OK',resultBytes:size(value),mcpEnvelopeBytes:size(responses[0]),networkRequests:metrics.networkRequestsStarted,cacheHits:metrics.cacheHits,cacheMisses:metrics.cacheMisses,coalescedRequests:metrics.coalescedRequests,peakConcurrentRequests:metrics.peakConcurrentRequests};
}

const table=(headers,rows)=>`| ${headers.join(' | ')} |\n| ${headers.map(()=>'---').join(' | ')} |\n${rows.map(row=>`| ${row.map(value=>value??'—').join(' | ')} |`).join('\n')}`;
const rowKey=row=>`${row.toolName}:${row.variant}`;
const find=(result,name,variant='default')=>result.rows.find(row=>row.toolName===name&&row.variant===variant);
function delta(before,after,key){if(!before||!after||before[key]===undefined||after[key]===undefined)return '—';return before[key]-after[key];}
function report(current,baseline,integration){
  const beforeByKey=new Map((baseline?.rows??[]).map(row=>[rowKey(row),row])),measured=current.rows.filter(row=>row.status==='OK'&&!row.variant.endsWith('-warm')&&row.variant!=='concurrent-3');
  const definitions=table(['Tool','Before','After','Reduction','Description','Schema'],current.definitions.rows.slice(0,5).map(row=>{const before=baseline?.definitions?.rows?.find(item=>item.name===row.name);return [row.name,before?.totalBytes,row.totalBytes,delta(before,row,'totalBytes'),row.descriptionBytes,row.schemaBytes];}));
  const results=table(['Tool','Variant','Before result','After result','Reduction','MCP envelope','Items','Warnings','Largest category'],measured.map(row=>{const candidate=beforeByKey.get(rowKey(row)),before=candidate?.itemCount===row.itemCount&&candidate?.warningsCount===row.warningsCount?candidate:undefined;return [row.toolName,row.variant,before?.resultBytes,row.resultBytes,delta(before,row,'resultBytes'),row.mcpEnvelopeBytes,row.itemCount,row.warningsCount,row.largestFieldCategory];}));
  const weekly=find(current,'learnus_get_weekly_tasks'),overview=find(current,'learnus_get_overview'),learning=find(current,'learnus_get_learning_overview');
  const sectionTable=sections=>table(['Section','Items','Bytes','Average bytes/item'],(sections??[]).map(item=>[item.name,item.itemCount,item.bytes,item.averageBytesPerItem]));
  const networkNames=[['overview','learnus_get_overview'],['weekly_tasks','learnus_get_weekly_tasks']];
  const network=table(['Case','Cold requests','Warm requests','Before cold','Before warm'],networkNames.map(([label,name])=>{const cold=find(current,name),warm=find(current,name,'default-warm');return [label,cold?.networkRequests,warm?.networkRequests,baseline&&find(baseline,name)?.networkRequests,baseline&&find(baseline,name,'default-warm')?.networkRequests];}));
  const concurrency=table(['Tool','Requests','Coalesced','Peak','Before requests/coalesced/peak'],['learnus_get_course','learnus_get_overview','learnus_get_weekly_tasks'].map(name=>{const row=find(current,name,'concurrent-3'),old=baseline&&find(baseline,name,'concurrent-3');return [name,row?.networkRequests,row?.coalescedRequests,row?.peakConcurrentRequests,old&&`${old.networkRequests}/${old.coalescedRequests}/${old.peakConcurrentRequests}`];}));
  const internals=measured.reduce((sum,row)=>sum+Object.values(row.internalFieldCounts??{}).reduce((a,b)=>a+b,0),0);
  const integrationRows=integration?.rows.filter(row=>row.status==='OK'&&!row.variant.endsWith('-warm')&&row.variant!=='concurrent-3')??[];
  return `# M9 Token / Context Evaluation

## Environment

- Runtime: Node ${process.version}, ${process.platform}/${process.arch}
- Transport: MCP SDK client → local stdio server → production Tool handlers
- Metric: UTF-8 bytes of serialized JSON; this is not an exact LLM token count
- Synthetic evaluation: RUN
- Integration token evaluation: ${integration?'RUN':'NOT RUN'}
- Host-internal Tool tokenization: not observable from this local benchmark

## Tool Definition Baseline

- Tool count: ${current.definitions.toolCount}
- Before: ${baseline?.definitions?.totalDefinitionBytes??'—'} bytes
- After: ${current.definitions.totalDefinitionBytes} bytes
- Reduction: ${baseline?baseline.definitions.totalDefinitionBytes-current.definitions.totalDefinitionBytes:'—'} bytes
- Description bytes: ${baseline?.definitions?.totalDescriptionBytes??'—'} → ${current.definitions.totalDescriptionBytes}
- Schema bytes: ${baseline?.definitions?.totalSchemaBytes??'—'} → ${current.definitions.totalSchemaBytes}

Largest current definitions (description text is intentionally omitted):

${definitions}

## Tool Result Baseline

${results}

All measurements use the MCP tools/call path. Result bytes measure parsed JSON; envelope bytes measure the serialized MCP response. Download is excluded because it writes a local file.

## Weekly Tasks Analysis

${sectionTable(weekly?.sections)}

## Overview Analysis

${sectionTable(overview?.sections)}

## Learning Analysis

${sectionTable(learning?.sections)}

## Duplicate / Empty Field Analysis

- Weekly empty/null/empty-container fields: ${weekly?.emptyFields??'—'}
- Overview repeated canonical identity occurrences: ${overview?.repeatedIdentityOccurrences??'—'}
- Overview URL bytes: ${overview?.urlBytes??'—'} across ${overview?.urlCount??'—'} URLs
- Public internal/debug fields remaining across measured results: ${internals}
- Warning strings remain attached to item identity when item-specific; aggregate warnings already use set semantics.

## Changes Applied

- Repeated per-Tool source/read-only/browser boilerplate moved to server instructions and annotations; routing-specific wording remains on each Tool.
- Public MCP JSON omits parser diagnostics and internal target/deadline evidence fields while preserving final state, uncertainty, effective deadline and warning semantics.
- Existing list/detail boundaries, notification summary cap, canonical IDs and full URLs remain unchanged.

## Before / After

The table above compares the stored pre-optimization synthetic baseline with the current MCP path. Exact byte counts are reports, not unit-test contracts.

## Semantic Risk Review

- Retained: canonical IDs, completion/submission state, attendance target/status, effective due date/source, actionability, uncertainty and warnings.
- Retained: detail Tool content, full canonical URLs, notification text cap and list/detail schemas.
- Removed only from MCP serialization: diagnostics, raw/debug/session/cache keys and internal evidence arrays/basis fields.

## M8 Performance Regression

${network}

${concurrency}

Network request counts, cache reuse, coalescing and peak concurrency must remain equal to the stored baseline.

## Structured Content Audit

The installed MCP SDK supports structuredContent when an output schema is declared. Current Tools publish text JSON without output schemas. Adding both formats would increase payload; switching to structured-only could break existing local Hosts. No transport-format migration was applied.

## Integration Evaluation

${integration?table(['Tool','Variant','Result bytes','MCP envelope','Items','Warnings','Largest category'],integrationRows.map(row=>[row.toolName,row.variant,row.resultBytes,row.mcpEnvelopeBytes,row.itemCount,row.warningsCount,row.largestFieldCategory])):'Integration token evaluation: NOT RUN'}

Only structural statistics are written. Course names, titles, bodies, filenames, user data, URL queries, HTML and authentication values are never recorded.

## Deferred Candidates

- Definition surface consolidation requires a Host-level routing benchmark; Tool deletion or renaming is deferred.
- Dictionary/relational encoding, URL prefix compression and property-name shortening save bytes but break compatibility.
- More aggressive notification or instructor-text truncation requires opt-in real-account evidence because it can remove required context.
`;
}

async function main(){
const current=await run('synthetic');
if(captureBaseline){
  await writeFile(baselineUrl,JSON.stringify(current,null,2)+'\n','utf8');
  console.log(JSON.stringify({evaluation:'baseline-captured',toolCount:current.definitions.toolCount,report:'docs/m9-token-baseline.json'}));
}else{
  const baseline=JSON.parse(await readFile(baselineUrl,'utf8'));
  for(const row of current.rows){
    if(row.status!=='OK')throw new Error('SYNTHETIC_RESULT_FAILED');
    if(Object.values(row.internalFieldCounts??{}).some(count=>count>0))throw new Error('PUBLIC_INTERNAL_FIELD');
    const previous=baseline.rows.find(item=>rowKey(item)===rowKey(row));
    for(const key of ['networkRequests','coalescedRequests','peakConcurrentRequests'])if(previous&&row[key]!==previous[key])throw new Error('M8_METRIC_REGRESSION');
  }
  const integration=process.env.LEARNUS_INTEGRATION==='1'&&process.env.LEARNUS_ID&&process.env.LEARNUS_PASSWORD?await run('integration'):undefined;
  await writeFile(reportUrl,report(current,baseline,integration),'utf8');
  console.log(JSON.stringify({evaluation:'complete',toolCount:current.definitions.toolCount,integration:integration?'RUN':'NOT RUN',report:'docs/m9-token-evaluation.md'}));
}
}
main().catch(()=>{console.error('TOKEN_EVALUATION_FAILED');process.exitCode=1;});
