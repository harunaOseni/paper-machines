// Real browser cross-origin test; only the upstream model response is mocked.
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,readdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createGenerationHandler} from '../../src/paper-machines/generation-service.mjs';
import {buildRuntimeAssets} from '../../src/runtime/assets.mjs';
import {createExampleObject} from '../fixtures/example-object.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=new URL('../../',import.meta.url);
const assets=await buildRuntimeAssets();
let handle, browser;
const seen=[];
const backend=http.createServer((req,res)=>{
  seen.push({method:req.method,path:req.url,origin:req.headers.origin});
  if(req.url==='/api/generate')return handle(req,res);
  if(req.url==='/runtime/frame'){
    const {html,csp}=assets.frame();res.writeHead(200,{'content-type':'text/html','content-security-policy':csp});res.end(html);return;
  }
  res.writeHead(404);res.end();
});
const frontend=http.createServer(async(req,res)=>{
  try {
    const path=req.url==='/'?'index.html':req.url.slice(1);
    if(path.includes('..')||path.includes('?'))throw Error('Invalid path');
    const data=await readFile(new URL('dist/'+path,root));
    res.writeHead(200,{'content-type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html'});res.end(data);
  }catch{res.writeHead(404);res.end();}
});
try {
  await new Promise(r=>backend.listen(0,'127.0.0.1',r));
  await new Promise(r=>frontend.listen(0,'127.0.0.1',r));
  const api='http://127.0.0.1:'+backend.address().port, site='http://127.0.0.1:'+frontend.address().port;
  handle=createGenerationHandler({allowedOrigins:[site],apiKey:'test-only',fetchImpl:async()=>new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(createExampleObject())}]}]}))});
  await promisify(execFile)(process.execPath,['scripts/build-frontend.mjs'],{cwd:root,env:{...process.env,PUBLIC_API_ORIGIN:api,OPENAI_API_KEY:'test-secret-not-for-frontend'}});
  for(const file of await readdir(new URL('dist/',root),{recursive:true})){
    assert.ok(!file.includes('.env'));
    let data;try{data=await readFile(new URL('dist/'+file,root),'utf8');}catch{continue;}
    assert.ok(!data.includes('test-secret-not-for-frontend'),'Secret must not enter frontend assets');
  }
  browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  const page=await browser.newPage({viewport:{width:1300,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(site);
  const canvas=page.locator('#sketch');await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();
  await page.mouse.move(box.x+90,box.y+90);await page.mouse.down();await page.mouse.move(box.x+160,box.y+170,{steps:12});await page.mouse.up();
  await page.locator('#bring').click();
  await page.waitForFunction(()=>document.querySelector('#snapshot-image').naturalWidth===800);
  await page.locator('#bring').click();
  await page.waitForFunction(()=>['ready','error'].includes(document.querySelector('#runtime-view').dataset.state),{},{timeout:15000});
  assert.equal(await page.locator('#runtime-view').getAttribute('data-state'),'ready',await page.locator('#notice').textContent());
  assert.equal(await page.locator('#runtime-view iframe').getAttribute('src'),api+'/runtime/frame');
  assert.ok(seen.some(r=>r.method==='OPTIONS'&&r.path==='/api/generate'&&r.origin===site),'Browser made a CORS preflight');
  assert.ok(seen.some(r=>r.method==='POST'&&r.path==='/api/generate'&&r.origin===site),'Browser called backend directly');
  await page.locator('#play').click();
  assert.equal(await page.locator('#play').getAttribute('aria-label'),'Play animation');
  await page.locator('#zoom').evaluate(el=>{el.value='125';el.dispatchEvent(new Event('input'));});
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#runtime-view').getAttribute('data-state'),'ready');
  await page.locator('#runtime-back').click();
  await page.waitForFunction(()=>document.querySelectorAll('#runtime-view iframe').length===0,{},{timeout:1000});
  assert.deepEqual(errors,[]);
  console.log('PASS split frontend/backend: build without secrets, CORS preflight, generation stream, isolated iframe, controls and cleanup');
}finally{
  await browser?.close();
  await Promise.all([new Promise(r=>frontend.close(r)),new Promise(r=>backend.close(r))]);
}
