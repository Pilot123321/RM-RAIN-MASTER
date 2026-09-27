(function(){
'use strict';
const $=id=>document.getElementById(id), clamp=(x,a,b)=>x<a?a:x>b?b:x;
const angd=(a,b)=>{let d=a-b;while(d>180)d-=360;while(d<-180)d+=360;return d;};
const iOS=/iP(hone|ad|od)/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
let lockSaved=45,invSaved=false,ffbSaved=true,flipSaved=false,vrCamSaved=true;try{vrCamSaved=localStorage.getItem('rw.vrcam')!=='0';flipSaved=localStorage.getItem('rw.flip')==='1';lockSaved=+localStorage.getItem('rw.lock')||45;invSaved=localStorage.getItem('rw.inv2')==='1';ffbSaved=localStorage.getItem('rw.ffb')!=='0';}catch(e){}
// each phone (tab) has its own id, so the game can tell the wheel phone from the AR viewer
// pairing key from the QR code / link (kept for this tab, so a reload without it still works)
let PAIR=new URLSearchParams(location.search).get('k')||'';try{if(PAIR)sessionStorage.setItem('rw.k',PAIR);else PAIR=sessionStorage.getItem('rw.k')||'';}catch(e){}
let PID='';try{PID=sessionStorage.getItem('rw.id')||'';}catch(e){}
if(!PID){PID=Math.random().toString(36).slice(2,10);try{sessionStorage.setItem('rw.id',PID);}catch(e){}}
let CAL={pitchOff:0,hfov:66,camH:1.05,yawOff:0};try{Object.assign(CAL,JSON.parse(localStorage.getItem('rw.arcal')||'{}'));}catch(e){}
function saveCal(){try{localStorage.setItem('rw.arcal',JSON.stringify(CAL));}catch(e){}}
const S={gas:0,brake:0,steer:0,angle:0,neutral:null,gx:0,gy:0,hasMotion:false,lock:lockSaved,inv:invSaved,ffb:ffbSaved,yawInv:flipSaved,vr:false,vrCam:vrCamSaved,touchSteer:null,games:0,running:false,alert:0};

// ---- connection
let ws=null;
function connect(){
  ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws?role=wheel&id='+PID+'&k='+encodeURIComponent(PAIR));
  ws.onopen=()=>{status();hello();if(arOn)send({t:'cmd',c:'ar',on:true});};
  ws.onmessage=e=>{if(typeof e.data!=='string')return;let m;try{m=JSON.parse(e.data);}catch(_){return;}
    if(m.t==='track'){onTrack(m);return;} if(m.t==='w'){onState(m);return;}
    if(m.t==='games'){S.games=m.n;status();hello();}
    else if(m.t==='st'){S.running=m.r;S.ap=!!m.ap;S.wh=m.wh||0;$('bRun').textContent=m.r?'Stop':'Start';
      if(m.a===2&&S.alert!==2&&navigator.vibrate){navigator.vibrate([90,60,90]);FFB.hold=performance.now()+260;}
      if(m.w&&!S.wall&&!S.ffb&&navigator.vibrate)navigator.vibrate(40);S.wall=m.w;
      // hysteresis: red holds for 0.8 s so the glow does not flicker around the threshold
      const nowT=performance.now();if(m.a===2)S.redUntil=nowT+800;const lvl=m.a===2||nowT<(S.redUntil||0)?2:m.a;
      if(lvl!==S.shownLvl){S.shownLvl=lvl;const g=$('glow');g.style.setProperty('--gc',lvl===2?'var(--brake)':'var(--amb)');g.style.opacity=lvl?(lvl===2?0.9:0.45):0;}
      S.alert=m.a;}};
  ws.onclose=e=>{S.games=0;S.unpaired=e.code===4001;status();setTimeout(connect,S.unpaired?5000:1000);};
  ws.onerror=()=>{};
}
let sent=0;
function hello(){send({t:'hello',w:innerWidth,h:innerHeight,dpr:devicePixelRatio||1});}
addEventListener('resize',()=>setTimeout(hello,200));
function status(){const open=ws&&ws.readyState===1,ok=open&&S.games>0;$('dot').classList.toggle('ok',ok);
  $('conn').textContent=S.unpaired?'Not paired: scan the QR code on the Mac again':!open?'Cannot reach '+location.host:!S.games?'Server OK, open the game on the Mac':`Linked · ${arOn?(S.ap?'AR view · autopilot driving':'AR view · wheel phone drives'):'Wheel'} · HUD ${fps} fps · v8`;
  $('hudwait').hidden=!!(trackOk&&W);
  if(open&&S.games&&!trackOk)$('hudwait').textContent='Linked, waiting for the track. Reload the game page on the Mac.';
  if(!HUD)$('hudwait').textContent='Could not load the HUD code from the Mac. Reload this page.';}
setInterval(status,500);
// ---- native HUD: same drawing code as the game, fed by track + state messages
const HUD=window.makeHUD?window.makeHUD():null;if(HUD)HUD.setCalm(true);
const _unused=0, cv=$('hudcv'), cx=cv.getContext('2d'), video=$('cam');
let arOn=false,camStream=null;
let frames=0,fps=0,msgs=0,W=null,Wt=0,trackOk=false;setInterval(()=>{fps=frames;frames=0;},1000);
function fitCanvas(){const d=Math.min(devicePixelRatio||1,1.5);   // 1.5x is sharp enough and much cheaper to fill every frame
  cv.width=Math.round(innerWidth*d);cv.height=Math.round(innerHeight*d);}
addEventListener('resize',fitCanvas);fitCanvas();
function onTrack(t){if(!HUD)return;HUD.setTrack(t);trackOk=true;}
const SNAP=[];let clockOff=null;
function onState(m){msgs++;const hz=m.hz.map(h=>({type:h[0],s:h[1],lat:h[2],yaw:h[3],halfLen:h[4],halfW:h[5],vis:!!h[6],gone:!!h[7],avoid:h[8],vpass:h[9],label:h[10]}));
  const p=m.p,rd=m.rd;let radar=null;
  if(rd){const dets=[],tracks=[];for(let i=0;i<rd.d.length;i+=3)dets.push({x:rd.d[i],z:rd.d[i+1],st:!!rd.d[i+2]});
    for(let i=0;i<rd.k.length;i+=3)tracks.push({x:rd.k[i],z:rd.k[i+1],conf:true,barrier:false,obj:!!rd.k[i+2]});radar={ox:rd.o[0],oz:rd.o[1],rng:rd.g,att:rd.a,dets,tracks};}
  if(m.ffb){FFB.v=m.ffb;FFB.t=performance.now();}if(m.scr)S.scr=m.scr;
  const behind=m.bh?{d:m.bh[0],side:m.bh[1],cl:m.bh[2]}:null;
  if(behind&&!S.behind&&S.running&&navigator.vibrate){navigator.vibrate([30,70,30]);FFB.hold=performance.now()+160;}S.behind=behind;rearGlow($('rearfx'),REAR,S.running?behind:null);
  W={player:{s:p[0],lat:p[1],psi:p[2],latV:p[3],slideV:p[4],v:p[5],vx:m.dr?p[6]:null,lapc:p[7]||0,brk:p[8]||0,thr:p[9]||0,gear:p[10]>=0?p[10]:p[10]===-2?0:null,rev:p[10]===-2,rpm:p[11]||0,beta:p[12]||0,steer:p[13]||0},radar,behind,spray:m.sp||0,flags:m.fg?Uint8Array.from(m.fg.slice(1)):null,secLen:m.fg?m.fg[0]:0,
    traffic:m.tr.map(c=>({s:c[0],lat:c[1],latV:c[2],v:c[3],vis:!!c[4],closing:!!c[5],lapc:c[6]||0})),hazards:hz,alert:m.a,near:m.ni>=0?hz[m.ni]:null,dNear:m.dn,
    vis:m.vis,flagOn:!!m.fo,sc:{flag:m.fl||null},opts:{driver:m.dr?'drive':'model',hud:m.hd!==0},t:m.tm};
  Wt=performance.now();if(HUD)HUD.NAV.zoom=m.z||1;
  const off=Wt/1000-m.tm;clockOff=clockOff==null||off<clockOff?off:clockOff+(off-clockOff)*0.02;
  SNAP.push({tm:m.tm,w:W});while(SNAP.length>12)SNAP.shift();}
function sampleWorld(now){
  if(!SNAP.length||clockOff==null)return W;const rt=now/1000-clockOff-0.06,L=HUD.wrapS,dS=HUD.dSigned;
  let i=SNAP.length-1;while(i>0&&SNAP[i-1].tm>rt)i--;
  const B=SNAP[i],A=i>0?SNAP[i-1]:null;
  if(!A||rt>=B.tm){const e=Math.min(0.15,Math.max(0,rt-B.tm)),P=B.w.player;   // small extrapolation if the next update is late
    return Object.assign({},B.w,{player:Object.assign({},P,{s:L(P.s+P.v*e),lat:P.lat+(P.latV||0)*e}),traffic:B.w.traffic.map(c=>Object.assign({},c,{s:L(c.s+c.v*e)})),dNear:B.w.dNear-P.v*e});}
  if(rt<=A.tm)return A.w;
  const k=(rt-A.tm)/Math.max(1e-3,B.tm-A.tm),lp=(a,b)=>a+(b-a)*k,ls=(a,b)=>L(a+dS(a,b)*k);
  const pa=A.w.player,pb=B.w.player;
  return Object.assign({},B.w,{
    player:Object.assign({},pb,{s:ls(pa.s,pb.s),lat:lp(pa.lat,pb.lat),psi:lp(pa.psi||0,pb.psi||0),v:lp(pa.v,pb.v),latV:lp(pa.latV||0,pb.latV||0)}),
    traffic:B.w.traffic.map((c,j)=>{const ca=A.w.traffic[j];return ca?Object.assign({},c,{s:ls(ca.s,c.s),lat:lp(ca.lat,c.lat),v:lp(ca.v,c.v)}):c;}),
    hazards:B.w.hazards.map((h,j)=>{const ha=A.w.hazards[j];return ha?Object.assign({},h,{lat:lp(ha.lat,h.lat)}):h;}),
    dNear:lp(A.w.dNear,B.w.dNear)});}
// AR calibration: line up the drawn horizon and lane with the camera image
let calOn=false,calDrag=null;
function drawCal(A,Wd,H,u){cx.save();cx.strokeStyle='rgba(255,194,71,.95)';cx.lineWidth=2*u;cx.setLineDash([10*u,6*u]);
  cx.beginPath();cx.moveTo(A.horizon[0][0],A.horizon[0][1]);cx.lineTo(A.horizon[1][0],A.horizon[1][1]);cx.stroke();cx.setLineDash([]);
  cx.fillStyle='rgba(0,0,0,.55)';cx.fillRect(Wd*0.27,H*0.2,Wd*0.46,H*0.3);cx.fillStyle='#FFC247';cx.font=`700 ${13*u}px "B612 Mono", monospace`;cx.textAlign='center';
  cx.fillText('CALIBRATE AR',Wd/2,H*0.26);cx.font=`${11*u}px "B612 Mono", monospace`;cx.fillStyle='#E3EBF0';
  cx.fillText('Drag up/down: put the dashed line on the real horizon',Wd/2,H*0.32);cx.fillText('Drag left/right: widen or narrow the lane to match the road',Wd/2,H*0.37);
  cx.fillText(`pitch ${(CAL.pitchOff*57.3).toFixed(1)}°  ·  field of view ${CAL.hfov.toFixed(0)}°  ·  height ${CAL.camH.toFixed(2)} m`,Wd/2,H*0.43);
  cx.restore();}
function calStart(e){if(!calOn||e.target.closest('.bar'))return;e.preventDefault();e.stopPropagation();calDrag={x:e.clientX,y:e.clientY,p:CAL.pitchOff,f:CAL.hfov};}
function calMove(e){if(!calDrag)return;const dy=(e.clientY-calDrag.y)/innerHeight,dx=(e.clientX-calDrag.x)/innerWidth;
  CAL.pitchOff=clamp(calDrag.p-dy*0.9,-0.6,0.6);CAL.hfov=clamp(calDrag.f-dx*60,35,110);}
function calEnd(){if(calDrag){calDrag=null;saveCal();}}
addEventListener('pointerdown',calStart,true);addEventListener('pointermove',calMove);addEventListener('pointerup',calEnd);
// AR: the rear camera is the background, the overlay is drawn where things would be in front of you
async function setAR(on){
  if(on){try{camStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});
      video.srcObject=camStream;video.hidden=false;await video.play().catch(()=>{});arOn=true;}
    catch(e){arOn=false;$('hudwait').hidden=false;$('hudwait').textContent=!window.isSecureContext?'The camera needs the https:// address or the USB address.':'Camera access was refused or is not available.';setTimeout(status,3000);}}
  else{arOn=false;if(camStream)camStream.getTracks().forEach(t=>t.stop());camStream=null;video.hidden=true;video.srcObject=null;}
  $('bAR').setAttribute('aria-pressed',arOn?'true':'false');$('bCal').hidden=!arOn;$('bVR').hidden=!arOn;if(!arOn){calOn=false;setVR(false);}
  // AR is a passenger view: the game's autopilot drives, so the pedals and steering are off
  document.body.classList.toggle('ar',arOn);$('bCenter').textContent=arOn?'Recenter':'Center';ORI.yaw=0;S.gas=S.brake=0;S.touchSteer=null;send({t:'cmd',c:'ar',on:arOn});}
