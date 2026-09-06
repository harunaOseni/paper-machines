import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { acceptsRuntimeEvent, acceptsCommand } from '../src/runtime/protocol.js';
import { copyRenderable } from '../src/runtime/geometry-copy.js';
import {hasOpenBoundary} from '../src/runtime/surface-policy.js';

test('open sheets render both faces without changing closed volumes or explicit material intent',()=>{
  const closed=new THREE.BoxGeometry(),sphere=new THREE.SphereGeometry(1,12,8),plane=new THREE.PlaneGeometry();
  assert.equal(hasOpenBoundary(closed),false);assert.equal(hasOpenBoundary(sphere),false);assert.equal(hasOpenBoundary(plane),true);
  for(const [geometry,side,transparent,expected] of [[plane,0,false,2],[closed,0,false,0],[plane,1,false,1],[plane,0,true,0]]){
    const material=new THREE.MeshBasicMaterial({side,transparent});
    const result=copyRenderable(new THREE.Mesh(geometry,material));
    assert.equal(result.root.material.side,expected);assert.equal(material.side,side);
    result.dispose();material.dispose();
  }
  closed.dispose();sphere.dispose();plane.dispose();
});

test('runtime transport checks sender, opaque origin, IDs and replay sequence',()=>{
  const sender={},expected={requestId:'request-test',executionId:'execution-test',lastSequence:2};
  const data={protocolVersion:'1.0.0',requestId:'request-test',executionId:'execution-test',sequence:3,type:'ready',diagnostic:'Ready'};
  assert.equal(acceptsRuntimeEvent({source:sender,origin:'null',data},sender,expected),true);
  for(const event of [{source:{},origin:'null',data},{source:sender,origin:'http://localhost',data},{source:sender,origin:'null',data:{...data,sequence:2}},{source:sender,origin:'null',data:{...data,requestId:'old'}},{source:sender,origin:'null',data:{...data,executionId:'old'}},{source:sender,origin:'null',data:{...data,unexpected:true}}])assert.equal(acceptsRuntimeEvent(event,sender,expected),false);
  assert.equal(acceptsCommand({type:'tick',requestId:expected.requestId,executionId:expected.executionId,sequence:3},expected,2),true);
  assert.equal(acceptsCommand({type:'tick',requestId:expected.requestId,executionId:expected.executionId,sequence:2},expected,2),false);
});
test('renderer copies data, never callbacks, userData, parent or mutable buffers',()=>{
  const root=new THREE.Group(),g=new THREE.SphereGeometry(1,8,6),m=new THREE.MeshStandardMaterial({color:0xe56b39}),mesh=new THREE.Mesh(g,m);
  mesh.onBeforeRender=()=>{throw new Error('Must not reach renderer');};m.onBeforeCompile=()=>{throw new Error('Must not reach shader compiler');};
  root.userData.secret='private';root.add(mesh);
  const copy=copyRenderable(root),child=copy.root.children[0];
  assert.notEqual(child.onBeforeRender,mesh.onBeforeRender);assert.notEqual(child.material.onBeforeCompile,m.onBeforeCompile);
  assert.equal(copy.root.userData.secret,undefined);assert.equal(copy.root.parent,null);
  assert.notEqual(child.geometry.attributes.position.array,g.attributes.position.array);
  assert.notEqual(child.material,m);copy.dispose();g.dispose();m.dispose();
});
test('invalid geometry and oversized/cyclic scene data fails closed',()=>{
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());
  mesh.position.x=NaN;assert.throws(()=>copyRenderable(mesh));mesh.position.x=0;
  mesh.children.push(mesh);assert.throws(()=>copyRenderable(mesh));mesh.children=[];
  mesh.geometry.attributes.position.count=100001;assert.throws(()=>copyRenderable(mesh));
});
