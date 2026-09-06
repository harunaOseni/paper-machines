import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {deploymentConfig,parseOrigin,publicConfigSource} from '../src/deployment-config.mjs';
import {createGenerationHandler} from '../src/paper-machines/generation-service.mjs';

test('deployment defaults remain local; production requires explicit origins',()=>{
  assert.deepEqual(deploymentConfig({}),{host:'127.0.0.1',port:4173,allowedOrigins:null,apiOrigin:''});
  assert.throws(()=>deploymentConfig({NODE_ENV:'production'}),/ALLOWED_ORIGINS/);
  const result=deploymentConfig({NODE_ENV:'production',PORT:'8080',ALLOWED_ORIGINS:'https://app.example, https://preview.example/'});
  assert.equal(result.host,'0.0.0.0');assert.equal(result.port,8080);
  assert.deepEqual(result.allowedOrigins,['https://app.example','https://preview.example']);
  for(const PORT of ['hello','123x','-1','65536'])assert.throws(()=>deploymentConfig({PORT}));
});
test('origins reject wildcards, insecure public addresses and embedded data',()=>{
  for(const value of ['*','https://*.example','null','http://app.example','https://user:pass@app.example','https://app.example/path','https://app.example?key=secret','https://app.example#fragment','javascript:alert(1)'])assert.throws(()=>parseOrigin(value));
  assert.equal(parseOrigin('http://127.0.0.1:4173'),'http://127.0.0.1:4173');
  assert.equal(publicConfigSource('https://api.example').includes('https://api.example'),true);
});
test('cross-origin preflight is exact and allowed error responses carry CORS headers',async()=>{
  const server=http.createServer(createGenerationHandler({allowedOrigins:['https://app.example'],apiKey:'test-only'}));
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const url='http://127.0.0.1:'+server.address().port;
  try {
    const preflight={Origin:'https://app.example','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,x-paper-machines'};
    const response=await fetch(url,{method:'OPTIONS',headers:preflight});
    assert.equal(response.status,204);assert.equal(response.headers.get('access-control-allow-origin'),'https://app.example');
    assert.equal(response.headers.get('vary'),'Origin');
    for(const origin of ['https://app.example.evil','null','http://app.example']){
      const denied=await fetch(url,{method:'OPTIONS',headers:{...preflight,Origin:origin}});
      assert.equal(denied.status,403);assert.equal(denied.headers.get('access-control-allow-origin'),null);
    }
    assert.equal((await fetch(url,{method:'OPTIONS',headers:{...preflight,'Access-Control-Request-Headers':'authorization'}})).status,403);
    assert.equal((await fetch(url,{method:'OPTIONS',headers:{...preflight,'Access-Control-Request-Method':'DELETE'}})).status,403);
    const invalid=await fetch(url,{method:'POST',headers:{Origin:'https://app.example','Content-Type':'application/json','X-Paper-Machines':'1'},body:'null'});
    assert.equal(invalid.status,400);assert.equal(invalid.headers.get('access-control-allow-origin'),'https://app.example');
    assert.equal((await fetch(url,{method:'POST',body:'{}'})).status,403);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