function drawHud(now){
  cx.setTransform(1,0,0,1,0,0);
  if(arOn)cx.clearRect(0,0,cv.width,cv.height);else{cx.fillStyle='#000';cx.fillRect(0,0,cv.width,cv.height);}
  if(!HUD||!trackOk||!W)return;
  const dt=Math.min(0.1,(now-(drawHud.last||now))/1000);drawHud.last=now;
  // smooth playback: interpolate between buffered updates instead of snapping to each one
  const view=sampleWorld(now);if(view.hazards&&W.near)view.near=view.hazards[W.hazards.indexOf(W.near)]||view.near;
  HUD.setWorld(view);
  const H=cv.height,Wd=cv.width,u=H/420;
  if(arOn&&S.vr){
    // VR headset: side-by-side stereo, one half per eye, eyes 64 mm apart, 90 degrees per eye for the lenses.
    // The camera (if on) is shown in both halves; the HUD sits at screen depth in each eye.
    const half=Wd/2,uu=u*0.8;
    for(const [i,ex] of [[0,-0.032],[1,0.032]]){
      cx.save();cx.beginPath();cx.rect(i*half,0,half,H);cx.clip();cx.translate(i*half,0);
      cx.fillStyle='#000';cx.fillRect(0,0,half,H);
      if(S.vrCam&&video.readyState>=2&&video.videoWidth){const vw=video.videoWidth,vh=video.videoHeight,k=Math.max(half/vw,H/vh);cx.globalAlpha=0.9;cx.drawImage(video,(half-vw*k)/2,(H-vh*k)/2,vw*k,vh*k);cx.globalAlpha=1;}
      HUD.drawARView(cx,view,now/1000,uu,half,H,{pitch:CAL.pitchOff,roll:0,hfov:90,camH:CAL.camH,yawOff:CAL.yawOff-ORI.yaw,rawYaw:true,vw:0,vh:0,eyeX:ex});
      const bw=half*0.62,th=H*0.12,bx=(half-bw)/2,ty=H*0.1;
      cx.fillStyle='rgba(0,0,0,.4)';cx.fillRect(bx,ty-3*u,bw,th+6*u);HUD.drawTracker(cx,view,bx,ty,bw,th,uu,true);
      HUD.drawFlagChip(cx,view,view.player.s,half/2-50*uu,ty+th+10*u,uu);
      cx.restore();}
    cx.fillStyle='#000';cx.fillRect(Wd/2-1,0,2,H);
  } else if(arOn){
    const uu=u*1.05,flash=true;
    const cam={pitch:CAL.pitchOff,roll:0,hfov:CAL.hfov,camH:CAL.camH,yawOff:CAL.yawOff-ORI.yaw,rawYaw:true,vw:video.videoWidth||0,vh:video.videoHeight||0};
    const A=HUD.drawARView(cx,view,now/1000,uu,Wd,H,cam);
    if(calOn)drawCal(A,Wd,H,uu);
    // readable bands for the header and lap tracker over a bright camera image
    const bx=Wd*0.27,bw=Wd*0.46,hh=H*0.12,th=H*0.14,ty=H*0.04;   // position / lap tracker at the top
    cx.fillStyle='rgba(0,0,0,.38)';cx.fillRect(bx,ty-4*u,bw,th+8*u);
    HUD.drawTracker(cx,view,bx,ty,bw,th,uu,flash);
    HUD.drawFlagChip(cx,view,view.player.s,Wd/2-60*uu,ty+th+14*u,uu);
  } else {
    // the game screen's HUD layout (same camera, same positions), scaled to fit; no 3D picture behind it
    const gw=S.scr?S.scr[0]:1280,gh=S.scr?S.scr[1]:720,k=Math.min(Wd/gw,H/gh),ox=(Wd-gw*k)/2,oy=(H-gh*k)/2;
    cx.setTransform(k,0,0,k,ox,oy);HUD.setSize(gw,gh);HUD.drawScreen(cx,view,now/1000,dt);
    cx.setTransform(1,0,0,1,0,0);cx.strokeStyle='rgba(196,248,255,.18)';cx.lineWidth=1;cx.strokeRect(ox+0.5,oy+0.5,gw*k-1,gh*k-1);
  }
  frames++;
}
function send(o){if(ws&&ws.readyState===1){ws.send(typeof o==='string'?o:JSON.stringify(Object.assign({id:PID},o)));sent++;}}

