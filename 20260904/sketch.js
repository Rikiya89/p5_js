"use strict";

// Series settings and export pipeline retained from the existing artwork.
const W=1080,H=1920,FPS=60,MAX_DURATION=10,MAX_FRAMES=FPS*MAX_DURATION,LOOP_FRAMES=MAX_FRAMES,TAU=Math.PI*2;
const BG={r:3,g:3,b:5},INK={r:255,g:255,b:255},CYAN={r:0,g:229,b:255},MAGENTA={r:255,g:61,b:191},ACID={r:182,g:255,b:61};
const CONFIG={gravityStrength:1,eccentricity:.62,apoapsis:1,steps:12,dt:.006,trailHistory:600,preRoll:118,orbitScale:350,cameraDistance:1120,bloomScale:.5};
const BOUNDS={closed:.18,perturb:.35,rosette:.72,structure:.88,end:1};
const PHASES=[{end:.18,label:"01 · CLOSED ORBIT"},{end:.35,label:"02 · PERTURBATION"},{end:.72,label:"03 · PRECESSION"},{end:.88,label:"04 · ORBITAL ROSETTE"},{end:1,label:"05 · RETURN"}];
const HUD={safeX:56,stageY:374,trackY:418,bottomMainAlpha:140,citationAlpha:64};

let canvasEl,grainPg,hudPg,bloomPg,bloomStreakPg,perturbedFrames=[],closedFrames=[],backgroundStars=[];
let loopProgress=0,phase=0,muxer=null,encoder=null,isRecording=false,recFrameCount=0;
const previewParam=typeof window!=="undefined"?new URLSearchParams(window.location.search).get("preview"):null;
const previewProgress=previewParam===null?NaN:Number(previewParam);

function setup(){
  const cnv=createCanvas(W,H,WEBGL); canvasEl=cnv.elt;
  pixelDensity(1); frameRate(FPS); colorMode(RGB,255,255,255,255); strokeCap(ROUND);
  grainPg=createGraphics(W,H); grainPg.pixelDensity(1);
  hudPg=createGraphics(W,H); hudPg.pixelDensity(1);
  bloomPg=createGraphics(W*CONFIG.bloomScale,H*CONFIG.bloomScale,WEBGL); bloomPg.pixelDensity(1);
  bloomStreakPg=createGraphics(W*CONFIG.bloomScale,H*CONFIG.bloomScale); bloomStreakPg.pixelDensity(1);
  bakeGrain(); buildBackgroundStars(); buildOrbitFrames();
  const el=id=>document.getElementById(id);
  if(el("startBtn"))el("startBtn").onclick=startRecording;
  if(el("stopBtn"))el("stopBtn").onclick=stopRecording;
  if(el("maxDuration"))el("maxDuration").textContent=MAX_DURATION;
  if(el("canvasSize"))el("canvasSize").textContent=W+" × "+H;
  if(el("maxFrames"))el("maxFrames").textContent=MAX_FRAMES;
}

function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function smooth01(v){const t=clamp(v,0,1);return t*t*(3-2*t);}
function segment(t,a,b,x,y){return x+(y-x)*smooth01((t-a)/(b-a));}
function gravityExponentAt(t){
  if(t<BOUNDS.closed)return 2;
  if(t<BOUNDS.perturb)return segment(t,BOUNDS.closed,BOUNDS.perturb,2,2.05);
  if(t<.57)return segment(t,BOUNDS.perturb,.57,2.05,2.11);
  if(t<BOUNDS.structure)return 2.11;
  return segment(t,BOUNDS.structure,1,2.11,2);
}
function currentPhase(){return PHASES.find(p=>loopProgress<p.end)||PHASES[4];}

function bakeGrain(){
  grainPg.clear();grainPg.noStroke();randomSeed(20260904);
  for(let i=0;i<W*H*.0016;i++){const v=random(110,200);grainPg.fill(v,v,v,random(2,7));grainPg.circle(random(W),random(H),random(.15,.85));}
  for(let i=0;i<W*H*.000035;i++){const v=random(210,255);grainPg.fill(v,v,v,random(12,34));grainPg.circle(random(W),random(H),random(.4,1.2));}
}
function buildBackgroundStars(){
  randomSeed(20260904);
  for(let i=0;i<86;i++)backgroundStars.push({x:random(-W*.46,W*.46),y:random(-H*.34,H*.34),z:random(-240,120),size:random(.45,1.45),alpha:random(12,42),pulse:random(TAU)});
}

