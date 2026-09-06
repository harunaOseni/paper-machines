import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

for(const production of [false,true])test(`actual server serves UI, keeps env private, and routes generation (${production?'production':'development'})`, async()=>{
  const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:'0',HOST:production?'0.0.0.0':'127.0.0.1',NODE_ENV:production?'production':'test',ALLOWED_ORIGINS:production?'https://app.example':'',PUBLIC_API_ORIGIN:production?'https://api.example':'',OPENAI_API_KEY:'test-only-not-a-real-key'},stdio:['ignore','pipe','pipe']});
  let output='';
  try {
    const port=await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('Server did not start.')),5000);
      child.once('exit',()=>{clearTimeout(timeout);reject(new Error('Server exited before startup.'));});
      child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/localhost:(\d+)/);if(match){clearTimeout(timeout);resolve(match[1]);}});
    });
    const origin='http://127.0.0.1:'+port;
    const site=production?'https://app.example':origin;
    const routing=await (await fetch(origin+'/deployment-config.js')).text();
    assert.ok(!routing.includes('test-only-not-a-real-key'));
    assert.ok(routing.includes(production?'https://api.example':"\"\""));
    const home=await fetch(origin);assert.equal(home.status,200);assert.match(await home.text(),/id="sketch"/);
    assert.equal((await fetch(origin+'/paper-machines.js')).status,200);
    assert.equal((await fetch(origin+'/runtime/host.js')).status,200);
    const runtime=await fetch(origin+'/runtime/frame');
    assert.equal(runtime.status,200);
    const policy=runtime.headers.get('content-security-policy');
    assert.match(policy,/sandbox allow-scripts/);
    assert.match(policy,/connect-src 'none'/);
    assert.ok(!policy.includes('allow-same-origin'));
    assert.equal(runtime.headers.get('cache-control'),'no-store');
    assert.equal((await fetch(origin+'/.env')).status,404);
    assert.equal((await fetch(origin+'/api/generate',{method:'POST',body:'{}'})).status,403);
    assert.equal((await fetch(origin+'/api/generate',{method:'POST',headers:{Origin:site,'Content-Type':'application/json','X-Paper-Machines':'1'},body:'null'})).status,400);
    const preflight=await fetch(origin+'/api/generate',{method:'OPTIONS',headers:{Origin:site,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,x-paper-machines'}});
    assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),site);
    assert.ok(!output.includes('test-only-not-a-real-key'));
  } finally {const exited=once(child,'exit');child.kill('SIGTERM');await exited;}
});
