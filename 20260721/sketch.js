'use strict';

// Canvas, timing, palette, and export settings preserved from 20260720.
const W = 1080, H = 1920, FPS = 60, MAX_DURATION = 10;
const MAX_FRAMES = FPS * MAX_DURATION, LOOP_FRAMES = MAX_FRAMES, TAU = Math.PI * 2;
const BG_R = 3, BG_G = 3, BG_B = 5;
const INK_R = 255, INK_G = 255, INK_B = 255;
const CYAN = { r:0, g:229, b:255 }, MAGENTA = { r:255, g:61, b:191 }, ACID = { r:182, g:255, b:61 };

const PARAMS = {
  exponent:5, radius:1, theta:0, pointCount:240, trailLength:120,
  layerCount:12, depthSpacing:45, animationSpeed:1, cameraDistance:900,
  autoRotate:true, showAxes:true, showUnitCircle:true, showPowerTrail:true,
  showRootsOfUnity:true, showConnections:true, glowStrength:1
};

let canvasEl, muxer = null, encoder = null, isRecording = false, recFrameCount = 0;
let paused = false, showHUD = true, frozenFrame = 0;

function setup() {
  setAttributes({ alpha:false, antialias:true, preserveDrawingBuffer:true });
  const cnv = createCanvas(W, H, WEBGL); canvasEl = cnv.elt;
  pixelDensity(1); frameRate(FPS); colorMode(RGB,255,255,255,255);
  document.getElementById('canvas-wrap').appendChild(canvasEl);
  document.getElementById('maxDuration').textContent = MAX_DURATION;
  document.getElementById('maxFrames').textContent = MAX_FRAMES;
  bindControls();
}

function bindControls() {
  const bind = (id, key, digits=0) => {
    const el = document.getElementById(id), out = document.getElementById(id+'Out');
    el.addEventListener('input', () => { PARAMS[key] = +el.value; out.textContent = (+el.value).toFixed(digits); });
  };
  bind('exponent','exponent'); bind('radius','radius',2); bind('speed','animationSpeed',2); bind('glow','glowStrength',2);
  document.getElementById('startBtn').addEventListener('click', startRecording);
  document.getElementById('stopBtn').addEventListener('click', stopRecording);
  document.getElementById('pngBtn').addEventListener('click', () => saveCanvas('de_moivre_'+ts(),'png'));
}

function draw() {
  const sourceFrame = isRecording ? recFrameCount : frameCount;
  if (!paused || isRecording) frozenFrame = sourceFrame;
  const state = updateSimulation(frozenFrame);
  background(BG_R, BG_G, BG_B);
  perspective(PI/3, W/H, 10, 5000);
  updateCamera(state);
  ambientLight(18,18,24); pointLight(CYAN.r,CYAN.g,CYAN.b,0,-300,500);
  drawDeMoivreField(state);
  if (showHUD) drawHUD(state);
  if (isRecording) {
    captureFrame(); recFrameCount++; updateRecordingUi();
    if (recFrameCount >= MAX_FRAMES) stopRecording();
  }
}

function updateSimulation(frame) {
  const loop = ((frame % LOOP_FRAMES) / LOOP_FRAMES * PARAMS.animationSpeed) % 1;
  const theta = TAU * loop;
  const n = PARAMS.exponent;
  return { loop, theta, n, poweredAngle:n*theta, magnitude:PARAMS.radius, poweredMagnitude:Math.pow(PARAMS.radius,n), breathe:.5-.5*Math.cos(TAU*loop) };
}

function updateCamera(s) {
  const orbit = PARAMS.autoRotate ? TAU*s.loop : -0.55;
  const d = PARAMS.cameraDistance;
  camera(Math.sin(orbit)*d*.68, -180+Math.sin(TAU*s.loop)*55, Math.cos(orbit)*d*.68, 0, 35, 0, 0,1,0);
}

function drawDeMoivreField(s) {
  push(); rotateX(-0.18);
  drawExponentLayers(s);
  if (PARAMS.showPowerTrail) drawPowerTrail(s);
  if (PARAMS.showRootsOfUnity) drawRootsOfUnity(s);
  drawInputTransformation(s);
  pop();
}

