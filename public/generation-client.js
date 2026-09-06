/** Sends only the exact captured PNG and its provenance. Never sends credentials. */
export async function requestGeneration(request, fetchImpl = fetch) {
  request.signal.throwIfAborted();
  const bytes = new Uint8Array(await request.blob.arrayBuffer());
  let binary = '';
  for (let i=0; i<bytes.length; i+=8192) binary += String.fromCharCode(...bytes.subarray(i,i+8192));
  request.signal.throwIfAborted();
  const response = await fetchImpl('/api/generate', {
    method: 'POST', headers: { 'Content-Type':'application/json', 'X-Paper-Machines':'1' }, signal: request.signal,
    body: JSON.stringify({ creationId:request.creationId, revision:request.revision, requestId:request.requestId, source:request.source, imageBase64:btoa(binary) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Generation failed. Please try again.');
  return data;
}
