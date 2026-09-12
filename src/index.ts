// Prevent dependency debug modes from printing HTTP/authentication internals.
delete process.env.DEBUG;
delete process.env.PWDEBUG;
delete process.env.NODE_DEBUG;
const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
const { EnvironmentCredentialProvider } = await import('./auth/CredentialProvider.js');
const { PlaywrightAuthManager } = await import('./auth/PlaywrightAuthManager.js');
const { LearnUsClient } = await import('./client/LearnUsClient.js');
const { createServer } = await import('./tools/index.js');
const auth = new PlaywrightAuthManager(new EnvironmentCredentialProvider());
const server = createServer(new LearnUsClient(auth));
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  const timeout=setTimeout(()=>{process.stderr.write('SHUTDOWN_TIMEOUT\n');process.exit(1);},10000);
  try { await server.close(); await auth.close(); }
  catch { process.stderr.write('SHUTDOWN_FAILED\n'); process.exitCode=1; }
  finally { clearTimeout(timeout); }
};
process.on('SIGINT', () => { void stop(); });
process.on('SIGTERM', () => { void stop(); });
process.stdin.on('end', () => { void stop(); });
try { await server.connect(new StdioServerTransport()); }
catch { process.stderr.write('SERVER_START_FAILED\n'); await stop(); process.exitCode = 1; }
