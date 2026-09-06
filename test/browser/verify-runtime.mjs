import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, readdir } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { createExampleObject } from '../fixtures/example-object.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const server=spawn(process.execPath,['server.mjs'],{cwd:new URL('../../',import.meta.url),env:{...process.env,PORT:'0',OPENAI_API_KEY:'test-only'},stdio:['ignore','pipe','pipe']});
let browser;
try {
  const port=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(new Error('Server startup timeout')),10000);server.stdout.on('data',c=>{out+=c;const match=out.match(/localhost:(\d+)/);if(match){clearTimeout(timer);resolve(match[1]);}});server.once('exit',()=>reject(new Error('Server exited')));});
  browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  const page=await browser.newPage({viewport:{width:1200,height:900}});
  const network=[];page.on('request',r=>{if(r.url().includes('escape-probe'))network.push(r.url());});
  await page.goto('http://127.0.0.1:'+port);
  await page.evaluate(async()=>{
    const {ObjectRuntime}=await import('/runtime/host.js');
    const box=document.createElement('div');box.id='test-runtime';box.style='position:fixed;inset:0;width:600px;height:600px;z-index:100;background:white';document.body.append(box);
    const style=document.createElement('style');style.textContent='#test-runtime iframe{width:100%;height:100%;border:0;display:block}';document.head.append(style);
    window.runtimeEvents=[];window.testRuntime=new ObjectRuntime(box,(type,message)=>window.runtimeEvents.push({type,message}));
    localStorage.setItem('runtime-secret','must-not-leak');document.cookie='runtimeSecret=must-not-leak';
  });
  async function run(source) {
    const definition=createExampleObject();if(source!==undefined)definition.code.source=source;
    await page.evaluate(d=>{window.runtimeEvents=[];window.testRuntime.start(d);},definition);
    await page.waitForFunction(()=>window.runtimeEvents.length>0,{},{timeout:12000});
    return page.evaluate(()=>window.runtimeEvents[0]);
  }
  async function visiblePixels() {
    const {data}=PNG.sync.read(await page.locator('#test-runtime').screenshot());
    let changed=0;
    for(let i=0;i<data.length;i+=4)if(Math.abs(data[i]-data[0])+Math.abs(data[i+1]-data[1])+Math.abs(data[i+2]-data[2])>40)changed++;
    assert.ok(changed>500,'Rendered subject must be visible, not only acknowledged');
  }
  const first=await run();assert.equal(first.type,'ready',first.message);await visiblePixels();console.log('PASS trusted object renders visible pixels');
  for(let i=0;i<12;i++){
    assert.equal((await run()).type,'ready');
    await page.evaluate(()=>window.testRuntime.pause(true));
    await visiblePixels();
  }
  console.log('PASS 12 repeated starts remain visibly rendered while paused');
  const attacks=[
    'parent.document.body.textContent="escaped";',
    'document.cookie;',
    'localStorage.getItem("runtime-secret");',
    'indexedDB.open("escape-probe");',
    'fetch("https://example.com/escape-probe");',
    'new WebSocket("wss://example.com/escape-probe");',
    'location.href="https://example.com/escape-probe";',
    'import("https://example.com/escape-probe.js");',
    'THREE.Mesh.constructor("return globalThis")().fetch("https://example.com/escape-probe");',
    '({}).constructor.constructor("return globalThis")().postMessage({type:"ready"});',
    'Object.prototype.escaped=true;',
    'THREE.Mesh.prototype.onBeforeRender.escaped=true;',
    'new Worker("https://example.com/escape-probe.js");',
    'setInterval(()=>{},1);',
  ];
  for(const attack of attacks){const result=await run(attack+'\n'+createExampleObject().code.source);assert.equal(result.type,'error',attack);}
  assert.deepEqual(network,[]);console.log('PASS 14 adversarial capability probes blocked; no probe network requests');
  const callbacks='const root=new THREE.Group();const m=new THREE.Mesh(new THREE.SphereGeometry(1,12,8),new THREE.MeshStandardMaterial({color:0xe56b39}));root.add(m);m.onBeforeRender=()=>{throw new Error("Renderer exposed");};m.material.onBeforeCompile=()=>{throw new Error("Shader exposed");};return {root,update(){},dispose(){}};';
  assert.equal((await run(callbacks)).type,'ready');console.log('PASS generated renderer callbacks never invoked');
  await page.evaluate(()=>{const a=window.testRuntime.active;window.dispatchEvent(new MessageEvent('message',{source:window,origin:'null',data:{protocolVersion:'1.0.0',requestId:a.requestId,executionId:a.executionId,sequence:99999,type:'error',diagnostic:'spoof'}}));});
  assert.equal(await page.evaluate(()=>window.runtimeEvents.some(e=>e.message==='spoof')),false);
  assert.equal(await page.evaluate(()=>window.testRuntime.active!==null),true);console.log('PASS known-ID wrong-sender message rejected');
  const hung=await run('while(true){}');assert.equal(hung.type,'error');assert.match(hung.message,/stopped responding/);
  assert.equal(await page.locator('#test-runtime iframe').count(),0);console.log('PASS runaway worker stopped; parent stays responsive');
  assert.equal((await run()).type,'ready');
  assert.equal(await page.evaluate(()=>window.testRuntime.dispose()),'disposed');
  assert.equal(await page.locator('#test-runtime iframe').count(),0);console.log('PASS runtime recovers after failure and disposes');
  const lifecycle=update=>`const root=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());return {root,update(t){${update}},dispose(){root.geometry.dispose();root.material.dispose();}};`;
  assert.equal((await run(lifecycle('if(t.tick>0)while(true){}'))).type,'ready');
  await page.waitForFunction(()=>window.runtimeEvents.some(e=>e.type==='error'),{},{timeout:4000});
  assert.equal(await page.locator('#test-runtime iframe').count(),0);
  console.log('PASS runaway update stopped by frame deadline');
  for(const cleanup of ['throw new Error("cleanup failure")','while(true){}']){
    assert.equal((await run(`const root=new THREE.Group();return {root,update(){},dispose(){${cleanup}}};`)).type,'ready');
    assert.equal(await page.evaluate(()=>{
      const frame=window.testRuntime.active.frame;
      const result=window.testRuntime.dispose();
      if(getComputedStyle(frame).display!=='none')throw new Error('Retiring frame must be invisible immediately');
      return result;
    }),'terminated');
    assert.equal(await page.locator('#test-runtime iframe').count(),0);
    assert.equal(await page.evaluate(()=>window.testRuntime.retiring),null);
  }
  console.log('PASS throwing and hung dispose hooks are terminated within cleanup deadline');
  await page.evaluate(d=>{for(let i=0;i<20;i++)window.testRuntime.start(d);},createExampleObject());
  assert.ok(await page.locator('#test-runtime iframe').count()<=2);
  await page.waitForFunction(()=>window.testRuntime.retiring===null,{},{timeout:2000});
  await page.evaluate(()=>window.testRuntime.dispose());
  assert.equal(await page.locator('#test-runtime iframe').count(),0);
  assert.equal((await run()).type,'ready');await visiblePixels();
  await page.evaluate(()=>window.testRuntime.pause(true));
  await page.waitForTimeout(150);
  const pausedSequence=await page.evaluate(()=>window.testRuntime.active.lastSequence);
  await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(()=>window.testRuntime.active.lastSequence),pausedSequence);
  await page.evaluate(()=>window.testRuntime.pause(false));
  await page.waitForFunction(s=>window.testRuntime.active.lastSequence>s,pausedSequence);
  await page.evaluate(()=>window.testRuntime.dispose());
  console.log('PASS rapid replacement stays bounded; pause stays idle and resume works');
  if(process.env.RUNTIME_EVAL_DIR) {
    const directory=process.env.RUNTIME_EVAL_DIR;
    for(const name of (await readdir(directory)).filter(n=>n.endsWith('.json')&&n!=='report.json')) {
      const {definition}=JSON.parse(await readFile(directory+'/'+name,'utf8'));
      await page.evaluate(d=>{window.runtimeEvents=[];window.testRuntime.start(d);},definition);
      await page.waitForFunction(()=>window.runtimeEvents.length>0,{},{timeout:12000});
      const result=await page.evaluate(()=>window.runtimeEvents[0]);
      assert.equal(result.type,'ready',name+': '+result.message);
      await page.waitForFunction(()=>window.testRuntime.active?.lastSequence>=5 || window.runtimeEvents.some(e=>e.type==='error'),{},{timeout:10000});
      assert.equal(await page.evaluate(()=>window.runtimeEvents.some(e=>e.type==='error')),false,name);
      await visiblePixels();
      console.log('PASS saved AI object build and frames:',name);
      if(name==='ball-basket.json')await page.locator('#test-runtime').screenshot({path:'/tmp/paper-machines-runtime.png'});
    }
  }
} finally {await browser?.close();const exited=once(server,'exit');server.kill('SIGTERM');await exited;}