function createOrbitState(){return{x:CONFIG.apoapsis,y:0,vx:0,vy:Math.sqrt(CONFIG.gravityStrength*(1-CONFIG.eccentricity)/CONFIG.apoapsis)};}
function calculateAcceleration(x,y,n){const r2=Math.max(x*x+y*y,.0025),r=Math.sqrt(r2),f=-CONFIG.gravityStrength/Math.pow(r,n+1);return{x:x*f,y:y*f};}
function verlet(s,n,dt){
  const a=calculateAcceleration(s.x,s.y,n),x=s.x+s.vx*dt+.5*a.x*dt*dt,y=s.y+s.vy*dt+.5*a.y*dt*dt,b=calculateAcceleration(x,y,n);
  s.vx+=.5*(a.x+b.x)*dt;s.vy+=.5*(a.y+b.y)*dt;s.x=x;s.y=y;
}
function advance(s,n){for(let i=0;i<CONFIG.steps;i++)verlet(s,n,CONFIG.dt);return{x:s.x,y:s.y,radius:Math.hypot(s.x,s.y),speed:Math.hypot(s.vx,s.vy),exponent:n};}
function buildOrbitFrames(){
  const p=createOrbitState(),c=createOrbitState();
  for(let i=-CONFIG.preRoll;i<MAX_FRAMES;i++){
    const t=clamp(i/(MAX_FRAMES-1),0,1),n=i<0?2:gravityExponentAt(t);
    perturbedFrames.push(advance(p,n));closedFrames.push(advance(c,2));
  }
}