// ---- AR head tracking, like a VR headset but horizontal only: turning the phone left/right turns the driver's
// head (the view pans); tilting or rolling it does not move the view, so the horizon stays where it was calibrated.
// "Up" in the phone's own axes comes from the gyro, pulled slowly towards gravity from the accelerometer (readings
// near 1 g only); the head's yaw is the gyro rate about that vertical, integrated. Recenter zeroes it.
const ORI={u:null,t:0,yaw:0,bias:0},D2R=Math.PI/180,REAR={k:'',was:false};
/* ================= REAR GLOW (shared by the game page and the phone) ================= */
function rearGlow(el,st,b){
  let l=0,r=0,bt=0,col='196 248 255',closing=false;
  if(b){const k=clamp((52-b.d)/40,0.35,1),cl=b.cl*3.6;col=b.d<12&&cl>5?'255 75 58':(cl>8||b.d<20)?'255 194 71':'196 248 255';
    if(b.side<0)l=k;else if(b.side>0)r=k;else{bt=k;l=r=k*0.3;}closing=cl>8;}
  const key=[l,r,bt].map(v=>v.toFixed(2)).join()+col+closing;
  el.classList.toggle('on',!!b);
  if(key!==st.k){st.k=key;el.style.setProperty('--l',l);el.style.setProperty('--r',r);el.style.setProperty('--b',bt);el.style.setProperty('--rc',col);el.classList.toggle('closing',closing);}
  if(b&&!st.was){el.classList.remove('arrive');void el.offsetWidth;el.classList.add('arrive');}
  st.was=!!b;}

