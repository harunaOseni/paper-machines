import test from 'node:test';
import assert from 'node:assert/strict';
import {requestGeneration} from '../public/generation-client.js';
const request=()=>({signal:new AbortController().signal,blob:new Blob(['sketch']),requestId:'request-test'});
function streamed(events){
  const bytes=new TextEncoder().encode(events.map(e=>JSON.stringify(e)+'\n').join(''));
  return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=7)c.enqueue(bytes.slice(i,i+7));c.close();}}),{headers:{'content-type':'application/x-ndjson'}});
}
test('progress parser handles split chunks and ignores wrong IDs, unknown or regressive stages',async()=>{
  const seen=[];
  const response=streamed([
    {type:'progress',requestId:'other',stage:'checking'},
    ...['validating','unknown','generating','validating','checking'].map(stage=>({type:'progress',requestId:'request-test',stage})),
    {type:'result',definition:{requestId:'request-test'}},
  ]);
  const result=await requestGeneration(request(),async()=>response,s=>seen.push(s));
  assert.deepEqual(seen,['validating','generating','checking']);assert.ok(result.definition);
});
test('progress parser fails on stream error or truncation without inventing completion',async()=>{
  await assert.rejects(requestGeneration(request(),async()=>streamed([{type:'error',error:'Try again'}])),/Try again/);
  await assert.rejects(requestGeneration(request(),async()=>streamed([])),/connection ended/);
});
test('legacy JSON response and cancellation remain supported',async()=>{
  assert.deepEqual(await requestGeneration(request(),async()=>Response.json({definition:{}})),{definition:{}});
  const controller=new AbortController();controller.abort();
  await assert.rejects(requestGeneration({...request(),signal:controller.signal},()=>assert.fail('Must not fetch')),{name:'AbortError'});
});
