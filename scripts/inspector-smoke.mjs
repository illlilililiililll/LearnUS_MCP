import {spawnSync} from 'node:child_process';
const env={...process.env};
for (const key of ['LEARNUS_ID','LEARNUS_PASSWORD','DEBUG','PWDEBUG','NODE_DEBUG']) delete env[key];
const cli='node_modules/@modelcontextprotocol/inspector/clients/launcher/build/index.js';
for(const [name,args] of [
 ['list',['--method','tools/list']],
 ['status',['--method','tools/call','--tool-name','learnus_auth_status']],
 ['courses',['--method','tools/call','--tool-name','learnus_list_courses']],
 ['activities',['--method','tools/call','--tool-name','learnus_list_activities','--tool-args-json',JSON.stringify({courseId:'1'})]],
 ['assignment',['--method','tools/call','--tool-name','learnus_get_assignment','--tool-arg','cmid=1']],
 ['upcoming',['--method','tools/call','--tool-name','learnus_upcoming','--tool-arg','from=2026-09-01','to=2026-10-01','limit=5']],
 ['announcements',['--method','tools/call','--tool-name','learnus_list_announcements','--tool-args-json',JSON.stringify({courseId:'1',limit:2})]],
 ['announcement',['--method','tools/call','--tool-name','learnus_get_announcement','--tool-args-json',JSON.stringify({moduleId:'1',articleId:'1'})]],
 ['notifications',['--method','tools/call','--tool-name','learnus_list_notifications','--tool-arg','limit=2']]
 ,['videos',['--method','tools/call','--tool-name','learnus_list_videos','--tool-args-json',JSON.stringify({courseId:'1'})]]
 ,['attendance',['--method','tools/call','--tool-name','learnus_get_video_attendance','--tool-args-json',JSON.stringify({courseId:'1'})]]
 ,['overview',['--method','tools/call','--tool-name','learnus_get_learning_overview','--tool-args-json',JSON.stringify({courseId:'1',week:'current'})]]
 ,['files',['--method','tools/call','--tool-name','learnus_list_files','--tool-args-json',JSON.stringify({courseId:'1'})]]
 ,['download',['--method','tools/call','--tool-name','learnus_download_file','--tool-arg','fileId=123e4567-e89b-12d3-a456-426614174000']]
 ,['aggregate',['--method','tools/call','--tool-name','learnus_get_overview','--tool-args-json',JSON.stringify({includeAssignments:false})]]
 ,['weekly',['--method','tools/call','--tool-name','learnus_get_weekly_tasks','--tool-args-json','{}']]
]) {
 const r=spawnSync(process.execPath,[cli,'--cli',process.execPath,'dist/index.js',...args,'--format','json'],{env,encoding:'utf8',timeout:30000});
 const output=r.stdout||'';
 const passed=name==='list'?['learnus_auth_status','learnus_list_courses','learnus_get_course','learnus_list_activities','learnus_get_assignment','learnus_upcoming','learnus_list_announcements','learnus_get_announcement','learnus_list_notifications','learnus_list_videos','learnus_get_video_attendance','learnus_get_learning_overview','learnus_list_files','learnus_download_file','learnus_get_overview','learnus_get_weekly_tasks'].every(tool=>output.includes(tool)):name==='status'?output.includes('authenticated'):['aggregate','weekly'].includes(name)?output.includes('UPCOMING_UNAVAILABLE')&&output.includes('ANNOUNCEMENTS_UNAVAILABLE'):['download'].includes(name)?output.includes('PARSE_ERROR'):output.includes('CREDENTIALS_MISSING');
 console.log(JSON.stringify({check:name,passed,exitCode:r.status}));
 if(!passed) { console.log('INSPECTOR_CHECK_FAILED'); process.exitCode=1; }
}