function fuse(e,ax,ay,az,gm){
  const now=e.timeStamp||performance.now(),dt=ORI.t?clamp((now-ORI.t)/1000,0,0.1):0;ORI.t=now;
  const m=[ax/gm,ay/gm,az/gm];if(!ORI.u){ORI.u=m;return;}const u=ORI.u,r=e.rotationRate;
  if(r&&r.alpha!=null&&dt>0){const wx=(r.beta||0)*D2R,wy=(r.gamma||0)*D2R,wz=(r.alpha||0)*D2R;   // about the phone's x, y, z
    // turn rate about the vertical (+ = turning left). Phone gyros carry a small bias that makes "straight ahead"
    // creep; it is measured whenever the phone is held still and subtracted. Looking roughly ahead and holding still,
    // the view also eases back to centre (VR-style), so any leftover drift never builds up.
    const wu=wx*u[0]+wy*u[1]+wz*u[2],wn=Math.hypot(wx,wy,wz);
    if(wn<0.05)ORI.bias+=(wu-ORI.bias)*Math.min(1,dt/2);
    ORI.yaw+=(wu-ORI.bias)*dt*(S.yawInv?-1:1);
    if(wn<0.15&&Math.abs(ORI.yaw)<0.35)ORI.yaw-=ORI.yaw*Math.min(1,dt/10);
    ORI.yaw=Math.atan2(Math.sin(ORI.yaw),Math.cos(ORI.yaw));
    const c0=wy*u[2]-wz*u[1],c1=wz*u[0]-wx*u[2],c2=wx*u[1]-wy*u[0];u[0]-=c0*dt;u[1]-=c1*dt;u[2]-=c2*dt;}   // du/dt = -ω × u
  const k=(r&&r.alpha!=null?Math.min(1,dt/0.8):Math.min(1,dt/0.12))*Math.exp(-Math.abs(gm-9.81)/1.5);
  for(let i=0;i<3;i++)u[i]+=(m[i]-u[i])*k;const n=Math.hypot(u[0],u[1],u[2])||1;for(let i=0;i<3;i++)u[i]/=n;}
