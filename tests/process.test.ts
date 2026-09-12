import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {expect,it} from 'vitest';

it.each(['eof','SIGINT','SIGTERM'] as const)('production stdio shuts down on %s without non-protocol stdout',async trigger=>{
  const env={...process.env,LEARNUS_ID:'',LEARNUS_PASSWORD:'',LEARNUS_INTEGRATION:'0'};
  const child=spawn(process.execPath,['dist/index.js'],{env,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
  child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
  const closed=once(child,'close');
  const timer=setTimeout(()=>child.kill('SIGKILL'),12000);
  try {
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'shutdown-test',version:'1'}}})+'\n');
    await once(child.stdout,'data');
    if(trigger==='eof')child.stdin.end();else child.kill(trigger);
    const [code,signal]=await closed;
    expect(stdout.trim().split('\n').every(line=>{try{return JSON.parse(line).jsonrpc==='2.0';}catch{return false;}})).toBe(true);
    expect(stderr).toBe('');expect(signal).not.toBe('SIGKILL');
    if(trigger==='eof'||process.platform!=='win32')expect(code).toBe(0);
  }finally{clearTimeout(timer);if(child.exitCode===null&&!child.killed)child.kill('SIGKILL');}
},15000);
