function renderSample(ctx) {
ctx.save();ctx.translate(220,205);ctx.scale(1.05,1.05);ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#d87847';ctx.lineWidth=4;ctx.fillStyle='#edaa7440';ctx.beginPath();ctx.moveTo(42,135);ctx.bezierCurveTo(12,95,20,36,43,55);ctx.lineTo(77,100);ctx.bezierCurveTo(125,60,185,73,228,100);ctx.bezierCurveTo(255,30,280,56,263,125);ctx.bezierCurveTo(332,180,318,290,263,316);ctx.bezierCurveTo(188,355,58,345,26,295);ctx.bezierCurveTo(-8,247,1,171,42,135);ctx.fill();ctx.stroke();ctx.beginPath();ctx.ellipse(64,332,36,15,-.2,0,Math.PI*2);ctx.ellipse(244,334,36,14,.1,0,Math.PI*2);ctx.stroke();ctx.strokeStyle='#7b6047';ctx.lineWidth=5;for(const x of [111,205]){ctx.beginPath();ctx.ellipse(x,210,6,11,0,0,Math.PI*2);ctx.stroke();}ctx.beginPath();ctx.arc(159,235,15,0,Math.PI);ctx.stroke();ctx.strokeStyle='#d8784770';ctx.lineWidth=2;for(let i=0;i<6;i++){ctx.beginPath();ctx.moveTo(48+i*7,164);ctx.lineTo(37+i*7,188);ctx.stroke();}ctx.restore();
}

function paintStroke(ctx, stroke) {
  ctx.save();
  ctx.globalCompositeOperation = stroke.eraser ? 'destination-out' : 'source-over';
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const [first, ...rest] = stroke.points;
  ctx.beginPath();
  if (!rest.length) {
    ctx.arc(first.x, first.y, stroke.width / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.moveTo(first.x, first.y);
    for (const point of rest) ctx.lineTo(point.x, point.y);
    ctx.stroke();
  }
  ctx.restore();
}

export function renderSketch(ctx, state, active = null) {
  if (state.sample) renderSample(ctx);
  for (const stroke of state.strokes) paintStroke(ctx, stroke);
  if (active) paintStroke(ctx, active);
}
