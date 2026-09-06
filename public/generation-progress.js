const stages = [
  ['sending','Sending your sketch','Preparing and sending the captured sketch.'],
  ['validating','Checking your sketch','Checking the image and its fingerprint.'],
  ['generating','Generating your object',''],
  ['checking','Checking the result','Validating the returned object before playback.'],
  ['opening','Bringing it to life','Starting the isolated 3D renderer.'],
];

/** Advances only on actual request/runtime events. Time is elapsed, not an ETA. */
export class GenerationProgress {
  constructor(container) {
    this.container=container;
    container.innerHTML='<ol aria-label="Creation stages"></ol><p class="generation-detail" role="status" aria-live="polite"></p><span class="generation-elapsed"></span>';
    this.list=container.querySelector('ol');this.detail=container.querySelector('p');this.elapsed=container.querySelector('span');
    this.reset();
  }
  reset(){clearInterval(this.timer);this.stage=null;this.container.hidden=true;}
  start(){this.reset();this.started=performance.now();this.container.hidden=false;this.set('sending');this.timer=setInterval(()=>this.updateTime(),1000);this.updateTime();}
  updateTime(){this.elapsed.textContent=Math.floor((performance.now()-this.started)/1000)+'s elapsed';}
  set(stage){
    const index=stages.findIndex(s=>s[0]===stage);if(index<0)return;
    this.stage=stage;this.container.dataset.stage=stage;this.container.dataset.failed='false';
    this.list.replaceChildren(...stages.map(([id,label],i)=>{
      const item=document.createElement('li');item.textContent=label;
      item.dataset.state=i<index?'done':i===index?'active':'pending';
      if(i===index)item.setAttribute('aria-current','step');return item;
    }));
    this.detail.textContent=stages[index][2];
    this.detail.hidden=!stages[index][2];
  }
  fail(message){clearInterval(this.timer);this.container.dataset.failed='true';this.detail.hidden=false;this.detail.textContent=message;this.updateTime();}
  complete(){this.reset();}
}
