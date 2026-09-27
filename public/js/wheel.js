(function(){
'use strict';
const $=id=>document.getElementById(id), clamp=(x,a,b)=>x<a?a:x>b?b:x;
const angd=(a,b)=>{let d=a-b;while(d>180)d-=360;while(d<-180)d+=360;return d;};
const iOS=/iP(hone|ad|od)/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
let lockSaved=45,invSaved=false,ffbSaved=true,flipSaved=false;try{flipSaved=localStorage.getItem('rw.flip')==='1';lockSaved=+localStorage.getItem('rw.lock')||45;invSaved=localStorage.getItem('rw.inv3')==='1';ffbSaved=localStorage.getItem('rw.ffb')!=='0';}catch(e){}
// each phone (tab) has its own id, so the game can tell the wheel phone from the AR viewer
// pairing key from the QR code / link (kept for this tab, so a reload without it still works)
let PAIR=new URLSearchParams(location.search).get('k')||'';try{if(PAIR)sessionStorage.setItem('rw.k',PAIR);else PAIR=sessionStorage.getItem('rw.k')||'';}catch(e){}
let PID='';try{PID=sessionStorage.getItem('rw.id')||'';}catch(e){}
if(!PID){PID=Math.random().toString(36).slice(2,10);try{sessionStorage.setItem('rw.id',PID);}catch(e){}}
let CAL={pitchOff:0,hfov:66,camH:1.05,yawOff:0};try{Object.assign(CAL,JSON.parse(localStorage.getItem('rw.arcal2')||'{}'));}catch(e){}
for(const [key,lo,hi,def] of [['pitchOff',-0.9,0.9,0],['hfov',35,110,66],['camH',0.2,3,1.05],['yawOff',-Math.PI,Math.PI,0]])CAL[key]=Number.isFinite(CAL[key])?clamp(CAL[key],lo,hi):def;
function saveCal(){try{localStorage.setItem('rw.arcal2',JSON.stringify(CAL));}catch(e){}}
const S={gas:0,brake:0,steer:0,angle:0,neutral:null,gx:0,gy:0,hasMotion:false,quarter:null,trim:0,farSince:0,lock:lockSaved,inv:invSaved,ffb:ffbSaved,yawInv:flipSaved,touchSteer:null,games:0,running:false,alert:0};

// ---- connection
let ws=null;
// On the website the relay runs on several server instances and (without Redis) only relays within one; if this
// phone lands on another instance than the game it sees no game. It then reconnects after a moment, which soon
// lands it next to the game. The local server (a port in the address, or a LAN/loopback host) is one process.
const CLOUD=location.port===''&&!/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[)/.test(location.hostname);
let lonely=0;
function connect(){
  ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws?role=wheel&id='+PID+'&k='+encodeURIComponent(PAIR));
  ws.onopen=()=>{resetWorld();S.unpaired=false;status();hello();};
  ws.onmessage=e=>{if(typeof e.data!=='string')return;let m;try{m=JSON.parse(e.data);}catch(_){return;}
    if(m.t==='track'){onTrack(m);return;} if(m.t==='w'){onState(m);return;}
    if(m.t==='games'){if(S.games!==m.n)resetWorld();S.games=m.n;status();hello();
      clearTimeout(lonely);if(CLOUD&&!m.n)lonely=setTimeout(()=>{if(ws&&ws.readyState===1&&!S.games)ws.close(4000,'find the game');},2000+Math.random()*1500);}
    else if(m.t==='st'){S.running=m.r;S.ap=!!m.ap;S.wh=m.wh||0;$('bRun').textContent=m.r?'Stop':'Start';
      if(m.a===2&&S.alert!==2&&navigator.vibrate){navigator.vibrate([90,60,90]);FFB.hold=performance.now()+260;}
      if(m.w&&!S.wall&&!S.ffb&&navigator.vibrate)navigator.vibrate(40);S.wall=m.w;
      // hysteresis: red holds for 0.8 s so the glow does not flicker around the threshold
      const nowT=performance.now();if(m.a===2)S.redUntil=nowT+800;const lvl=m.a===2||nowT<(S.redUntil||0)?2:m.a;
      if(lvl!==S.shownLvl){S.shownLvl=lvl;const g=$('glow');g.style.setProperty('--gc',lvl===2?'var(--brake)':'var(--amb)');g.style.opacity=lvl?(lvl===2?0.9:0.45):0;}
      S.alert=m.a;}};
  ws.onclose=e=>{S.games=0;S.unpaired=e.code===4001;resetWorld();status();setTimeout(connect,S.unpaired?5000:1000);};
  ws.onerror=()=>{};
}
let sent=0;
function hello(){send({t:'hello',w:innerWidth,h:innerHeight,dpr:devicePixelRatio||1,ar:arOn,sim:!!S.sim});
  // Replay modes both after a phone reconnect and after the game page reloads.
  send({t:'cmd',c:'ar',on:arOn});send({t:'cmd',c:'sim',on:!!S.sim});send({t:'cmd',c:'dots',on:!!S.dots});}
addEventListener('resize',()=>setTimeout(hello,200));
function status(){const open=ws&&ws.readyState===1,ok=open&&S.games>0;$('dot').classList.toggle('ok',ok);
  $('conn').textContent=S.unpaired?'Not paired: scan the QR code on the Mac again':!open?'Cannot reach '+location.host:!S.games?'Server OK, open the game on the Mac':`Linked · ${arOn?(S.ap?'AR view · autopilot driving':'AR view · wheel phone drives'):'Wheel'} · HUD ${fps} fps · v8`;
  $('hudwait').hidden=!!(trackOk&&W)&&!cameraError;
  if(cameraError){$('hudwait').textContent=cameraError;return;}
  if(open&&S.games&&!trackOk)$('hudwait').textContent='Linked, waiting for the track. Reload the game page on the Mac.';
  if(!HUD)$('hudwait').textContent='Could not load the HUD code from the Mac. Reload this page.';}
setInterval(status,500);
// ---- native HUD: same drawing code as the game, fed by track + state messages
const HUD=window.makeHUD?window.makeHUD():null;if(HUD)HUD.setCalm(true);
const _unused=0, cv=$('hudcv'), cx=cv.getContext('2d'), video=$('cam');
let arOn=false,camStream=null,cameraError='',cameraRequest=0;
let frames=0,fps=0,msgs=0,W=null,Wt=0,trackOk=false;setInterval(()=>{fps=frames;frames=0;},1000);
function fitCanvas(){const d=Math.min(devicePixelRatio||1,1.5);   // 1.5x is sharp enough and much cheaper to fill every frame
  cv.width=Math.round(innerWidth*d);cv.height=Math.round(innerHeight*d);}
addEventListener('resize',fitCanvas);fitCanvas();
let trackSource=null,trackRevision=null,worldRevision=null;
function resetWorld(){SNAP.length=0;OFFS.length=0;clockOff=null;W=null;trackOk=false;trackSource=null;trackRevision=null;worldRevision=null;resetSim();}
function onTrack(t){if(!HUD)return;
  if(!trackOk||t.src!==trackSource||t.trackRev!==trackRevision){SNAP.length=0;OFFS.length=0;clockOff=null;W=null;worldRevision=null;resetSim();}
  HUD.setTrack(t);trackSource=t.src;trackRevision=t.trackRev;trackOk=true;}
const SNAP=[],OFFS=[];let clockOff=null;
function onState(m){
  if(!trackOk||m.src!==trackSource||m.trackRev!==trackRevision)return;
  if(worldRevision!==m.worldRev){SNAP.length=0;worldRevision=m.worldRev;}
  if(SNAP.length&&m.tw!=null&&m.tw/1000<SNAP[SNAP.length-1].tm){SNAP.length=0;OFFS.length=0;clockOff=null;}
  msgs++;const hz=m.hz.map(h=>({type:h[0],s:h[1],lat:h[2],yaw:h[3],halfLen:h[4],halfW:h[5],vis:!!h[6],gone:!!h[7],avoid:h[8],vpass:h[9],label:h[10]}));
  const p=m.p,rd=m.rd;let radar=null;
  if(rd){const dets=[],tracks=[];for(let i=0;i<rd.d.length;i+=3)dets.push({x:rd.d[i],z:rd.d[i+1],st:!!rd.d[i+2]});
    for(let i=0;i<rd.k.length;i+=3)tracks.push({x:rd.k[i],z:rd.k[i+1],conf:true,barrier:false,obj:!!rd.k[i+2]});radar={ox:rd.o[0],oz:rd.o[1],rng:rd.g,att:rd.a,dets,tracks};}
  if(m.ffb){FFB.v=m.ffb;FFB.t=performance.now();}if(m.scr)S.scr=m.scr;
  const behind=m.bh?{d:m.bh[0],side:m.bh[1],cl:m.bh[2]}:null;
  if(behind&&!S.behind&&S.running&&navigator.vibrate){navigator.vibrate([30,70,30]);FFB.hold=performance.now()+160;}S.behind=behind;rearGlow($('rearfx'),REAR,S.running?behind:null);
  W={tc:m.tc||null,player:{s:p[0],lat:p[1],psi:p[2],latV:p[3],slideV:p[4],v:p[5],vx:m.dr?p[6]:null,lapc:p[7]||0,brk:p[8]||0,thr:p[9]||0,gear:p[10]>=0?p[10]:p[10]===-2?0:null,rev:p[10]===-2,rpm:p[11]||0,beta:p[12]||0,steer:p[13]||0},radar,behind,mk:m.mk||null,mx:m.mx||null,scr:m.scr||null,fov:m.fov||60,cm:m.cm||null,spray:m.sp||0,flags:m.fg?Uint8Array.from(m.fg.slice(1)):null,secLen:m.fg?m.fg[0]:0,
    traffic:m.tr.map(c=>({s:c[0],lat:c[1],latV:c[2],v:c[3],vis:!!c[4],closing:!!c[5],lapc:c[6]||0})),hazards:hz,alert:m.a,near:m.ni>=0?hz[m.ni]:null,dNear:m.dn,
    vis:m.vis,flagOn:!!m.fo,sc:{flag:m.fl||null},opts:{driver:m.dr?'drive':'model',hud:m.hd!==0},t:m.tm};
  Wt=performance.now();if(HUD)HUD.NAV.zoom=m.z||1;
  // sync on real time, not the game's sim clock (that runs slow whenever a frame is slow, which made the phone drift
  // against the monitor). The game stamps each update with its wall clock; the smallest arrival delay seen over the
  // last few seconds gives the offset between the two clocks without network jitter.
  const tk=m.tw!=null?m.tw/1000:m.tm;OFFS.push(Wt/1000-tk);while(OFFS.length>150)OFFS.shift();clockOff=Math.min(...OFFS);
  SNAP.push({tm:tk,w:W,fc:m.fc==null?null:m.fc});while(SNAP.length>90)SNAP.shift();}
function sampleWorld(now){
  // once the frame numbers have measured the display + camera delay, AR uses it too, so the HUD shows what the monitor shows
  if(!SNAP.length||clockOff==null)return W;const rt=now/1000-clockOff-(S.sim||(arOn&&(SIMAR.syncN||0)>=8)?SIMAR.delay/1000:0.06),L=HUD.wrapS,dS=HUD.dSigned;
  let i=SNAP.length-1;while(i>0&&SNAP[i-1].tm>rt)i--;
  const B=SNAP[i],A=i>0?SNAP[i-1]:null;
  if(!A||rt>=B.tm){const e=S.sim?0:Math.min(0.15,Math.max(0,rt-B.tm)),P=B.w.player;   // SIM keeps camera and world from the same snapshot
    return Object.assign({},B.w,{player:Object.assign({},P,{s:L(P.s+P.v*e),lat:P.lat+(P.latV||0)*e}),traffic:B.w.traffic.map(c=>Object.assign({},c,{s:L(c.s+c.v*e)})),dNear:B.w.dNear-P.v*e});}
  if(rt<=A.tm)return A.w;
  if(JSON.stringify(A.w.scr)!==JSON.stringify(B.w.scr)||JSON.stringify(A.w.mk)!==JSON.stringify(B.w.mk))return A.w;
  const k=(rt-A.tm)/Math.max(1e-3,B.tm-A.tm),lp=(a,b)=>a+(b-a)*k,ls=(a,b)=>L(a+dS(a,b)*k);
  const pa=A.w.player,pb=B.w.player;
  return Object.assign({},B.w,{
    player:Object.assign({},pb,{s:ls(pa.s,pb.s),lat:lp(pa.lat,pb.lat),psi:lp(pa.psi||0,pb.psi||0),v:lp(pa.v,pb.v),latV:lp(pa.latV||0,pb.latV||0)}),
    traffic:B.w.traffic.map((c,j)=>{const ca=A.w.traffic[j];return ca?Object.assign({},c,{s:ls(ca.s,c.s),lat:lp(ca.lat,c.lat),v:lp(ca.v,c.v)}):c;}),
    hazards:B.w.hazards.map((h,j)=>{const ha=A.w.hazards[j];return ha?Object.assign({},h,{lat:lp(ha.lat,h.lat)}):h;}),
    cm:A.w.cm&&B.w.cm?(()=>{const a=A.w.cm,b=B.w.cm,d=a[3]*b[3]+a[4]*b[4]+a[5]*b[5]+a[6]*b[6]>=0?1:-1,q=[3,4,5,6].map(i=>a[i]+(b[i]*d-a[i])*k),n=Math.hypot(...q)||1;
      return [lp(a[0],b[0]),lp(a[1],b[1]),lp(a[2],b[2]),...q.map(v=>v/n)];})():B.w.cm,
    dNear:lp(A.w.dNear,B.w.dNear)});}
// AR: the rear camera is the background, the overlay is drawn where things would be in front of you
async function setAR(on){
  const request=++cameraRequest;cameraError='';$('bAR').disabled=true;
  if(on){try{const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});
      if(request!==cameraRequest){stream.getTracks().forEach(t=>t.stop());return;}
      camStream=stream;video.srcObject=stream;video.hidden=false;await video.play();arOn=true;}
    catch(e){arOn=false;if(camStream)camStream.getTracks().forEach(t=>t.stop());camStream=null;video.srcObject=null;video.hidden=true;
      cameraError=!window.isSecureContext?'The camera needs the https:// address or the USB address.':'Camera access was refused or is not available. Tap AR to retry.';}}
  else{arOn=false;if(camStream)camStream.getTracks().forEach(t=>t.stop());camStream=null;video.hidden=true;video.srcObject=null;}
  $('bAR').disabled=false;$('bAR').setAttribute('aria-pressed',arOn?'true':'false');$('bSim').hidden=!arOn;if(!arOn)setSim(false);
  // AR is a passenger view: the game's autopilot drives, so the pedals and steering are off
  document.body.classList.toggle('ar',arOn);ORI.yaw=0;recenterAR();S.gas=S.brake=0;S.touchSteer=null;send({t:'cmd',c:'ar',on:arOn});if(arOn)startCal();else setDots(false);status();}
