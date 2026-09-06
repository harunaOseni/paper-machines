import 'ses';
import * as THREE from 'three';
import { OBJECT_API_KEYS, validateObjectPackage } from '../paper-machines/object-contract.mjs';
import { seededRandom } from '../paper-machines/object-lifecycle.mjs';
import { acceptsCommand } from './protocol.js';
import { copyRenderable } from './geometry-copy.js';

// Lock down this disposable worker realm only, never the application realm.
lockdown();
// Three assigns per-instance callbacks that shadow prototype defaults. Preserve
// that standard override behavior before freezing the shared prototypes. The
// setter only defines a property on its receiver; frozen prototypes stay frozen.
const patched=new Set();
for(const key of OBJECT_API_KEYS) {
  for(let prototype=THREE[key].prototype;prototype && prototype!==Object.prototype;prototype=Object.getPrototypeOf(prototype)) {
    if(patched.has(prototype))continue;patched.add(prototype);
    for(const name of Object.getOwnPropertyNames(prototype)) {
      const descriptor=Object.getOwnPropertyDescriptor(prototype,name);
      if(name==='constructor'||!descriptor.configurable||!descriptor.writable)continue;
      const value=descriptor.value;
      Object.defineProperty(prototype,name,{configurable:true,enumerable:descriptor.enumerable,
        get(){return harden(value);},set(next){Object.defineProperty(this,name,{value:next,writable:true,configurable:true,enumerable:true});}});
    }
  }
}
const objectAPI=harden(Object.fromEntries(OBJECT_API_KEYS.map(key=>[key,THREE[key]])));
let config, instance, renderer, scene, camera, currentCopy, lastCommand=-1, sequence=0, tick=0, stopped=false;
const emit=(type,diagnostic)=>{
  const event={protocolVersion:'1.0.0',requestId:config.requestId,executionId:config.executionId,sequence:sequence++,type,diagnostic};
  if(type==='ready'||type==='frame'){
    const bitmap=renderer.domElement.transferToImageBitmap();
    postMessage({...event,bitmap},[bitmap]);
  }else postMessage(event);
};
const sync=result=>{if(result && typeof result.then==='function'){Promise.resolve(result).catch(()=>{});throw new Error('Async lifecycle not supported');}};
function draw() {
  const next=copyRenderable(instance.root);
  if(currentCopy){scene.remove(currentCopy.root);currentCopy.dispose();}
  currentCopy=next;scene.add(next.root);renderer.render(scene,camera);
}
function release() {
  // Trusted resources must be released even when guest cleanup throws.
  try {currentCopy?.dispose();}
  finally {
    try {renderer?.dispose();}
    finally {renderer?.forceContextLoss();currentCopy=undefined;instance=undefined;scene=undefined;camera=undefined;renderer=undefined;}
  }
}
self.onmessage=event=>{
  try {
    const message=event.data;
    if(!config) {
      if(message?.type!=='init' || !validateObjectPackage(message.definition).valid || !/^execution-[a-f0-9-]+$/.test(message.executionId))return;
      config={...message.definition,executionId:message.executionId};
      const compartment=new Compartment({THREE:objectAPI,random:harden(seededRandom(config.animation.seed))});
      const factory=compartment.evaluate(`(function({THREE,random}) {\n${config.code.source}\n})`);
      instance=factory(harden({THREE:objectAPI,random:compartment.globalThis.random}));
      sync(instance);
      if(!instance?.root?.isObject3D || typeof instance.update!=='function' || typeof instance.dispose!=='function')throw new Error('Invalid lifecycle');
      // Explicit bitmap presentation avoids implicit cross-thread placeholder
      // compositing. The iframe acknowledges only after drawing this bitmap.
      renderer=new THREE.WebGLRenderer({canvas:new OffscreenCanvas(640,640),antialias:true,alpha:false});
      renderer.setSize(640,640,false);renderer.setClearColor(0xedf0e6);
      scene=new THREE.Scene();scene.add(new THREE.HemisphereLight(0xffffff,0x67735b,2.2));
      const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(-3,6,5);scene.add(light);
      const min=config.bounds.min,max=config.bounds.max;
      const center=new THREE.Vector3((min.x+max.x)/2,(min.y+max.y)/2,(min.z+max.z)/2);
      const radius=Math.max(max.x-min.x,max.y-min.y,max.z-min.z,0.1);
      camera=new THREE.PerspectiveCamera(38,1,0.01,10000);
      camera.position.copy(center).add(new THREE.Vector3(radius*.35,radius*.5,radius*2.1));camera.lookAt(center);
      sync(instance.update(harden({elapsedSeconds:0,deltaSeconds:0,tick:0})));draw();emit('ready','Object ready');return;
    }
    if(stopped || !acceptsCommand(message,config,lastCommand))return;
    lastCommand=message.sequence;
    if(message.type==='dispose') {
      stopped=true;
      try {sync(instance.dispose());}finally{release();}
      emit('disposed','Object disposed');self.close();return;
    }
    tick++;
    const duration=Math.max(1,Math.round(config.animation.durationSeconds*30));
    const sample=config.animation.loop?tick%duration:Math.min(tick,duration);
    sync(instance.update(harden({elapsedSeconds:sample/30,deltaSeconds:1/30,tick:sample})));
    draw();emit('frame','Frame rendered');
  }catch(error) {
    stopped=true;
    try {release();}catch{/* Context termination is the final cleanup fallback. */}
    if(config)emit('error','Object stopped: '+String(error?.message??'Runtime failure').slice(0,300));self.close();
  }
};
