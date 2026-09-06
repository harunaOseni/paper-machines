import { validateObjectPackage } from '../paper-machines/object-contract.mjs';
import { acceptsRuntimeEvent } from './protocol.js';
import { RUNTIME_LIMITS } from './limits.js';

export class ObjectRuntime {
  constructor(container,onStatus=()=>{}) {this.container=container;this.onStatus=onStatus;this.active=null;this.retiring=null;}
  start(definition) {
    if(!validateObjectPackage(definition).valid)throw new Error('Invalid object package');
    if(!globalThis.Worker || !globalThis.OffscreenCanvas || !OffscreenCanvas.prototype.transferToImageBitmap)throw new Error('This browser does not support isolated 3D playback.');
    // At most one active worker and one short-lived retiring worker.
    this.retiring?.finish('terminated');
    this.dispose();
    const frame=document.createElement('iframe');
    frame.title='Your animated 3D creation';frame.setAttribute('sandbox','allow-scripts');
    frame.referrerPolicy='no-referrer';frame.setAttribute('allow',"camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'");
    const active={frame,requestId:definition.requestId,executionId:'execution-'+crypto.randomUUID(),lastSequence:-1,command:0,waiting:false,paused:false};
    this.active=active;
    const fail=message=>{if(this.active!==active)return;this.dispose(true);this.onStatus('error',message);};
    const watchdog=ms=>{clearTimeout(active.deadline);active.deadline=setTimeout(()=>fail('The object stopped responding and was stopped.'),ms);};
    active.listener=event=>{
      if(this.active!==active || !acceptsRuntimeEvent(event,frame.contentWindow,active))return;
      active.lastSequence=event.data.sequence;
      if(event.data.type==='error'){fail(event.data.diagnostic);return;}
      if(event.data.type==='ready'||event.data.type==='frame'){
        clearTimeout(active.deadline);active.waiting=false;
        if(event.data.type==='ready')this.onStatus('ready','Your sketch is alive.');
      }
    };
    window.addEventListener('message',active.listener);
    frame.onload=()=>{
      if(this.active!==active)return;
      frame.contentWindow.postMessage({type:'init',definition:structuredClone(definition),executionId:active.executionId},'*');
    };
    frame.src='/runtime/frame';this.container.append(frame);watchdog(RUNTIME_LIMITS.startupMs);active.waiting=true;
    active.interval=setInterval(()=>{
      if(this.active!==active || active.waiting || (active.paused && active.pendingScale===undefined))return;
      active.waiting=true;watchdog(RUNTIME_LIMITS.frameMs);
      const command={type:'tick',requestId:active.requestId,executionId:active.executionId,sequence:active.command++};
      if(active.pendingScale!==undefined){command.type='view';command.scale=active.pendingScale;active.pendingScale=undefined;}
      frame.contentWindow.postMessage(command,'*');
    },1000/RUNTIME_LIMITS.framesPerSecond);
  }
  pause(value) {if(this.active)this.active.paused=value;}
  setScale(value) {
    if(typeof value!=='number'||!Number.isFinite(value)||value<0.7||value>1.25)throw new Error('Invalid view scale');
    if(this.active)this.active.pendingScale=value;
  }
  dispose(force=false) {
    const a=this.active;
    if(!a){if(force)this.retiring?.finish('terminated');return this.retiring?.promise??Promise.resolve('idle');}
    this.retiring?.finish('terminated');this.active=null;
    clearTimeout(a.deadline);clearInterval(a.interval);window.removeEventListener('message',a.listener);
    a.frame.onload=null;a.frame.hidden=true;a.frame.style.display='none';
    if(force){a.frame.remove();return Promise.resolve('terminated');}
    let resolve, timer, finished=false;
    const promise=new Promise(done=>{resolve=done;});
    const finish=result=>{
      if(finished)return;finished=true;
      clearTimeout(timer);window.removeEventListener('message',listener);a.frame.remove();
      if(this.retiring?.frame===a.frame)this.retiring=null;
      resolve(result);
    };
    const listener=event=>{
      if(!acceptsRuntimeEvent(event,a.frame.contentWindow,a))return;
      a.lastSequence=event.data.sequence;
      if(event.data.type==='disposed')finish('disposed');
      else if(event.data.type==='error')finish('terminated');
    };
    this.retiring={frame:a.frame,promise,finish};
    window.addEventListener('message',listener);
    timer=setTimeout(()=>finish('terminated'),RUNTIME_LIMITS.cleanupMs);
    // Give cooperative cleanup a bounded chance, then destroy the context even
    // if the guest's dispose hook throws or loops forever.
    a.frame.contentWindow?.postMessage({type:'dispose',requestId:a.requestId,executionId:a.executionId,sequence:a.command++},'*');
    return promise;
  }
}