function drawHud(now){
  cx.setTransform(1,0,0,1,0,0);
  if(arOn)cx.clearRect(0,0,cv.width,cv.height);else{cx.fillStyle='#000';cx.fillRect(0,0,cv.width,cv.height);}
  if(!HUD||!trackOk||!W)return;
  const dt=Math.min(0.1,(now-(drawHud.last||now))/1000);drawHud.last=now;
  // smooth playback: interpolate between buffered updates instead of snapping to each one
  if(arOn&&S.sim)simCapture(now);
  else if(arOn&&!S.simBlock&&now-SIMAR.t>=120){simCapture(now);   // AR keeps looking for the sim's dots
    if(SIMAR.tracker.ready(now)){S.simAuto=true;setSim(true,true);}}
  if(arOn&&S.sim&&S.simAuto){if(SIMAR.tracker.ready(now))SIMAR.lastLock=now;else if(now-(SIMAR.lastLock||now)>1500){S.simAuto=false;setSim(false);}}
  // The dots stay on for as long as the phone is in AR: every camera frame that sees them re-measures the screen
  // mapping, lens bend, field of view, AR alignment and the display delay, so calibration never goes stale.
  const view=(arOn&&S.sim&&simSnap(now))||sampleWorld(arOn&&S.sim&&SIMAR.frameAt?SIMAR.frameAt:now);
  if(view.hazards&&view.near)view.near=view.hazards[view.hazards.indexOf(view.near)]||view.near;
  HUD.setWorld(view);window.__view=view;   // for debugging from the browser console
  const H=cv.height,Wd=cv.width,u=H/420;
  if(arOn&&S.sim){simFrame(view,now,dt,Wd,H,u);}
  else if(arOn){
    const uu=u*1.05,flash=true;
    const pose=arPose(),cam={pitch:pose.pitch,roll:pose.roll,hfov:CAL.hfov,camH:CAL.camH,yawOff:pose.yaw,rawYaw:true,vw:video.videoWidth||0,vh:video.videoHeight||0};
    const A=HUD.drawARView(cx,view,now/1000,uu,Wd,H,cam);
    // readable bands for the header and lap tracker over a bright camera image
    const bx=Wd*0.27,bw=Wd*0.46,hh=H*0.12,th=H*0.14,ty=H*0.04;   // position / lap tracker at the top
    cx.fillStyle='rgba(0,0,0,.38)';cx.fillRect(bx,ty-4*u,bw,th+8*u);
    HUD.drawTracker(cx,view,bx,ty,bw,th,uu,flash);
    HUD.drawFlagChip(cx,view,view.player.s,Wd/2-60*uu,ty+th+14*u,uu);
    // close-range 2D radar in the corner: the cars right around you, 50 m ahead
    {const rs=Math.min(H*0.44,Wd*0.24);HUD.drawNav(cx,view,now/1000,dt,uu,{x:Wd-rs-14*u,y:H*0.14,w:rs,h:rs*1.18},50);}
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

// ---- AR/VR camera from the phone's orientation: the standard mechanism (three.js DeviceOrientationControls,
// Cardboard). The OS fuses gyro + accelerometer (+ compass) into alpha/beta/gamma; with the screen rotation they give
// the camera's full orientation, so the view looks exactly where the phone's back camera points: tilt down to see
// the road at your feet, turn to look into a corner, roll and the horizon stays level. Recenter makes the current
// heading "straight down the track"; pitch and roll stay true to gravity so the horizon matches the real one.
const DO={ok:false,a:0,b:0,g:0,h0:0,center:true};
addEventListener('deviceorientation',e=>{if(e.alpha==null||e.beta==null)return;DO.a=e.alpha;DO.b=e.beta;DO.g=e.gamma||0;DO.ok=true;
  QH.push([performance.now(),devQuat()]);if(QH.length>40)QH.shift();});
// recent phone orientations, so the SIM overlay can use the pose at the moment the (delayed) camera frame was taken
const QH=[];
function qAt(t){if(!QH.length)return DO.ok?devQuat():null;let b=QH[QH.length-1];for(let i=QH.length-1;i>=0;i--){b=QH[i];if(QH[i][0]<=t)break;}return b[1];}
const qmul=(a,b)=>[a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
function qrot(q,v){const [x,y,z,w]=q,[vx,vy,vz]=v,ix=w*vx+y*vz-z*vy,iy=w*vy+z*vx-x*vz,iz=w*vz+x*vy-y*vx,iw=-x*vx-y*vy-z*vz;
  return [ix*w-iw*x-iy*z+iz*y,iy*w-iw*y-iz*x+ix*z,iz*w-iw*z-ix*y+iy*x];}
function devQuat(){const b=DO.b*D2R,a=DO.a*D2R,g=-DO.g*D2R,o=((screen.orientation&&screen.orientation.angle)!=null?screen.orientation.angle:(window.orientation||0))*D2R;
  const c1=Math.cos(b/2),c2=Math.cos(a/2),c3=Math.cos(g/2),s1=Math.sin(b/2),s2=Math.sin(a/2),s3=Math.sin(g/2);
  let q=[s1*c2*c3+c1*s2*s3,c1*s2*c3-s1*c2*s3,c1*c2*s3-s1*s2*c3,c1*c2*c3+s1*s2*s3];   // Euler (beta, alpha, -gamma), order YXZ
  q=qmul(q,[-Math.SQRT1_2,0,0,Math.SQRT1_2]);                                          // the camera looks out of the back
  return qmul(q,[0,0,Math.sin(-o/2),Math.cos(-o/2)]);}                                  // screen rotated to landscape
// Adaptive smoothing of the phone's orientation (a One-Euro-style filter on the quaternion): sensor noise makes the
// raw pose tremble by a few tenths of a degree, which shows as a shimmering overlay when the phone is held still.
// The filter's time constant follows the turn rate: ~80 ms when still (steady), ~10 ms when turning (no lag).
const QF={q:null,t:0,w:[0,0,0],out:null};
function slerp(a,b,k){let d=a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3];if(d<0){b=b.map(v=>-v);d=-d;}
  if(d>0.9995){const r=a.map((v,i)=>v+(b[i]-v)*k),n=Math.hypot(...r);return r.map(v=>v/n);}
  const th=Math.acos(d),s0=Math.sin((1-k)*th)/Math.sin(th),s1=Math.sin(k*th)/Math.sin(th);return a.map((v,i)=>v*s0+b[i]*s1);}
// Latency prediction, as head-mounted displays do: the pose is extrapolated ~30 ms ahead along the (smoothed)
// angular velocity, so the overlay does not trail the world while turning. It ramps in only above ~0.3 rad/s: at
// rest, extrapolating sensor noise would bring the shimmer back.
const PRED_S=0.03;
function qconj(q){return [-q[0],-q[1],-q[2],q[3]];}
function smoothQuat(q,now){
  if(!QF.q||now-QF.t>300){QF.q=q;QF.t=now;QF.w=[0,0,0];return q;}
  const dt=(now-QF.t)/1000;QF.t=now;if(dt<=0)return QF.out||QF.q;
  const d=Math.abs(QF.q[0]*q[0]+QF.q[1]*q[1]+QF.q[2]*q[2]+QF.q[3]*q[3]),speed=2*Math.acos(Math.min(1,d))/dt;   // rad/s
  const tau=0.01+0.07*Math.exp(-speed/0.5),prev=QF.q;QF.q=slerp(QF.q,q,1-Math.exp(-dt/tau));
  // angular velocity (world frame) from the filtered pose, smoothed over ~50 ms
  let dq=qmul(QF.q,qconj(prev));if(dq[3]<0)dq=dq.map(v=>-v);
  const sn=Math.hypot(dq[0],dq[1],dq[2]),ang=2*Math.atan2(sn,dq[3]),k=sn>1e-9?ang/sn/dt:0,a=1-Math.exp(-dt/0.05);
  QF.w=QF.w.map((v,i)=>v+(dq[i]*k-v)*a);
  const wn=Math.hypot(...QF.w),g=clamp((wn-0.3)/0.7,0,1);if(!(g>0)){QF.out=QF.q;return QF.q;}
  const th=wn*PRED_S*g,h=Math.sin(th/2)/wn,pq=[QF.w[0]*h,QF.w[1]*h,QF.w[2]*h,Math.cos(th/2)];
  QF.out=qmul(pq,QF.q);return QF.out;}
// camera pose for the AR projection: pitch (down +), roll (horizon angle), yaw (+ = looking right of straight ahead)
// the phone's own pose, before the alignment offsets
function arPoseRaw(){
  if(!DO.ok)return {pitch:0,roll:0,yaw:-ORI.yaw};                                                // fallback: gyro yaw only
  const q=smoothQuat(devQuat(),performance.now()),f=qrot(q,[0,0,-1]),up=qrot(q,[0,1,0]),rt=qrot(q,[1,0,0]),h=Math.atan2(f[0],-f[2]);
  if(DO.center){DO.h0=h;DO.center=false;}
  let yaw=Math.atan2(Math.sin(h-DO.h0),Math.cos(h-DO.h0));if(S.yawInv)yaw=-yaw;
  return {pitch:-Math.asin(clamp(f[1],-1,1)),roll:Math.atan2(rt[1],up[1]),yaw};}
function arPose(){const r=arPoseRaw();return {pitch:r.pitch+CAL.pitchOff,roll:r.roll,yaw:CAL.yawOff+r.yaw};}
// Align plain AR with the sim. The sim's view centre (its camera axis) is the middle of the game screen; through
// the dot mapping we know where that is in the phone camera, i.e. at which angles (dx right, dy down) from the
// phone's own axis. AR must then look (dx, dy) away from the sim camera's direction: yaw = -dx, pitch = sim pitch
// - dy. The offsets that make the phone's current pose give exactly that are blended in while the screen is seen,
// so AR's horizon and road sit where the sim's are, and stay there when the phone turns away (orientation only).
function simPitch(){if(!W||!W.cm)return 0.035;const c=W.cm,q=[c[3],c[4],c[5],c[6]],f=qrot(q,[0,0,-1]);return -Math.asin(clamp(f[1],-1,1));}
function alignAR(M,frameW,k){if(!W||!W.scr)return;const P=SC.project(M.H,W.scr[0]/2,W.scr[1]/2);if(!P)return;
  const fp=(frameW/2)/Math.tan(CAL.hfov*Math.PI/360),dx=Math.atan((P[0]-M.cx)/fp),dy=Math.atan((P[1]-M.cy)/fp),r=arPoseRaw();
  const tp=simPitch()-dy-r.pitch,ty=-dx-r.yaw,wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
  CAL.pitchOff=clamp(CAL.pitchOff+wrap(tp-CAL.pitchOff)*k,-0.9,0.9);CAL.yawOff=wrap(CAL.yawOff+wrap(ty-CAL.yawOff)*k);
  SIMAR.alignN=(SIMAR.alignN||0)+1;if(SIMAR.alignN%60===0)saveCal();}
function recenterAR(){ORI.yaw=0;DO.center=true;QF.q=null;}
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
  // Straight ahead = the phone held level in the way the screen is shown: gravity angle = screen rotation. The
  // quarter-turn offset absorbs axis-sign differences between browsers (iOS vs Android) and a locked rotation, and
  // the trim is the user's own "centre" (small). Taking the first reading as centre broke on iPhones: it was often
  // taken while the phone was still upright, so every tilt landed near +-90..180 degrees (full lock, reversed).
  if(S.quarter==null)recenter();
  let d=angd(ang,screenRot()+S.quarter+S.trim);
  // held far past full lock for a while: the reference is a quarter turn off (e.g. the page did not rotate); re-take it
  if(Math.abs(d)>80){if(!S.farSince)S.farSince=performance.now();else if(performance.now()-S.farSince>1200){recenter();d=0;}}else S.farSince=0;
  // Turning the phone clockwise (to the right, as seen by the driver) turns "up" the other way in the phone's own
  // frame, so the gravity angle decreases: negate to make a right turn positive, as the game expects.
  d=-d;
  if(S.inv)d=-d;
  S.angle=d;
}
function screenRot(){const o=screen.orientation&&screen.orientation.angle!=null?screen.orientation.angle:(window.orientation||0);return +o||0;}
function recenter(){S.farSince=0;
  if(S.hasMotion){const ang=Math.atan2(S.gx,S.gy)*180/Math.PI,base=screenRot();let best=0;
    for(const q of [0,90,180,270])if(Math.abs(angd(ang,base+q))<Math.abs(angd(ang,base+best)))best=q;
    S.quarter=best;S.trim=clamp(angd(ang,base+best),-30,30);}
  S.touchSteer=S.touchSteer==null?null:0;}
addEventListener('orientationchange',()=>{S.trim=0;});

// ---- pedals (multi-touch)
function pedal(el,key){
  const on=v=>{S[key]=v;el.classList.toggle('on',!!v);if(v&&navigator.vibrate)navigator.vibrate(12);};
  el.addEventListener('pointerdown',e=>{if(arOn)return;e.preventDefault();el.setPointerCapture(e.pointerId);on(1);});
  for(const ev of ['pointerup','pointercancel','lostpointercapture'])el.addEventListener(ev,()=>on(0));
}
pedal($('gas'),'gas');pedal($('brake'),'brake');

// ---- touch steering fallback: drag sideways on the wheel
const wb=document.body;let dragX=null;
wb.addEventListener('pointerdown',e=>{if(arOn||S.hasMotion||e.target.closest('.pedal,.bar,.sheet'))return;dragX=e.clientX;wb.setPointerCapture(e.pointerId);S.touchSteer=0;});
wb.addEventListener('pointermove',e=>{if(dragX==null)return;S.touchSteer=clamp((e.clientX-dragX)/(innerWidth*0.25),-1,1);});
for(const ev of ['pointerup','pointercancel'])wb.addEventListener(ev,()=>{dragX=null;S.touchSteer=0;});

// ---- buttons
$('bRun').onclick=()=>send({t:'cmd',c:S.running?'stop':'start'});
$('bDrop').onclick=()=>send({t:'cmd',c:'drop'});
$('bCam').onclick=()=>send({t:'cmd',c:'cam'});
$('bAR').onclick=()=>setAR(!arOn);
$('bSetup').onclick=()=>{const open=$('bLock').hidden;document.querySelectorAll('.more').forEach(b=>b.hidden=!open);$('bSetup').setAttribute('aria-pressed',open?'true':'false');};
// One button calibrates and centres, automatically, whatever the mode:
//   wheel: the way the phone is held now is straight ahead (steering centre)
//   AR:    straight ahead = where the phone points now; old manual offsets are cleared; the sim's dots are looked
//          for again (SIM comes on by itself when they are seen), which relearns the lens and the field of view
//   SIM:   the screen is reacquired and the display + camera delay is relearnt from the frame numbers
// the sim shows its dots while this phone asks for them: all the time in AR
function setDots(on){on=!!on;if(!!S.dots===on)return;S.dots=on;send({t:'cmd',c:'dots',on});}
function startCal(){S.calStart=performance.now();SIMAR.alignN=0;setDots(true);}
function calibrate(){
  if(!arOn){recenter();recFlash('Centred');return;}
  startCal();
  // pointing at the middle of the sim now: its centre is straight ahead at the sim camera's pitch (refined by the
  // dots as soon as they are seen)
  recenterAR();const r=arPoseRaw();CAL.pitchOff=simPitch()-r.pitch;CAL.yawOff=0;saveCal();
  S.simBlock=false;SIMAR.syncN=0;SIMAR.tcRej=0;SIMAR.prevPts=null;resetSim();
  recFlash(S.sim?'Reacquiring the screen':'Centred · looking for the sim');}
$('bCal').onclick=calibrate;
function syncOpts(){$('bLock').textContent='Lock '+S.lock+'°';$('bInv').setAttribute('aria-pressed',S.inv?'true':'false');$('bFfb').setAttribute('aria-pressed',S.ffb?'true':'false');$('bFlip').setAttribute('aria-pressed',S.yawInv?'true':'false');
  try{localStorage.setItem('rw.lock',S.lock);localStorage.setItem('rw.inv3',S.inv?'1':'0');localStorage.setItem('rw.ffb',S.ffb?'1':'0');localStorage.setItem('rw.flip',S.yawInv?'1':'0');}catch(e){}}
$('bLock').onclick=()=>{S.lock=S.lock===30?45:S.lock===45?70:30;syncOpts();};
$('bFfb').onclick=()=>{S.ffb=!S.ffb;if(!S.ffb&&navigator.vibrate)navigator.vibrate(0);syncOpts();};
$('bFlip').onclick=()=>{S.yawInv=!S.yawInv;recenterAR();syncOpts();};
// ---- SIM AR: point the camera at the game screen. The sim shows four coloured calibration dots; the C++ core
// (physics/markers.cpp) finds them in the camera image and gives the homography from the game screen to the
// camera view. The HUD is drawn at game-screen size and warped through it (piecewise affine), so boxes, call signs,
// the radar and flags sit exactly on the sim picture as the phone moves.
let PHX=null;
const SC=window.SimCalibration;
const SIMAR={syncN:0,tcRej:0,model:null,k1:0,fc:null,fcAt:0,sync:0,grab:document.createElement('canvas'),frame:document.createElement('canvas'),off:document.createElement('canvas'),tracker:new SC.Tracker(),t:-Infinity,frameAt:0,videoTime:-1,geometry:'',error:'',delay:110};
try{const k=+localStorage.getItem('rw.k1');if(Number.isFinite(k))SIMAR.k1=clamp(k,-0.35,0.35);}catch(e){}
try{const delay=localStorage.getItem('rw.simDelay');if(delay!==null&&Number.isFinite(+delay))SIMAR.delay=clamp(+delay,0,300);}catch(e){}
$('simDelay').value=SIMAR.delay;$('simDelayValue').textContent=SIMAR.delay+' ms';
$('simDelay').oninput=e=>{SIMAR.delay=clamp(+e.target.value,0,300);$('simDelayValue').textContent=SIMAR.delay+' ms';try{localStorage.setItem('rw.simDelay',SIMAR.delay);}catch(e){}};
fetch('/physics.wasm').then(r=>{if(!r.ok)throw new Error('Detector download failed');return r.arrayBuffer();}).then(b=>WebAssembly.instantiate(b,{})).then(({instance})=>{
  const p=instance.exports;
  for(const name of ['markers_frame','markers_find','markers_found','markers_cands','markers_homography','markers_hom','markers_find_near','markers_near','markers_fit','markers_fit_in','markers_fit_out'])if(typeof p[name]!=='function')throw new Error('Detector version mismatch');
  if(p._initialize)p._initialize();PHX=p;
}).catch(()=>{SIMAR.error='Could not load the screen detector. Reload this page to retry.';});
function resetSim(){SIMAR.tracker.reset();SIMAR.t=-Infinity;SIMAR.frameAt=0;SIMAR.videoTime=-1;SIMAR.geometry='';}
function setSim(on,keepLock){on=!!on&&arOn;if(!!S.sim===on)return;S.sim=on;if(keepLock){SIMAR.lastLock=performance.now();SIMAR.fc=null;}else resetSim();$('simControls').hidden=true;
  document.body.classList.toggle('sim',on);$('bSim').setAttribute('aria-pressed',on?'true':'false');
  send({t:'cmd',c:'sim',on});}
// SIM comes on by itself when the camera finds the dots; the button still forces it on, or off (and then stays off
// until pressed again)
$('bSim').onclick=()=>{if(S.sim){S.simBlock=true;S.simAuto=false;setSim(false);}else{S.simBlock=false;S.simAuto=false;setDots(true);setSim(true);}};
window.__simar=SIMAR;   // for debugging from the browser console
function simCapture(now){
  if(video.readyState<2||!video.videoWidth||!video.videoHeight||now-SIMAR.t<30)return;
  const geometry=[video.videoWidth,video.videoHeight,cv.width,cv.height,W&&W.scr,W&&W.mk].join('|');
  if(geometry!==SIMAR.geometry){resetSim();SIMAR.geometry=geometry;}
  if(video.currentTime===SIMAR.videoTime)return;
  SIMAR.videoTime=video.currentTime;SIMAR.t=now;SIMAR.frameAt=now;
  const f=SIMAR.frame,fs=SC.frameSize(video.videoWidth,video.videoHeight,1280,1280*960);
  if(f.width!==fs.width||f.height!==fs.height){f.width=fs.width;f.height=fs.height;}
  // Capture once: detection and the visible background must refer to this exact image.
  f.getContext('2d').drawImage(video,0,0,f.width,f.height);
  if(!PHX)return;
  const {width:w,height:h}=SC.frameSize(f.width,f.height),g=SIMAR.grab;
  if(g.width!==w||g.height!==h){g.width=w;g.height=h;}
  const gc=g.getContext('2d',{willReadFrequently:true});gc.drawImage(f,0,0,w,h);
  try{
    new Uint8Array(PHX.memory.buffer,PHX.markers_frame(),w*h*4).set(gc.getImageData(0,0,w,h).data);
    let mask=PHX.markers_find(w,h);const F=new Float64Array(PHX.memory.buffer,PHX.markers_found(),8);
    let points=SC.frameToCanvas([0,1,2,3].map(i=>[F[2*i]*f.width/w,F[2*i+1]*f.height/h]),f.width,f.height,cv.width,cv.height);
    if(mask===15&&W&&W.mk&&W.mx&&W.scr){const pick=pickCorners(f,w,h);if(pick)points=pick;else mask=0;}
    SIMAR.tracker.update(mask,points,now);
    SIMAR.fc=null;SIMAR.model=null;if(SIMAR.tracker.ready(now)){fitModel(f,w,h);readTimecode(f);}
  }catch(e){SIMAR.tracker.reset();SIMAR.error='Screen detection failed. Reload this page to retry.';}
}
// Which blobs are the corners: scenery (a kerb, a sponsor board, a HUD graphic) can look more dot-like than a real
// corner dot, so the detector keeps its four best candidates per colour. Combinations are tried best first; one is
// accepted only if it makes a sane screen and the edge dots then turn up where it predicts them (at least three of
// the six, or all that are listed). A lookalike blob cannot pass that.
function pickCorners(f,w,h){
  const C=new Float64Array(PHX.memory.buffer,PHX.markers_cands(),48),c=SC.cover(f.width,f.height,cv.width,cv.height);
  const toCanvas=(gx,gy)=>[c.x+gx*f.width/w*c.scale,c.y+gy*f.height/h*c.scale],toGrab=(X,Y)=>[(X-c.x)/c.scale*w/f.width,(Y-c.y)/c.scale*h/f.height];
  const L=[0,1,2,3].map(k=>{const o=[];for(let j=0;j<4;j++){const sc=C[k*12+j*3+2];if(sc>0)o.push({p:toCanvas(C[k*12+j*3],C[k*12+j*3+1]),sc});}return o;});
  if(L.some(l=>!l.length))return null;
  const combos=[];for(const a of L[0])for(const b of L[1])for(const d of L[2])for(const e of L[3])combos.push({pts:[a.p,b.p,d.p,e.p],sc:a.sc+b.sc+d.sc+e.sc});
  combos.sort((x,y)=>y.sc-x.sc);
  const mk=W.mk,mx=W.mx,gw=W.scr[0],gh=W.scr[1],need=Math.min(3,mx.length/3);let tries=0;
  for(const cb of combos){if(!SC.validQuad(cb.pts))continue;if(++tries>16)break;const d=cb.pts;
    if(!PHX.markers_homography(mk[0],mk[1],mk[2],mk[3],mk[4],mk[5],mk[6],mk[7],d[0][0],d[0][1],d[1][0],d[1][1],d[2][0],d[2][1],d[3][0],d[3][1]))continue;
    const Hm=Float64Array.from(new Float64Array(PHX.memory.buffer,PHX.markers_hom(),9));if(!SC.validHomography(Hm,gw,gh))continue;
    const cg=d.map(q=>toGrab(q[0],q[1]));let ok=0;
    for(let i=0;i<mx.length;i+=3){const p=SC.project(Hm,mx[i],mx[i+1]);if(!p)continue;const g=toGrab(p[0],p[1]);
      const rad=clamp(0.3*Math.min(...cg.map(q=>Math.hypot(q[0]-g[0],q[1]-g[1]))),5,40);if(PHX.markers_find_near(w,h,mx[i+2],g[0],g[1],rad))ok++;}
    if(ok>=need)return d.map(q=>q.slice());}
  return null;}
// Lens-true mapping: the corners give a first homography, which predicts where the six edge dots are; each is looked
// for in a small window there (C++), and all dots found fit the homography plus the lens bend (k1) together. A phone
// lens bends straight lines a little, which a 4-point homography cannot follow; that is what made the HUD's corners
// curve differently from the sim's. k1 belongs to the camera, so it is averaged over time and remembered.
// Detection noise is also calmed: a dot that moved less than 2 px is treated as still (low-pass), a real move is
// taken as is, so the HUD stays put when the phone does and follows at once when it moves.
function fitModel(f,w,h){
  const mk=W&&W.mk,mx=W&&W.mx,d=SIMAR.tracker.points;if(!mk||!d)return;
  if(!PHX.markers_homography(mk[0],mk[1],mk[2],mk[3],mk[4],mk[5],mk[6],mk[7],d[0][0],d[0][1],d[1][0],d[1][1],d[2][0],d[2][1],d[3][0],d[3][1]))return;
  const H4=Float64Array.from(new Float64Array(PHX.memory.buffer,PHX.markers_hom(),9)),c=SC.cover(f.width,f.height,cv.width,cv.height);
  const toGrab=(X,Y)=>[(X-c.x)/c.scale*w/f.width,(Y-c.y)/c.scale*h/f.height],toCanvas=(gx,gy)=>[c.x+gx*f.width/w*c.scale,c.y+gy*f.height/h*c.scale];
  const pairs=[];for(let i=0;i<4;i++)pairs.push([i,mk[2*i],mk[2*i+1],d[i][0],d[i][1]]);
  if(mx){const cg=d.map(q=>toGrab(q[0],q[1]));
    for(let i=0;i<mx.length;i+=3){const p=SC.project(H4,mx[i],mx[i+1]);if(!p)continue;const g=toGrab(p[0],p[1]);
      const rad=clamp(0.3*Math.min(...cg.map(q=>Math.hypot(q[0]-g[0],q[1]-g[1]))),5,40);
      if(PHX.markers_find_near(w,h,mx[i+2],g[0],g[1],rad)){const N=new Float64Array(PHX.memory.buffer,PHX.markers_near(),2),q=toCanvas(N[0],N[1]);pairs.push([4+i/3,mx[i],mx[i+1],q[0],q[1]]);}}}
  const prev=SIMAR.prevPts||(SIMAR.prevPts=new Map());
  for(const p of pairs){const o=prev.get(p[0]);if(o){const dx=p[3]-o[0],dy=p[4]-o[1];if(Math.hypot(dx,dy)<2){p[3]=o[0]+dx*0.35;p[4]=o[1]+dy*0.35;}}prev.set(p[0],[p[3],p[4]]);}
  const IN=new Float64Array(PHX.memory.buffer,PHX.markers_fit_in(),256);pairs.forEach((p,i)=>IN.set(p.slice(1),4*i));
  const cxc=c.x+f.width*c.scale/2,cyc=c.y+f.height*c.scale/2,rn=Math.hypot(f.width,f.height)*c.scale/2;
  const xs=d.map(q=>q[0]),span=(Math.max(...xs)-Math.min(...xs))/(f.width*c.scale),FO=()=>new Float64Array(PHX.memory.buffer,PHX.markers_fit_out(),2);
  if(pairs.length>=8&&span>0.45&&PHX.markers_fit(pairs.length,cxc,cyc,rn,0,1)&&FO()[1]<3){
    SIMAR.k1+=(FO()[0]-SIMAR.k1)*0.08;if(performance.now()-(SIMAR.k1Saved||0)>3000){SIMAR.k1Saved=performance.now();try{localStorage.setItem('rw.k1',SIMAR.k1.toFixed(4));}catch(e){}}}
  let n=pairs.length;if(!PHX.markers_fit(n,cxc,cyc,rn,SIMAR.k1,0))return;
  if(FO()[1]>4&&n>4){n=4;if(!PHX.markers_fit(4,cxc,cyc,rn,SIMAR.k1,0))return;}   // a bad edge dot: fall back to the corners
  SIMAR.model={H:Float64Array.from(new Float64Array(PHX.memory.buffer,PHX.markers_hom(),9)),k1:SIMAR.k1,cx:cxc,cy:cyc,rn,n,rms:FO()[1],at:SIMAR.frameAt};
  autoFov(SIMAR.model,f.width*c.scale);if(arOn)alignAR(SIMAR.model,f.width*c.scale,0.2);}
// The dots also calibrate plain AR: the screen is a rectangle, so its two edge directions through the camera must
// be perpendicular and equally scaled. With the principal point at the frame centre that fixes the focal length
// (the standard homography-to-intrinsics constraints), i.e. the camera's real field of view, which AR then uses
// instead of a guess. Only well-conditioned views count (screen seen at an angle, both constraints agreeing).
function autoFov(M,frameW){const h=M.H,a=h[0]-M.cx*h[6],b=h[1]-M.cx*h[7],c=h[3]-M.cy*h[6],d=h[4]-M.cy*h[7],e=h[6],g=h[7];
  const f1=-(a*b+c*d)/(e*g),f2=(a*a+c*c-b*b-d*d)/(g*g-e*e);
  if(!(f1>0&&f2>0&&isFinite(f1)&&isFinite(f2))||f1/f2<0.8||f1/f2>1.25)return;
  const hf=2*Math.atan(frameW/2/Math.sqrt((f1+f2)/2))*180/Math.PI;if(hf<40||hf>110)return;
  CAL.hfov+=(hf-CAL.hfov)*0.05;SIMAR.fovN=(SIMAR.fovN||0)+1;if(SIMAR.fovN%30===0)saveCal();}
// screen point -> camera canvas through the fitted model: homography, then the lens bend (inverse of the fit's
// undistortion, a few fixed-point steps)
function modelMap(M,x,y){const u=SC.project(M.H,x,y);if(!u)return null;if(!M.k1)return u;
  const ux=u[0]-M.cx,uy=u[1]-M.cy;let fx=ux,fy=uy;for(let i=0;i<4;i++){const f=1+M.k1*(fx*fx+fy*fy)/(M.rn*M.rn);fx=ux/f;fy=uy/f;}return [M.cx+fx,M.cy+fy];}
// Exact timing: the sim shows its frame number as a strip of black/white cells (Gray code, so a camera exposure that
// straddles two frames reads as one of them, never garbage). Read it from this camera frame through the homography
// and draw the HUD of exactly that game frame. Every successful read also measures the real display + camera delay,
// which is used whenever the strip cannot be read.
function readTimecode(f){
  const w=W,mk=w&&w.mk,tc=w&&w.tc,d=SIMAR.tracker.points;if(!PHX||!mk||!tc||!d)return;
  if(!PHX.markers_homography(mk[0],mk[1],mk[2],mk[3],mk[4],mk[5],mk[6],mk[7],d[0][0],d[0][1],d[1][0],d[1][1],d[2][0],d[2][1],d[3][0],d[3][1]))return;
  const Hm=new Float64Array(PHX.memory.buffer,PHX.markers_hom(),9),c=SC.cover(f.width,f.height,cv.width,cv.height),r=tc[4]*0.22,pts=[];
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  const NC=tc[5]||9;
  for(let i=0;i<NC;i++){const x=tc[0]+(tc[2]-tc[0])*i/(NC-1),y=tc[1]+(tc[3]-tc[1])*i/(NC-1);
    for(const [ox,oy] of [[0,0],[-r,-r],[r,-r],[r,r],[-r,r]]){const p=SC.project(Hm,x+ox,y+oy);if(!p)return;
      const fx=Math.round((p[0]-c.x)/c.scale),fy=Math.round((p[1]-c.y)/c.scale);if(fx<0||fy<0||fx>=f.width||fy>=f.height)return;
      pts.push(fx,fy,i);x0=Math.min(x0,fx);y0=Math.min(y0,fy);x1=Math.max(x1,fx);y1=Math.max(y1,fy);}}
  const bw=x1-x0+1,bh=y1-y0+1;if(bw*bh>400*400)return;
  const img=f.getContext('2d').getImageData(x0,y0,bw,bh).data,L=new Float64Array(NC);
  for(let k=0;k<pts.length;k+=3){const q=((pts[k+1]-y0)*bw+pts[k]-x0)*4;L[pts[k+2]]+=img[q]*0.3+img[q+1]*0.59+img[q+2]*0.11;}
  const span=L[0]-L[1];if(span<5*40)return;   // white and black reference squares too alike: glare or out of focus
  // every square must read clearly white or clearly black; one in between (blur, moire, a frame change mid-exposure
  // on a non-Gray square) makes the whole reading untrusted rather than a wrong frame
  const th=(L[0]+L[1])/2;let g=0,par=0;
  for(let i=2;i<NC;i++){if(Math.abs(L[i]-th)<0.22*span){SIMAR.tcBad=(SIMAR.tcBad||0)+1;return;}const v=L[i]>th?1:0;if(i<9){g=g<<1|v;par^=v;}else if(v!==par){SIMAR.tcBad=(SIMAR.tcBad||0)+1;return;}}
  g^=g>>1;g^=g>>2;g^=g>>4;SIMAR.fc=g;SIMAR.fcAt=SIMAR.frameAt;}
function simSnap(now){
  if(SIMAR.fc==null||SIMAR.fcAt!==SIMAR.frameAt||clockOff==null)return null;
  for(let i=SNAP.length-1;i>=0;i--){const sn=SNAP[i];if(sn.fc!==SIMAR.fc)continue;
    const lag=(SIMAR.frameAt/1000-clockOff-sn.tm)*1000;if(lag<-20||lag>600)return null;
    // A reading must also agree with the delay measured so far (display + camera latency hardly changes). Until
    // a few readings agree it is learnt quickly; after that a reading more than 45 ms off is treated as a misread
    // and this frame falls back to the delay-based timing. If readings keep disagreeing, the delay is relearnt.
    const settled=(SIMAR.syncN||0)>=8;
    if(settled&&Math.abs(lag-SIMAR.delay)>45){if(++SIMAR.tcRej>20){SIMAR.syncN=0;SIMAR.tcRej=0;}return null;}
    SIMAR.tcRej=0;SIMAR.syncN=(SIMAR.syncN||0)+1;
    SIMAR.delay+=(clamp(lag,0,300)-SIMAR.delay)*(settled?0.05:0.35);SIMAR.sync=now;
    if(now-(SIMAR.shown||0)>500){SIMAR.shown=now;$('simDelay').value=Math.round(SIMAR.delay/10)*10;$('simDelayValue').textContent=Math.round(SIMAR.delay)+' ms (auto)';}
    return sn.w;}
  return null;}
function simPips(Wd,H,u){const cols=['#FF3B3B','#3BF03B','#3B6BFF','#F03BF0'],m=SIMAR.tracker.mask,locked=SIMAR.tracker.ready(performance.now());
  cx.save();const x0=Wd/2-62*u,y0=H*0.04;cx.fillStyle='rgba(0,0,0,.55)';cx.fillRect(x0-8*u,y0-6*u,300*u,24*u);
  cols.forEach((c,i)=>{cx.beginPath();cx.arc(x0+i*16*u,y0+6*u,5*u,0,Math.PI*2);if(m>>i&1){cx.fillStyle=c;cx.fill();}else{cx.strokeStyle=c;cx.lineWidth=1.5*u;cx.stroke();}});
  cx.fillStyle=locked?'#3BF08A':'#FFC247';cx.font=`700 ${10*u}px "B612 Mono", monospace`;cx.textBaseline='middle';cx.fillText(locked?'LOCKED · '+(SIMAR.model?SIMAR.model.n:4)+' DOTS'+(performance.now()-(SIMAR.sync||0)<400?' · SYNC':'')+(SIMAR.model&&SIMAR.model.n>4?' · fit '+SIMAR.model.rms.toFixed(1)+' px':''):'SEARCHING',x0+62*u,y0+6*u);cx.restore();}
function simFrame(view,now,dt,Wd,H,u){
  const f=SIMAR.frame;
  if(SIMAR.frameAt){const c=SC.cover(f.width,f.height,Wd,H);cx.drawImage(f,c.x,c.y,f.width*c.scale,f.height*c.scale);}
  const mk=view.mk,gw=view.scr?view.scr[0]:0,gh=view.scr?view.scr[1]:0;
  if(!PHX||!mk||!gw||!gh||!SIMAR.tracker.ready(now)||now-Wt>500||SIMAR.error){
    simPips(Wd,H,u);cx.save();cx.fillStyle='rgba(0,0,0,.55)';cx.fillRect(Wd*0.2,H*0.42,Wd*0.6,H*0.16);cx.fillStyle='#E3EBF0';cx.textAlign='center';cx.textBaseline='middle';
    const hint=SIMAR.error||(!PHX?'Loading screen detector…':now-Wt>500?'Waiting for live game data':!SIMAR.frameAt?'Waiting for a camera frame':mk?'Point the camera at the game screen':'Waiting for the calibration dots on the sim');
    cx.font=`700 ${14*u}px "B612 Mono", monospace`;cx.fillText(hint,Wd/2,H*0.475);
    cx.font=`${11*u}px "B612 Mono", monospace`;cx.fillText('Keep the corner dots visible. Move closer if they look small.',Wd/2,H*0.53);cx.restore();return;}
  simPips(Wd,H,u);
  const M=SIMAR.model;if(!M)return;
  if(!SC.validHomography(M.H,gw,gh)){SIMAR.tracker.reset();return;}
  const map=(x,y)=>modelMap(M,x,y);
  // the HUD at game-screen size (60 % resolution), then warped onto the screen in the camera image
  const k0=0.6,off=SIMAR.off,ow=Math.round(gw*k0),oh=Math.round(gh*k0);if(off.width!==ow||off.height!==oh){off.width=ow;off.height=oh;}
  const oc=off.getContext('2d');oc.setTransform(1,0,0,1,0,0);oc.clearRect(0,0,ow,oh);oc.setTransform(k0,0,0,k0,0,0);
  HUD.setSize(gw,gh);HUD.drawScreen(oc,view,now/1000,dt,true);
  const tri=(S0)=>{const Q=S0.map(q=>map(q[0],q[1]));if(Q.some(q=>!q))return;const P=S0.map(q=>[q[0]*k0,q[1]*k0]);
    const a1x=P[1][0]-P[0][0],a1y=P[1][1]-P[0][1],a2x=P[2][0]-P[0][0],a2y=P[2][1]-P[0][1],den=a1x*a2y-a2x*a1y;if(!den)return;
    const b1x=Q[1][0]-Q[0][0],b1y=Q[1][1]-Q[0][1],b2x=Q[2][0]-Q[0][0],b2y=Q[2][1]-Q[0][1];
    const a=(b1x*a2y-b2x*a1y)/den,c=(b2x*a1x-b1x*a2x)/den,b=(b1y*a2y-b2y*a1y)/den,dd=(b2y*a1x-b1y*a2x)/den,e=Q[0][0]-a*P[0][0]-c*P[0][1],f=Q[0][1]-b*P[0][0]-dd*P[0][1];
    const mx=(Q[0][0]+Q[1][0]+Q[2][0])/3,my=(Q[0][1]+Q[1][1]+Q[2][1])/3;
    cx.save();cx.beginPath();Q.forEach((q,i)=>{const x=q[0]+Math.sign(q[0]-mx)*0.8,y=q[1]+Math.sign(q[1]-my)*0.8;i?cx.lineTo(x,y):cx.moveTo(x,y);});cx.closePath();cx.clip();
    cx.setTransform(a,b,c,dd,e,f);cx.drawImage(off,0,0);cx.restore();};
  const G=12;for(let i=0;i<G;i++)for(let j=0;j<G;j++){const x0=gw*i/G,x1=gw*(i+1)/G,y0=gh*j/G,y1=gh*(j+1)/G;tri([[x0,y0],[x1,y0],[x1,y1]]);tri([[x0,y0],[x1,y1],[x0,y1]]);}
}
// AR: double-tap anywhere on the view to make the way you are facing "straight ahead"
let lastTap=0;
addEventListener('pointerdown',e=>{if(!arOn||e.target.closest('.bar,.sheet'))return;const now=performance.now();
  if(now-lastTap<350){recenterAR();lastTap=0;if(navigator.vibrate)navigator.vibrate(15);recFlash();}else lastTap=now;});
function recFlash(text){const el=$('recenter');el.textContent=text||'Centred';el.classList.remove('show');void el.offsetWidth;el.classList.add('show');}
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
  try{if(typeof DeviceOrientationEvent!=='undefined'&&DeviceOrientationEvent.requestPermission)await DeviceOrientationEvent.requestPermission();}catch(e){}
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
