import {cp,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {buildRuntimeAssets} from '../src/runtime/assets.mjs';
import {parseOrigin,publicConfigSource} from '../src/deployment-config.mjs';

// Copy only public assets. No API key or .env file is needed for this build.
if(!process.env.PUBLIC_API_ORIGIN)throw new Error('Set PUBLIC_API_ORIGIN to the Railway HTTPS origin before building');
const apiOrigin=parseOrigin(process.env.PUBLIC_API_ORIGIN);
const output=new URL('../dist/',import.meta.url);
await mkdir(new URL('runtime/',output),{recursive:true});
await cp(new URL('../public/',import.meta.url),output,{recursive:true});
const {host}=await buildRuntimeAssets();
await writeFile(new URL('runtime/host.js',output),host);
await writeFile(new URL('deployment-config.js',output),publicConfigSource(apiOrigin));
console.log('Frontend built:',fileURLToPath(output));