// Polar z = r(cos(theta)+i sin(theta)); z^n uses r^n and n*theta exactly.
function calculateComplexPower(r, theta, n) {
  const magnitude = Math.pow(r,n), angle = n*theta;
  return { r:magnitude*Math.cos(angle), i:magnitude*Math.sin(angle), magnitude, angle };
}
function polarToCartesian(r,a){ return { r:r*Math.cos(a), i:r*Math.sin(a) }; }
function complexMultiply(a,b){ return { r:a.r*b.r-a.i*b.i, i:a.r*b.i+a.i*b.r }; }
function mapComplexTo3D(z, depth, scale=250){ return { x:z.r*scale, y:-z.i*scale, z:depth }; }
function interpolate(a,b,t){ return a+(b-a)*t; }
function loopTiming(frame){ return (frame%LOOP_FRAMES)/LOOP_FRAMES; }

function drawExponentLayers(s) {
  const half = (PARAMS.layerCount-1)*.5;
  for (let j=0;j<PARAMS.layerCount;j++) {
    const depth=(j-half)*PARAMS.depthSpacing;
    const fade=1-Math.abs(j-half)/(half+1);
    push(); translate(0,0,depth);
    drawComplexPlane(210, fade, j===Math.floor(half));
    const layerN = 1 + (j % s.n);
    drawSymmetryPolygon(layerN, s.theta+j*TAU/PARAMS.layerCount, 130+layerN*10, depth, fade);
    pop();
  }
}

function drawComplexPlane(radius, fade, central) {
  noFill();
  if (PARAMS.showUnitCircle) {
    glowStroke(INK_R,INK_G,INK_B,central?80:24,central?1.5:.65); circle3D(radius,96);
  }
  if (PARAMS.showAxes) {
    stroke(CYAN.r,CYAN.g,CYAN.b,central?150:35); strokeWeight(central?1.7:.7); line(-radius*1.18,0,0,radius*1.18,0,0);
    stroke(MAGENTA.r,MAGENTA.g,MAGENTA.b,central?150:35); line(0,-radius*1.18,0,0,radius*1.18,0);
  }
}

function circle3D(radius, segments) {
  beginShape(); for(let i=0;i<=segments;i++){ const a=TAU*i/segments; vertex(radius*Math.cos(a),radius*Math.sin(a),0); } endShape();
}

function drawSymmetryPolygon(n, baseTheta, radius, depth, fade) {
  const pts=[];
  for(let k=0;k<n;k++){ const a=baseTheta+TAU*k/n; pts.push({x:radius*Math.cos(a),y:radius*Math.sin(a)}); }
  if(PARAMS.showConnections && n>1){ noFill(); stroke(ACID.r,ACID.g,ACID.b,35+fade*75); strokeWeight(.8); beginShape(); pts.forEach(p=>vertex(p.x,p.y,0)); endShape(CLOSE); }
  pts.forEach((p,k)=>glowPoint(p.x,p.y,0,k%2?MAGENTA:CYAN,2.4+fade*2));
}

function drawPowerTrail(s) {
  const trail=[];
  const scale=245, half=(s.n-1)*.5;
  for(let power=1;power<=s.n;power++){
    const z=calculateComplexPower(PARAMS.radius,s.theta,power);
    const safeMag=Math.min(1.55,z.magnitude);
    const p=mapComplexTo3D(polarToCartesian(safeMag,z.angle),(power-1-half)*PARAMS.depthSpacing*2.05,scale);
    trail.push(p);
  }
  if(PARAMS.showConnections){ noFill(); stroke(INK_R,INK_G,INK_B,150); strokeWeight(1.2); beginShape(); trail.forEach(p=>vertex(p.x,p.y,p.z)); endShape(); }
  trail.forEach((p,i)=>{
    const col=i===trail.length-1?ACID:(i%2?MAGENTA:CYAN); glowPoint(p.x,p.y,p.z,col,i===trail.length-1?9:5);
    if(PARAMS.showConnections){ stroke(col.r,col.g,col.b,45); strokeWeight(.7); line(0,0,p.z,p.x,p.y,p.z); }
  });
  drawPhaseRibbon(s);
}

