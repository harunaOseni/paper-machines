import { validateObjectPackage } from '../paper-machines/object-contract.mjs';
import { acceptsRuntimeEvent } from './protocol.js';

export class ObjectRuntime {
  constructor(container,onStatus=()=>{}) {this.container=container;this.onStatus=onStatus;this.active=null;}
  start(definition) {
    this.dispose();
    if(!validateObjectPackage(definition).valid)throw new Error('Invalid object package');
    if(!globalThis.Worker || !globalThis.OffscreenCanvas || !OffscreenCanvas.prototype.transferToImageBitmap)throw new Error('This browser does not support isolated 3D playback.');
    const frame=document.createElement('iframe');
    frame.title='Your animated 3D creation';frame.setAttribute('sandbox','allow-scripts');
    frame.referrerPolicy='no-referrer';frame.setAttribute('allow',"camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'");
    const active={frame,requestId:definition.requestId,executionId:'execution-'+crypto.randomUUID(),lastSequence:-1,command:0,waiting:false,paused:false};
    this.active=active;
    const fail=message=>{if(this.active!==active)return;this.dispose();this.onStatus('error',message);};
    const watchdog=()=>{clearTimeout(active.deadline);active.deadline=setTimeout(()=>fail('The object stopped responding and was stopped.'),5000);};
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
    frame.src='/runtime/frame';this.container.replaceChildren(frame);watchdog();active.waiting=true;
    active.interval=setInterval(()=>{
      if(this.active!==active || active.waiting || active.paused)return;
      active.waiting=true;watchdog();
      frame.contentWindow.postMessage({type:'tick',requestId:active.requestId,executionId:active.executionId,sequence:active.command++},'*');
    },1000/30);
  }
  pause(value) {if(this.active)this.active.paused=value;}
  dispose() {
    const a=this.active;if(!a)return;this.active=null;
    clearTimeout(a.deadline);clearInterval(a.interval);window.removeEventListener('message',a.listener);
    // Removing the browsing context kills its worker even if guest dispose hangs.
    a.frame.contentWindow?.postMessage({type:'dispose',requestId:a.requestId,executionId:a.executionId,sequence:a.command++},'*');
    a.frame.remove();
  }
}