// ---- steering from gravity: the angle of "up" in the phone's screen plane
function onMotion(e){
  const a=e.accelerationIncludingGravity;if(!a||a.x==null)return;
  let ax=a.x,ay=a.y,az=a.z||0;if(iOS){ax=-ax;ay=-ay;az=-az;}
  const gm=Math.hypot(ax,ay,az)||9.8;fuse(e,ax,ay,az,gm);
  S.gx+=(ax-S.gx)*0.35;S.gy+=(ay-S.gy)*0.35;
  if(Math.hypot(S.gx,S.gy)<2.5)return;           // phone lying flat: hold last angle
  S.hasMotion=true;
  const ang=Math.atan2(S.gx,S.gy)*180/Math.PI;
  if(S.neutral==null)S.neutral=ang;
  let d=angd(ang,S.neutral);if(S.inv)d=-d;
  S.angle=d;
}
function recenter(){if(S.hasMotion)S.neutral=Math.atan2(S.gx,S.gy)*180/Math.PI;S.touchSteer=S.touchSteer==null?null:0;}

// ---- pedals (multi-touch)
function pedal(el,key){
  const on=v=>{S[key]=v;el.classList.toggle('on',!!v);if(v&&navigator.vibrate)navigator.vibrate(12);};
  el.addEventListener('pointerdown',e=>{if(calOn||arOn)return;e.preventDefault();el.setPointerCapture(e.pointerId);on(1);});
  for(const ev of ['pointerup','pointercancel','lostpointercapture'])el.addEventListener(ev,()=>on(0));
}
pedal($('gas'),'gas');pedal($('brake'),'brake');