function drawPhaseRibbon(s) {
  noFill(); stroke(CYAN.r,CYAN.g,CYAN.b,52); strokeWeight(1);
  beginShape();
  for(let i=0;i<=PARAMS.pointCount;i++){
    const u=i/PARAMS.pointCount, phase=s.theta+TAU*u, exponent=1+(s.n-1)*u;
    const mag=Math.min(1.4,Math.pow(PARAMS.radius,exponent));
    vertex(205*mag*Math.cos(exponent*phase),205*mag*Math.sin(exponent*phase),(u-.5)*PARAMS.depthSpacing*s.n*2.1);
  }
  endShape();
}

function drawRootsOfUnity(s) {
  const radius=285, z=(PARAMS.layerCount*.5+1)*PARAMS.depthSpacing;
  const pts=[];
  for(let k=0;k<s.n;k++){ const root=polarToCartesian(1,TAU*k/s.n+s.theta*.12); pts.push({x:root.r*radius,y:root.i*radius,z}); }
  if(PARAMS.showConnections){ stroke(MAGENTA.r,MAGENTA.g,MAGENTA.b,145); strokeWeight(1.5); noFill(); beginShape(); pts.forEach(p=>vertex(p.x,p.y,p.z)); endShape(CLOSE); }
  pts.forEach(p=>glowPoint(p.x,p.y,p.z,MAGENTA,7));
}

function drawInputTransformation(s) {
  const base=polarToCartesian(PARAMS.radius,s.theta), result=calculateComplexPower(PARAMS.radius,s.theta,s.n);
  const a=mapComplexTo3D(base,0,245), b=mapComplexTo3D(polarToCartesian(Math.min(1.55,result.magnitude),result.angle),0,245);
  stroke(CYAN.r,CYAN.g,CYAN.b,210); strokeWeight(2); line(0,0,0,a.x,a.y,0); glowPoint(a.x,a.y,0,CYAN,8);
  stroke(ACID.r,ACID.g,ACID.b,220); strokeWeight(2.4); line(0,0,0,b.x,b.y,0); glowPoint(b.x,b.y,0,ACID,11);
  drawAngleArc(s.theta,74,CYAN); drawAngleArc(s.poweredAngle,104,ACID);
}

function drawAngleArc(angle,radius,col){
  const a=Math.max(-TAU*2,Math.min(TAU*2,angle)); noFill(); stroke(col.r,col.g,col.b,165); strokeWeight(2); beginShape();
  const steps=48; for(let i=0;i<=steps;i++){const t=a*i/steps;vertex(radius*Math.cos(t),-radius*Math.sin(t),3)} endShape();
}

function glowStroke(r,g,b,a,w){ stroke(r,g,b,a*PARAMS.glowStrength); strokeWeight(w); }
function glowPoint(x,y,z,col,size){
  push(); translate(x,y,z); noStroke(); fill(col.r,col.g,col.b,24*PARAMS.glowStrength); sphere(size*2.7,8,5); fill(col.r,col.g,col.b,240); sphere(size,10,6); pop();
}

function drawHUD(s) {
  push(); resetMatrix(); translate(-W/2,-H/2,0); noLights();
  const ctx=drawingContext, mono='ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  noStroke(); fill(BG_R,BG_G,BG_B,218); rect(0,0,W,300); rect(0,H-430,W,430);
  stroke(255,255,255,32); strokeWeight(1); line(72,300,W-72,300); line(72,H-430,W-72,H-430);
  ctx.save(); ctx.textAlign='center'; ctx.textBaseline='top';
  ctx.font=`30px ${mono}`; ctx.fillStyle='rgba(255,255,255,.9)'; ctx.fillText('DE MOIVRE’S THEOREM',W/2,118);
  ctx.font=`23px ${mono}`; ctx.fillStyle='rgba(255,255,255,.72)'; ctx.fillText('(cos θ + i sin θ)ⁿ',W/2,170); ctx.fillText('= cos(nθ) + i sin(nθ)',W/2,209);
  const y=H-355; ctx.textAlign='left'; ctx.font=`20px ${mono}`;
  ctx.fillStyle=`rgba(${CYAN.r},${CYAN.g},${CYAN.b},.88)`; ctx.fillText(`INPUT   z = ${s.magnitude.toFixed(3)} ∠ ${s.theta.toFixed(3)} rad`,76,y);
  ctx.fillStyle=`rgba(${ACID.r},${ACID.g},${ACID.b},.92)`; ctx.fillText(`POWER   zⁿ = ${s.poweredMagnitude.toFixed(3)} ∠ ${s.poweredAngle.toFixed(3)} rad`,76,y+47);
  ctx.fillStyle='rgba(255,255,255,.52)'; ctx.fillText(`n = ${s.n}`,76,y+105); ctx.fillText(`θ = ${s.theta.toFixed(3)} rad`,76,y+145); ctx.fillText(`angle after power = ${s.poweredAngle.toFixed(3)} rad`,76,y+185);
  ctx.fillStyle='rgba(255,255,255,.34)'; ctx.font=`17px ${mono}`; ctx.fillText(`|z| = ${s.magnitude.toFixed(3)}     |zⁿ| = ${s.poweredMagnitude.toFixed(3)}`,76,y+235);
  ctx.textAlign='right'; ctx.fillText('20260721  #RikiCodeArt',W-76,H-78); ctx.restore();
  pop();
}