function updateLoopTime(){
  if(Number.isFinite(previewProgress))loopProgress=clamp(previewProgress,0,.999999);
  else if(isRecording)loopProgress=clamp(recFrameCount/(MAX_FRAMES-1),0,.999999);
  else loopProgress=((frameCount-1)%LOOP_FRAMES)/LOOP_FRAMES;
  phase=loopProgress*TAU;
}
function draw(){
  updateLoopTime();renderFrame();drawScreenFinish();
  if(isRecording){captureFrame();recFrameCount++;updateRecordingUI();if(recFrameCount>=MAX_FRAMES)stopRecording();}
}
function renderFrame(){
  background(BG.r,BG.g,BG.b);perspective(PI/3.35,W/H,10,5000);setupCamera();drawEnvironment();
  push();applySculptureTransform();drawFieldStructure();drawClosedReference();drawOrbitTrail();drawCentralMass();drawOrbitingBody();pop();
  renderBloomSource();streakBloom();compositeBloom();
}
function setupCamera(t=window){const b=1+.012*Math.sin(phase-PI*.35);t.camera(0,0,CONFIG.cameraDistance*b,0,35,0,0,1,0);}
function applySculptureTransform(t=window){
  const e=smooth01((loopProgress-.24)/.52);t.translate(0,-30,0);t.rotateX(-.08+.045*Math.sin(phase));t.rotateY(.10*Math.sin(phase*.5));t.rotateZ(-.11+.035*Math.sin(phase*.7)*e);
}
function drawEnvironment(){
  push();blendMode(ADD);noStroke();
  for(const s of backgroundStars){fill(255,255,255,s.alpha*(.78+.22*Math.sin(phase+s.pulse)));push();translate(s.x,s.y,s.z);circle(0,0,s.size);pop();}
  blendMode(BLEND);pop();
}
function drawFieldStructure(t=window,a=1){
  t.push();t.noFill();t.blendMode(ADD);
  for(let i=0;i<4;i++){const r=34+i*27;t.stroke(CYAN.r,CYAN.g,CYAN.b,(20-i*3)*a);t.strokeWeight(.75);t.circle(0,0,r*2);}
  t.rotateZ(phase*.035);
  for(let i=0;i<24;i++){const q=i/24*TAU,inner=112,outer=inner+(i%6===0?13:6);t.stroke(255,255,255,(i%6===0?26:12)*a);t.line(Math.cos(q)*inner,Math.sin(q)*inner,Math.cos(q)*outer,Math.sin(q)*outer);}
  t.blendMode(BLEND);t.pop();
}
function frameArrayIndex(){return CONFIG.preRoll+Math.floor(loopProgress*(MAX_FRAMES-1));}
function returnMix(){return smooth01((loopProgress-BOUNDS.structure)/(.985-BOUNDS.structure));}
function drawClosedReference(t=window,a=1){
  const end=frameArrayIndex(),start=Math.max(0,end-184),alpha=14+132*returnMix();
  t.push();t.noFill();t.blendMode(ADD);t.beginShape();
  for(let i=start;i<=end;i++){const p=closedFrames[i],age=(i-start)/Math.max(1,end-start);t.stroke(CYAN.r,CYAN.g,CYAN.b,alpha*smooth01(age)*a);t.strokeWeight((.65+1.05*age)*a);t.vertex(p.x*CONFIG.orbitScale,p.y*CONFIG.orbitScale,-5);}
  t.endShape();t.blendMode(BLEND);t.pop();
}
function trailVisibility(i,end){
  const start=Math.max(0,end-CONFIG.trailHistory),age=clamp((i-start)/Math.max(1,end-start),0,1);
  return Math.pow(age,.72)*(1-returnMix());
}
function trailColor(p,v,a=1){
  const peri=1-smooth01((p.radius-.2)/.8),pre=smooth01((p.exponent-2)/.11),mix=pre*.82;
  return{r:lerp(lerp(CYAN.r,MAGENTA.r,mix),ACID.r,peri*.32),g:lerp(lerp(CYAN.g,MAGENTA.g,mix),ACID.g,peri*.32),b:lerp(lerp(CYAN.b,MAGENTA.b,mix),ACID.b,peri*.32),alpha:(20+172*v+44*peri)*a,weight:(.55+1.65*v+.75*peri)*a};
}
function drawOrbitTrail(t=window,a=1){
  const end=frameArrayIndex(),start=Math.max(0,end-CONFIG.trailHistory);
  t.push();t.noFill();t.blendMode(ADD);t.beginShape();
  for(let i=start;i<=end;i++){const p=perturbedFrames[i],v=trailVisibility(i,end),c=trailColor(p,v,a);t.stroke(c.r,c.g,c.b,c.alpha);t.strokeWeight(c.weight);t.vertex(p.x*CONFIG.orbitScale,p.y*CONFIG.orbitScale,0);}
  t.endShape();
  for(let i=start+(30-start%30)%30;i<=end;i+=30){const p=perturbedFrames[i],v=trailVisibility(i,end);t.stroke(MAGENTA.r,MAGENTA.g,MAGENTA.b,72*v*a);t.strokeWeight(2.2*a);t.point(p.x*CONFIG.orbitScale,p.y*CONFIG.orbitScale,2);}
  t.blendMode(BLEND);t.pop();
}
function drawCentralMass(t=window,a=1){
  const p=.5+.5*Math.sin(phase*2);t.push();t.blendMode(ADD);t.noStroke();t.fill(CYAN.r,CYAN.g,CYAN.b,(24+12*p)*a);t.circle(0,0,(45+4*p)*a);t.fill(MAGENTA.r,MAGENTA.g,MAGENTA.b,52*a);t.circle(0,0,(20+2*p)*a);t.fill(255,255,255,242*a);t.circle(0,0,(7+p)*a);t.blendMode(BLEND);t.pop();
}
function drawOrbitingBody(t=window,a=1){
  const i=frameArrayIndex(),p=perturbedFrames[i],c=closedFrames[i],m=returnMix(),x=lerp(p.x,c.x,m)*CONFIG.orbitScale,y=lerp(p.y,c.y,m)*CONFIG.orbitScale,r=lerp(p.radius,c.radius,m),peri=1-smooth01((r-.2)/.8);
  t.push();t.translate(x,y,8);t.blendMode(ADD);t.noStroke();t.fill(ACID.r,ACID.g,ACID.b,(34+42*peri)*a);t.circle(0,0,(24+13*peri)*a);t.fill(255,255,255,245*a);t.circle(0,0,(6.5+3.5*peri)*a);t.blendMode(BLEND);t.pop();
}

