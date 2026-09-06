import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('actual server serves UI, keeps env private, and routes generation', async()=>{
  const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:'0',OPENAI_API_KEY:'test-only-not-a-real-key'},stdio:['ignore','pipe','pipe']});
  let output='';
  try {
    const port=await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('Server did not start.')),5000);
      child.once('exit',()=>{clearTimeout(timeout);reject(new Error('Server exited before startup.'));});
      child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/localhost:(\d+)/);if(match){clearTimeout(timeout);resolve(match[1]);}});
    });
    const origin='http://127.0.0.1:'+port;
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
    assert.equal((await fetch(origin+'/api/generate',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Paper-Machines':'1'},body:'null'})).status,400);
    assert.ok(!output.includes('test-only-not-a-real-key'));
  } finally {const exited=once(child,'exit');child.kill('SIGTERM');await exited;}
});
