/** Inspect trusted copied numeric geometry, never guest methods or callbacks. */
export function hasOpenBoundary(geometry) {
  const positions=geometry.attributes.position;
  const welded=new Map(), ids=new Uint32Array(positions.count);
  for(let i=0;i<positions.count;i++){
    const key=[0,1,2].map(j=>Math.round(positions.array[i*3+j]*1e6)).join(',');
    if(!welded.has(key))welded.set(key,welded.size);
    ids[i]=welded.get(key);
  }
  const indices=geometry.index?.array, count=indices?.length??ids.length, edges=new Map();
  for(let i=0;i+2<count;i+=3){
    const a=ids[indices?indices[i]:i],b=ids[indices?indices[i+1]:i+1],c=ids[indices?indices[i+2]:i+2];
    if(a===b||b===c||a===c)continue;
    for(const [u,v] of [[a,b],[b,c],[c,a]]){const key=u<v?u+','+v:v+','+u;edges.set(key,(edges.get(key)??0)+1);}
  }
  return [...edges.values()].some(count=>count===1);
}
