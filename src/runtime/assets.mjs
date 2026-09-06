import { build } from 'esbuild';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export async function buildRuntimeAssets() {
  const compile=async(entry,format)=>(await build({entryPoints:[fileURLToPath(new URL(entry,import.meta.url))],bundle:true,write:false,format,platform:'browser',target:'es2022',banner:{js:'"use strict";'},minify:false,logLevel:'silent'})).outputFiles[0].text;
  const [host,worker]=await Promise.all([compile('./host.js','esm'),compile('./worker.js','iife')]);
  return {host,frame() {
    const nonce=randomBytes(18).toString('base64');
    const csp=`default-src 'none'; script-src 'nonce-${nonce}' 'unsafe-eval'; worker-src blob:; connect-src 'none'; style-src 'unsafe-inline'; img-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts`;
    const encoded=Buffer.from(worker).toString('base64');
    const html=`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;overflow:hidden;background:#edf0e6}canvas{display:block;width:100%;height:100%;object-fit:contain}</style><canvas width="640" height="640"></canvas><script nonce="${nonce}">
      let worker, ids, parentOrigin, last=-1;
      addEventListener('message',event=>{
        if(event.source!==parent)return;
        const m=event.data;
        if(!worker){
          if(m?.type!=='init'||!m.definition||!/^execution-[a-f0-9-]+$/.test(m.executionId))return;
          parentOrigin=event.origin;ids={requestId:m.definition.requestId,executionId:m.executionId};
          const source=atob('${encoded}');
          const url=URL.createObjectURL(new Blob([Uint8Array.from(source,c=>c.charCodeAt(0))],{type:'text/javascript'}));
          worker=new Worker(url);URL.revokeObjectURL(url);
          const canvas=document.querySelector('canvas'),context=canvas.getContext('2d',{alpha:false});
          worker.onmessage=e=>{
            const {bitmap,...event}=e.data;
            if((event.type==='ready'||event.type==='frame') && !bitmap){event.type='error';event.diagnostic='The object did not provide a display frame.';}
            if(bitmap){
              try {
                if(bitmap.width!==640||bitmap.height!==640)throw new Error('Invalid frame size');
                context.drawImage(bitmap,0,0);
              }catch(error){event.type='error';event.diagnostic='Could not display the object frame.';}
              finally{bitmap.close();}
            }
            parent.postMessage(event,parentOrigin);
          };
          worker.onerror=e=>parent.postMessage({protocolVersion:'1.0.0',...ids,sequence:1000000000,type:'error',diagnostic:'Runtime startup failed: '+String(e.message||'Worker unavailable').slice(0,300)},parentOrigin);
          worker.postMessage(m);return;
        }
        if(event.origin!==parentOrigin||m?.requestId!==ids.requestId||m.executionId!==ids.executionId||!Number.isSafeInteger(m.sequence)||m.sequence<=last)return;
        if(!['tick','dispose'].includes(m.type)||Object.keys(m).length!==4)return;
        last=m.sequence;worker.postMessage(m);
      });
      addEventListener('pagehide',()=>worker?.terminate());
    </script>`;
    return {html,csp};
  }};
}
