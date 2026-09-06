import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { acceptsRuntimeEvent, acceptsCommand } from '../src/runtime/protocol.js';
import { copyRenderable } from '../src/runtime/geometry-copy.js';
import {hasOpenBoundary} from '../src/runtime/surface-policy.js';
import {RUNTIME_LIMITS} from '../src/runtime/limits.js';

test('copy disposal releases each trusted resource exactly once',()=>{
  const original=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());
  const result=copyRenderable(original);let released=0;
  result.root.geometry.addEventListener('dispose',()=>released++);
  result.root.material.addEventListener('dispose',()=>released++);
  result.dispose();result.dispose();assert.equal(released,2);
  original.geometry.dispose();original.material.dispose();
});

test('index and draw-call budgets apply across the whole object',()=>{
  const root=new THREE.Group(),geometry=new THREE.BufferGeometry(),material=new THREE.MeshBasicMaterial();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(300003),1));
  root.add(new THREE.Mesh(geometry,material),new THREE.Mesh(geometry,material));
  assert.throws(()=>copyRenderable(root),/Index budget/);
  geometry.setIndex([0,1,2]);
  for(let i=0;i<65;i++)geometry.addGroup(0,3,0);
  for(const child of root.children)child.material=[material];
  assert.throws(()=>copyRenderable(root),/Draw call budget/);
  geometry.dispose();material.dispose();
});

test('material and attribute-byte budgets are aggregate limits',()=>{
  const root=new THREE.Group(),geometry=new THREE.BoxGeometry(),material=new THREE.MeshBasicMaterial();
  for(let i=0;i<17;i++)root.add(new THREE.Mesh(geometry,Array(8).fill(material)));
  assert.throws(()=>copyRenderable(root),/Material budget/);
  geometry.dispose();material.dispose();
  const large=new THREE.BufferGeometry();
  large.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));
  for(const [key,size] of [['normal',3],['uv',2],['color',3]])large.setAttribute(key,new THREE.BufferAttribute(new Float32Array(100000*size),size));
  const group=new THREE.Group(),m=new THREE.MeshBasicMaterial();
  for(let i=0;i<3;i++)group.add(new THREE.Mesh(large,m));
  assert.throws(()=>copyRenderable(group),/byte budget/);
  large.dispose();m.dispose();
  assert.ok(RUNTIME_LIMITS.cleanupMs<RUNTIME_LIMITS.frameMs);
});

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