function renderBloomSource(){
  const b=bloomPg;b.push();b.background(0);b.perspective(PI/3.35,W/H,10,5000);setupCamera(b);b.scale(CONFIG.bloomScale);applySculptureTransform(b);drawClosedReference(b,1.6);drawOrbitTrail(b,1.75);drawCentralMass(b,1.8);drawOrbitingBody(b,1.8);b.pop();
}
function streakBloom(){
  const s=bloomStreakPg,taps=8,spread=3+smooth01((loopProgress-.35)/.42)*3;s.clear();s.push();s.blendMode(ADD);s.imageMode(CENTER);
  for(let k=-taps;k<=taps;k++){const f=1-Math.abs(k)/taps;s.tint(255,255,255,7*f*f);s.image(bloomPg,s.width/2+k*spread,s.height/2);}
  s.pop();
}
function compositeBloom(){
  push();drawingContext.disable(drawingContext.DEPTH_TEST);resetMatrix();camera(0,0,1,0,0,0,0,1,0);ortho(-W/2,W/2,-H/2,H/2,-10,10);noLights();blendMode(ADD);tint(255,255,255,190);image(bloomStreakPg,-W/2,-H/2,W,H);noTint();blendMode(BLEND);drawingContext.enable(drawingContext.DEPTH_TEST);pop();
}

function drawFormula(g,n){
  g.textStyle(NORMAL);g.textFont("monospace");g.textAlign(CENTER,CENTER);g.textSize(34);g.fill(255,255,255,228);g.text("F(r)  ∝  −1 / rⁿ",W*.5,276);
  const m=smooth01((n-2)/.11);g.textSize(23);g.fill(lerp(CYAN.r,MAGENTA.r,m),lerp(CYAN.g,MAGENTA.g,m),lerp(CYAN.b,MAGENTA.b,m),220);g.text("n = "+n.toFixed(3),W*.5,319);
}
function drawScreenFinish(){
  const g=hudPg,info=currentPhase(),progress=clamp(Math.round(loopProgress*LOOP_FRAMES)/(LOOP_FRAMES-1),0,1),n=gravityExponentAt(loopProgress);
  g.clear();g.image(grainPg,0,0);g.noFill();g.stroke(255,255,255,38);g.strokeWeight(.7);
  const m=34,l=24;g.line(m,m,m+l,m);g.line(m,m,m,m+l);g.line(W-m,m,W-m-l,m);g.line(W-m,m,W-m,m+l);g.line(m,H-m,m+l,H-m);g.line(m,H-m,m,H-m-l);g.line(W-m,H-m,W-m-l,H-m);g.line(W-m,H-m,W-m,H-m-l);
  g.noStroke();g.textFont("Georgia");g.textAlign(CENTER,CENTER);g.textStyle(BOLD);g.fill(255,255,255,246);g.textSize(72);g.text("BERTRAND'S THEOREM",W*.5,210);drawFormula(g,n);
  g.textStyle(NORMAL);g.textFont("monospace");g.fill(255,255,255,166);g.textSize(26);g.text("A TINY CHANGE. THE ORBIT STOPS CLOSING.",W*.5,348);
  g.push();g.textAlign(LEFT,TOP);g.fill(255,255,255,235);g.textSize(26);g.text(info.label,HUD.safeX,HUD.stageY);g.textAlign(RIGHT,TOP);g.textSize(22);g.text("FORCE EXPONENT · "+n.toFixed(3),W-HUD.safeX,HUD.stageY+3);
  const x=lerp(HUD.safeX,W-HUD.safeX,progress);g.stroke(255,255,255,34);g.strokeWeight(1);g.line(HUD.safeX,HUD.trackY,W-HUD.safeX,HUD.trackY);g.stroke(255,255,255,184);g.strokeWeight(2.2);g.line(HUD.safeX,HUD.trackY,x,HUD.trackY);g.noStroke();g.fill(255,255,255,235);g.circle(x,HUD.trackY,8);g.pop();
  g.textAlign(CENTER,CENTER);g.fill(255,255,255,HUD.bottomMainAlpha);g.textSize(28);g.text("ONLY TWO CENTRAL FORCES CLOSE EVERY BOUNDED ORBIT",W*.5,1540);g.textSize(22);g.fill(255,255,255,HUD.citationAlpha);g.text("INVERSE-SQUARE GRAVITY · CLOSED → PRECESSING",W*.5,1620);
  push();drawingContext.disable(drawingContext.DEPTH_TEST);resetMatrix();camera(0,0,1,0,0,0,0,1,0);ortho(-W/2,W/2,-H/2,H/2,-10,10);noLights();blendMode(BLEND);image(g,-W/2,-H/2,W,H);drawingContext.enable(drawingContext.DEPTH_TEST);pop();
}