// ---- touch steering fallback: drag sideways on the wheel
const wb=document.body;let dragX=null;
wb.addEventListener('pointerdown',e=>{if(arOn||S.hasMotion||e.target.closest('.pedal,.bar,.sheet'))return;dragX=e.clientX;wb.setPointerCapture(e.pointerId);S.touchSteer=0;});
wb.addEventListener('pointermove',e=>{if(dragX==null)return;S.touchSteer=clamp((e.clientX-dragX)/(innerWidth*0.25),-1,1);});
for(const ev of ['pointerup','pointercancel'])wb.addEventListener(ev,()=>{dragX=null;S.touchSteer=0;});

// ---- buttons
$('bCenter').onclick=()=>{if(arOn){ORI.yaw=0;recFlash();}else recenter();};
$('bRun').onclick=()=>send({t:'cmd',c:S.running?'stop':'start'});
$('bDrop').onclick=()=>send({t:'cmd',c:'drop'});
$('bCam').onclick=()=>send({t:'cmd',c:'cam'});
$('bAR').onclick=()=>setAR(!arOn);
$('bSetup').onclick=()=>{const open=$('bLock').hidden;document.querySelectorAll('.more').forEach(b=>b.hidden=!open);$('bSetup').setAttribute('aria-pressed',open?'true':'false');};
$('bCal').onclick=()=>{calOn=!calOn;$('bCal').setAttribute('aria-pressed',calOn?'true':'false');$('bCal').textContent=calOn?'Done':'Calibrate';};
function syncOpts(){$('bLock').textContent='Lock '+S.lock+'°';$('bInv').setAttribute('aria-pressed',S.inv?'true':'false');$('bFfb').setAttribute('aria-pressed',S.ffb?'true':'false');$('bFlip').setAttribute('aria-pressed',S.yawInv?'true':'false');$('bVRCam').setAttribute('aria-pressed',S.vrCam?'true':'false');
  try{localStorage.setItem('rw.lock',S.lock);localStorage.setItem('rw.inv2',S.inv?'1':'0');localStorage.setItem('rw.ffb',S.ffb?'1':'0');localStorage.setItem('rw.flip',S.yawInv?'1':'0');localStorage.setItem('rw.vrcam',S.vrCam?'1':'0');}catch(e){}}
