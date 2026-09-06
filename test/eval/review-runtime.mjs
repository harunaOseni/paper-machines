// Offline evaluation: saved model output runs only in the production sandbox.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {PNG} from 'pngjs';
import {validateObjectPackage} from '../../src/paper-machines/object-contract.mjs';
const directory=resolve(process.argv[2]||'test/eval/results/2026-09-06T06-22-54-889Z');
const output=resolve('test/eval/results/runtime-review-'+basename(directory)+'-'+new Date().toISOString().replace(/[:.]/g,'-'));
await mkdir(output,{recursive:true});
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const server=spawn(process.execPath,['server.mjs'],{cwd:new URL('../../',import.meta.url),env:{...process.env,PORT:'0',OPENAI_API_KEY:'test-only'},stdio:['ignore','pipe','pipe']});
let browser;
const hash=b=>createHash('sha256').update(b).digest('hex');
const pixels=b=>PNG.sync.read(b).data;
const changed=(a,b)=>{let n=0;for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>30)n++;return n;};
const rows=[];
try {
  const port=await new Promise((ok,no)=>{let out='';const timer=setTimeout(()=>no(Error('Server timeout')),10000);server.stdout.on('data',c=>{out+=c;const m=out.match(/localhost:(\d+)/);if(m){clearTimeout(timer);ok(m[1]);}});server.once('exit',()=>no(Error('Server exited')));});
  browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  const page=await browser.newPage({viewport:{width:600,height:600}});
  page.on('console',m=>{if(/WebGL|context lost|GPU/.test(m.text()))console.log('RENDERER',m.text());});
  await page.goto('http://127.0.0.1:'+port);
  await page.evaluate(async()=>{
    const {ObjectRuntime}=await import('/runtime/host.js');
    document.body.replaceChildren();const box=document.createElement('div');box.id='review';document.body.append(box);
    const style=document.createElement('style');style.textContent='html,body{margin:0}#review{position:fixed;inset:0;background:#edf0e6}#review iframe{display:block;border:0;width:100%;height:100%}';document.head.append(style);
    window.events=[];window.runtime=new ObjectRuntime(box,(type,message)=>window.events.push({type,message}));
    window.disposed=false;
    addEventListener('message',e=>{const a=window.runtime.active;if(a && e.source===a.frame.contentWindow && e.origin==='null' && e.data?.executionId===a.executionId && e.data?.requestId===a.requestId && e.data.type==='disposed')window.disposed=true;});
  });
  const start=async definition=>{
    await page.evaluate(d=>{window.events=[];window.disposed=false;window.runtime.start(d);window.runtime.pause(true);},definition);
    await page.waitForFunction(()=>window.events.length>0,{},{timeout:12000});
    const result=await page.evaluate(()=>window.events[0]);assert.equal(result.type,'ready',result.message);
  };
  const advance=async count=>{
    for(let i=0;i<count;i++){
      const sequence=await page.evaluate(()=>{const a=window.runtime.active;const previous=a.lastSequence;a.frame.contentWindow.postMessage({type:'tick',requestId:a.requestId,executionId:a.executionId,sequence:a.command++},'*');return previous;});
      await page.waitForFunction(s=>!window.runtime.active||window.runtime.active.lastSequence>s,sequence,{timeout:6000,polling:5});
      const error=await page.evaluate(()=>window.events.find(e=>e.type==='error'));assert.ok(!error,error?.message);
    }
  };
  const shot=async()=>{
    // A worker acknowledgement precedes browser compositing. Let the paused
    // frame reach the screen, then require consecutive stable captures.
    await page.waitForTimeout(100);
    let previous=await page.locator('#review').screenshot();
    for(let attempt=0;attempt<5;attempt++){
      await page.waitForTimeout(50);
      const next=await page.locator('#review').screenshot();
      if(hash(pixels(previous))===hash(pixels(next)))return next;
      previous=next;
    }
    throw Error('Paused render did not settle');
  };
  for(const file of (await readdir(directory)).filter(f=>f.endsWith('.json')&&f!=='report.json')) {
    const id=file.slice(0,-5),raw=await readFile(directory+'/'+file),saved=JSON.parse(raw),d=saved.definition;
    const row={id,packageSHA256:hash(raw),valid:validateObjectPackage(d).valid,frames:[],build:false,dispose:false};
    try {
      const source=await readFile(directory+'/'+id+'.png');assert.equal(hash(source),d.source.sha256);row.provenance=true;
      await start(d);row.build=true;
      const first=await shot();row.frames.push(id+'-0.png');await writeFile(output+'/'+row.frames[0],first);
      let prior=0;const samples=[7,23]; // Avoid sampling only repeated poses at half/quarter periods.
      const images=[first];
      for(const target of samples){await advance(target-prior);prior=target;const image=await shot();images.push(image);row.frames.push(id+'-'+target+'.png');await writeFile(output+'/'+row.frames.at(-1),image);}
      row.sampleTicks=[0,...samples];row.motionPixels=images.slice(1).map(b=>changed(pixels(first),pixels(b)));
      const bg=Buffer.alloc(pixels(first).length);for(let i=0;i<bg.length;i+=4){bg[i]=237;bg[i+1]=240;bg[i+2]=230;bg[i+3]=255;}
      row.visiblePixels=changed(pixels(first),bg);
      await advance(Math.round(d.animation.durationSeconds*30)-prior);
      row.loopChangedPixels=changed(pixels(first),pixels(await shot()));
      await page.evaluate(()=>{const a=window.runtime.active;a.frame.contentWindow.postMessage({type:'dispose',requestId:a.requestId,executionId:a.executionId,sequence:a.command++},'*');});
      await page.waitForFunction(()=>window.disposed || window.events.some(e=>e.type==='error'),{},{timeout:6000});
      row.dispose=await page.evaluate(()=>window.disposed);assert.ok(row.dispose,'Dispose hook failed');
      await start(d);row.restartChangedPixels=changed(pixels(first),pixels(await shot()));
      await page.evaluate(()=>window.runtime.dispose());
      row.removed=await page.locator('#review iframe').count()===0;
      row.accepted=row.visiblePixels>500 && Math.max(...row.motionPixels)>100 && row.restartChangedPixels===0 && row.loopChangedPixels===0 && row.dispose && row.removed;
      console.log(row.accepted?'PASS':'REVIEW',id,JSON.stringify({visible:row.visiblePixels,motion:row.motionPixels,loop:row.loopChangedPixels,restart:row.restartChangedPixels,dispose:row.dispose}));
    }catch(error){row.error=error.message;await page.evaluate(()=>window.runtime.dispose());console.log('FAIL',id,row.error);}
    rows.push(row);
  }
  await writeFile(output+'/report.json',JSON.stringify({sourceRun:basename(directory),runtimeWorkerSHA256:hash(await readFile(new URL('../../src/runtime/worker.js',import.meta.url))),generatedAt:new Date().toISOString(),scope:'Offline sandbox render/motion/restart/dispose; no API calls; no hard memory/GPU accounting',rows},null,2));
  const contact=await browser.newPage({viewport:{width:1000,height:1500},deviceScaleFactor:1});
  for(let part=0;part<rows.length;part+=5){
    let html='<style>body{margin:0;background:white;font:16px Arial}.row{height:280px}header{height:30px;padding:4px;box-sizing:border-box}.images{display:flex}img{width:250px;height:250px;object-fit:contain}</style>';
    for(const row of rows.slice(part,part+5)){
      html+='<div class="row"><header>'+row.id+' — sketch | frame 0 | frame 7 | frame 23</header><div class="images">';
      for(const path of [directory+'/'+row.id+'.png',...row.frames.map(f=>output+'/'+f)])html+='<img src="data:image/png;base64,'+(await readFile(path)).toString('base64')+'">';
      html+='</div></div>';
    }
    await contact.setContent(html);await contact.screenshot({path:output+'/sheet-'+part/5+'.png',fullPage:true});
  }
  console.log('Evidence:',output);
}finally{await browser?.close();const exited=once(server,'exit');server.kill('SIGTERM');await exited;}
