import * as THREE from 'three';
import { hasOpenBoundary } from './surface-policy.js';

const number = value => { if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value)>1e6) throw new Error('Invalid numeric data'); return value; };
/** Read only approved data. Never expose a renderer/scene to generated callbacks. */
export function copyRenderable(root) {
  const geometries=[], materials=[]; let nodes=0, vertices=0;
  const seen=new Set();
  const dispose=()=>{geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());};
  const material=m=>{
    if (!m || !m.isMaterial) throw new Error('Invalid material');
    const color=new THREE.Color(number(m.color.r),number(m.color.g),number(m.color.b));
    const result=m.isMeshBasicMaterial ? new THREE.MeshBasicMaterial({color}) : new THREE.MeshStandardMaterial({color,roughness:Math.max(0,Math.min(1,number(m.roughness??0.7))),metalness:Math.max(0,Math.min(1,number(m.metalness??0)))});
    materials.push(result);
    result.side=[0,1,2].includes(m.side)?m.side:0;
    result.opacity=Math.max(0,Math.min(1,number(m.opacity)));result.transparent=m.transparent===true;
    result.flatShading=m.flatShading===true;
    return result;
  };
  function copy(node,depth=0) {
    if (!node || !node.isObject3D || depth>32 || ++nodes>128 || seen.has(node)) throw new Error('Invalid object graph');
    seen.add(node);let result;
    if (node.isMesh) {
      const source=node.geometry;
      if (!source?.isBufferGeometry) throw new Error('Invalid geometry');
      const geometry=new THREE.BufferGeometry();geometries.push(geometry);
      for (const [name,size] of [['position',3],['normal',3],['uv',2],['color',3]]) {
        const attr=source.attributes[name];if(!attr)continue;
        if(attr.itemSize!==size || !Number.isInteger(attr.count) || attr.count<1 || attr.count>100000)throw new Error('Invalid attribute');
        if(name==='position'){vertices+=attr.count;if(vertices>100000)throw new Error('Vertex budget exceeded');}
        const data=new Float32Array(attr.count*size);
        if(attr.array.length!==data.length)throw new Error('Invalid attribute array');
        for(let i=0;i<data.length;i++)data[i]=number(attr.array[i]);
        geometry.setAttribute(name,new THREE.BufferAttribute(data,size));
      }
      if(!geometry.attributes.position)throw new Error('Missing positions');
      if(source.index) {
        const count=source.index.count;
        if(!Number.isInteger(count)||count<1||count>600000)throw new Error('Index budget exceeded');
        const indices=new Uint32Array(count);
        for(let i=0;i<count;i++){const value=source.index.array[i];if(!Number.isInteger(value)||value<0||value>=geometry.attributes.position.count)throw new Error('Invalid index');indices[i]=value;}
        geometry.setIndex(new THREE.BufferAttribute(indices,1));
      }
      const materialList=Array.isArray(node.material)?node.material:[node.material];
      if(materialList.length<1||materialList.length>8)throw new Error('Material budget exceeded');
      const mapped=materialList.map(material);
      // Thin open sheets have two visible faces. A sketch supplies no preferred
      // winding. Normalize only default front-sided opaque materials on open
      // surfaces; closed volumes and explicit back/double-sided choices remain.
      if(hasOpenBoundary(geometry))for(const m of mapped){
        if(m.side===THREE.FrontSide && !m.transparent)m.side=THREE.DoubleSide;
      }
      if(!Array.isArray(source.groups)||source.groups.length>128)throw new Error('Invalid geometry groups');
      for(const group of (Array.isArray(node.material)?source.groups:[])){const max=geometry.index?.count??geometry.attributes.position.count;
        if(![group.start,group.count,group.materialIndex].every(Number.isInteger)||group.start<0||group.count<0||group.start+group.count>max||group.materialIndex<0||group.materialIndex>=mapped.length)throw new Error('Invalid geometry group');
        geometry.addGroup(group.start,group.count,group.materialIndex);
      }
      result=new THREE.Mesh(geometry,Array.isArray(node.material)?mapped:mapped[0]);
    } else result=new THREE.Group();
    result.position.set(number(node.position.x),number(node.position.y),number(node.position.z));
    result.quaternion.set(number(node.quaternion.x),number(node.quaternion.y),number(node.quaternion.z),number(node.quaternion.w));
    result.scale.set(number(node.scale.x),number(node.scale.y),number(node.scale.z));
    result.visible=node.visible!==false;
    if(!Array.isArray(node.children)||node.children.length>128)throw new Error('Invalid children');
    for(const child of node.children)result.add(copy(child,depth+1));
    return result;
  }
  try{return {root:copy(root),dispose};}catch(error){dispose();throw error;}
}