$('bLock').onclick=()=>{S.lock=S.lock===30?45:S.lock===45?70:30;syncOpts();};
$('bFfb').onclick=()=>{S.ffb=!S.ffb;if(!S.ffb&&navigator.vibrate)navigator.vibrate(0);syncOpts();};
$('bFlip').onclick=()=>{S.yawInv=!S.yawInv;ORI.yaw=0;syncOpts();};
// ---- VR headset mode (from AR): side-by-side stereo. The buttons hide inside the headset; a tap brings them back
// for a few seconds, a double tap re-centres the view.
let vrUiT=0;
function setVR(on){S.vr=!!on;document.body.classList.toggle('vr',S.vr);$('bVR').setAttribute('aria-pressed',S.vr?'true':'false');
  if(S.vr){ORI.yaw=0;showVrUi();try{document.documentElement.requestFullscreen({navigationUI:'hide'}).catch(()=>{});}catch(e){}try{screen.orientation.lock('landscape').catch(()=>{});}catch(e){}}}
function showVrUi(){document.body.classList.add('vrui');clearTimeout(vrUiT);vrUiT=setTimeout(()=>document.body.classList.remove('vrui'),4000);}
addEventListener('pointerdown',e=>{if(S.vr&&!e.target.closest('.bar'))showVrUi();},true);
$('bVR').onclick=()=>setVR(!S.vr);
$('bVRCam').onclick=()=>{S.vrCam=!S.vrCam;syncOpts();};
// AR: double-tap anywhere on the view to make the way you are facing "straight ahead" (as in VR headsets)
let lastTap=0;
addEventListener('pointerdown',e=>{if(!arOn||calOn||e.target.closest('.bar,.sheet'))return;const now=performance.now();
  if(now-lastTap<350){ORI.yaw=0;lastTap=0;if(navigator.vibrate)navigator.vibrate(15);recFlash();}else lastTap=now;});
