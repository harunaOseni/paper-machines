// Held-out v1 sketches. Labels are evaluation-only and never sent to the generator.
export const CORPUS_VERSION = 'held-out-sketches-v1';
const orange='#e56b39', dark='#343c36', green='#718b70';
const line=(points,color=orange,width=7)=>({points:points.map(([x,y])=>({x,y})),color,width,eraser:false});
const oval=(x,y,rx,ry,color=orange,start=0,end=Math.PI*2)=>line(Array.from({length:81},(_,i)=>{const a=start+(end-start)*i/80;return [x+Math.cos(a)*rx,y+Math.sin(a)*ry];}),color);
const circle=()=>oval(400,400,180,180);
export const corpus = [
  {id:'ball-basket',category:'shape',expected:['ball','basketball'],strokes:[circle(),line([[220,400],[580,400]],dark),line([[400,220],[400,580]],dark),oval(270,400,105,180,dark,-Math.PI/2,Math.PI/2),oval(530,400,105,180,dark,Math.PI/2,Math.PI*1.5)]},
  {id:'ball-beach',category:'shape',expected:['ball','sphere'],strokes:[circle(),oval(400,400,65,180,green),line([[245,315],[555,315]],dark),line([[245,485],[555,485]],dark)]},
  {id:'ball-striped',category:'shape',expected:['ball','sphere'],strokes:[circle(),line([[260,280],[540,520]],green,12),line([[225,340],[475,565]],dark,9),line([[325,235],[575,455]],green,12)]},
  {id:'creature-cat',category:'creature',expected:['cat','kitten','feline'],strokes:[line([[260,340],[245,185],[345,265],[455,265],[555,185],[540,340]],dark),oval(400,375,150,120,orange,0,Math.PI),oval(400,470,100,90),line([[330,540],[310,625],[350,625]],dark),line([[455,540],[475,625],[435,625]],dark),oval(350,350,10,18,dark),oval(450,350,10,18,dark),line([[388,385],[412,385],[400,399],[388,385]],dark),line([[500,485],[570,465],[595,410],[580,380]],orange),line([[370,402],[260,380]],dark),line([[430,402],[540,380]],dark)]},
  {id:'creature-snail',category:'creature',expected:['snail'],strokes:[oval(360,410,145,140,green),line([[330,400],[370,370],[410,400],[400,450],[350,475],[310,440],[320,370]],green),line([[205,540],[545,540],[605,480],[600,420],[570,405],[545,475],[460,510],[205,540]],orange),line([[574,420],[550,365]],dark),line([[592,417],[625,365]],dark),oval(548,359,12,12,dark),oval(627,359,12,12,dark)]},
  {id:'creature-fish',category:'creature',expected:['fish'],strokes:[oval(365,400,175,100),line([[530,400],[645,295],[640,510],[530,400]],orange),line([[320,305],[395,240],[430,315]],green),line([[330,495],[405,555],[440,485]],green),oval(255,375,12,15,dark),line([[320,330],[345,390],[320,465]],dark),line([[192,414],[225,414]],dark)]},
  {id:'object-mug',category:'object',expected:['mug','cup'],strokes:[oval(350,270,145,45,dark),line([[205,270],[225,560],[270,600],[430,600],[475,560],[495,270]],orange),oval(510,415,115,100,orange,-Math.PI/2,Math.PI/2),oval(505,415,65,60,dark,-Math.PI/2,Math.PI/2)]},
  {id:'object-lamp',category:'object',expected:['lamp'],strokes:[line([[290,220],[510,220],[595,405],[205,405],[290,220]],green),line([[400,405],[400,635]],dark,12),oval(400,645,130,25,dark),line([[480,407],[480,470]],dark),oval(480,478,9,9,orange)]},
  {id:'object-rocket',category:'object',expected:['rocket','spaceship'],strokes:[line([[315,535],[315,330],[350,220],[400,145],[450,220],[485,330],[485,535],[315,535]],orange),line([[315,420],[235,540],[235,605],[315,535]],green),line([[485,420],[565,540],[565,605],[485,535]],green),oval(400,330,45,50,dark),line([[355,535],[345,620],[385,585],[405,670],[435,590],[455,625],[445,535]],orange)]},
  {id:'ambiguous-zigzag',category:'ambiguous',expected:[],strokes:[line([[225,280],[525,420],[285,535],[550,580]],dark)]},
  {id:'blank',category:'blank',expected:[],strokes:[]},
];
