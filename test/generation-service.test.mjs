import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { PassThrough } from 'node:stream';
import { PNG } from 'pngjs';
import { generateObject, validateGenerationInput, lintObjectCode, readBounded, createGenerationHandler, generationSchema } from '../src/paper-machines/generation-service.mjs';
import { createExampleObject } from './fixtures/example-object.mjs';

function input(blank=false) {
  const p = new PNG({width:800,height:800}); p.data.fill(255);
  if (!blank) {p.data[0]=200;p.data[1]=80;p.data[2]=20;}
  const bytes=PNG.sync.write(p),sha256=createHash('sha256').update(bytes).digest('hex');
  return {creationId:'sketch-test',revision:1,requestId:'request-test',source:{imageId:'image-'+sha256.slice(0,58),sha256,widthPx:800,heightPx:800},imageBase64:bytes.toString('base64')};
}
const good=input();
test('HTTP progress arrives before provider completion; checks and result follow real completion',async()=>{
  let release;
  const gate=new Promise(r=>release=r);
  const server=http.createServer(createGenerationHandler({apiKey:'test',fetchImpl:async()=>{await gate;return reply();}}));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try {
    const origin='http://127.0.0.1:'+server.address().port;
    const response=await fetch(origin,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Paper-Machines':'1',Accept:'application/x-ndjson'},body:JSON.stringify(good)});
    assert.match(response.headers.get('content-type'),/ndjson/);
    const reader=response.body.getReader();let text='';
    while(!text.includes('generating'))text+=new TextDecoder().decode((await reader.read()).value);
    assert.ok(text.includes('validating'));assert.ok(!text.includes('checking'));assert.ok(!text.includes('definition'));
    release();
    while(true){const {done,value}=await reader.read();if(done)break;text+=new TextDecoder().decode(value);}
    const events=text.trim().split('\n').map(JSON.parse);
    assert.deepEqual(events.filter(e=>e.type==='progress').map(e=>e.stage),['validating','generating','checking']);
    assert.equal(events.at(-1).type,'result');assert.equal(events.at(-1).definition.requestId,good.requestId);
  } finally {release();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('provider schema gives every enum/constant an explicit type',()=>{
  const check=s=>{assert.ok(s.type);for(const child of Object.values(s.properties??{}))check(child);if(s.items)check(s.items);};
  check(generationSchema);
});
function reply(definition=createExampleObject()) {return new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(definition)}]}]}));}
test('PNG provenance, integrity, dimensions and blank input validated before API use',()=>{
  assert.equal(validateGenerationInput(good).requestId,good.requestId);
  for(const v of [null,{...good,revision:0},{...good,extra:true},{...good,imageBase64:'https://example.com/image.png'}, {...good,source:{...good.source,sha256:'0'.repeat(64)}}, {...good,source:{...good.source,widthPx:20000}}, input(true)]) assert.throws(()=>validateGenerationInput(v));
  const bytes=Buffer.from(good.imageBase64,'base64');bytes[40]^=255;
  const sha256=createHash('sha256').update(bytes).digest('hex');
  assert.throws(()=>validateGenerationInput({...good,imageBase64:bytes.toString('base64'),source:{...good.source,sha256,imageId:'image-'+sha256.slice(0,58)}}));
  const original=Buffer.from(good.imageBase64,'base64');
  for(const malformed of [Buffer.concat([original,Buffer.from('trailing')]),Buffer.concat([original.subarray(0,33),original.subarray(8)])]) {
    const sha256=createHash('sha256').update(malformed).digest('hex');
    assert.throws(()=>validateGenerationInput({...good,imageBase64:malformed.toString('base64'),source:{...good.source,sha256,imageId:'image-'+sha256.slice(0,58)}}),{code:'invalid_image'});
  }
});
test('generation sends exact image, no persistence, and returns server-owned provenance',async()=>{
  const result=await generateObject(good,{apiKey:'test-only',fetchImpl:async(url,options)=>{
    assert.equal(url,'https://api.openai.com/v1/responses');
    const body=JSON.parse(options.body);assert.equal(body.store,false);assert.equal(body.text.format.strict,true);
    assert.equal(body.reasoning.effort,'low');
    assert.equal(body.input[0].content[1].image_url,'data:image/png;base64,'+good.imageBase64);
    return reply();
  }});
  assert.deepEqual(result.definition.source,good.source);assert.equal(result.definition.requestId,good.requestId);
  assert.equal(result.execution,'pending-isolated-runtime');assert.equal(result.metrics.attempts,1);
});
test('missing key, access errors, rate limits, refusals and incomplete output are safe',async()=>{
  await assert.rejects(generateObject(good),{code:'not_configured'});
  for(const [status,code] of [[401,'provider_access'],[403,'provider_access'],[404,'provider_access'],[429,'provider_limit'],[500,'provider_error']])
    await assert.rejects(generateObject(good,{apiKey:'secret-not-for-output',fetchImpl:async()=>new Response('secret-not-for-output',{status})}),e=>e.code===code&&!e.message.includes('secret-not-for-output'));
  for(const [data,code] of [[{status:'incomplete',output:[]},'incomplete'],[{status:'completed',output:[{content:[{type:'refusal'}]}]},'refused'],[{status:'completed',output:[{content:[{type:'output_text',text:'bad'}]}]},'invalid_package']])
    await assert.rejects(generateObject(good,{apiKey:'test',fetchImpl:async()=>new Response(JSON.stringify(data))}),{code});
});
test('invalid code never reaches the runtime; lint is not execution',async()=>{
  for(const source of ['return {','fetch("x");return {};','while(true){}','return {root:new THREE.Scene(),update(){},dispose(){}}']) assert.ok(lintObjectCode(source).length);
  const pkg=createExampleObject();pkg.code.source='throw new Error("Must never execute");';
  await assert.rejects(generateObject(good,{apiKey:'test',fetchImpl:async()=>reply(pkg)}),{code:'invalid_package'});
});
test('upstream deadline and cancellation abort requests; bounded stream rejects excess bytes',async()=>{
  const fetchImpl=async(_,{signal})=>new Promise((_,reject)=>{
    if(signal.aborted)return reject(signal.reason);
    signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
  });
  // Keep the test event loop alive while AbortSignal.timeout's unref timer fires.
  const keep=setTimeout(()=>{},1000);
  try {await assert.rejects(generateObject(good,{apiKey:'test',fetchImpl,timeoutMs:5}),{code:'timeout'});}finally{clearTimeout(keep);}
  const c=new AbortController();c.abort();
  await assert.rejects(generateObject(good,{apiKey:'test',fetchImpl,signal:c.signal}),{code:'cancelled'});
  await assert.rejects(readBounded((async function*(){yield Buffer.alloc(5);})(),4),{code:'size_limit'});
});
test('HTTP origin/content guards and request rate limits',async()=>{
  const server=http.createServer(createGenerationHandler({apiKey:'test',fetchImpl:async()=>reply()}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const headers={'Content-Type':'application/json','X-Paper-Machines':'1',Origin:origin};
  try {
    assert.equal((await fetch(origin,{method:'POST',body:'{}'})).status,403);
    assert.equal((await fetch(origin,{method:'POST',headers:{...headers,Origin:'https://evil.example'},body:'{}'})).status,403);
    assert.equal((await fetch(origin,{method:'POST',headers,body:'null'})).status,400);
    for(let i=0;i<11;i++) assert.equal((await fetch(origin,{method:'POST',headers,body:JSON.stringify(good)})).status,200);
    assert.equal((await fetch(origin,{method:'POST',headers,body:JSON.stringify(good)})).status,429);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('aborting a stalled request body releases the reader',async()=>{
  const stream=new PassThrough(),controller=new AbortController();
  const reading=readBounded(stream,100,controller.signal);controller.abort();
  await assert.rejects(reading);
  assert.equal(stream.destroyed,true);
});
test('HTTP limits concurrent work and aborts provider on client disconnect',async()=>{
  let calls=0,aborted=0;
  const handler=createGenerationHandler({apiKey:'test',fetchImpl:async(_,{signal})=>{
    calls++;
    return new Promise((_,reject)=>signal.addEventListener('abort',()=>{aborted++;reject(signal.reason);},{once:true}));
  }});
  const server=http.createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port,headers={'Content-Type':'application/json','X-Paper-Machines':'1',Origin:origin};
  const controllers=[new AbortController(),new AbortController()];
  const pending=controllers.map((c,i)=>fetch(origin,{method:'POST',headers,signal:c.signal,body:JSON.stringify({...good,requestId:'request-'+i})}).catch(()=>null));
  try {
    for(let i=0;i<100&&calls<2;i++)await new Promise(r=>setTimeout(r,10));
    assert.equal(calls,2);
    assert.equal((await fetch(origin,{method:'POST',headers,body:JSON.stringify(good)})).status,429);
    controllers.forEach(c=>c.abort());await Promise.all(pending);
    for(let i=0;i<100&&aborted<2;i++)await new Promise(r=>setTimeout(r,10));
    assert.equal(aborted,2);
  } finally {controllers.forEach(c=>c.abort());server.closeAllConnections();await new Promise(r=>server.close(r));}
});