function recFlash(){const el=$('recenter');el.classList.remove('show');void el.offsetWidth;el.classList.add('show');}
// ---- force feedback from the tyres. A phone motor is only on or off, so each channel is a rhythm and its
// strength a duty cycle inside each 60 ms window, highest priority first:
//   impact: one long pulse · lock-up: fast ABS-like chatter · kerb: stripe-rate pulses · wheelspin / rear slide:
//   a long buzz · front scrub (understeer, past the tyre peak): a stutter · steering weight (self-aligning torque):
//   a faint hum that fades as the front goes light before it lets go · aquaplaning: the hum drops out entirely.
const FFB={v:[0,0,0,0,0,0,0,0,0],t:0,hold:0,lastHit:0,buzz:false,tick:0};
setInterval(()=>{if(!S.ffb||arOn||!navigator.vibrate)return;const now=performance.now();if(now<FFB.hold)return;FFB.tick++;
  const [kerb,hit,weight,scrub,slide,lock,spin,spray,aqua]=now-FFB.t<300&&S.running?FFB.v:[0,0,0,0,0,0,0,0,0];let pat=null;
  if(hit>0.5&&now-FFB.lastHit>300){pat=[110];FFB.lastHit=now;FFB.hold=now+110;}
  else if(lock>0.1)pat=[7,9,7,9,7];
  else if(kerb>0.05){const on=Math.round(7+9*kerb);pat=[on,Math.max(6,20-on),on];}
  else if(Math.max(spin,slide)>0.1)pat=[Math.round(16+38*Math.max(spin,slide))];
  else if(scrub>0.1)pat=[Math.round(8+14*scrub),14,Math.round(8+14*scrub)];
  else{const hum=weight*(1-Math.min(1,aqua*1.5))*0.5+spray*0.2;if(hum>=0.08&&FFB.tick%2===0)pat=[Math.round(5+22*Math.min(1,hum))];}
  if(pat){navigator.vibrate(pat);FFB.buzz=true;}else if(FFB.buzz){navigator.vibrate(0);FFB.buzz=false;}},60);
$('bInv').onclick=()=>{S.inv=!S.inv;syncOpts();};syncOpts();
document.addEventListener('contextmenu',e=>e.preventDefault());

// ---- start: permissions, fullscreen, landscape, keep screen awake
let wake=null;
async function keepAwake(){try{wake=await navigator.wakeLock.request('screen');}catch(e){}}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){keepAwake();if(!ws||ws.readyState>1)connect();}});
$('go').onclick=async()=>{
  try{if(typeof DeviceMotionEvent!=='undefined'&&DeviceMotionEvent.requestPermission){const r=await DeviceMotionEvent.requestPermission();if(r!=='granted')throw new Error('denied');}}catch(e){$('sheetMsg').textContent='Motion access was refused. Drag on the wheel to steer instead.';}
  if(!window.isSecureContext){$('sheetMsg').className='warn';$('sheetMsg').textContent='This page is not a secure connection, so the gyro is off. Use the https:// address or the USB address from the Mac.';}
  window.addEventListener('devicemotion',onMotion);
  try{await document.documentElement.requestFullscreen({navigationUI:'hide'});}catch(e){}
  try{await screen.orientation.lock('landscape');}catch(e){}
  keepAwake();
  $('sheet').hidden=true;
  setTimeout(()=>{if(!S.hasMotion){$('conn').textContent='No gyro: drag the wheel';}},1800);
};

// ---- send loop + wheel drawing
let last='',lastT=0;
function loop(now){
  requestAnimationFrame(loop);
  drawHud(now);
  const deg=S.hasMotion?S.angle:(S.touchSteer||0)*S.lock;
  const s=S.steer;
  $('ang').textContent=`${deg>0?'R':deg<0?'L':''} ${Math.abs(Math.round(deg))}°`;
}
function curDeg(){return S.hasMotion?S.angle:(S.touchSteer||0)*S.lock;}
setInterval(()=>{const deg=curDeg();let s=clamp(deg/S.lock,-1,1);if(Math.abs(deg)<1.5)s=0;S.steer=s;
  if(arOn)s=0;const now=performance.now(),msg=JSON.stringify({t:'in',id:PID,s:+s.toFixed(3),g:arOn?0:S.gas,b:arOn?0:S.brake});
  if(msg!==last||now-lastT>100){send(msg);last=msg;lastT=now;}},25);
connect();requestAnimationFrame(loop);
})();
