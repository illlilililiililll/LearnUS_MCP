import { LearnUsError, safeCode } from '../../src/errors.js';

export class IntegrationCheckError extends Error {
  constructor(readonly checkpoint:string){super('CHECK_FAILED');}
}
export function checkIntegration(condition:boolean,checkpoint:string):asserts condition {if(!condition)throw new IntegrationCheckError(checkpoint);}
export function integrationFailure(prefix:string,checkpoint:string,error:unknown,diagnostics:unknown):string {
  return error instanceof IntegrationCheckError
    ? `${prefix}_CHECK_FAILED ${error.checkpoint} ${JSON.stringify(diagnostics)}`
    : `${prefix}_REQUEST_FAILED ${checkpoint} ${safeCode(error)} ${JSON.stringify(diagnostics)}`;
}
export function mcpError(value:unknown):LearnUsError {
  const allowed=['CREDENTIALS_MISSING','AUTH_FAILED','AUTH_CHALLENGE_REQUIRED','SESSION_EXPIRED','NETWORK_ERROR','PARSE_ERROR','ENDPOINT_UNAVAILABLE','DOWNLOAD_TOO_LARGE'];
  let code='NETWORK_ERROR';
  try{const parsed=JSON.parse(String(value));if(allowed.includes(parsed.error))code=parsed.error;}catch{/* MCP error bodies are never copied to test output. */}
  return new LearnUsError(code as ConstructorParameters<typeof LearnUsError>[0]);
}
