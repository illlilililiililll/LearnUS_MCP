import { it,expect } from 'vitest';
import { LearnUsError } from '../src/errors.js';
import { checkIntegration, integrationFailure, mcpError } from './support/integration.js';
it('does not mislabel integration checks as network failures',()=>{
  let failure:unknown;try{checkIntegration(false,'synthetic_checkpoint');}catch(error){failure=error;}
  expect(integrationFailure('M5','ignored',failure,{courseCount:0,warnings:['NO_ANNOUNCEMENTS_FOUND']})).toBe('M5_CHECK_FAILED synthetic_checkpoint {"courseCount":0,"warnings":["NO_ANNOUNCEMENTS_FOUND"]}');
  expect(integrationFailure('M5','tool_call',new LearnUsError('ENDPOINT_UNAVAILABLE'),{})).toBe('M5_REQUEST_FAILED tool_call ENDPOINT_UNAVAILABLE {}');
});
it('preserves allowlisted MCP errors without exposing response contents',()=>{
  expect(mcpError('{"error":"PARSE_ERROR","detail":"private data"}').message).toBe('PARSE_ERROR');
  for(const value of [undefined,null,'private data','null','{"error":"private data"}']){
    expect(mcpError(value).message).toBe('NETWORK_ERROR');
  }
});
