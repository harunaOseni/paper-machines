import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { corpus, CORPUS_VERSION } from './corpus.mjs';
import { generateObject, PROMPT_VERSION } from '../../src/paper-machines/generation-service.mjs';

export function rasterize(strokes) {
  const p=new PNG({width:800,height:800});p.data.fill(255);
  for(const stroke of strokes) {
    const rgb=stroke.color.slice(1).match(/../g).map(h=>parseInt(h,16));
    const dot=(x,y)=>{
      const r=stroke.width/2;
      for(let py=Math.max(0,Math.floor(y-r));py<=Math.min(799,Math.ceil(y+r));py++) for(let px=Math.max(0,Math.floor(x-r));px<=Math.min(799,Math.ceil(x+r));px++) {
        if(Math.hypot(px-x,py-y)>r)continue; const offset=(py*800+px)*4;p.data.set(rgb,offset);
      }
    };
    for(let i=0;i<stroke.points.length;i++) {
      const a=stroke.points[Math.max(0,i-1)],b=stroke.points[i],steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)));
      for(let n=0;n<=steps;n++)dot(a.x+(b.x-a.x)*n/steps,a.y+(b.y-a.y)*n/steps);
    }
  }
  return PNG.sync.write(p);
}

if (process.argv.includes('--live')) {
  process.loadEnvFile(new URL('../../.env',import.meta.url));
  const runId=new Date().toISOString().replace(/[:.]/g,'-');
  const output=new URL(`./results/${runId}/`,import.meta.url);
  await mkdir(output,{recursive:true});
  const results=[];
  let writes=Promise.resolve();
  // Two independent in-flight cases, no automatic retries or repair.
  const queue=[...corpus];
  async function worker() {
    while(queue.length) {
      const item=queue.shift(),bytes=rasterize(item.strokes),sha256=createHash('sha256').update(bytes).digest('hex');
      const input={creationId:'eval-'+item.id,revision:1,requestId:'request-'+crypto.randomUUID(),source:{imageId:'image-'+sha256.slice(0,58),sha256,widthPx:800,heightPx:800},imageBase64:bytes.toString('base64')};
      await writeFile(new URL(item.id+'.png',output),bytes);
      const start=Date.now();let record;
      try {
        const result=await generateObject(input,{apiKey:process.env.OPENAI_API_KEY,model:process.env.OPENAI_MODEL||'gpt-6-astra'});
        await writeFile(new URL(item.id+'.json',output),JSON.stringify(result,null,2)+'\n');
        const description=result.definition.subject.summary.toLowerCase();
        record={id:item.id,category:item.category,source:input.source,packageValid:true,firstPass:true,repairAttempted:false,
          recognitionKeywordMatch:item.expected.length ? item.expected.some(w=>description.includes(w)):null,
          subject:result.definition.subject.summary,declaredMotion:result.definition.animation.description,
          renderedResemblanceScore:null,runtimeMotionScore:null,runtimeVerified:false,metrics:result.metrics};
      } catch(error) {
        record={id:item.id,category:item.category,packageValid:false,firstPass:false,repairAttempted:false,errorCode:error.code||'unknown',latencyMs:Date.now()-start};
        // Do not spend the remaining corpus on a known infrastructure failure.
        if (['provider_configuration','provider_access','quota_exhausted','not_configured'].includes(error.code)) queue.length=0;
      }
      results.push(record);console.log(JSON.stringify(record));
      const report=JSON.stringify({corpusVersion:CORPUS_VERSION,promptVersion:PROMPT_VERSION,runId,model:process.env.OPENAI_MODEL||'gpt-6-astra',
        limitations:'No isolated renderer yet. Recognition is a metadata keyword proxy; visual resemblance and actual motion remain unscored. The first v1 run was held out from prompt design; subsequent prompt tuning makes repeat runs regression tests, not fresh unseen evaluation. No pretraining exclusion is claimed.',results},null,2)+'\n';
      writes=writes.then(()=>writeFile(new URL('report.json',output),report));
      await writes;
    }
  }
  await Promise.all([worker(),worker()]);
  console.log('Report: '+decodeURIComponent(new URL('report.json',output).pathname));
} else if (process.argv[1]?.endsWith('run-generation.mjs')) {
  console.log('Use --live to run 10 paid model requests plus a local blank-input rejection. Results stay under test/eval/results/.');
}