function keyReleased(){if(key==="r"||key==="R"){isRecording?stopRecording():startRecording();return false;}if(key==="s"||key==="S"){saveCanvas("bertrands_theorem_closed_orbits_"+getTimestamp(),"png");return false;}return true;}
function updateRecordingUI(){const el=id=>document.getElementById(id);if(el("duration"))el("duration").textContent=(recFrameCount/FPS).toFixed(1);if(el("frameCount"))el("frameCount").textContent=recFrameCount;if(el("progressFill"))el("progressFill").style.width=(recFrameCount/MAX_FRAMES*100).toFixed(1)+"%";}
function startRecording(){
  if(typeof VideoEncoder==="undefined"){alert("WebCodecs not supported.");return;}if(typeof Mp4Muxer==="undefined"){alert("mp4-muxer not loaded.");return;}
  muxer=new Mp4Muxer.Muxer({target:new Mp4Muxer.ArrayBufferTarget(),video:{codec:"avc",width:W,height:H},fastStart:"in-memory",firstTimestampBehavior:"offset"});
  encoder=new VideoEncoder({output:(chunk,meta)=>muxer.addVideoChunk(chunk,meta),error:error=>{console.error(error);isRecording=false;setStatus("Error","#f44");}});encoder.configure({codec:"avc1.640028",width:W,height:H,bitrate:18_000_000,framerate:FPS});
  recFrameCount=0;loopProgress=0;phase=0;isRecording=true;const el=id=>document.getElementById(id);if(el("duration"))el("duration").textContent="0.0";if(el("frameCount"))el("frameCount").textContent="0";if(el("startBtn"))el("startBtn").disabled=true;if(el("stopBtn"))el("stopBtn").disabled=false;if(el("progressFill"))el("progressFill").style.width="0%";setStatus("Recording…","#fff");
}
async function stopRecording(){
  if(!encoder||!muxer)return;isRecording=false;setStatus("Finalizing…","#ccc");await encoder.flush();muxer.finalize();const blob=new Blob([muxer.target.buffer],{type:"video/mp4"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="bertrands_theorem_closed_orbits_"+getTimestamp()+".mp4";a.click();encoder.close();encoder=null;muxer=null;setTimeout(()=>URL.revokeObjectURL(url),1000);const el=id=>document.getElementById(id);if(el("startBtn"))el("startBtn").disabled=false;if(el("stopBtn"))el("stopBtn").disabled=true;setStatus("Saved","#8f8");
}
function captureFrame(){if(!encoder||encoder.state!=="configured")return;const timestamp=Math.round(recFrameCount*1_000_000/FPS),frame=new VideoFrame(canvasEl,{timestamp});encoder.encode(frame,{keyFrame:recFrameCount%FPS===0});frame.close();}
function setStatus(textValue,colorValue){const status=document.getElementById("status");if(status){status.textContent=textValue;status.style.color=colorValue;}}
function getTimestamp(){const d=new Date();return d.getFullYear().toString()+String(d.getMonth()+1).padStart(2,"0")+String(d.getDate()).padStart(2,"0")+"_"+String(d.getHours()).padStart(2,"0")+String(d.getMinutes()).padStart(2,"0")+String(d.getSeconds()).padStart(2,"0");}
