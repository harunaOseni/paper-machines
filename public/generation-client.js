/** Sends only the exact captured PNG and its provenance. Never sends credentials. */
export async function requestGeneration(request, fetchImpl = fetch, onProgress = () => {}) {
  request.signal.throwIfAborted();
  const bytes = new Uint8Array(await request.blob.arrayBuffer());
  let binary = '';
  for (let i=0; i<bytes.length; i+=8192) binary += String.fromCharCode(...bytes.subarray(i,i+8192));
  request.signal.throwIfAborted();
  const response = await fetchImpl('/api/generate', {
    method: 'POST', headers: { 'Content-Type':'application/json', 'X-Paper-Machines':'1', Accept:'application/x-ndjson' }, signal: request.signal,
    body: JSON.stringify({ creationId:request.creationId, revision:request.revision, requestId:request.requestId, source:request.source, imageBase64:btoa(binary) }),
  });
  if (response.ok && response.headers.get('content-type')?.includes('application/x-ndjson')) {
    const reader=response.body.getReader(), decoder=new TextDecoder();
    let buffer='', size=0, last=-1;
    const stages=['validating','generating','checking'];
    try {
      while(true) {
        request.signal.throwIfAborted();
        const {done,value}=await reader.read();
        if(done)throw new Error('The connection ended before generation finished. Please try again.');
        size+=value.byteLength;
        if(size>2*1024*1024)throw new Error('The generation response exceeded its size limit.');
        buffer+=decoder.decode(value,{stream:true});
        let newline;
        while((newline=buffer.indexOf('\n'))>=0) {
          const line=buffer.slice(0,newline); buffer=buffer.slice(newline+1);
          if(!line.trim())continue;
          const event=JSON.parse(line);
          request.signal.throwIfAborted();
          if(event.type==='error')throw new Error(event.error || 'Generation failed. Please try again.');
          if(event.type==='result')return event;
          if(event.type!=='progress'||event.requestId!==request.requestId)continue;
          const index=stages.indexOf(event.stage);
          if(index>last){last=index;onProgress(event.stage);}
        }
      }
    } finally { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Generation failed. Please try again.');
  return data;
}