function keyPressed(){
  if(key>='1'&&key<='9'){ PARAMS.exponent=+key; document.getElementById('exponent').value=key; document.getElementById('exponentOut').textContent=key; return false; }
  if(key==='r'||key==='R'){PARAMS.showRootsOfUnity=!PARAMS.showRootsOfUnity;return false}
  if(key==='a'||key==='A'){PARAMS.showAxes=!PARAMS.showAxes;return false}
  if(key==='c'||key==='C'){PARAMS.showConnections=!PARAMS.showConnections;return false}
  if(key==='h'||key==='H'){showHUD=!showHUD;return false}
  if(key===' '){paused=!paused;return false}
  if(key==='s'||key==='S'){saveCanvas('de_moivre_'+ts(),'png');return false}
  if(key==='v'||key==='V'){isRecording?stopRecording():startRecording();return false}
  return true;
}

// Existing MP4 capture/export workflow, unchanged except the file prefix.
function startRecording(){
  if(typeof VideoEncoder==='undefined'){alert('WebCodecs not supported.');return}
  if(typeof Mp4Muxer==='undefined'){alert('mp4-muxer not loaded.');return}
  muxer=new Mp4Muxer.Muxer({target:new Mp4Muxer.ArrayBufferTarget(),video:{codec:'avc',width:W,height:H},fastStart:'in-memory',firstTimestampBehavior:'offset'});
  encoder=new VideoEncoder({output:(chunk,meta)=>muxer.addVideoChunk(chunk,meta),error:e=>{console.error(e);isRecording=false;setStatus('Error','#f44')}});
  encoder.configure({codec:'avc1.640028',width:W,height:H,bitrate:18_000_000,framerate:FPS});
  recFrameCount=0;isRecording=true;frameCount=0;document.getElementById('startBtn').disabled=true;document.getElementById('stopBtn').disabled=false;setStatus('Recording…','#fff');
}
async function stopRecording(){
  if(!encoder||!muxer)return; isRecording=false;setStatus('Finalizing…','#ccc');await encoder.flush();muxer.finalize();
  const blob=new Blob([muxer.target.buffer],{type:'video/mp4'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='de_moivre_'+ts()+'.mp4';a.click();
  encoder.close();encoder=null;muxer=null;setTimeout(()=>URL.revokeObjectURL(url),6000);document.getElementById('startBtn').disabled=false;document.getElementById('stopBtn').disabled=true;document.getElementById('progressFill').style.width='0%';setStatus('Complete','#fff');setTimeout(()=>setStatus('Ready','#ccc'),3000);
}
function captureFrame(){if(!encoder||!canvasEl)return;const frame=new VideoFrame(canvasEl,{timestamp:recFrameCount*(1_000_000/FPS)});encoder.encode(frame,{keyFrame:recFrameCount%FPS===0});frame.close()}
function updateRecordingUi(){document.getElementById('duration').textContent=(recFrameCount/FPS).toFixed(1);document.getElementById('frameCount').textContent=recFrameCount;document.getElementById('progressFill').style.width=(recFrameCount/MAX_FRAMES*100).toFixed(1)+'%'}
function setStatus(txt,c){const el=document.getElementById('status');el.textContent=txt;el.style.color=c}
function ts(){const d=new Date();return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}${String(d.getSeconds()).padStart(2,'0')}`}
window.startRecording=startRecording;window.stopRecording=stopRecording;window.ts=ts;
