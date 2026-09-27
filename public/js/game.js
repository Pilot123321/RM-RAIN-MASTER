(function(){
'use strict';
const $=id=>document.getElementById(id);
if(typeof THREE==='undefined'){ $('stage').insertAdjacentHTML('beforeend','<div class="noscript">The 3D view needs three.js from cdnjs, which did not load.</div>'); return; }
const RM = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp=(x,a,b)=>x<a?a:x>b?b:x, lerp=(a,b,t)=>a+(b-a)*t, TAU=Math.PI*2;
function mulberry(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;}}
const angd=(a,b)=>{let d=a-b; while(d>Math.PI)d-=TAU; while(d<-Math.PI)d+=TAU; return d;};

/* ================= TRACK (rebuildable) ================= */
const HW=6, WALL=6.6, GRIP=22;
let N,L,DS,PX,PZ,TX,TZ,H,SL,KC,LATRL,VPROF,WLX,WLZ,WRX,WRZ,WGL,WGR,CORNERS=[],STRAIGHTS=[],SPOTS={},TRACK_NAME='Grand Prix circuit';
/*HUD>*/
const wrapS=s=>((s%L)+L)%L;
const dSigned=(a,b)=>{let d=wrapS(b-a); if(d>L/2) d-=L; return d;};
function sampleArr(A,s){const x=wrapS(s)/DS, i=Math.floor(x)%N, j=(i+1)%N, f=x-Math.floor(x); return A[i]+(A[j]-A[i])*f;}
function trackFrame(s){
  const x=wrapS(s)/DS, i=Math.floor(x)%N, j=(i+1)%N, f=x-Math.floor(x);
  let tx=lerp(TX[i],TX[j],f), tz=lerp(TZ[i],TZ[j],f); const tl=Math.hypot(tx,tz)||1;
  return {px:lerp(PX[i],PX[j],f), pz:lerp(PZ[i],PZ[j],f), h:lerp(H[i],H[j],f), tx:tx/tl, tz:tz/tl, sl:lerp(SL[i],SL[j],f)};
}
function worldPos(s,lat){const F=trackFrame(s); return {x:F.px-F.tz*lat, z:F.pz+F.tx*lat, y:F.h, F};}
/*<HUD*/

function polyLen(p){let l=0;for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length];l+=Math.hypot(b[0]-a[0],b[1]-a[1]);}return l;}
/* The track itself is built in C++ (physics/track.cpp): smoothing, curvature, corners, elevation, barriers with
   gaps, racing line and speed profile. Here the arrays are typed-array views on wasm memory, and the corners
   become objects for the HUD and the scenario spots. */
function defaultLoop(){return 'default';}
function trackViews(){const X=PHYS.x,b=X.memory.buffer,F=p=>new Float64Array(b,p,N),U=p=>new Uint8Array(b,p,N);
  PX=F(X.track_px());PZ=F(X.track_pz());TX=F(X.track_tx());TZ=F(X.track_tz());H=F(X.track_h());SL=F(X.track_sl());KC=F(X.track_kc());
  LATRL=F(X.track_lat());VPROF=F(X.track_vprof());WLX=F(X.track_wlx());WLZ=F(X.track_wlz());WRX=F(X.track_wrx());WRZ=F(X.track_wrz());
  WGL=U(X.track_wgl());WGR=U(X.track_wgr());}
function buildTrack(raw,name){
  TRACK_NAME=name||'Circuit';const X=PHYS.x;let n;
  if(raw==='default')n=X.track_default();
  else{n=Math.min(raw.length,65536);const R=new Float64Array(X.memory.buffer,X.track_raw(),n*2);for(let i=0;i<n;i++){R[2*i]=raw[i][0];R[2*i+1]=raw[i][1];}}
  N=X.track_build(n);L=X.track_len();DS=X.track_ds();trackViews();
  const CB=new Float64Array(X.memory.buffer,X.track_corners(),X.track_ncorners()*4);CORNERS=[];
  for(let i=0;i<CB.length;i+=4)CORNERS.push({s0:CB[i],s1:CB[i+1],sg:CB[i+2],angle:CB[i+3]});
  CORNERS.forEach((c,i)=>{c.n=i+1;c.apex=wrapS(c.s0+wrapS(c.s1-c.s0)/2);});
  STRAIGHTS=CORNERS.map((c,i)=>{const nx=CORNERS[(i+1)%CORNERS.length];return {s0:c.s1,s1:nx.s0,len:wrapS(nx.s0-c.s1)||L,after:c};});
  if(!CORNERS.length) STRAIGHTS=[{s0:0,s1:0,len:L,after:null}];
  const longest=STRAIGHTS.reduce((a,b)=>b.len>a.len?b:a,STRAIGHTS[0]);
  SPOTS.crestStraight=longest;SPOTS.crest=X.track_crest();
  // scenario spots: the fastest corner with room after it hides the stopped car, another fast one gets the tractor
  const minV=c=>{let m=99;for(let s=c.s0;dSigned(s,c.s1)>0;s+=4)m=Math.min(m,sampleArr(VPROF,s));return m;};
  CORNERS.forEach((c,i)=>{c.minV=minV(c);c.exitLen=STRAIGHTS[i].len;});
  const cand=CORNERS.filter(c=>Math.abs(c.angle)>0.55&&c.exitLen>70).sort((a,b)=>b.minV-a.minV);
  const pool=cand.length?cand:CORNERS.slice().sort((a,b)=>b.exitLen-a.exitLen);
  const blindC=pool[0]||null;
  let recC=pool.find(c=>c!==blindC&&Math.abs(dSigned(c.s1,blindC?blindC.s1:0))>400)||pool.find(c=>c!==blindC)||null;
  SPOTS.blind=blindC?wrapS(blindC.s1+Math.min(40,blindC.exitLen*0.45)):wrapS(L*0.3);
  SPOTS.blindC=blindC;
  SPOTS.rec=recC?wrapS(recC.s1+Math.min(35,recC.exitLen*0.45)):wrapS(L*0.7);
  SPOTS.recC=recC;
  SPOTS.marsh=wrapS(SPOTS.crest+45);
  SPOTS.freeStart=wrapS(longest.s0+20);
}
const nearTrack=(x,z,r,self,far)=>PHYS.x.track_near(x,z,r,self,far)!==0;
const lineOfSight=(sA,latA,hA,sB,latB,hB)=>PHYS.x.track_los(sA,latA,hA,sB,latB,hB)!==0;
const waterDepth=(s,lat,rain)=>PHYS.x.track_water(s,lat,rain);


/* ================= ON-BOARD RADAR: scene side =================
   The sensor physics and the tracker are in physics/radar.c (77 GHz link budget, rain, multipath, Swerling-1
   detection, measurement noise, resolution, Kalman tracking). This part decides what the beam can reach:
   line of sight past barriers and crests, cars in the way, spray plumes between the radar and a target,
   barrier patches at grazing incidence. Then it matches confirmed tracks to the position feed. */
const RADAR={h:0.35,nose:2.9,scan:1/15,rmax:250,half:9*Math.PI/180};
const RCS={car:10,tractor:40,marshal:0.7,traffic:7}, SCAT_H={car:[0.25,0.5,0.8],tractor:[0.5,1.3,2.2],marshal:[0.5,1.0,1.5],traffic:[0.2,0.45,0.75]};
// track coordinates (s, lat) of a world point, searching near a guess of s
function toTrack(x,z,sHint){let best=1e18,bi=0;const i0=Math.floor(wrapS(sHint)/DS),span=Math.ceil(60/DS);
  for(let k=-span;k<=span;k++){const i=((i0+k)%N+N)%N,d=(PX[i]-x)**2+(PZ[i]-z)**2;if(d<best){best=d;bi=i;}}
  return {s:bi*DS,lat:(x-PX[bi])*-TZ[bi]+(z-PZ[bi])*TX[bi]};}
function radarScan(w){
  const X=PHYS.x;if(!X)return;
  if(!w.radar){w.radar={dets:[],tracks:[],t:w.t,rng:0,att:0};X.radar_seed(w.t+1+Math.random());}
  const R=w.radar,P=w.player,dtS=Math.max(0.02,w.t-R.t);R.t=w.t;
  const hd=headingAt(P.s,carYaw(P,true)),pc=worldPos(P.s,P.lat),ox=pc.x+hd[0]*RADAR.nose,oz=pc.z+hd[1]*RADAR.nose,vex=hd[0]*fwdSpeed(w),vez=hd[1]*fwdSpeed(w),sR=P.s+RADAR.nose;
  R.ox=ox;R.oz=oz;
  const polar=(x,z)=>{const dx=x-ox,dz=z-oz;return [Math.hypot(dx,dz),Math.atan2(dx*-hd[1]+dz*hd[0],dx*hd[0]+dz*hd[1]),dx,dz];};
  const cars=w.traffic.map((c,i)=>{const p=worldPos(c.s,c.lat),q=polar(p.x,p.z);return {c,i,p,r:q[0],az:q[1],d:dSigned(sR,c.s)};});
  // extra two-way loss on the way to (r, az): a car in the beam (F1 floors leave no gap under) or its spray
  const pathLoss=(r,az,self)=>{let L=0;for(const q of cars){if(q.c===self||q.r>=r-2||q.r<3)continue;const da=Math.abs(q.az-az);
    if(da<Math.atan2(1.0,q.r))L+=25;else if(da<Math.atan2(1.4+0.05*Math.min(40,r-q.r),q.r))L+=4*w.rain*w.rain*clamp(q.c.v/45,0,1.3);}return L;};
  const ret=(x,z,vx,vz,sigma,hts,ref,st,self)=>{const [r,az,dx,dz]=polar(x,z);if(r<1.5||r>RADAR.rmax*1.15)return;
    const vr=((vx-vex)*dx+(vz-vez)*dz)/r;X.radar_return(r,az,vr,sigma,hts[0],hts[1],hts[2],pathLoss(r,az,self),w.rain,ref,st?1:0);};
  X.radar_begin();
  for(const q of cars){if(q.d<=0||q.r>RADAR.rmax*1.1||!lineOfSight(sR,P.lat,RADAR.h,q.c.s,q.c.lat,0.5))continue;
    const h2=headingAt(q.c.s,carYaw(q.c));ret(q.p.x,q.p.z,h2[0]*q.c.v,h2[1]*q.c.v,RCS.traffic,SCAT_H.traffic,q.i,false,q.c);}
  w.hazards.forEach((h,i)=>{if(h.gone)return;const d=dSigned(sR,h.s);if(d<=0||d>RADAR.rmax*1.1||!lineOfSight(sR,P.lat,RADAR.h,h.s,h.lat,Math.min(0.6,h.height*0.5)))return;
    const p=worldPos(h.s,h.lat),vl=h.moving?h.dir*h.speed:0,F=trackFrame(h.s);ret(p.x,p.z,-F.tz*vl,F.tx*vl,RCS[h.type]||5,SCAT_H[h.type]||[0.5,0.5,0.5],1000+i,true,null);});
  // barrier returns: 4 m × 1.2 m patches, σ0 = γc·sinψ with γc ≈ -10 dB for rough concrete
  for(let d=6;d<170;d+=4)for(const sg of [-1,1]){const i=Math.floor(wrapS(sR+d)/DS)%N;if(sg<0?WGL[i]:WGR[i])continue;
    const p=worldPos(sR+d,sg*(WALL-0.05)),[r,az,dx,dz]=polar(p.x,p.z);if(Math.abs(az)>RADAR.half*6)continue;
    if(!lineOfSight(sR,P.lat,RADAR.h,sR+d,sg*(WALL-0.4),0.5))continue;const sinpsi=Math.abs(dx/r*p.F.tz-dz/r*p.F.tx);
    ret(p.x,p.z,0,0,0.1*Math.max(0.02,sinpsi)*4.8,[0.3,0.7,1.0],-1,true,null);}
  X.radar_false_alarms();
  const nd=X.radar_resolve(ox,oz,hd[0],hd[1],vex,vez),D=PHYS.det;R.dets=[];
  for(let j=0;j<nd;j++){const o=j*12;R.dets.push({x:D[o+10],z:D[o+11],st:D[o+9]>0.5,snr:D[o+3],ref:D[o+8]});}
  const nt=X.radar_track(dtS,vex,vez,ox,oz),T0=PHYS.trk,old=new Map(R.tracks.map(T=>[T.id,T]));R.tracks=[];
  for(let k=0;k<nt;k++){const o=k*12,id=T0[o];R.tracks.push({id,x:T0[o+1],z:T0[o+2],vx:T0[o+3],vz:T0[o+4],conf:T0[o+5]>0.5,snr:T0[o+9]});}
  // classify (barrier or on the road) and fuse with the position feed
  for(const T of R.tracks){const tt=toTrack(T.x,T.z,sR+Math.hypot(T.x-ox,T.z-oz));T.s=tt.s;T.lat=tt.lat;T.spd=Math.hypot(T.vx,T.vz);T.barrier=Math.abs(tt.lat)>HW+0.3&&T.spd<3;T.obj=null;}
  for(const T of R.tracks){if(!T.conf||T.barrier)continue;let bo=null,bd=16;
    for(const o of w.traffic.concat(w.hazards.filter(h=>!h.gone))){const p=worldPos(o.s,o.lat),e=(p.x-T.x)**2+(p.z-T.z)**2;if(e<bd){bd=e;bo=o;}}
    if(bo){T.obj=bo;bo.rdrT=w.t;if(bo.rdrD==null)bo.rdrD=dSigned(P.s,bo.s);}}
  R.rng=X.radar_range90(w.rain);R.att=2*X.radar_rain_db(w.rain)*R.rng/1000+4*w.rain;}

/* ================= SCENARIOS & SIM ================= */
const RANGE=700, A_MAX=24, A_PLAN=11, EYE=0.95, REACT_EYES=0.7, REACT_VISOR=0.9, REACT_HUD=1.6, TRAFFIC_SEE=125;
const accel=v=>Math.max(1.2, 9.5*(1-v/95));
const LABEL={car:'Stopped car', tractor:'Recovery vehicle', marshal:'Marshal on track'};
function onLine(s){return clamp(sampleArr(LATRL,s),-(HW-1.8),HW-1.8);}
function avoidOf(l){return l>0?Math.max(-(HW-1.3),l-4.4):Math.min(HW-1.3,l+4.4);}
function mkHaz(type,s,o){
  const lat=o&&o.lat!=null?o.lat:onLine(s);
  const base={car:{halfLen:2.8,halfW:1.0,height:0.9,vpass:16.7}, tractor:{halfLen:3.2,halfW:1.5,height:2.6,vpass:13.9}, marshal:{halfLen:0.4,halfW:0.35,height:1.7,vpass:12.5}}[type];
  const h=Object.assign({type,s,lat,avoid:avoidOf(lat),avoidT:avoidOf(lat),yaw:0,label:LABEL[type]},base,o||{});
  return Object.assign(h,{seenAcc:0,firstSeenD:null,vis:false,aware:false,knows:false,src:null,reactD:null,warnT:null,warnD:null,passed:false,passV:null,clear:null,tArrive:null,gone:false});
}
const cname=c=>c?'T'+c.n:'the corner';
const SCN={
  blind:{key:'blind', title:'Blind corner, spray', ref:'Paletti · Montréal 1982', short:'Paletti · 1982',
    blurb:()=>`A car has stopped just past ${cname(SPOTS.blindC)}, a fast corner. Two cars ahead throw spray and swerve round it at the last moment.`,
    rain:0.6, flag:null, startBack:900, traffic:[42,96],
    hazards:()=>[mkHaz('car',SPOTS.blind,{yaw:0.45})]},
  crest:{key:'crest', title:'Marshal over a crest', ref:'Pryce · Kyalami 1977', short:'Pryce · 1977',
    blurb:()=>'A marshal runs across the longest straight just past a rise, toward a stopped car. The car ahead dodges him. From behind the crest you see neither.',
    rain:0.12, flag:'yellow', startBack:1000, traffic:[38],
    hazards:()=>{
      const S=SPOTS.marsh, rl=sampleArr(LATRL,S), rs=rl>=0?1:-1;
      const start=rs*(HW+0.8), spd=3.4, trig=Math.max(45,sampleArr(VPROF,S)*Math.abs(rl-start)/spd);
      const m=mkHaz('marshal',S,{lat:start,dir:-rs,speed:spd,latEnd:-rs*(HW-3.2),trigger:trig,go:false,avoid:rs*3.3,avoidT:rs*3.9,tvpass:70});
      const c=mkHaz('car',wrapS(S+16),{lat:-rs*(HW-1.4),yaw:rs*0.3,avoid:rs*3.3,avoidT:rs*3.9,tvpass:70});
      return [m,c];}},
  rec:{key:'rec', title:'Recovery vehicle in rain', ref:'Bianchi · Suzuka 2014 · Gasly · 2022', short:'Bianchi · Gasly',
    blurb:()=>`A tractor is lifting a crashed car at the exit of ${cname(SPOTS.recC)}. Heavy rain, double yellow, and the tractor sits right on the line out of the corner.`,
    rain:0.88, flag:'double', startBack:950, traffic:[],
    hazards:()=>{const t=mkHaz('tractor',SPOTS.rec,{yaw:0.5}); const side=Math.sign(t.lat)||1;
      return [t, mkHaz('car',wrapS(SPOTS.rec+9),{lat:side*(HW-1.2),yaw:-0.8,avoid:t.avoid,avoidT:t.avoid})];}},
  free:{key:'free', free:true, title:'Free drive', ref:'Any circuit · traffic', short:'Free drive',
    blurb:()=>'No script. Race a pack of cars wheel to wheel and watch them on the radar. Press X to hide a stopped car or tractor past the next blind corner and see if you catch it in time.',
    rain:0.45, flag:null, startBack:0,
    traffic:[{gap:-60,lane:1.8,fac:0.97},{gap:30,lane:-1.9,fac:0.93},{gap:75,lane:1.6,fac:0.95},{gap:140,lane:0,fac:0.9},{gap:230,lane:-2,fac:0.94},{gap:330,lane:1.2,fac:0.92}],
    hazards:()=>[]}
};
const SCN_ORDER=['free','blind','crest','rec'];
const TCOL=[0xd6dce2,0xff7a2a,0x18c08f,0xa970ff,0xffd02a,0x4a9cff,0xff4f8e,0x5fd068,0xff9a3a,0x9fb4c0,0xc46cff,0x22d0e0];
function genTraffic(n){const r=mulberry(n*7+1),out=[];
  for(let i=0;i<n;i++){const gap=-150+i*(820/n)+r()*18;if(Math.abs(gap)<14)continue;
    out.push({gap,lane:[-2.3,1.9,-0.8,2.4,0.6,-1.8][i%6]+(r()-0.5)*0.6,fac:0.86+r()*0.13});}
  return out;}

function carFrom(g,s0,lap0,i){const T=typeof g==='number'?{gap:g,lane:0,fac:1}:g, s=wrapS(s0+T.gap);
  return {lapc:lap0+Math.floor((s0+T.gap)/L),s,lat:clamp(sampleArr(LATRL,s)+T.lane,-(HW-1.2),HW-1.2),latV:0,v:sampleArr(VPROF,s)*T.fac,lane:T.lane,fac:T.fac,vis:true,closing:false,col:TCOL[i%TCOL.length],braking:0,followT:0,touch:false};}
function makeWorld(key,opts){
  const sc=SCN[key], hz=sc.hazards();
  const s0=sc.free?SPOTS.freeStart:wrapS(hz[0].s-sc.startBack), tlist=sc.free?genTraffic(opts.traffic||12):sc.traffic;
  return {sc,opts:Object.assign({},opts),rain:opts.rain,t:0,done:false,losT:0,vis:400,alert:0,near:null,dNear:1e9,flagOn:false,
    stopT:0,impact:null,crash:null,result:null,touches:0,scrapes:0,events:[],
    player:(()=>{const v0=sampleArr(VPROF,s0)*(sc.free?0.8:1);return {lapc:0,s:s0,lat:sampleArr(LATRL,s0),latV:0,slideV:0,psi:0,steer:0,v:v0,vx:v0,vy:0,r:0,ax:0,ay:0,delta:0,braking:0,thr:0,brk:0,onWall:false};})(),
    traffic:tlist.map((g,i)=>carFrom(g,s0,0,i)),
    hazards:hz};
}
// forward speed with its sign (negative while reversing); in autopilot the car only goes forward
const fwdSpeed=w=>{const P=w.player;return w.opts.driver==='drive'&&P.vx!=null?P.vx:P.v;};
function vSafe(h,d){return Math.sqrt(h.vpass*h.vpass+2*A_PLAN*Math.max(0,d-h.halfLen-8));}
function steerTo(c,target,dt){
  const maxLat=Math.min(6.5,0.6+c.v*0.12), want=clamp((target-c.lat)*2.0,-maxLat,maxLat);
  c.latV+=clamp(want-c.latV,-16*dt,16*dt);
  c.lat=clamp(c.lat+c.latV*dt,-HW+0.9,HW-0.9);
}
/* Player car in "You drive": the physics is physics/vehicle.c (dynamic bicycle model in track coordinates,
   combined-slip Magic Formula tyres, drivetrain, aero, barrier impulses). Here: car constants the driver model
   needs, and the lane assist, a pure-pursuit steering controller (Coulter 1992). Signs: +y, +r, +delta = right. */
const CAR={m:798,Iz:1150,lf:1.95,lr:1.65,h:0.3,ClA:4.4,CdA:1.35,aeroF:0.42,P:760e3,Fmax:13000,Fbrake:5.5*798*9.81,bb:0.57,B:10,Bf:9,Br:11,C:1.9,E:0.97,rearMu:1.08,dmax:0.34,rho:1.2};
function tyreMu(w){return 1.5-0.5*w.rain;}
// gearbox ratios (kept here for the HUD; the drivetrain itself is in physics/vehicle.c)
const GEARS=[18.1,14.98,12.4,10.27,8.5,7.04,5.83,4.81], RW=0.36;
/* ================= PHYSICS CORE: C compiled to WebAssembly (physics/*.c, build with tools/build.py) =================
   vehicle.c  — tyres, drivetrain, aero, barrier impulses (integrated between frames)
   radar.c    — 77 GHz link budget, detection, measurement noise, resolution, Kalman tracker
   spray.c    — tyre spray droplets in the car's wake (render buffers live in wasm memory)
   JavaScript keeps the driver model, the scene geometry and the drawing. */
const VEH_FIELDS=['s','lat','psi','vx','vy','r','wf','wr','kf','kr','af','ar','FyfS','FyrS','ax','ay','thr','brk','delta','gear','cut','rpm','hitV','latV','v','sliding','beta','satF','satR','mz','gripF','gripR','aqua','rev'];
const PHYS={ok:false,x:null};
PHYS.ready=fetch('/physics.wasm').then(r=>{if(!r.ok)throw new Error('physics.wasm '+r.status);return r.arrayBuffer();}).then(b=>WebAssembly.instantiate(b,{})).then(({instance})=>{
  const x=instance.exports,buf=x.memory.buffer;if(x._initialize)x._initialize();PHYS.x=x;
  PHYS.veh=new Float64Array(buf,x.veh_state(),VEH_FIELDS.length);PHYS.curv=new Float64Array(buf,x.veh_curv(),16384);
  PHYS.det=new Float64Array(buf,x.radar_det(),160*12);PHYS.trk=new Float64Array(buf,x.radar_tracks(),96*12);
  const n=x.spray_count();x.spray_clear();
  spG.setAttribute('position',new THREE.BufferAttribute(new Float32Array(buf,x.spray_pos(),n*3),3));
  spG.setAttribute('aSize',new THREE.BufferAttribute(new Float32Array(buf,x.spray_size(),n),1));
  spG.setAttribute('aAlpha',new THREE.BufferAttribute(new Float32Array(buf,x.spray_alpha(),n),1));
  PHYS.ok=true;physTrack();}).catch(e=>{PHYS.err=e;console.error(e);});
// hand the track curvature to the C integrator (called after every track build)
function physTrack(){if(!PHYS.ok||!KC)return;PHYS.curv.set(KC.length>16384?KC.subarray(0,16384):KC);PHYS.x.veh_set_track(Math.min(N,16384),DS);}
function driveDynamics(P,w,inp,dt,assist){
  const L=CAR.lf+CAR.lr, g=9.81, aids=w.opts.aids!==false, x=PHYS.x, V=PHYS.veh;
  // wet painted kerbs; aquaplaning comes from the water depth, in physics/vehicle.c
  let mu=tyreMu(w);x.veh_set_water(waterDepth(P.s,P.lat,w.rain));
  if(Math.abs(P.lat)>HW-1.1&&w.rain>0.3)mu*=0.8;
  if(P.wf==null){VEH_FIELDS.forEach((f,i)=>V[i]=P[f]||0);x.veh_reset();VEH_FIELDS.forEach((f,i)=>P[f]=V[i]);}
  // reverse: hold brake at a standstill to select it; then the brake pedal drives backwards and gas brakes.
  // Gas at a standstill selects first gear again.
  const stopped=Math.abs(P.vx)<0.6&&Math.abs(P.vy)<0.6;
  if(!P.rev){if(stopped&&inp.brake>0.5&&inp.throttle<0.1){P.revT=(P.revT||0)+dt;if(P.revT>0.35){P.rev=1;P.revT=0;}}else P.revT=0;}
  else if(stopped&&inp.throttle>0.3&&inp.brake<0.1)P.rev=0;
  const thrIn=P.rev?inp.brake:inp.throttle,brkIn=P.rev?inp.throttle:inp.brake;
  // driver inputs through actuator rates
  P.thr+=clamp(thrIn-P.thr,-5*dt,3.2*dt); P.brk+=clamp(brkIn-P.brk,-8*dt,7*dt); P.braking=P.brk>0.1?1:0;
  P.steer+=clamp(inp.steer-P.steer,-5*dt,5*dt);
  // steering angle target at the wheels
  let dTarget;
  if(P.rev) dTarget=P.steer*CAR.dmax*0.8;                        // reversing: plain steering, no lane assist
  else if(assist){
    const edge=HW-1.15, Ld=clamp(7+0.42*P.vx,8,42);
    const tl=P.steer<0?lerp(sampleArr(LATRL,P.s+Ld),-edge,-P.steer):lerp(sampleArr(LATRL,P.s+Ld),edge,P.steer);
    const me=worldPos(P.s,P.lat), tg=worldPos(P.s+Ld,tl), hd=headingAt(P.s,P.psi);
    const dx=tg.x-me.x, dz=tg.z-me.z, fw=dx*hd[0]+dz*hd[1], rt=dx*(-hd[1])+dz*hd[0];
    const kpp=2*Math.sin(Math.atan2(rt,fw))/Math.hypot(dx,dz);
    dTarget=Math.atan(L*kpp)+0.06*(kpp*P.vx-P.r);                 // pure pursuit + yaw-rate tracking
  } else if(aids){
    const vv=Math.max(P.vx,6), ayMax=mu*(g+0.5*CAR.rho*CAR.ClA*(P.aeroK||1)*vv*vv/CAR.m);
    dTarget=P.steer*clamp(L*ayMax/(vv*vv)+0.1,0.05,CAR.dmax);   // lock limited to what the front tyres can use
  } else dTarget=P.steer*CAR.dmax/(1+P.vx*P.vx/2500);             // raw lock for countersteering a drift
  const beta=Math.atan2(P.vy,Math.max(Math.abs(P.vx),3));
  if(aids&&!P.rev&&P.vx>5&&Math.abs(beta)>0.035) dTarget+=0.7*(beta-Math.sign(beta)*0.035);   // stability control
  dTarget=clamp(dTarget,-CAR.dmax,CAR.dmax);
  // physics: physics/vehicle.c
  VEH_FIELDS.forEach((f,i)=>V[i]=P[f]||0);
  x.veh_step(dt,mu,dTarget,aids?1:0,P.aeroK||1,WALL);
  VEH_FIELDS.forEach((f,i)=>P[f]=V[i]);
  P.sliding=P.sliding>0.5; P.slideV=0;
}
function planLat(w,s){
  let l=sampleArr(LATRL,s);
  for(const h of w.hazards){if(h.gone)continue;const d=dSigned(s,h.s);if(d>-h.halfLen-10&&d<150){const k=d<30?1:1-(d-30)/120;l=lerp(l,h.avoid,clamp(k,0,1));}}
  return l;
}
function step(w,dt,inp){
  if(w.done) return;
  w.t+=dt;
  const P=w.player, o=w.opts, drive=o.driver==='drive', live=w.hazards.filter(h=>!h.gone), h0=w.hazards[0];
  let vis=420-330*w.rain;
  for(const c of w.traffic){const d=dSigned(P.s,c.s); if(d>0&&d<170) vis=Math.min(vis,d+14+36*(1-w.rain));}
  w.vis=vis;
  // spray and dirty air from the cars ahead: each car leaves a plume that widens behind it and is densest close up
  // and at speed; its water volume scales with the water on the track (~rain squared). Following closely also costs
  // downforce (2022-rules cars lose roughly a fifth at one to two car lengths).
  let spray=0,wake=0;
  for(const c of w.traffic){const d=dSigned(P.s,c.s);if(d<=1||d>70)continue;const half=1.1+d*0.05,ov=clamp(1-(Math.abs(c.lat-P.lat)-half*0.5)/half,0,1);if(!ov)continue;
    spray+=ov*clamp(c.v/45,0,1.3)*Math.exp(-d/22);wake+=ov*clamp(c.v/50,0,1.2)*Math.exp(-d/25);}
  spray=clamp(spray*w.rain*w.rain*1.7+0.08*clamp(P.v/70,0,1.2)*waterDepth(P.s,P.lat,w.rain)/2,0,1);   // + your own front wheels
  w.spray=w.spray==null?spray:w.spray+(spray-w.spray)*Math.min(1,dt*6);
  P.aeroK=1-clamp(wake,0,1)*0.22;
  // the nearest car behind you inside 50 m: distance, which side it is coming, how fast it is closing
  {let b=null;for(const c of w.traffic){const d=-dSigned(P.s,c.s);if(d>2&&d<=50&&(!b||d<b.d))b={c,d};}
    if(b){const dl=b.c.lat-P.lat;b.side=Math.abs(dl)<1.6?0:Math.sign(dl);b.cl=b.c.v-P.v;b.fresh=!w.behind;}
    w.behind=b;}
  w.radT=(w.radT||0)-dt;if(w.radT<=0){w.radT+=RADAR.scan;radarScan(w);}
  for(const h of live) if(h.type==='marshal'){
    const d=dSigned(P.s,h.s); if(!h.go&&d>0&&d<h.trigger) h.go=true;
    if(h.go){const nl=h.lat+h.dir*h.speed*dt; h.moving=h.dir>0?nl<h.latEnd:nl>h.latEnd; if(h.moving) h.lat=nl;}
  }
  w.losT-=dt;
  if(w.losT<=0){w.losT=1/30;
    for(const h of live){const d=dSigned(P.s,h.s); h.vis=d>0&&d<vis&&lineOfSight(P.s,P.lat,EYE,h.s,h.lat,h.height);}
    for(const c of w.traffic){const d=dSigned(P.s,c.s); c.vis=d<=0?true:(d<vis+4&&lineOfSight(P.s,P.lat,EYE,c.s,c.lat,0.8));}
  }
  for(const h of live) if(h.vis){h.seenAcc+=dt; if(h.firstSeenD==null) h.firstSeenD=dSigned(P.s,h.s);}
  let near=null, dn=1e9;
  for(const h of live){const d=dSigned(P.s,h.s); if(d>-h.halfLen&&d<dn){dn=d;near=h;}}
  w.near=near; w.dNear=dn;
  w.flagOn=!!(w.sc.flag&&near&&dn<360);
  // marshal sectors (~200 m): yellow where a hazard sits and on the approach to it; red where it blocks the track
  // (less than ~3.2 m left to get by) or a person is running across it
  {const n=Math.max(8,Math.round(L/200)),sl=L/n;if(!w.flags||w.flags.length!==n)w.flags=new Uint8Array(n);else w.flags.fill(0);w.secLen=sl;
    for(const h of live){const k=Math.floor(wrapS(h.s)/sl)%n,free=Math.max(h.lat-h.halfW+HW,HW-(h.lat+h.halfW)),red=free<3.2||(h.type==='marshal'&&h.moving);
      w.flags[k]=Math.max(w.flags[k],red?2:1);const kp=(k-1+n)%n;w.flags[kp]=Math.max(w.flags[kp],1);}}
  const assist=o.hud||o.visor;
  for(const h of live){const d=dSigned(P.s,h.s); if(assist&&d>0&&d<RANGE&&h.warnT==null){h.warnT=w.t;h.warnD=d;}}
  let alert=0;
  if(assist&&near&&dn<RANGE){alert=1; if(P.v>vSafe(near,dn)+1.5&&dn/Math.max(P.v,1)<5) alert=2;}
  for(const c of w.traffic){const d=dSigned(P.s,c.s), cl=P.v-c.v; c.closing=d>0&&d<140&&cl>5&&d/cl<3.2; if(assist&&c.closing&&d/cl<1.6) alert=Math.max(alert,2);}
  w.alert=alert;
  // awareness, per hazard
  for(const h of live){ if(h.aware) continue; const d=dSigned(P.s,h.s); if(d<=0) continue; let src=null;
    if(!drive){ if(h.seenAcc>=REACT_EYES) src='eyes'; else if(h.warnT!=null&&w.t-h.warnT>=(o.visor?REACT_VISOR:REACT_HUD)) src=o.hud?'hud':'visor'; }
    else if(inp.brake>0.3&&d<560&&(h.warnT!=null||h.seenAcc>0)) src='you';
    if(src){h.aware=true;h.src=src;h.reactD=d;} }
  for(const h of live) h.knows=h.aware&&(o.hud||h.src==='eyes'||h.src==='you'||h.seenAcc>0.3);
  const prof=sampleArr(VPROF,P.s), kap=sampleArr(KC,P.s);
  const prevD=live.map(h=>dSigned(P.s,h.s)), sBefore=P.s;
  if(!drive){
    let vt=prof;
    if(w.flagOn) vt*=0.93;
    {const nf=nextFlag(w,P.s,300);if(nf&&nf.f===2)vt=Math.min(vt,Math.sqrt(23.5*23.5+2*9*Math.max(0,nf.d-10)));}
    for(const c of w.traffic){const d=dSigned(P.s,c.s); if(d>0&&d<70&&Math.abs(c.lat-P.lat)<2.6) vt=Math.min(vt,Math.max(0,c.v+(d-22)*0.8));}
    for(const h of live){ if(!h.aware) continue; const d=dSigned(P.s,h.s); if(d>-h.halfLen&&d<600) vt=Math.min(vt,h.knows?vSafe(h,d):0.62*prof); }
    if(P.v>vt){P.braking=(P.v-vt)>0.3?1:0;P.brk=P.braking;P.thr=0;P.v=Math.max(vt,P.v-A_MAX*dt);}
    else {P.braking=0;P.brk=0;P.thr=P.v<vt-0.5?1:0.3;P.v=Math.min(vt,P.v+accel(P.v)*dt);}
    let lt=sampleArr(LATRL,P.s);
    if(near&&near.knows&&dn<260) lt=near.avoid;
    steerTo(P,lt,dt); P.psi=0;
  } else {
    driveDynamics(P,w,inp,dt,o.steer==='assist');
  }
  // walls. You drive: rigid-body impulses at the car's corners (bounce, scrape, yaw) are applied inside
  // driveDynamics; here we only count hits and end the run on a heavy impact. Autopilot: simple clamp.
  if(drive){
    if(P.hitV>0){if(!P.onWall&&w.t-(P.lastHitT||-9)>0.4){w.scrapes++;}P.onWall=true;P.lastHitT=w.t;
      if(P.hitV>24){w.crash={what:'the wall',v:P.v};w.tArrive=w.t;finish(w,'crash');return;}}
    else if(w.t-(P.lastHitT||-9)>0.25)P.onWall=false;
    P.hitV=0;
  }
  const lim=WALL-1.05;
  if(!drive&&Math.abs(P.lat)>lim){
    const sg=Math.sign(P.lat), vl=Math.abs(P.latV); P.lat=sg*lim;
    if(!P.onWall){P.onWall=true;w.scrapes++;
      if(vl>9&&P.v>20){w.crash={what:'the wall',v:P.v};w.tArrive=w.t;finish(w,'crash');return;}
      if(drive)P.vx*=1-Math.min(0.45,vl*0.04); else P.v*=1-Math.min(0.45,vl*0.04);}
    if(drive){P.vx=Math.max(0,P.vx-9*dt);if(Math.sign(P.psi)===sg)P.psi*=-0.2;P.vy*=0.3;P.r*=0.3;P.v=Math.hypot(P.vx,P.vy);P.latV=-sg*0.5;}
    else {P.v=Math.max(0,P.v-9*dt);P.latV=-sg*0.6;P.slideV=0;P.psi*=-0.3;}
  } else P.onWall=false;
  if(!drive) P.s=wrapS(P.s+P.v*dt);
  if(P.s<sBefore-L/2)P.lapc++; else if(P.s>sBefore+L/2)P.lapc--;
  // traffic
  const all=[P].concat(w.traffic);
  for(const c of w.traffic){
    let vtc=sampleArr(VPROF,c.s)*c.fac, ltc=clamp(sampleArr(LATRL,c.s)+c.lane,-(HW-1.2),HW-1.2), hn=null, dh=1e9;
    for(const h of live){const d=dSigned(c.s,h.s); if(d>-h.halfLen-3&&d<dh){dh=d;hn=h;}}
    if(hn&&dh<TRAFFIC_SEE){ltc=hn.avoidT; const tv=hn.tvpass||26; vtc=Math.min(vtc,Math.sqrt(tv*tv+2*18*Math.max(0,dh-6)));}
    let blocked=false;
    for(const o2 of all){if(o2===c)continue;const d=dSigned(c.s,o2.s);if(d>0&&d<55&&Math.abs(o2.lat-c.lat)<2.3){vtc=Math.min(vtc,Math.max(0,o2.v+(d-14)*0.7));blocked=true;}}
    c.followT=blocked?c.followT+dt:0;
    if(c.followT>2.5&&w.sc.free){c.lane=c.lane>=0?-2.4:2.4;c.followT=0;}
    const dp=dSigned(c.s,P.s); if(Math.abs(dp)<8&&Math.abs(P.lat-c.lat)<3) ltc=clamp(c.lat+(c.lat>=P.lat?1.4:-1.4),-(HW-1.2),HW-1.2);
    if(c.v>vtc){c.braking=1;c.v=Math.max(vtc,c.v-A_MAX*dt);} else {c.braking=0;c.v=Math.min(vtc,c.v+accel(c.v)*dt);}
    steerTo(c,ltc,dt);
    {const sb=c.s;c.s=wrapS(c.s+c.v*dt);if(c.s<sb-L/2)c.lapc++;}
  }
  // car-to-car contact
  for(const c of w.traffic){
    const d=dSigned(P.s,c.s), dl=c.lat-P.lat;
    if(Math.abs(d)<5&&Math.abs(dl)<1.95){
      const pv=fwdSpeed(w),rel=d>0?pv-c.v:c.v-pv;   // closing speed; reversing into a car behind adds up
      if(rel>16){w.crash={what:'a car',v:P.v};w.tArrive=w.t;finish(w,'crash');return;}
      const ov=(1.95-Math.abs(dl))/2, sg=dl>=0?1:-1; P.lat-=sg*ov; c.lat+=sg*ov; P.latV*=0.3;
      if(d>0&&P.v>c.v){P.v=Math.max(0,c.v-0.5);P.vx=P.v;P.vy*=0.5;} else if(d<0&&c.v>P.v)c.v=Math.max(0,P.v-0.5);
      if(!c.touch){c.touch=true;w.touches++;}
    } else c.touch=false;
  }
  // hazard contact
  for(const h of live){
    const d=dSigned(P.s,h.s);
    if(Math.abs(d)<h.halfLen+2.7&&Math.abs(P.lat-h.lat)<h.halfW+0.95&&P.v>0.5){w.impact={v:P.v,label:h.label,h};h.tArrive=w.t;finish(w,'impact');return;}
  }
  live.forEach((h,k)=>{const d=dSigned(P.s,h.s);
    if(!h.passed&&prevD[k]>0&&d<=0){h.passed=true;h.passV=P.v;h.clear=Math.abs(P.lat-h.lat)-h.halfW-0.95;h.tArrive=w.t;if(w.sc.free)w.events.push(h);}
    if(w.sc.free&&h.passed&&d<-60)h.gone=true;});
  if(!w.sc.free){
    if(w.hazards.every(h=>dSigned(P.s,h.s)<-50)){finish(w,'pass');return;}
    const d0=dSigned(P.s,h0.s);
    if(P.v<0.3&&!h0.passed&&d0<260){w.stopT+=dt; if(w.stopT>1.4){finish(w,'stopped');return;}} else w.stopT=0;
    if(w.t>150) finish(w,'pass');
  }
}
function hazVerdict(h){const v=h.passV||0;return (v*3.6<=95&&(h.clear==null||h.clear>0.6))?'safe':'near';}
function finish(w,kind){
  w.done=true;
  const P=w.player, h0=w.impact?w.impact.h:(w.hazards[0]||null);
  let verdict, v=null;
  if(kind==='impact'){verdict='contact'; v=w.impact.v;}
  else if(kind==='crash'){verdict='crash'; v=w.crash.v;}
  else if(kind==='stopped'){verdict='stopped';}
  else {v=h0&&h0.passV!=null?h0.passV:P.v; verdict=h0?hazVerdict(h0):'safe';}
  w.result={verdict,kmh:v!=null?Math.round(v*3.6):null,
    shortM:kind==='stopped'?Math.max(0,Math.round(dSigned(P.s,h0.s)-h0.halfLen)):null,
    warnD:h0?h0.warnD:null, lead:(h0&&h0.warnT!=null&&h0.tArrive!=null)?h0.tArrive-h0.warnT:null,
    seenD:h0?h0.firstSeenD:null, radarD:h0&&h0.rdrD!=null?h0.rdrD:null, reactD:h0?h0.reactD:null, src:h0?h0.src:null,
    what:w.crash?w.crash.what:(h0?h0.label:''), opts:Object.assign({},w.opts), scn:w.sc.key, track:TRACK_NAME};
}
function verdictText(r){
  if(r.verdict==='contact') return 'Contact at '+r.kmh+' km/h';
  if(r.verdict==='crash') return 'Hit '+r.what+' at '+r.kmh+' km/h';
  if(r.verdict==='stopped') return 'Stopped '+r.shortM+' m short';
  if(r.verdict==='near') return 'Near miss at '+r.kmh+' km/h';
  return 'Safe pass at '+r.kmh+' km/h';
}
function chipText(r){
  if(r.verdict==='contact') return 'Contact '+r.kmh+' km/h';
  if(r.verdict==='crash') return 'Hit '+r.what.replace('the ','')+' '+r.kmh;
  if(r.verdict==='stopped') return 'Stopped '+r.shortM+' m short';
  if(r.verdict==='near') return 'Near miss '+r.kmh+' km/h';
  return 'Safe '+r.kmh+' km/h';
}

/* ================= RENDERER & SCENE ================= */
const stage=$('stage'), glc=$('gl');
const renderer=new THREE.WebGLRenderer({canvas:glc,antialias:true,powerPreference:'high-performance'});
renderer.outputEncoding=THREE.sRGBEncoding;
renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=0.95;
renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap;
let curRain=0.6;
const scene=new THREE.Scene();
const FOV=60;
const camera=new THREE.PerspectiveCamera(FOV,16/9,0.04,4000);
scene.fog=new THREE.Fog(0x1e2833,10,400);
scene.background=new THREE.Color(0x070a10);
// twilight sky dome that follows the camera (so it sits at infinity): deep blue overhead, the last of the sunset
// low in one direction, and the fog colour at the horizon so fogged scenery melts into it. Rain turns it overcast.
const FOG_BASE=new THREE.Color(), SPRAY_C=new THREE.Color(0x8d969f), SUN_AZ=-0.6, SKY_R=3500, skyGeo=new THREE.SphereGeometry(SKY_R,48,24);
skyGeo.setAttribute('color',new THREE.BufferAttribute(new Float32Array(skyGeo.attributes.position.count*3),3));
const skyMat=new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.BackSide,fog:false,depthWrite:false});
const sky=new THREE.Mesh(skyGeo,skyMat);sky.renderOrder=-10;sky.frustumCulled=false;scene.add(sky);
// distant hills and a tree line as silhouettes on the horizon (children of the sky, so also at infinity)
const HILLS=[[3200,0x1a2233,55,190,0.62],[2900,0x0c1219,18,46,0.35]].map(([r,col,h0,h1,haze],k)=>{
  const rnd=mulberry(21+k),ph=[0,1,2,3,4].map(()=>rnd()*TAU),M=360,pos=[],idx=[];
  for(let j=0;j<=M;j++){const a=j/M*TAU,n=0.5+0.22*Math.sin(a*2+ph[0])+0.14*Math.sin(a*5+ph[1])+0.08*Math.sin(a*11+ph[2])+(k?0.18*Math.abs(Math.sin(a*63+ph[3]))+0.1*Math.sin(a*140+ph[4]):0);
    const y=h0+(h1-h0)*clamp(n,0,1);pos.push(Math.cos(a)*r,y,Math.sin(a)*r,Math.cos(a)*r,-400,Math.sin(a)*r);if(j){const o=2*(j-1);idx.push(o,o+1,o+2,o+1,o+3,o+2);}}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setIndex(idx);
  const m=new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:col,side:THREE.DoubleSide,fog:false,depthWrite:false}));m.renderOrder=-9+k;m.frustumCulled=false;m.userData={base:new THREE.Color(col),haze};sky.add(m);return m;});
function paintSky(rain){
  curRain=rain;if(MATS&&MATS.road)wetRoad(rain);
  const fogc=new THREE.Color(0x1b2536).lerp(new THREE.Color(0x2f3a46),rain);
  scene.fog.color.copy(fogc);FOG_BASE.copy(fogc);
  const top=new THREE.Color(0x050a1a).lerp(new THREE.Color(0x12171d),rain), mid=new THREE.Color(0x1f2f58).lerp(new THREE.Color(0x29313a),rain),
    glow=new THREE.Color(0xe07a48).multiplyScalar(1-0.8*rain), P=skyGeo.attributes.position, C=skyGeo.attributes.color, c=new THREE.Color();
  for(let i=0;i<P.count;i++){const x=P.getX(i),y=P.getY(i),z=P.getZ(i),e=y/SKY_R;
    if(e<=0)c.copy(fogc);else c.copy(fogc).lerp(mid,Math.min(1,e*6)).lerp(top,Math.pow(clamp((e-0.1)/0.9,0,1),0.55));
    const g=Math.pow(Math.max(0,Math.cos(Math.atan2(z,x)-SUN_AZ)),3)*Math.exp(-Math.max(0,e)*10)*(e>-0.02?1:0);
    C.setXYZ(i,c.r+glow.r*g,c.g+glow.g*g,c.b+glow.b*g);}
  C.needsUpdate=true;
  for(const m of HILLS)m.material.color.copy(m.userData.base).lerp(fogc,clamp(m.userData.haze+rain*0.5,0,0.95));
}
scene.add(new THREE.HemisphereLight(0x9fb6cf,0x10160f,0.42));
const sun=new THREE.DirectionalLight(0xe6eeff,0.25); sun.position.set(-0.4,1,0.3); scene.add(sun);
// floodlight key light that follows the car and casts the shadows you see under cars and in the cockpit
const key=new THREE.DirectionalLight(0xfff0dc,1.15);key.castShadow=true;key.shadow.mapSize.set(2048,2048);
{const c=key.shadow.camera;c.left=-32;c.right=32;c.top=32;c.bottom=-32;c.near=1;c.far=140;}key.shadow.bias=-0.0004;key.shadow.normalBias=0.03;
scene.add(key,key.target);
// reflections: an environment map rendered from the same twilight sky plus a ring of floodlight panels, so cars
// and the wet road reflect the circuit's lights (no city)
const pmrem=new THREE.PMREMGenerator(renderer);
let ENV=null;const ENVK=0.85;
function applyEnv(root){if(!ENV||!root)return;root.traverse(o=>{const ms=o.material?(Array.isArray(o.material)?o.material:[o.material]):[];
  for(const m of ms){if(!m.isMeshStandardMaterial||m.userData.envDone||m.userData.noEnv)continue;m.userData.envDone=true;m.envMap=ENV;m.envMapIntensity=(m.envMapIntensity||1)*ENVK;m.needsUpdate=true;}});}
function buildEnv(){
  const es=new THREE.Scene(),s2=new THREE.Mesh(skyGeo,skyMat);s2.scale.setScalar(60/SKY_R);es.add(s2);
  const fl=new THREE.MeshBasicMaterial({color:new THREE.Color(0xfff2dc).multiplyScalar(5),side:THREE.DoubleSide});
  for(let k=0;k<12;k++){const a=k/12*TAU,m=new THREE.Mesh(new THREE.PlaneGeometry(5,2),fl);m.position.set(Math.cos(a)*34,11,Math.sin(a)*34);m.lookAt(0,0,0);es.add(m);}
  const gd=new THREE.Mesh(new THREE.CircleGeometry(58,32),new THREE.MeshBasicMaterial({color:0x0e1411}));gd.rotation.x=-Math.PI/2;gd.position.y=-1.2;es.add(gd);
  ENV=pmrem.fromScene(es,0.02,0.1,200).texture;
}
let composer=null,bloom=null;
try{if(THREE.EffectComposer&&THREE.UnrealBloomPass){
  const rt=THREE.WebGLMultisampleRenderTarget&&renderer.capabilities.isWebGL2?new THREE.WebGLMultisampleRenderTarget(960,540,{format:THREE.RGBAFormat}):undefined;
  composer=new THREE.EffectComposer(renderer,rt);composer.addPass(new THREE.RenderPass(scene,camera));
  bloom=new THREE.UnrealBloomPass(new THREE.Vector2(960,540),0.32,0.4,0.88);composer.addPass(bloom);
  composer.addPass(new THREE.ShaderPass(THREE.GammaCorrectionShader));}}catch(e){composer=null;}

function canvasTex(w,h,draw){const cv=document.createElement('canvas');cv.width=w;cv.height=h;draw(cv.getContext('2d'),w,h);
  const t=new THREE.CanvasTexture(cv);t.encoding=THREE.sRGBEncoding;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());return t;}
function noise(c,w,h,amt,rnd){const im=c.getImageData(0,0,w,h),d=im.data;for(let i=0;i<d.length;i+=4){const n=(rnd()-0.5)*amt;d[i]+=n;d[i+1]+=n;d[i+2]+=n;}c.putImageData(im,0,0);}
const R0=mulberry(11);
const roadTex=canvasTex(256,512,(c,w,h)=>{
  c.fillStyle='#3a3e44';c.fillRect(0,0,w,h);noise(c,w,h,30,R0);
  const g=c.createLinearGradient(0,0,w,0);g.addColorStop(0.2,'rgba(0,0,0,0)');g.addColorStop(0.5,'rgba(8,8,10,.35)');g.addColorStop(0.8,'rgba(0,0,0,0)');c.fillStyle=g;c.fillRect(0,0,w,h);
  for(let k=0;k<16;k++){c.fillStyle='rgba(150,170,190,.07)';c.beginPath();c.ellipse(R0()*w,R0()*h,10+R0()*40,20+R0()*80,0,0,TAU);c.fill();}
  c.fillStyle='#e8ecef';c.fillRect(w*0.035,0,w*0.022,h);c.fillRect(w*0.943,0,w*0.022,h);
});
// GP barrier, top to bottom (the wall runs 3.4 m above the road to 3 m below; road level is at y=68):
// catch fence wrapped in branded scrim with invented sponsors, striped barrier top, TecPro blocks, concrete
const wallTex=canvasTex(512,128,(c,w,h)=>{
  const cols=['#0f2f5a','#15171c','#7a0f16','#0c3b2e'],names=['KINETIC','VELOCE','MERIDIAN','HALCYON'];
  c.fillStyle='#1b1f24';c.fillRect(0,0,w,4);
  for(let k=0;k<4;k++){c.fillStyle=cols[k];c.fillRect(k*128,4,128,40);c.fillStyle=k===2?'#ffd24a':'#eef2f5';c.font='800 21px "Arial Narrow",Arial,sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(names[k],k*128+64,25);}
  c.strokeStyle='rgba(0,0,0,.18)';c.lineWidth=1;for(let x=-40;x<w;x+=6){c.beginPath();c.moveTo(x,4);c.lineTo(x+40,44);c.stroke();}
  c.fillStyle='#2a2f35';for(let x=0;x<w;x+=64)c.fillRect(x,0,3,44);
  for(let x=0;x<w;x+=32){c.fillStyle=(x/32)%2?'#e4e7ea':'#c22a2e';c.fillRect(x,44,32,6);}
  const tp=['#2a4677','#aeb3b8','#86262b'];for(let x=0;x<w;x+=32){c.fillStyle=tp[(x/32)%3];c.fillRect(x,50,32,18);c.fillStyle='rgba(0,0,0,.35)';c.fillRect(x,50,2,18);c.fillRect(x,58,32,1);}
  c.fillStyle='#7c8187';c.fillRect(0,68,w,h-68);noise(c,w,h,18,R0);
});
// grandstand crowd: one row of spectators per tier, lit by the floodlights
const crowdTex=canvasTex(512,64,(c,w,h)=>{const r=mulberry(17),shirts=['#ff7a2a','#d6202a','#1f5fd0','#f2f2f2','#18a060','#ffd02a','#6a2fb0','#222','#e85aa0','#20b8d0'],skin=['#f1c6a0','#d9a47c','#a86d45','#6b4226','#f5d7bd'];
  c.fillStyle='#1a1f2a';c.fillRect(0,0,w,h);c.fillStyle='#262d3a';c.fillRect(0,40,w,24);
  for(let x=3;x<w;x+=6+r()*4){if(r()<0.08)continue;const sh=shirts[(r()*shirts.length)|0],y=12+r()*6;c.fillStyle=sh;c.fillRect(x-3,y+6,7,44-y);
    c.fillStyle=skin[(r()*skin.length)|0];c.beginPath();c.arc(x,y+2,3.1,0,TAU);c.fill();
    if(r()<0.05){c.fillStyle=shirts[(r()*shirts.length)|0];c.fillRect(x+2,y-12,12,8);c.fillStyle='#ccc';c.fillRect(x+1,y-12,1,16);}}});
// timing tower: running order as a column of tracker codes
const towerTex=canvasTex(64,256,(c,w,h)=>{c.fillStyle='#07090c';c.fillRect(0,0,w,h);const codes=['ALP','BRV','CHL','DLT','ECH','FOX','GLF','HTL','IND','JLT'];
  c.font='700 13px "B612 Mono",monospace';c.textBaseline='middle';codes.forEach((cd,i)=>{const y=14+i*24;c.fillStyle='#ffd02a';c.fillText(String(i+1),5,y);c.fillStyle='#eef2f5';c.fillText(cd,24,y);});});
const glowTex=canvasTex(64,64,(c,w,h)=>{const g=c.createRadialGradient(32,32,0,32,32,32);g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(0.25,'rgba(255,255,255,.45)');g.addColorStop(1,'rgba(255,255,255,0)');c.fillStyle=g;c.fillRect(0,0,w,h);});
const streakTex=canvasTex(32,256,(c,w,h)=>{for(let y=0;y<h;y++){const a=Math.pow(y/h,1.6);const g=c.createLinearGradient(0,0,w,0);g.addColorStop(0,'rgba(255,255,255,0)');g.addColorStop(0.5,'rgba(255,255,255,'+a+')');g.addColorStop(1,'rgba(255,255,255,0)');c.fillStyle=g;c.fillRect(0,y,w,1);}});
streakTex.wrapS=streakTex.wrapT=THREE.ClampToEdgeWrapping;
const roadNormal=canvasTex(256,512,(c,w,h)=>{const img=c.createImageData(w,h),hgt=new Float32Array(w*h),r=mulberry(9);
  for(let i=0;i<w*h;i++)hgt[i]=r();for(let k=0;k<2;k++)for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x;hgt[i]=(hgt[i]*2+hgt[i-1]+hgt[i+1]+hgt[i-w]+hgt[i+w])/6;}
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x,dx=(hgt[y*w+(x+1)%w]-hgt[y*w+(x-1+w)%w])*6,dy=(hgt[((y+1)%h)*w+x]-hgt[((y-1+h)%h)*w+x])*6,l=Math.hypot(dx,dy,1);
    img.data[i*4]=(-dx/l*0.5+0.5)*255;img.data[i*4+1]=(-dy/l*0.5+0.5)*255;img.data[i*4+2]=(1/l*0.5+0.5)*255;img.data[i*4+3]=255;}c.putImageData(img,0,0);});
roadNormal.encoding=THREE.LinearEncoding;
const roadRough=canvasTex(256,512,(c,w,h)=>{c.fillStyle='rgb(185,185,185)';c.fillRect(0,0,w,h);const r=mulberry(4);
  for(let k=0;k<40;k++){const x=r()*w,y=r()*h,rx=8+r()*40,ry=20+r()*90,g=c.createRadialGradient(x,y,0,x,y,Math.max(rx,ry));g.addColorStop(0,'rgba(70,70,70,.9)');g.addColorStop(1,'rgba(70,70,70,0)');c.fillStyle=g;c.beginPath();c.ellipse(x,y,rx,ry,0,0,TAU);c.fill();}
  const g2=c.createLinearGradient(0,0,w,0);g2.addColorStop(0.3,'rgba(60,60,60,0)');g2.addColorStop(0.5,'rgba(60,60,60,.5)');g2.addColorStop(0.7,'rgba(60,60,60,0)');c.fillStyle=g2;c.fillRect(0,0,w,h);});
roadRough.encoding=THREE.LinearEncoding;
const texL=new THREE.TextureLoader();
function pbrTex(url,srgb,rx,ry,cb){return texL.load(url,t=>{t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(rx,ry);t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());if(srgb)t.encoding=THREE.sRGBEncoding;if(cb)cb(t);});}
const MATS={
  road:new THREE.MeshPhysicalMaterial({map:roadTex,color:0x8a9098,roughness:1,roughnessMap:roadRough,normalMap:roadNormal,normalScale:new THREE.Vector2(0.12,0.12),metalness:0.0,vertexColors:true,envMapIntensity:0.35,clearcoat:0,clearcoatRoughness:0.3,clearcoatRoughnessMap:roadRough}),
  line:new THREE.MeshStandardMaterial({color:0xd9dde0,roughness:0.8,vertexColors:true,polygonOffset:true,polygonOffsetFactor:-3}),
  wall:new THREE.MeshStandardMaterial({userData:{noEnv:false},map:wallTex,emissive:0xffffff,emissiveMap:wallTex,emissiveIntensity:0.2,roughness:0.75,side:THREE.DoubleSide,vertexColors:true,envMapIntensity:0.35}),
  kerb:new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.45,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2}),
  ground:new THREE.MeshStandardMaterial({color:0x13200f,roughness:1,envMapIntensity:0.1}),
  stand:new THREE.MeshStandardMaterial({color:0x59616b,roughness:0.85,side:THREE.DoubleSide,envMapIntensity:0.3}),
  crowd:new THREE.MeshStandardMaterial({map:crowdTex,emissive:0xffffff,emissiveMap:crowdTex,emissiveIntensity:0.32,roughness:0.9,side:THREE.DoubleSide}),
  roof:new THREE.MeshStandardMaterial({color:0xc9ced4,roughness:0.45,metalness:0.6,side:THREE.DoubleSide}),
  lit:new THREE.MeshBasicMaterial({color:0xfff3e0,side:THREE.DoubleSide}),
  glass:new THREE.MeshStandardMaterial({color:0x0c1520,emissive:0x5f86b0,emissiveIntensity:0.45,roughness:0.1,metalness:0.8,side:THREE.DoubleSide}),
  tower:new THREE.MeshBasicMaterial({map:towerTex}),
  verge:new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.95,envMapIntensity:0.1,side:THREE.DoubleSide}),
  mast:new THREE.MeshStandardMaterial({color:0x3a4048,roughness:0.6,metalness:0.5}),
  flood:new THREE.MeshBasicMaterial({color:0xfff6e8}),
  tree:new THREE.MeshStandardMaterial({color:0xffffff,roughness:0.9}),
  trunk:new THREE.MeshStandardMaterial({color:0x2a2119,roughness:1}),
  pit:new THREE.MeshStandardMaterial({color:0x2b2e33,roughness:0.7,envMapIntensity:0.4}),
  grn:new THREE.MeshBasicMaterial({color:0x22ff77}),
  glow:new THREE.SpriteMaterial({map:glowTex,color:0xffeed6,blending:THREE.AdditiveBlending,depthWrite:false,transparent:true,opacity:0.5,fog:true}),
  streak:new THREE.MeshBasicMaterial({map:streakTex,color:0xffe4c0,blending:THREE.AdditiveBlending,depthWrite:false,transparent:true,opacity:0.32,fog:true,polygonOffset:true,polygonOffsetFactor:-4})
};
let trackGroup=null, STREAKS=[], FOOT=[];
paintSky(0.6);buildEnv();
// swap in the real scanned asphalt once it has loaded (one tile ~ 4 m); puddle roughness stays from our own map
pbrTex('/assets/asphalt_diff.jpg',true,3.3,10,t=>{MATS.road.map=t;MATS.road.userData.dry=0x9aa0a6;wetRoad(curRain);MATS.road.needsUpdate=true;});
pbrTex('/assets/asphalt_nor.jpg',false,3.3,10,t=>{MATS.road.normalMap=t;MATS.road.normalScale.set(0.9,0.9);MATS.road.needsUpdate=true;});
pbrTex('/assets/asphalt_rough.jpg',false,3.3,10,t=>{MATS.road.roughnessMap=t;wetRoad(curRain);MATS.road.needsUpdate=true;});
/* wet track: water darkens asphalt (less diffuse light escapes a wet surface), fills the texture so the base goes
   smoother, and lies on top as a film that mirrors the floodlights: a clear coat whose strength follows the rain,
   glossiest where the puddle map says water stands. Kerbs and paint get slippery-shiny too. */
function wetRoad(rain){const m=MATS.road,w=clamp(rain,0,1);
  m.color.set(m.userData.dry||0x8a9098).multiplyScalar(1-0.5*w);
  m.roughness=1-0.45*w;m.clearcoat=clamp(w*0.9,0,1);m.clearcoatRoughness=0.4-0.3*w;m.envMapIntensity=(0.3+0.25*w)*ENVK;
  MATS.line.roughness=0.8-0.55*w;MATS.kerb.roughness=0.45-0.3*w;MATS.verge.roughness=0.95-0.3*w;}
// concrete barrier face (Poly Haven "brushed_concrete", CC0) painted into the lower band of the wall texture
{const im=new Image();im.onload=()=>{const c=wallTex.image.getContext('2d');for(let x=0;x<512;x+=128)c.drawImage(im,0,0,im.width,im.height/2,x,68,128,60);
  c.fillStyle='rgba(20,22,26,.25)';c.fillRect(0,68,512,60);c.fillStyle='#4a4e53';for(let x=0;x<512;x+=96)c.fillRect(x,68,2,60);wallTex.needsUpdate=true;};im.src='/assets/concrete_diff.jpg';}
// floodlight masts behind the barrier, alternating sides; lampLight is the light pool they leave on the ground
function lampList(){const out=[];for(let s=10,k=0;s<L-20;s+=64,k++)out.push([s,k%2?1:-1]);return out;}
function lampLight(s,lat){let b=0.42;for(const [ls,sd] of LAMPS){let d=s-ls;if(d>L/2)d-=L;if(d<-L/2)d+=L;if(Math.abs(d)>90)continue;const dl=lat-sd*(WALL+5);b+=0.8*Math.exp(-(d*d+dl*dl*0.5)/(2*26*26));}return Math.min(1.45,b);}
let LAMPS=[];
function buildTrackMeshes(){
  LAMPS=lampList();
  if(trackGroup){scene.remove(trackGroup);trackGroup.traverse(o=>{if(o.geometry)o.geometry.dispose();});}
  trackGroup=new THREE.Group(); scene.add(trackGroup); STREAKS=[]; FOOT=[];
  const step=2, cnt=Math.floor(N/step)+1;
  {const pos=[],uv=[],idx=[],col=[];
    for(let k=0;k<=cnt;k++){const ii=Math.min(k*step,N),i=ii%N,s=ii*DS,rx=-TZ[i],rz=TX[i],y=H[i],e=HW+0.6;
      pos.push(PX[i]-rx*e,y,PZ[i]-rz*e,PX[i]+rx*e,y,PZ[i]+rz*e);uv.push(0,s/40,1,s/40);
      {const a=lampLight(s,-e),b=lampLight(s,e);col.push(a,a,a*0.95,b,b,b*0.95);}
      if(k>0){const a=2*(k-1),b=a+1,c=2*k,d=c+1;idx.push(a,b,c,b,d,c);}}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));g.setIndex(idx);g.computeVertexNormals();
    const rm=new THREE.Mesh(g,MATS.road);rm.receiveShadow=true;trackGroup.add(rm);}
  for(const sg of [-1,1]){const p=[],u=[],ix=[],cl=[],G=sg<0?WGL:WGR;
    for(let k=0;k<=cnt;k++){const ii=Math.min(k*step,N),i=ii%N,s=ii*DS,x=PX[i]-TZ[i]*WALL*sg,z=PZ[i]+TX[i]*WALL*sg;
      p.push(x,H[i]-3,z,x,H[i]+3.4,z);u.push(-sg*s/16,0,-sg*s/16,1);{const b=lampLight(s,sg*WALL);cl.push(b*0.8,b*0.8,b*0.8,b*0.55,b*0.55,b*0.55);}
      const ip=(Math.min((k-1)*step,N))%N;
      if(k>0&&!G[i]&&!G[ip]){const a=2*(k-1),b=a+1,c=2*k,d=c+1;ix.push(a,c,b,b,c,d);}}
    const gw=new THREE.BufferGeometry();gw.setAttribute('position',new THREE.Float32BufferAttribute(p,3));gw.setAttribute('uv',new THREE.Float32BufferAttribute(u,2));gw.setAttribute('color',new THREE.Float32BufferAttribute(cl,3));gw.setIndex(ix);gw.computeVertexNormals();
    const wm=new THREE.Mesh(gw,MATS.wall);wm.receiveShadow=true;trackGroup.add(wm);}
  {const lp=[],lc=[],li=[];for(const sg of [-1,1]){const base=lp.length/3;
      for(let k=0;k<=cnt;k++){const ii=Math.min(k*step,N),i=ii%N,s=ii*DS;const A=worldPos(s,sg*(HW-0.42)),B=worldPos(s,sg*(HW-0.26));lp.push(A.x,A.y+0.01,A.z,B.x,B.y+0.01,B.z);const b=lampLight(s,sg*HW);lc.push(b,b,b,b,b,b);
        if(k>0){const a=base+2*(k-1),bb=a+1,c2=base+2*k,d=c2+1;li.push(a,bb,c2,bb,d,c2);}}}
    const gl2=new THREE.BufferGeometry();gl2.setAttribute('position',new THREE.Float32BufferAttribute(lp,3));gl2.setAttribute('color',new THREE.Float32BufferAttribute(lc,3));gl2.setIndex(li);gl2.computeVertexNormals();
    const lm=new THREE.Mesh(gl2,MATS.line);lm.receiveShadow=true;trackGroup.add(lm);}
  {const kp=[],kc=[],ki=[],red=new THREE.Color(0xc0262b),wht=new THREE.Color(0xdde2e6);
    for(const cn of CORNERS){const len=wrapS(cn.s1-cn.s0)+24;for(let q=0;q<len;q+=1.5){const s=cn.s0-12+q,n=Math.round(s/1.5);
      for(const sg of [-1,1]){const A=worldPos(s,sg*(HW-1.1)),B=worldPos(s,sg*(HW+0.25)),C=worldPos(s+1.5,sg*(HW-1.1)),D=worldPos(s+1.5,sg*(HW+0.25));
        const b=kp.length/3;kp.push(A.x,A.y+0.03,A.z,B.x,B.y+0.03,B.z,C.x,C.y+0.03,C.z,D.x,D.y+0.03,D.z);
        const col=(n%2)?red:wht;for(let t=0;t<4;t++)kc.push(col.r,col.g,col.b);ki.push(b,b+1,b+2,b+1,b+3,b+2);}}}
    const gk=new THREE.BufferGeometry();gk.setAttribute('position',new THREE.Float32BufferAttribute(kp,3));gk.setAttribute('color',new THREE.Float32BufferAttribute(kc,3));gk.setIndex(ki);gk.computeVertexNormals();
    trackGroup.add(new THREE.Mesh(gk,MATS.kerb));}
  // ---------- Grand Prix surroundings: verges, gravel, pit building, grandstands, floodlights, start gantry, trees ----------
  let minH=1e9;for(let i=0;i<N;i++)minH=Math.min(minH,H[i]);const G0=minH-1.2, far=Math.round(60/DS);
  const gp=new THREE.Mesh(new THREE.PlaneGeometry(9000,9000),MATS.ground);gp.rotation.x=-Math.PI/2;gp.position.y=G0;gp.receiveShadow=true;trackGroup.add(gp);
  // verges: mown grass at track height out to 45 m (less where another part of the circuit is close), gravel traps
  // on the outside of corners, then a skirt down to the ground
  {const pos=[],col=[],idx=[],grass=new THREE.Color(0x2f5226),gravel=new THREE.Color(0x8d7d62),c=new THREE.Color();
    for(const sg of [-1,1]){
      const grav=new Float32Array(N);
      for(const cn of CORNERS){if(cn.sg!==-sg)continue;const a=cn.s0-8,b=cn.s1+30+Math.abs(cn.angle)*12;
        for(let q=a;q<=b;q+=DS){const i=Math.floor(wrapS(q)/DS)%N;grav[i]=Math.max(grav[i],clamp(Math.min((q-a)/10,(b-q)/14),0,1));}}
      const base=pos.length/3;
      for(let k=0;k<=cnt;k++){const ii=Math.min(k*step,N),i=ii%N,s=ii*DS;
        let W=45;for(const r of [8,16,26,36,45]){const q=worldPos(s,sg*(WALL+r));if(nearTrack(q.x,q.z,WALL+2,i,far)){W=Math.max(1.5,r-8);break;}}
        const offs=[WALL+0.05,WALL+Math.min(W,20),WALL+W,WALL+W+14],ys=[H[i]-0.06,H[i]-0.12-Math.min(W,20)*0.02,Math.max(G0+0.3,H[i]-0.6-W*0.05),G0];
        const stripe=Math.floor(s/12)%2?1:0.84,lt=lampLight(s,sg*(WALL+10));
        offs.forEach((o,j)=>{const q=worldPos(s,sg*o);pos.push(q.x,ys[j],q.z);c.copy(grass).multiplyScalar(stripe).lerp(gravel,j<2?grav[i]:0).multiplyScalar(lt*(j===3?0.6:1));col.push(c.r,c.g,c.b);});
        if(k>0){const o0=base+4*(k-1),o1=base+4*k;for(let j=0;j<3;j++)idx.push(o0+j,o1+j,o0+j+1,o0+j+1,o1+j,o1+j+1);}}}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));g.setIndex(idx);g.computeVertexNormals();
    const m=new THREE.Mesh(g,MATS.verge);m.receiveShadow=true;trackGroup.add(m);}
  // simple geometry batches, one mesh per material
  const GB={},quad=(k,a,b,c,d,uw=1,vh=1)=>{const g=GB[k]||(GB[k]={p:[],u:[],i:[]}),o=g.p.length/3;g.p.push(...a,...b,...c,...d);g.u.push(0,0,uw,0,uw,vh,0,vh);g.i.push(o,o+1,o+2,o,o+2,o+3);};
  // local frame beside the track at s on side sd: x along the track, y up, z away from the track
  const frame=(s,sd,z0,y0)=>{const F=trackFrame(s),ox=-F.tz*sd,oz=F.tx*sd,bx=F.px+ox*z0,bz=F.pz+oz*z0;return (x,y,z)=>[bx+F.tx*x+ox*z,y0+y,bz+F.tz*x+oz*z];};
  const box=(k,P,x0,x1,y0,y1,z0,z1)=>{const U=(x1-x0)/8,V=(y1-y0)/8,Z=(z1-z0)/8;
    quad(k,P(x0,y0,z0),P(x1,y0,z0),P(x1,y1,z0),P(x0,y1,z0),U,V);quad(k,P(x0,y0,z1),P(x1,y0,z1),P(x1,y1,z1),P(x0,y1,z1),U,V);
    quad(k,P(x0,y0,z0),P(x0,y0,z1),P(x0,y1,z1),P(x0,y1,z0),Z,V);quad(k,P(x1,y0,z0),P(x1,y0,z1),P(x1,y1,z1),P(x1,y1,z0),Z,V);
    quad(k,P(x0,y1,z0),P(x1,y1,z0),P(x1,y1,z1),P(x0,y1,z1),U,Z);};
  const taken=[];
  const fits=(P,x0,x1,z0,z1)=>{for(let x=x0;x<=x1+0.01;x+=Math.max(6,(x1-x0)/8))for(const z of [z0,z1]){const q=P(x,0,z);if(nearTrackAny(q[0],q[2],WALL+2.5))return false;}
    const c=P((x0+x1)/2,0,(z0+z1)/2),r=Math.hypot(x1-x0,z1-z0)/2;if(taken.some(t=>Math.hypot(t[0]-c[0],t[1]-c[2])<t[2]+r))return false;
    taken.push([c[0],c[2],r]);FOOT.push({pts:[[x0,z0],[x1,z0],[x1,z1],[x0,z1]].map(([x,z])=>{const q=P(x,0,z);return [q[0],q[2]];})});return true;};
  const hAt=s=>H[Math.floor(wrapS(s)/DS)%N];
  // pit lane and pit building along the start straight, timing tower by the line
  let pit=null;
  for(const sd of [1,-1]){for(let len=200;len>=70&&!pit;len-=26){const sc=wrapS(len/2-50),P=frame(sc,sd,WALL,hAt(sc)-0.05);if(!fits(P,-len/2,len/2,3,36))continue;pit={sc,len,sd};
      quad('pit',P(-len/2,0.03,0.4),P(len/2,0.03,0.4),P(len/2,0.03,12.5),P(-len/2,0.03,12.5));
      box('stand',P,-len/2,len/2,0,11,13,29);box('roof',P,-len/2-1,len/2+1,11,11.6,11.5,30);
      for(let x=-len/2+3;x<len/2-8;x+=9)quad('lit',P(x,0.2,12.94),P(x+6.6,0.2,12.94),P(x+6.6,4.3,12.94),P(x,4.3,12.94));
      quad('glass',P(-len/2+1,5.4,12.93),P(len/2-1,5.4,12.93),P(len/2-1,9.6,12.93),P(-len/2+1,9.6,12.93));
      const tx=50-len/2-10;box('stand',P,tx-2.2,tx+2.2,0,34,31,35.4);quad('tower',P(tx-2,9,30.95),P(tx+2,9,30.95),P(tx+2,33,30.95),P(tx-2,33,30.95));}if(pit)break;}
  // start gantry over the line, lights out and the green LEDs on
  {const P=frame(0,1,0,hAt(0)),e=WALL+0.4;for(const z of [-e,e])box('mast',P,-0.3,0.3,0,7.4,z-0.3,z+0.3);box('mast',P,-0.4,0.4,6.4,7.4,-e,e);
    for(let k=-2;k<=2;k++)box('grn',P,-0.45,-0.41,5.7,6.3,k*1.3-0.35,k*1.3+0.35);}
  // grandstands: tiers of spectators behind the barrier, cantilever roof with a lit fascia
  const stand=(P,len,n,run,rise)=>{const x0=-len/2,x1=len/2,y0=2.4,top=y0+n*rise,D=n*run;
    quad('stand',P(x0,0,0),P(x1,0,0),P(x1,y0,0),P(x0,y0,0),len/8,1);
    for(let k=0;k<n;k++){const z=k*run,y=y0+k*rise;quad('crowd',P(x0,y,z),P(x1,y,z),P(x1,y+rise,z),P(x0,y+rise,z),len/25,1);
      quad('stand',P(x0,y+rise,z),P(x1,y+rise,z),P(x1,y+rise,z+run),P(x0,y+rise,z+run),len/8,0.2);}
    quad('stand',P(x0,0,D),P(x1,0,D),P(x1,top+4.2,D),P(x0,top+4.2,D),len/8,2);
    for(const x of [x0,x1])quad('stand',P(x,0,0),P(x,0,D),P(x,top+4.2,D),P(x,y0,0));
    quad('roof',P(x0-1,top+4.2,D+0.3),P(x1+1,top+4.2,D+0.3),P(x1+1,top+5.4,-1.5),P(x0-1,top+5.4,-1.5));
    quad('lit',P(x0,top+4.85,-1.45),P(x1,top+4.85,-1.45),P(x1,top+5.25,-1.45),P(x0,top+5.25,-1.45),len/8,1);};
  const rnd=mulberry(3);
  for(let s0=pit?pit.len+30:60;s0<L-(pit?80:60);s0+=64+rnd()*56){const sd=rnd()<0.5?1:-1,n=8+((rnd()*5)|0);let ok=false;
    for(const sd2 of [sd,-sd]){for(const len of [96,72,52]){const P=frame(s0,sd2,WALL+7,hAt(s0)-0.1);if(fits(P,-len/2,len/2,0,n*1.15+1.5)){stand(P,len,n,1.15,0.72);ok=true;break;}}if(ok)break;}}
  {const MK={stand:MATS.stand,crowd:MATS.crowd,roof:MATS.roof,lit:MATS.lit,glass:MATS.glass,tower:MATS.tower,pit:MATS.pit,mast:MATS.mast,grn:MATS.grn};
    for(const k in GB){const g=GB[k],geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(g.p,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(g.u,2));geo.setIndex(g.i);geo.computeVertexNormals();
      const m=new THREE.Mesh(geo,MK[k]);m.receiveShadow=true;trackGroup.add(m);}}
  // floodlight masts: 26 m lattice-grey poles, LED heads aimed down the track, glare sprites
  {const mastG=new THREE.CylinderGeometry(0.28,0.42,26,8);mastG.translate(0,13,0);
    const masts=new THREE.InstancedMesh(mastG,MATS.mast,LAMPS.length),heads=new THREE.InstancedMesh(new THREE.BoxGeometry(5.2,2.4,0.35),MATS.flood,LAMPS.length),dm=new THREE.Object3D();
    LAMPS.forEach(([s,sd],i)=>{const p=worldPos(s,sd*(WALL+5)),y=hAt(s);dm.position.set(p.x,y,p.z);dm.rotation.set(0,0,0);dm.updateMatrix();masts.setMatrixAt(i,dm.matrix);
      const c=worldPos(s+14,-sd*2);dm.position.set(p.x,y+26.5,p.z);dm.lookAt(c.x,y,c.z);dm.updateMatrix();heads.setMatrixAt(i,dm.matrix);
      const sp=new THREE.Sprite(MATS.glow);sp.position.set(p.x,y+26.5,p.z);sp.scale.set(14,14,1);trackGroup.add(sp);});
    trackGroup.add(masts,heads);}
  // trees on the ground plane beyond the verges
  {let mnx=1e9,mxx=-1e9,mnz=1e9,mxz=-1e9;for(let i=0;i<N;i+=4){mnx=Math.min(mnx,PX[i]);mxx=Math.max(mxx,PX[i]);mnz=Math.min(mnz,PZ[i]);mxz=Math.max(mxz,PZ[i]);}
    const r=mulberry(5),pts=[];
    for(let t=0;t<3000&&pts.length<420;t++){const x=mnx-300+r()*(mxx-mnx+600),z=mnz-300+r()*(mxz-mnz+600);
      if(nearTrackAny(x,z,WALL+62)||taken.some(q=>Math.hypot(q[0]-x,q[1]-z)<q[2]+6))continue;pts.push([x,z,6+r()*7,r()]);}
    const trunkG=new THREE.CylinderGeometry(0.22,0.34,1,5);trunkG.translate(0,0.5,0);
    const crowns=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,1),MATS.tree,pts.length),trunks=new THREE.InstancedMesh(trunkG,MATS.trunk,pts.length),dm=new THREE.Object3D(),tc=new THREE.Color();
    pts.forEach(([x,z,h,q],i)=>{dm.position.set(x,G0,z);dm.scale.set(1,h*0.45,1);dm.updateMatrix();trunks.setMatrixAt(i,dm.matrix);
      dm.position.set(x,G0+h*0.62,z);dm.scale.set(h*0.3,h*0.42,h*0.3);dm.updateMatrix();crowns.setMatrixAt(i,dm.matrix);crowns.setColorAt(i,tc.setHSL(0.27+q*0.07,0.42,0.1+q*0.07));});
    if(pts.length)trackGroup.add(crowns,trunks);}
  applyEnv(trackGroup);
}
function nearTrackAny(x,z,r){return PHYS.x.track_near(x,z,r,-1,0)!==0;}

// rain
const RAIN_N=2600, rainPos=new Float32Array(RAIN_N*6), rainBase=new Float32Array(RAIN_N*3);
const rainG=new THREE.BufferGeometry();rainG.setAttribute('position',new THREE.BufferAttribute(rainPos,3));
const rainMat=new THREE.LineBasicMaterial({color:0xa9bfd2,transparent:true,opacity:0.32,fog:true});
const rainL=new THREE.LineSegments(rainG,rainMat);rainL.frustumCulled=false;scene.add(rainL);
let rainInit=false;
function updateRain(dt,cam,vel,rain){
  const n=Math.floor(RAIN_N*clamp(rain*1.1,0.05,1)), B=34, BY=18;
  if(!rainInit){rainInit=true;const r=mulberry(5);for(let i=0;i<RAIN_N;i++){rainBase[i*3]=cam.x+(r()*2-1)*B;rainBase[i*3+1]=cam.y+(r()*2-1)*BY;rainBase[i*3+2]=cam.z+(r()*2-1)*B;}}
  const fall=13, sx=-vel.x*0.045, sy=fall*0.06, sz=-vel.z*0.045;
  for(let i=0;i<n;i++){let x=rainBase[i*3],y=rainBase[i*3+1]-fall*dt,z=rainBase[i*3+2];
    if(x-cam.x>B)x-=2*B;else if(x-cam.x<-B)x+=2*B; if(z-cam.z>B)z-=2*B;else if(z-cam.z<-B)z+=2*B; if(y-cam.y<-BY)y+=2*BY;else if(y-cam.y>BY)y-=2*BY;
    rainBase[i*3]=x;rainBase[i*3+1]=y;rainBase[i*3+2]=z;const j=i*6;rainPos[j]=x;rainPos[j+1]=y;rainPos[j+2]=z;rainPos[j+3]=x+sx;rainPos[j+4]=y+sy;rainPos[j+5]=z+sz;}
  rainG.setDrawRange(0,n*2);rainG.attributes.position.needsUpdate=true;rainMat.opacity=0.05+0.12*rain;
}
// spray
// tyre spray: particles simulated in physics/spray.c; three.js draws its buffers straight from wasm memory
const spG=new THREE.BufferGeometry();
const sprayMat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,fog:true,
  uniforms:THREE.UniformsUtils.merge([THREE.UniformsLib.fog,{uColor:{value:new THREE.Color(0x8a96a2)},uScale:{value:600}}]),
  vertexShader:'attribute float aSize;attribute float aAlpha;varying float vA;uniform float uScale;\n#include <fog_pars_vertex>\nvoid main(){vec4 mvPosition=modelViewMatrix*vec4(position,1.0);gl_Position=projectionMatrix*mvPosition;gl_PointSize=min(900.0,aSize*uScale/max(0.1,-mvPosition.z));vA=aAlpha;\n#include <fog_vertex>\n}',
  fragmentShader:'uniform vec3 uColor;varying float vA;\n#include <fog_pars_fragment>\nvoid main(){vec2 c=gl_PointCoord-0.5;float d=length(c);float a=smoothstep(0.5,0.05,d)*vA;if(a<0.003)discard;gl_FragColor=vec4(uColor,a);\n#include <fog_fragment>\n}'});
const sprayPts=new THREE.Points(spG,sprayMat);sprayPts.frustumCulled=false;scene.add(sprayPts);
const _v=new THREE.Vector3();
// count droplets from a point on a car (local offset), thrown into the wake of a car moving at vel
function emitSpray(obj,off,vel,count){if(!PHYS.ok||count<=0)return;
  _v.set(off[0],off[1],off[2]);obj.localToWorld(_v);PHYS.x.spray_emit(count,_v.x,_v.y,_v.z,vel.x,vel.z,obj.position.y);}
// a front tyre rolling through the water under it: tread pick-up, a sideways bow wave and mist (physics/spray.c)
const _o=new THREE.Vector3();
function emitTyreSpray(obj,side,vel,count){if(!PHYS.ok||count<=0)return;
  _v.set(side*0.8,0.3,-1.95);obj.localToWorld(_v);_o.set(side,0,0).transformDirection(obj.matrixWorld);
  PHYS.x.spray_emit_tyre(count,_v.x,_v.y,_v.z,vel.x,vel.z,_o.x,_o.z,obj.position.y);}
function updateSpray(dt,rain){if(!PHYS.ok||dt<=0)return;PHYS.x.spray_update(dt,rain);
  for(const k of ['position','aSize','aAlpha'])spG.attributes[k].needsUpdate=true;}

// models
const MAT={carbon:new THREE.MeshStandardMaterial({color:0x14171b,roughness:0.55,metalness:0.2}),tyre:new THREE.MeshStandardMaterial({color:0x0b0b0c,roughness:0.95}),
  rain:new THREE.MeshBasicMaterial({color:0xff2a1f}),glowR:new THREE.SpriteMaterial({map:glowTex,color:0xff3322,blending:THREE.AdditiveBlending,depthWrite:false,transparent:true,fog:true}),
  glowO:new THREE.SpriteMaterial({map:glowTex,color:0xffa21a,blending:THREE.AdditiveBlending,depthWrite:false,transparent:true,fog:true})};
const wheelG=new THREE.CylinderGeometry(0.35,0.35,0.38,18);wheelG.rotateZ(Math.PI/2);
let CAR_GLB=null, playerGLB=null;
function makeCar(col,cockpit){
  if(CAR_GLB&&!cockpit)return cloneGLBCar(col);
  return window.buildF1Car({color:col,accent:cockpit?0xff7a2a:0xe8ecef,cockpit,wet:curRain>0.6,glowTex});
}
function cloneGLBCar(col){
  const g=new THREE.Group();
  for(const part of CAR_GLB.parts){const mat=part.paint?part.mat.clone():part.mat;if(part.paint){mat.color.set(col);mat.userData={};}
    const m=new THREE.Mesh(part.geo,mat);m.castShadow=true;m.receiveShadow=true;m.userData.keep=true;g.add(m);}
  const rl=new THREE.Mesh(new THREE.BoxGeometry(0.16,0.08,0.03),MAT.rain);rl.position.set(0,CAR_GLB.rearY,CAR_GLB.rearZ);g.add(rl);
  const rg=new THREE.Sprite(MAT.glowR);rg.position.set(0,CAR_GLB.rearY,CAR_GLB.rearZ+0.05);rg.scale.set(0.35,0.35,1);g.add(rg);
  g.userData.rain=[rl,rg];g.userData.front=[];g.userData.wheels=[];
  return g;
}
// genuine model: "F1 2022" by Blender458 (sketchfab.com/Blender458), CC BY 4.0, via FetchCFD. Any licensed glb at this path works.
if(THREE.GLTFLoader)fetch('/assets/f1.glb',{method:'HEAD'}).then(r=>{if(!r.ok)return;
  fetch('/assets/f1.json').then(x=>x.ok?x.json():{}).catch(()=>({})).then(cfg=>{
    new THREE.GLTFLoader().load('/assets/f1.glb',gl=>{
      gl.scene.updateMatrixWorld(true);
      const groups=new Map();
      gl.scene.traverse(o=>{if(!o.isMesh)return;let g=o.geometry.clone();g.applyMatrix4(o.matrixWorld);if(g.index)g=g.toNonIndexed();
        for(const k of Object.keys(g.attributes))if(k!=='position'&&k!=='normal')g.deleteAttribute(k);if(!g.attributes.normal)g.computeVertexNormals();
        const m=o.material,key=m.color.getHexString()+'|'+(m.metalness||0).toFixed(2)+'|'+(m.roughness||0).toFixed(2);
        if(!groups.has(key))groups.set(key,{mat:m,geos:[]});groups.get(key).geos.push(g);});
      const parts=[];for(const {mat,geos} of groups.values()){const geo=THREE.BufferGeometryUtils.mergeBufferGeometries(geos,false);if(!geo)continue;
        const mm=new THREE.MeshPhysicalMaterial({color:mat.color,metalness:Math.min(0.7,mat.metalness||0.2),roughness:Math.max(0.25,mat.roughness==null?0.5:mat.roughness),clearcoat:0.6,clearcoatRoughness:0.1,side:THREE.DoubleSide});
        parts.push({geo,mat:mm});}
      // orient: long axis along z, nose to -z (the rear wing is the tallest part, so it marks the back)
      const all=new THREE.Box3();parts.forEach(p=>{p.geo.computeBoundingBox();all.union(p.geo.boundingBox);});
      const sz=all.getSize(new THREE.Vector3()),rot=new THREE.Matrix4();
      if(sz.x>sz.z){rot.makeRotationY(Math.PI/2);parts.forEach(p=>p.geo.applyMatrix4(rot));}
      let top=0,cnt=0,maxY=-1e9;parts.forEach(p=>{const a=p.geo.attributes.position;for(let i=0;i<a.count;i++)maxY=Math.max(maxY,a.getY(i));});
      const b0=new THREE.Box3();parts.forEach(p=>{p.geo.computeBoundingBox();b0.union(p.geo.boundingBox);});const cz=(b0.min.z+b0.max.z)/2,minY=b0.min.y;
      parts.forEach(p=>{const a=p.geo.attributes.position;for(let i=0;i<a.count;i++)if(a.getY(i)>minY+(maxY-minY)*0.8){top+=a.getZ(i)-cz;cnt++;}});
      if(cnt&&top/cnt<0){rot.makeRotationY(Math.PI);parts.forEach(p=>p.geo.applyMatrix4(rot));}
      if(cfg.yaw){rot.makeRotationY(cfg.yaw*Math.PI/180);parts.forEach(p=>p.geo.applyMatrix4(rot));}
      const b1=new THREE.Box3();parts.forEach(p=>{p.geo.computeBoundingBox();b1.union(p.geo.boundingBox);});
      const s1=b1.getSize(new THREE.Vector3()),c1=b1.getCenter(new THREE.Vector3()),k=(cfg.scale||1)*5.6/s1.z;
      const fit=new THREE.Matrix4().makeScale(k,k,k).multiply(new THREE.Matrix4().makeTranslation(-c1.x,-b1.min.y+(cfg.y||0)/k,-c1.z));
      parts.forEach(p=>{p.geo.applyMatrix4(fit);p.geo.computeBoundingSphere();});
      // the paint is the most-used saturated colour
      let best=null,bestN=0;for(const p of parts){const hsl={};p.mat.color.getHSL(hsl);const n=p.geo.attributes.position.count;if(hsl.s>0.25&&hsl.l>0.015&&n>bestN){best=p;bestN=n;}}
      if(best)best.paint=true;
      CAR_GLB={parts,rearZ:s1.z*k/2-0.1,rearY:0.45};
      playerGLB=cloneGLBCar(0x152a55);playerGLB.visible=false;scene.add(playerGLB);applyEnv(playerGLB);
      if(typeof world!=='undefined'&&world)buildDynamic(world);});});}).catch(()=>{});
function makeTractor(){
  const g=new THREE.Group(), y=new THREE.MeshStandardMaterial({color:0xd9a31a,roughness:0.5}), gl=new THREE.MeshStandardMaterial({color:0x1b2530,roughness:0.2,metalness:0.4});
  const box=(w,h,l,x,yy,z,m,rx)=>{const me=new THREE.Mesh(new THREE.BoxGeometry(w,h,l),m);me.position.set(x,yy,z);if(rx)me.rotation.x=rx;g.add(me);return me;};
  box(2.3,1.1,4.4,0,1.1,0,y); box(1.9,1.5,1.7,0,2.4,0.7,y); box(1.95,1.0,1.5,0,2.5,0.7,gl);
  const bw=new THREE.CylinderGeometry(0.8,0.8,0.6,18);bw.rotateZ(Math.PI/2);
  for(const [x,z] of [[-1.2,1.4],[1.2,1.4],[-1.2,-1.5],[1.2,-1.5]]){const w=new THREE.Mesh(bw,MAT.tyre);w.position.set(x,0.8,z);g.add(w);}
  box(0.4,0.4,5.2,0,3.3,-1.2,y,0.42); box(0.05,2.2,0.05,0,2.9,-3.6,MAT.carbon);
  box(0.25,0.22,0.25,0,3.28,0.9,new THREE.MeshBasicMaterial({color:0xff9a10}));
  const bg=new THREE.Sprite(MAT.glowO.clone());bg.position.set(0,3.3,0.9);bg.scale.set(4,4,1);g.add(bg);
  g.userData.beacon=bg; return g;
}
function makeMarshal(){
  const g=new THREE.Group(), o=new THREE.MeshStandardMaterial({color:0xff6a10,roughness:0.6,emissive:0x5a1a00,emissiveIntensity:0.6}), w=new THREE.MeshBasicMaterial({color:0xdfe8ee});
  const add=(geo,m,x,y,z)=>{const me=new THREE.Mesh(geo,m);me.position.set(x,y,z);g.add(me);return me;};
  add(new THREE.CylinderGeometry(0.2,0.24,0.72,10),o,0,1.2,0); add(new THREE.CylinderGeometry(0.245,0.245,0.07,10),w,0,1.1,0);
  add(new THREE.SphereGeometry(0.13,12,10),o,0,1.7,0);
  const lg=new THREE.BoxGeometry(0.13,0.85,0.15);lg.translate(0,-0.42,0);
  const l1=add(lg,o,-0.1,0.86,0), l2=add(lg,o,0.1,0.86,0);
  const ag=new THREE.BoxGeometry(0.1,0.6,0.1);ag.translate(0,-0.3,0);
  const a1=add(ag,o,-0.29,1.5,0), a2=add(ag,o,0.29,1.5,0);
  g.userData.limbs=[l1,l2,a1,a2]; return g;
}
function makeFlagPost(double){
  const g=new THREE.Group(); const pole=new THREE.Mesh(new THREE.CylinderGeometry(0.03,0.03,2.2,6),MAT.carbon);pole.position.y=1.1;g.add(pole);
  const fg=new THREE.PlaneGeometry(0.95,0.65,6,1);fg.translate(0.48,0,0);
  const fm=new THREE.MeshStandardMaterial({color:0xffd21a,emissive:0x6a5200,side:THREE.DoubleSide,roughness:0.8});
  const flags=[];for(let k=0;k<(double?2:1);k++){const f=new THREE.Mesh(fg,fm);f.position.set(0,1.85-k*0.05,k*0.3);g.add(f);flags.push(f);}
  const led=new THREE.Mesh(new THREE.BoxGeometry(1.3,0.8,0.1),new THREE.MeshBasicMaterial({color:0xffcc00}));led.position.set(0,0.5,-1.2);g.add(led);
  const m=makeMarshal();m.position.set(-0.5,0,0.4);m.scale.setScalar(0.95);g.add(m);
  g.userData={flags,led};return g;
}
const _m4=new THREE.Matrix4(),_f=new THREE.Vector3(),_r=new THREE.Vector3(),_u=new THREE.Vector3(),_b=new THREE.Vector3();
function placeObj(o,s,lat,yaw,lift){
  const F=trackFrame(s), cy=Math.cos(yaw||0), sy=Math.sin(yaw||0), rx=-F.tz, rz=F.tx;
  _f.set(F.tx*cy+rx*sy,F.sl,F.tz*cy+rz*sy).normalize(); _r.set(-_f.z,0,_f.x).normalize(); _u.crossVectors(_r,_f); _b.copy(_f).negate();
  _m4.makeBasis(_r,_u,_b); o.quaternion.setFromRotationMatrix(_m4);
  o.position.set(F.px+rx*lat,F.h+(lift||0),F.pz+rz*lat);
}
const player=makeCar(0x152a55,true); scene.add(player);
setTimeout(()=>applyEnv(player),0);
let dyn=new THREE.Group(); scene.add(dyn);
let trafficMeshes=[], hazardMeshes=[], flagPosts=[];
function hazMesh(h){return h.type==='tractor'?makeTractor():h.type==='marshal'?makeMarshal():makeCar(0xb3202b,false);}
function buildDynamic(w){
  scene.remove(dyn); dyn.traverse(o=>{if(o.geometry&&o.geometry!==wheelG&&!o.userData.keep) o.geometry.dispose();});
  dyn=new THREE.Group(); scene.add(dyn);
  trafficMeshes=w.traffic.map(c=>{const m=makeCar(c.col,false);dyn.add(m);return m;});
  hazardMeshes=w.hazards.map(h=>{const m=hazMesh(h);dyn.add(m);return m;});
  flagPosts=[];
  applyEnv(dyn);
  if(w.sc.flag){for(const back of [330,170]){const p=makeFlagPost(w.sc.flag==='double');placeObj(p,wrapS(w.hazards[0].s-back),-(WALL+0.7),Math.PI/2,3.4);dyn.add(p);flagPosts.push(p);}}
}

/* ================= HUD: conformal outlines + nav radar ================= */
const hud=$('hud'), hc=hud.getContext('2d');
const HUDC='#CFF6FF', CAU='#FFC247', DAN='#FF4B3A';
let cw=960,ch=540,dpr=1;
/*HUD>*/
function rr(c,x,y,w,h,r){r=Math.min(r,w/2,h/2);c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();}
function hazIcon(c,type,x,y,s,col,solid,ink){
  c.save();c.translate(x,y);c.lineJoin='round';c.lineWidth=Math.max(1.4,s*0.09);c.strokeStyle=col;c.fillStyle=col;
  c.beginPath();c.moveTo(0,-s*0.62);c.lineTo(s*0.62,s*0.46);c.lineTo(-s*0.62,s*0.46);c.closePath();
  if(solid)c.fill();else c.stroke();
  const k2=ink||(solid?'#061016':col);c.fillStyle=k2;c.strokeStyle=k2;c.lineWidth=Math.max(1.2,s*0.07);const k=s*0.2;
  c.translate(0,s*0.1);
  if(type==='car'){c.fillRect(-k*1.1,-k*0.35,k*2.2,k*0.7);c.fillRect(-k*1.3,-k*0.75,k*0.45,k*0.4);c.fillRect(k*0.85,-k*0.75,k*0.45,k*0.4);c.fillRect(-k*1.3,k*0.35,k*0.45,k*0.4);c.fillRect(k*0.85,k*0.35,k*0.45,k*0.4);}
  else if(type==='tractor'){c.beginPath();c.moveTo(-k*0.9,k*0.9);c.lineTo(-k*0.9,-k*0.9);c.lineTo(k*0.9,-k*0.9);c.lineTo(k*0.9,k*0.1);c.stroke();c.beginPath();c.arc(k*0.9,k*0.45,k*0.35,-Math.PI/2,Math.PI*0.9);c.stroke();}
  else {c.beginPath();c.arc(0,-k*0.75,k*0.32,0,TAU);c.fill();c.beginPath();c.moveTo(0,-k*0.35);c.lineTo(0,k*0.4);c.moveTo(-k*0.7,-k*0.05);c.lineTo(k*0.7,-k*0.25);c.moveTo(0,k*0.4);c.lineTo(-k*0.55,k*1.05);c.moveTo(0,k*0.4);c.lineTo(k*0.6,k*0.95);c.stroke();}
  c.restore();
}
/*<HUD*/
/*HUD>*/
function carYaw(c,isP){return isP&&c.vx!=null&&world&&world.opts.driver==='drive'?c.psi:isP&&c.psi?c.psi:Math.atan2(c.latV+(c.slideV||0),Math.max(c.v,2));}
function headingAt(s,yaw){const F=trackFrame(s),cy=Math.cos(yaw),sy=Math.sin(yaw);return [F.tx*cy-F.tz*sy,F.tz*cy+F.tx*sy];}
function egoPose(w,raw){const P=w.player,yaw=carYaw(P,true),now=performance.now(),k=1-Math.exp(-Math.min(0.1,(now-(NAV.yawT||now))/1000)*5);NAV.yawT=now;
  NAV.yawS=NAV.yawS==null||Math.abs(yaw-NAV.yawS)>1?yaw:NAV.yawS+(yaw-NAV.yawS)*k;if(raw){const hd=headingAt(P.s,yaw),p=worldPos(P.s,P.lat);return {x:p.x,z:p.z,fx:hd[0],fz:hd[1]};}NAV.yawD=yaw-NAV.yawS;const hd=headingAt(P.s,NAV.yawS),p=worldPos(P.s,P.lat);return {x:p.x,z:p.z,fx:hd[0],fz:hd[1]};}
/*<HUD*/
const _p=new THREE.Vector3(),_pc=new THREE.Vector3();
// project a point on the track into the 3D driver view: [x, y, depth]
function projCam(s,lat,yOff){const p=worldPos(s,lat);_p.set(p.x,p.y+yOff,p.z);_pc.copy(_p).applyMatrix4(camera.matrixWorldInverse);if(_pc.z>-1.2)return null;_p.project(camera);return [(_p.x*0.5+0.5)*cw,(-_p.y*0.5+0.5)*ch,-_pc.z];}
/*HUD>*/
function bracket(c,x,y,s,col,dashed,u){
  c.strokeStyle=col;c.lineWidth=1.8*u;if(dashed)c.setLineDash([4*u,3*u]);const k=s*0.32;
  c.beginPath();
  c.moveTo(x-s,y-s+k);c.lineTo(x-s,y-s);c.lineTo(x-s+k,y-s);
  c.moveTo(x+s-k,y-s);c.lineTo(x+s,y-s);c.lineTo(x+s,y-s+k);
  c.moveTo(x+s,y+s-k);c.lineTo(x+s,y+s);c.lineTo(x+s-k,y+s);
  c.moveTo(x-s+k,y+s);c.lineTo(x-s,y+s);c.lineTo(x-s,y+s-k);c.stroke();c.setLineDash([]);
}
// conformal hazard brackets (and car target boxes in the driver's view); proj(s,lat,y) -> [x,y,depth]
function drawConformal(c,w,u,proj,targets){
  const P=w.player, items=[], f=ch/(2*Math.tan(60*Math.PI/360));
  if(targets)drawTargets(c,w,proj,u);
  for(const h of w.hazards){if(h.gone)continue;const d=dSigned(P.s,h.s);if(d>2&&d<460)items.push({s:h.s,lat:h.lat,y:h.height*0.55,d,hid:!h.vis,col:(w.alert===2&&h===w.near)?THREAT_COL.red:THREAT_COL.amber,sz:h.type==='marshal'?0.9:h.type==='tractor'?2.2:1.4});}
  c.save();
  for(const it of items){const q=proj(it.s,it.lat,it.y);if(!q)continue;const x=q[0],y=q[1];if(x<-40||x>cw+40||y<-40||y>ch+40)continue;
    const s=clamp(it.sz*f/q[2],7*u,70*u);
    bracket(c,x,y,s,it.col,it.hid,u);
    c.font=`700 ${10.5*u}px "B612 Mono", monospace`;c.fillStyle=it.col;c.textAlign='center';c.fillText(Math.round(it.d)+' M',x,y+s+13*u);}
  c.restore();
}
/*<HUD*/

// --- Projected nav HUD: light only, so everything is outline and glow (the HUD canvas is screen-blended) ---
/*HUD>*/
const NAV={zoom:1,cur:160,lz:1,big:false,rects:null};
const NC={map:'#F1F0EA',bld:'#E2E1D9',wall:'#9EA4AB',roadEdge:'#E09E36',road:'#F8CE66',route:'#C4238E',shield:'#2F5FAE',ink:'#15181C'};
const HC={pri:'#C4F8FF',mid:'rgba(196,248,255,.62)',dim:'rgba(196,248,255,.34)',faint:'rgba(196,248,255,.14)',amb:'#FFC247',red:'#FF5A48',glow:'rgba(110,225,255,.65)'};
function headerInfo(w){
  const P=w.player;
  if(w.near&&w.dNear<RANGE){const h=w.near;return {kind:'haz',dist:Math.max(0,w.dNear),text:h.label,col:w.alert===2?HC.red:HC.amb,h};}
  let best=null,bd=1e9;
  for(const c of CORNERS){const inC=dSigned(c.s0,P.s)>=0&&dSigned(P.s,c.s1)>0;const d=inC?0:dSigned(P.s,c.s0);if(d>=0&&d<bd){bd=d;best=c;}}
  if(!best) return {kind:'none',dist:0,text:'Straight',col:HC.pri};
  const a=Math.abs(best.angle)*180/Math.PI, side=best.sg>0?'right':'left', word=a>120?'Hairpin':a>70?'Sharp':a>35?'':'Kink';
  return {kind:'corner',dist:bd,text:word?word+' '+side:side,corner:best,col:HC.pri};
}
function shield(c,x,y,txt,u){
  c.save();c.font=`700 ${9.5*u}px "B612", sans-serif`;const tw=c.measureText(txt).width+9*u,th=14*u;
  rr(c,x-tw/2,y-th/2,tw,th,3*u);c.fillStyle=NC.shield;c.fill();c.lineWidth=1.2*u;c.strokeStyle='#fff';c.stroke();
  c.fillStyle='#fff';c.textAlign='center';c.textBaseline='middle';c.fillText(txt,x,y+0.5*u);c.restore();
}
function hudTag(c,x,y,txt,col,u,size){
  c.save();c.font=`700 ${(size||9.5)*u}px "B612 Mono", monospace`;const tw=c.measureText(txt).width+8*u,th=(size||9.5)*1.5*u;
  rr(c,x-tw/2,y-th/2,tw,th,2*u);c.strokeStyle=col;c.lineWidth=1.1*u;c.stroke();
  c.fillStyle=col;c.textAlign='center';c.textBaseline='middle';c.fillText(txt,x,y+0.5*u);c.restore();
}
// --- lap tracker: the whole lap as one line, every car a dot at its place on it (TV-graphics style)
const TRK_CODES=['ALP','BRV','CHL','DLT','ECH','FOX','GLF','HTL','IND','JLT','KLO','LIM','MKE','NOV','OSC','PAP','QUE','ROM','SRA','TNG'];
const TRK_COLS=['#d6dce2','#ff7a2a','#18c08f','#a970ff','#ffd02a','#4a9cff','#ff4f8e','#5fd068','#ff9a3a','#9fb4c0','#c46cff','#22d0e0'];
// call sign on a car's box: the tracker code on a dark tag with the driver's colour as a stripe
function callSign(w,car){const i=w.traffic.indexOf(car);return i<0?null:{code:TRK_CODES[i%TRK_CODES.length],col:TRK_COLS[i%TRK_COLS.length]};}
function drawCallSign(c,x,y,fs,cs){if(!cs||fs<6)return;c.save();c.font=`700 ${fs}px "B612 Mono", monospace`;
  const tw=c.measureText(cs.code).width,pw=fs*0.35,bw=tw+pw*2+fs*0.3,bh=fs*1.35,x0=x-bw/2,y0=y-bh/2;
  c.fillStyle='rgba(0,0,0,.62)';c.fillRect(x0,y0,bw,bh);c.fillStyle=cs.col;c.fillRect(x0,y0,fs*0.3,bh);
  c.fillStyle='#fff';c.textAlign='center';c.textBaseline='middle';c.fillText(cs.code,x+fs*0.15,y+fs*0.05);c.restore();}
function raceInfo(w){const P=w.player,pp=(P.lapc||0)*L+P.s;let pos=1,ahead=null,behind=null;
  for(const c of w.traffic){const pr=(c.lapc||0)*L+c.s;if(pr>pp){pos++;if(ahead==null||pr<ahead)ahead=pr;}else if(behind==null||pr>behind)behind=pr;}
  const v=Math.max(P.v,10);return {pos,n:w.traffic.length+1,lap:Math.max(1,Math.floor(pp/L)+1),ga:ahead==null?null:(ahead-pp)/v,gb:behind==null?null:(pp-behind)/v};}
function drawTracker(c,w,x,y,W,H,u,flash){
  const ri=raceInfo(w), mono=f=>`700 ${f}px "B612 Mono", monospace`;
  c.save();c.textBaseline='alphabetic';c.textAlign='left';
  // position block
  c.fillStyle=HC.pri;c.font=mono(H*0.44);const ptxt='P'+ri.pos;c.fillText(ptxt,x+4*u,y+H*0.52);
  const pw=c.measureText(ptxt).width;c.fillStyle=HC.mid;c.font=mono(H*0.2);c.fillText('/'+ri.n,x+6*u+pw,y+H*0.52);
  const nw=c.measureText('/'+ri.n).width;c.fillText('LAP '+ri.lap,x+4*u,y+H*0.86);
  const gx=x+10*u+pw+nw+8*u;c.font=mono(H*0.19);const bw=gx-x+c.measureText('▲ 10.0s').width+4*u;
  if(ri.ga!=null){c.fillStyle=ri.ga<1?HC.amb:HC.mid;c.fillText('▲ '+ri.ga.toFixed(1)+'s',gx,y+H*0.4);}
  if(ri.gb!=null){c.fillStyle=ri.gb<1?HC.amb:HC.mid;c.fillText('▼ '+ri.gb.toFixed(1)+'s',gx,y+H*0.74);}
  // the lap line
  const sx=x+bw+8*u, sw=W-bw-14*u, ly=y+H*0.52, X=s=>sx+(wrapS(s)/L)*sw;
  c.strokeStyle=HC.mid;c.lineWidth=2.2*u;c.lineCap='round';c.beginPath();c.moveTo(sx,ly);c.lineTo(sx+sw,ly);c.stroke();
  c.fillStyle=HC.pri;for(let k=0;k<4;k++){c.globalAlpha=k%2?0.35:1;c.fillRect(sx-1.5*u,ly-8*u+k*4*u,3*u,4*u);}c.globalAlpha=1;
  c.strokeStyle=HC.dim;c.lineWidth=1*u;for(const cn of CORNERS){const cx=X(cn.apex);c.beginPath();c.moveTo(cx,ly-3*u);c.lineTo(cx,ly+3*u);c.stroke();}
  for(const h of w.hazards){if(h.gone)continue;const hc2=w.alert===2&&h===w.near?HC.red:HC.amb;hazIcon(c,h.type,X(h.s),ly-11*u,11*u,hc2,flash);}
  // cars: dots, codes alternate above and below, labels that would collide are dropped
  const items=w.traffic.map((t,i)=>({x:X(t.s),col:TRK_COLS[i%TRK_COLS.length],code:TRK_CODES[i%TRK_CODES.length],hid:!t.vis,red:t.closing}));
  items.sort((a,b)=>a.x-b.x);
  const last=[-1e9,-1e9],pxY=X(w.player.s);c.font=mono(9*u);c.textAlign='center';
  items.forEach((it,k)=>{const r=4.2*u;c.beginPath();c.arc(it.x,ly,r,0,Math.PI*2);
    if(it.hid){c.strokeStyle=it.col;c.lineWidth=1.6*u;c.stroke();}else{c.fillStyle=it.col;c.fill();}
    if(it.red){c.strokeStyle=HC.red;c.lineWidth=1.6*u;c.beginPath();c.arc(it.x,ly,r+2.5*u,0,Math.PI*2);c.stroke();}
    const side=k%2, tw=c.measureText(it.code).width+3*u;
    if(it.x-tw/2>last[side]&&!(side===0&&Math.abs(it.x-pxY)<tw)){c.fillStyle=it.col;c.fillText(it.code,it.x,side?ly+r+11*u:ly-r-5*u);last[side]=it.x+tw/2;}});
  const px=X(w.player.s);c.fillStyle=HC.pri;c.beginPath();c.arc(px,ly,6*u,0,Math.PI*2);c.fill();
  c.strokeStyle='#000';c.lineWidth=1.5*u;c.stroke();c.strokeStyle=HC.pri;c.lineWidth=1.4*u;c.beginPath();c.arc(px,ly,9*u,0,Math.PI*2);c.stroke();
  c.fillStyle=HC.pri;c.font=mono(10*u);c.fillText('YOU',px,ly-13*u);
  c.restore();
}
// --- AR overlay pieces (conformal: drawn where things are in the view)
const THREAT_COL={red:'#FF4B3A',amber:'#FFC247',green:'#4BE37F',teal:'#39E6B4'};
function threatOf(w,c){const P=w.player,d=dSigned(P.s,c.s),dl=Math.abs(c.lat-P.lat),cl=P.v-c.v;
  if(d>0&&d<140&&dl<2.4&&((cl>3&&d/cl<3.2)||d<22))return 'red';
  if((d>0&&d<220&&dl<3.4)||Math.abs(d)<10||(!c.vis&&d>0&&d<220))return 'amber';
  return 'green';}
function laneLead(w){const P=w.player;let best=null,bd=1e9;for(const c of w.traffic){const d=dSigned(P.s,c.s);if(d>4&&d<220&&Math.abs(c.lat-P.lat)<2.6&&d<bd){bd=d;best=c;}}return best?{c:best,d:bd}:null;}
function drawLadder(c,w,proj,u){
  const P=w.player,lead=laneLead(w);if(!lead)return;const end=lead.d-5;if(end<8)return;
  const th=threatOf(w,lead.c),col=th==='red'?THREAT_COL.red:th==='amber'&&lead.d<60?THREAT_COL.amber:THREAT_COL.teal;
  c.save();c.fillStyle=col;
  for(let d=4;d<end;d+=4.5){const k=d/end,lat=lerp(P.lat,lead.c.lat,k),s0=P.s+d;
    const a=proj(s0,lat-0.95,0.03),b=proj(s0,lat+0.95,0.03),a2=proj(s0+1.5,lat-0.8,0.03),b2=proj(s0+1.5,lat+0.8,0.03),m=proj(s0+2.1,lat,0.03);
    if(!a||!b||!a2||!b2||!m)continue;c.globalAlpha=0.82*(1-k*0.55);
    c.beginPath();c.moveTo(a[0],a[1]);c.lineTo(b[0],b[1]);c.lineTo(b2[0],b2[1]);c.lineTo(m[0],m[1]);c.lineTo(a2[0],a2[1]);c.closePath();c.fill();}
  c.globalAlpha=1;
  const q=proj(P.s+end*0.42,lerp(P.lat,lead.c.lat,0.42)+1.1,0.03);
  if(q){const tx=q[0]+26*u,ty=q[1]-22*u,lab=Math.round(lead.d)+' m';c.strokeStyle=col;c.lineWidth=1.6*u;c.beginPath();c.moveTo(q[0]+4*u,q[1]);c.lineTo(q[0]+14*u,q[1]);c.lineTo(tx,ty);c.lineTo(tx+56*u,ty);c.stroke();
    c.fillStyle=col;c.font=`700 ${15*u}px "B612 Mono", monospace`;c.textAlign='left';c.textBaseline='bottom';c.fillText(lab,tx+4*u,ty-3*u);}
  c.restore();}
function arBracket(c,x0,y0,x1,y1,col,dashed,u,tri){
  const k=Math.max(5*u,Math.min((x1-x0),(y1-y0))*0.3);c.strokeStyle=col;c.lineWidth=2*u;if(dashed)c.setLineDash([4*u,3*u]);
  c.beginPath();c.moveTo(x0,y0+k);c.lineTo(x0,y0);c.lineTo(x0+k,y0);c.moveTo(x1-k,y0);c.lineTo(x1,y0);c.lineTo(x1,y0+k);
  c.moveTo(x1,y1-k);c.lineTo(x1,y1);c.lineTo(x1-k,y1);c.moveTo(x0+k,y1);c.lineTo(x0,y1);c.lineTo(x0,y1-k);c.stroke();c.setLineDash([]);
  if(tri){const cx=(x0+x1)/2,s=Math.max(7*u,Math.min(13*u,(x1-x0)*0.22));c.fillStyle=col;c.beginPath();c.moveTo(cx-s,y0-s*1.7);c.lineTo(cx+s,y0-s*1.7);c.lineTo(cx,y0-s*0.4);c.closePath();c.fill();}}
// hit boxes on other cars only within this straight-line radius of the player
const BOX_R=150;
function inBoxRange(P,t){const a=worldPos(P.s,P.lat),b=worldPos(t.s,t.lat);return Math.hypot(b.x-a.x,b.z-a.z)<=BOX_R;}
function drawTargets(c,w,proj,u){
  const P=w.player,labels=[];c.save();
  const order=w.traffic.map(t=>[dSigned(P.s,t.s),t]).filter(([d,t])=>d>=4&&inBoxRange(P,t)).sort((a,b)=>a[0]-b[0]);
  for(const [d,t] of order){
    const l=proj(t.s,t.lat-1.15,0),r=proj(t.s,t.lat+1.15,0),tp=proj(t.s,t.lat,1.25);if(!l||!r||!tp)continue;
    let x0=Math.min(l[0],r[0]),x1=Math.max(l[0],r[0]),y1=Math.max(l[1],r[1]),y0=tp[1];const minW=12*u;if(x1-x0<minW){const m=(x0+x1)/2;x0=m-minW/2;x1=m+minW/2;}if(y1-y0<minW*0.6)y0=y1-minW*0.6;
    const pad=(x1-x0)*0.12,col=THREAT_COL[threatOf(w,t)];arBracket(c,x0-pad,y0-pad,x1+pad,y1+pad*0.5,col,!t.vis,u,true);
    drawCallSign(c,(x0+x1)/2,(y0+y1)/2,clamp((x1-x0)*0.22,8*u,15*u),callSign(w,t));
    // distance sits on top of the box, above the marker
    const tri=Math.max(7*u,Math.min(13*u,(x1-x0+2*pad)*0.22)),lab=Math.round(d)+' m',fs=Math.round(clamp(13*u*(1.2-d/400),10*u,15*u));
    c.font=`700 ${fs}px "B612 Mono", monospace`;c.textAlign='center';c.textBaseline='bottom';const lx=(x0+x1)/2,ly=y0-pad-tri*1.7-3*u,lw=c.measureText(lab).width+4*u,box=[lx-lw/2,ly-fs,lx+lw/2,ly];
    if(!labels.some(b=>box[0]<b[2]&&box[2]>b[0]&&box[1]<b[3]&&box[3]>b[1])){labels.push(box);c.fillStyle=col;c.fillText(lab,lx,ly);}}
  c.restore();}
// phone AR and phone screen mirror: pinhole camera at driver eye height
// cam: {pitch (rad, tilted down +), roll (rad, + turns the picture clockwise; the phone passes the horizon angle it
//       measures), hfov (deg, of the video), vw, vh (video size), camH (m), yawOff (rad), eyeX (m, stereo eye offset
//       to the right), rawYaw (follow the car's
//       heading exactly like the game's cockpit camera, instead of the smoothed heading)}
function arCamera(w,Wd,Hd,cam){
  const E0=egoPose(w,cam.rawYaw),ex=cam.eyeX||0,E={x:E0.x-E0.fz*ex,z:E0.z+E0.fx*ex,fx:E0.fx,fz:E0.fz},rx=-E.fz,rz=E.fx,sc=cam.vw?Math.max(Wd/cam.vw,Hd/cam.vh):1,fv=((cam.vw||Wd)/2)/Math.tan(cam.hfov*Math.PI/360),f=fv*sc;
  const ct=Math.cos(cam.pitch),st=Math.sin(cam.pitch),cy2=Math.cos(cam.yawOff||0),sy2=Math.sin(cam.yawOff||0),cr=Math.cos(cam.roll||0),sr=Math.sin(cam.roll||0),cx=Wd/2,cy=Hd/2,camH=cam.camH,NEAR=0.8;
  // camera coordinates [right, up, depth]
  const toCam=(x,z,yOff)=>{const dx=x-E.x,dz=z-E.z;let rt=dx*rx+dz*rz,fw=dx*E.fx+dz*E.fz;const r2=rt*cy2-fw*sy2;fw=fw*cy2+rt*sy2;rt=r2;const y=yOff-camH;return [rt,y*ct+fw*st,fw*ct-y*st];};
  const toScr=q=>{const X=f*q[0]/q[2],Y=-f*q[1]/q[2];return [cx+X*cr-Y*sr,cy+X*sr+Y*cr,q[2]];};
  const projXZ=(x,z,yOff)=>{const q=toCam(x,z,yOff);return q[2]<NEAR?null:toScr(q);};
  // a 3D segment cut at the near plane, so boxes right beside you stay drawn instead of vanishing
  const seg=(a,b)=>{if(a[2]<NEAR&&b[2]<NEAR)return null;
    if(a[2]<NEAR){const k=(NEAR-a[2])/(b[2]-a[2]);a=[a[0]+(b[0]-a[0])*k,a[1]+(b[1]-a[1])*k,NEAR];}
    else if(b[2]<NEAR){const k=(NEAR-b[2])/(a[2]-b[2]);b=[b[0]+(a[0]-b[0])*k,b[1]+(a[1]-b[1])*k,NEAR];}
    return [toScr(a),toScr(b)];};
  const hy=-f*Math.tan(cam.pitch),hl=Math.hypot(Wd,Hd),horizon=[[cx-hl*cr-hy*sr,cy-hl*sr+hy*cr],[cx+hl*cr-hy*sr,cy+hl*sr+hy*cr]];
  return {E,f,toCam,toScr,seg,projXZ,proj:(s,lat,yOff)=>{const p=worldPos(s,lat);return projXZ(p.x,p.z,yOff);},horizonY:cy+hy,horizon};
}
function arBox(c,A,x,z,hx,hz,halfL,halfW,hgt,col,dashed,u,fill){
  // eight corners of an oriented box on the road, twelve edges (each cut at the near plane), translucent footprint
  const rx=-hz,rz=hx,Q=[];
  for(const [a,b] of [[halfL,halfW],[halfL,-halfW],[-halfL,-halfW],[-halfL,halfW]])for(const y of [0,hgt])Q.push(A.toCam(x+hx*a+rx*b,z+hz*a+rz*b,y));
  if(Q.every(q=>q[2]<0.8))return null;
  const B=[0,2,4,6],T=[1,3,5,7];
  c.save();c.strokeStyle=col;c.lineWidth=1.8*u;c.lineJoin='round';c.lineCap='round';if(dashed)c.setLineDash([4*u,3*u]);
  if(fill&&B.every(i=>Q[i][2]>=0.8)){c.fillStyle=fill;c.beginPath();B.forEach((i,k)=>{const p=A.toScr(Q[i]);k?c.lineTo(p[0],p[1]):c.moveTo(p[0],p[1]);});c.closePath();c.fill();}
  c.beginPath();
  for(let k=0;k<4;k++)for(const [i,j] of [[B[k],B[(k+1)%4]],[T[k],T[(k+1)%4]],[B[k],T[k]]]){const sg=A.seg(Q[i],Q[j]);if(sg){c.moveTo(sg[0][0],sg[0][1]);c.lineTo(sg[1][0],sg[1][1]);}}
  c.stroke();c.restore();
  const tc=A.toCam(x,z,hgt);if(tc[2]<0.8)return null;const p=A.toScr(tc);let top=p[1];
  for(const i of T)if(Q[i][2]>=0.8){const q=A.toScr(Q[i]);if(q[1]<top)top=q[1];}
  return {x:p[0],y:top};
}
// drivable surface, track edges, walls and kerbs on the ground plane
// The road as the driver would read it through AR / VR: a dark asphalt surface, barriers as low panels,
// dashes along the middle that stream past with speed, bright edges, red/white kerbs, chevron boards before corners.
function arGround(c,A,P0,u,fill){
  const proj=A.proj,s0=P0.s,ds=[];for(let d=1;d<=240;d+=d<30?1.5:d<90?3:6)ds.push(d);
  const fa=d=>Math.max(0.1,1-d/255),quad=(p,q,r,t)=>{c.beginPath();c.moveTo(p[0],p[1]);c.lineTo(q[0],q[1]);c.lineTo(r[0],r[1]);c.lineTo(t[0],t[1]);c.closePath();};
  const lw=(base,d)=>Math.max(1*u,base*u*14/(Math.max(d,2)+10));
  c.save();c.lineCap='round';
  // asphalt
  if(fill)for(let i=1;i<ds.length;i++){const d0=ds[i-1],d1=ds[i],a=proj(s0+d0,-HW,0),b=proj(s0+d0,HW,0),e=proj(s0+d1,HW,0),f=proj(s0+d1,-HW,0);if(!a||!b||!e||!f)continue;
    c.fillStyle=`rgba(18,24,32,${0.5*fa(d0)})`;quad(a,b,e,f);c.fill();}
  // barriers: a 1 m panel on each side (gaps where the track opens up are left out)
  for(const sg of [-1,1])for(let i=1;i<ds.length;i++){const d0=ds[i-1],d1=ds[i],idx=Math.floor(wrapS(s0+d0)/DS)%N;if(WGL&&WGR&&(sg<0?WGL[idx]:WGR[idx]))continue;
    const a=proj(s0+d0,sg*WALL,0),b=proj(s0+d0,sg*WALL,1),e=proj(s0+d1,sg*WALL,1),f=proj(s0+d1,sg*WALL,0);if(!a||!b||!e||!f)continue;
    c.fillStyle=`rgba(150,185,210,${0.16*fa(d0)})`;quad(a,b,e,f);c.fill();c.strokeStyle=`rgba(190,215,235,${0.7*fa(d0)})`;c.lineWidth=lw(3,d0);c.beginPath();c.moveTo(b[0],b[1]);c.lineTo(e[0],e[1]);c.stroke();}
  // centre dashes, fixed to the road so they stream past: 3 m on, 6 m off
  c.strokeStyle='rgba(235,248,255,.55)';
  for(let sd=Math.ceil((s0+2)/9)*9;sd<s0+200;sd+=9){const d=sd-s0,a=proj(sd,0,0.01),b=proj(sd+3,0,0.01);if(!a||!b)continue;c.globalAlpha=fa(d);c.lineWidth=lw(5,d);c.beginPath();c.moveTo(a[0],a[1]);c.lineTo(b[0],b[1]);c.stroke();}
  c.globalAlpha=1;
  // track edges
  for(const sg of [-1,1]){let prev=null;c.strokeStyle='rgba(240,250,255,.95)';
    for(let d=-4;d<=240;d+=d<40?2:5){const q=proj(s0+d,sg*HW,0);if(!q){prev=null;continue;}
      if(prev){c.globalAlpha=fa(d);c.lineWidth=lw(10,d);c.beginPath();c.moveTo(prev[0],prev[1]);c.lineTo(q[0],q[1]);c.stroke();}prev=q;}}
  c.globalAlpha=1;
  // kerbs, and chevron boards on the outside barrier before each corner
  for(const cn of CORNERS){const d0=dSigned(s0,cn.s0),d1=dSigned(s0,cn.s1);if(d1<0||d0>240)continue;const lat=cn.sg*(HW-0.55);
    for(let d=Math.max(2,d0-10),k=Math.round(Math.max(2,d0-10)/1.5);d<=Math.min(240,d1+10);d+=1.5,k++){const a=proj(s0+d,lat,0),b=proj(s0+d+1.5,lat,0);if(!a||!b)continue;
      c.strokeStyle=k%2?'rgba(255,70,60,.9)':'rgba(255,255,255,.9)';c.lineWidth=Math.max(1.5*u,14*u*14/(d+10));c.globalAlpha=fa(d);c.beginPath();c.moveTo(a[0],a[1]);c.lineTo(b[0],b[1]);c.stroke();}
    c.globalAlpha=1;
    for(let j=0;j<3;j++){const sb=cn.s0-8+j*9,d=dSigned(s0,sb);if(d<6||d>200)continue;const lo=-cn.sg*(WALL-0.25);
      const bl=proj(sb,lo,0.5),tl=proj(sb,lo,1.7),br=proj(sb+4,lo,0.5),tr=proj(sb+4,lo,1.7);if(!bl||!tl||!br||!tr)continue;
      c.globalAlpha=fa(d);c.fillStyle='rgba(20,20,24,.85)';quad(bl,br,tr,tl);c.fill();
      const cx=(bl[0]+br[0]+tl[0]+tr[0])/4,cy=(bl[1]+br[1]+tl[1]+tr[1])/4,h=Math.abs(bl[1]-tl[1])*0.32,sgn=cn.sg>0?1:-1;
      c.strokeStyle='#FFC247';c.lineWidth=Math.max(1.5*u,h*0.35);c.lineJoin='miter';
      for(const off of [-0.55,0.55]){c.beginPath();c.moveTo(cx+(off-0.3*sgn)*h,cy-h);c.lineTo(cx+(off+0.3*sgn)*h,cy);c.lineTo(cx+(off-0.3*sgn)*h,cy+h);c.stroke();}
      c.globalAlpha=1;}}
  c.restore();
}
function radarMarks(c,w,A,u){
  // what the on-board radar is tracking, as small diamonds on the road at the radar's own position estimate
  const RD=w.radar;if(!RD)return;c.save();c.strokeStyle='#39E6B4';c.lineWidth=1.5*u;
  for(const T of RD.tracks){if(!T.conf||T.barrier)continue;const q=A.projXZ(T.x,T.z,0.05);if(!q)continue;const r=clamp(A.f*0.8/q[2],3.5*u,12*u);
    c.globalAlpha=T.obj?0.95:0.6;c.beginPath();c.moveTo(q[0],q[1]-r*0.6);c.lineTo(q[0]+r,q[1]);c.lineTo(q[0],q[1]+r*0.6);c.lineTo(q[0]-r,q[1]);c.closePath();c.stroke();}
  c.restore();}
function drawARView(c,w,t,u,Wd,Hd,cam){
  const A=arCamera(w,Wd,Hd,cam),P0=w.player;
  c.save();
  arGround(c,A,P0,u,true);
  arFlags(c,w,A,P0,u);
  // cars as 3D boxes, far to near so near ones draw on top; distance on top of each box
  const items=[];
  w.traffic.forEach((tr,i)=>{const d=dSigned(P0.s,tr.s);if(d>-6&&inBoxRange(P0,tr))items.push({d,tr,key:'c'+i});});
  w.hazards.forEach((h,i)=>{if(h.gone)return;const d=dSigned(P0.s,h.s);if(d>-4&&d<400)items.push({d,h,key:'h'+i});});
  items.sort((a,b)=>b.d-a.d);
  const tops=[];
  for(const it of items){
    if(it.tr){const t2=it.tr,p=worldPos(t2.s,t2.lat),hd=headingAt(t2.s,carYaw(t2)),col=THREAT_COL[threatOf(w,t2)];
      const top=arBox(c,A,p.x,p.z,hd[0],hd[1],2.7,0.95,0.95,col,!t2.vis,u,t2.vis?'rgba(255,255,255,.06)':null);
      {const q=A.projXZ(p.x,p.z,0.48);if(q)drawCallSign(c,q[0],q[1],clamp(A.f*0.55/q[2],8*u,16*u),callSign(w,t2));}
      if(top&&it.d>3)tops.push({d:it.d,col,top,key:it.key,lab:Math.round(it.d)+' m'});}
    else{const h=it.h,p=worldPos(h.s,h.lat),hd=headingAt(h.s,h.yaw||0),col=w.alert===2&&h===w.near?THREAT_COL.red:THREAT_COL.amber;
      const top=arBox(c,A,p.x,p.z,hd[0],hd[1],h.halfLen,h.halfW,h.height,col,!h.vis,u,'rgba(255,194,71,.14)');
      if(top){hazIcon(c,h.type,top.x,top.y-18*u,16*u,col,true);tops.push({d:it.d,col,top:{x:top.x,y:top.y-30*u},key:it.key,lab:h.label.toUpperCase()+' '+Math.round(Math.max(0,it.d))+' m'});}}
  }
  radarMarks(c,w,A,u);
  // labels: the ones shown last frame keep priority (no flicker between two overlapping labels), then nearest first
  const was=NAV.arLab||new Set(),now=new Set(),labels=[];
  tops.sort((a,b)=>(was.has(b.key)-was.has(a.key))||a.d-b.d);c.textAlign='center';c.textBaseline='bottom';
  for(const T of tops){const fs=Math.round(clamp(14*u*(1.2-T.d/400),10*u,16*u));c.font=`700 ${fs}px "B612 Mono", monospace`;
    const lw=c.measureText(T.lab).width+6*u,box=[T.top.x-lw/2,T.top.y-6*u-fs,T.top.x+lw/2,T.top.y-6*u];
    if(labels.some(b=>box[0]<b[2]&&box[2]>b[0]&&box[1]<b[3]&&box[3]>b[1]))continue;labels.push(box);now.add(T.key);
    c.fillStyle='rgba(0,0,0,.45)';c.fillRect(box[0],box[1],lw,fs+2*u);c.fillStyle=T.col;c.fillText(T.lab,T.top.x,T.top.y-5*u);}
  NAV.arLab=now;
  c.restore();
  return A;}
// phone screen mirror: the game screen's HUD layout (target boxes, hazard brackets, nav panel, lap tracker,
// pedals) plus the track edges, drawn from the same camera as the game's driver view, with no 3D picture
// the game's actual render camera (position and quaternion from three.js, 60 degree vertical FOV): used when the
// phone draws over the sim picture, so the overlay matches the 3D view exactly (slope, braking dip, eye offset, chase)
function gameCamera(cm,Wd,Hd){const [px,py,pz,qx,qy,qz,qw]=cm,f=(Hd/2)/Math.tan(30*Math.PI/180),cx=Wd/2,cy=Hd/2;
  const toCam=(x,y,z)=>{const dx=x-px,dy=y-py,dz=z-pz,ix=qw*dx-qy*dz+qz*dy,iy=qw*dy-qz*dx+qx*dz,iz=qw*dz-qx*dy+qy*dx,iw=qx*dx+qy*dy+qz*dz;   // rotate by the inverse quaternion
    return [ix*qw+iw*qx+iy*qz-iz*qy,iy*qw+iw*qy+iz*qx-ix*qz,iz*qw+iw*qz+ix*qy-iy*qx];};
  const projXYZ=(x,y,z)=>{const c=toCam(x,y,z),dep=-c[2];if(dep<0.3)return null;return [cx+f*c[0]/dep,cy-f*c[1]/dep,dep];};
  return {f,proj:(s,lat,yOff)=>{const p=worldPos(s,lat);return projXYZ(p.x,p.y+yOff,p.z);}};}
function drawScreen(c,w,t,dt,overlay){
  const u=clamp(Math.min(cw/1100,ch/620),0.55,1.4),A=w.cm?gameCamera(w.cm,cw,ch):arCamera(w,cw,ch,{pitch:0.035,hfov:2*Math.atan(Math.tan(30*Math.PI/180)*cw/ch)*180/Math.PI,camH:1.0,yawOff:0,rawYaw:true});
  c.save();arGround(c,A,w.player,u,false);arFlags(c,w,A,w.player,u);c.restore();
  if(w.opts.hud!==false){
    const R=navRegion(u),pd=22*u;if(!overlay){c.save();c.translate(R.x+R.w/2,R.y+R.h/2);c.scale(R.w/2+pd,R.h/2+pd);
    const g=c.createRadialGradient(0,0,0,0,0,1);g.addColorStop(0,'rgba(3,9,13,.5)');g.addColorStop(0.7,'rgba(3,9,13,.34)');g.addColorStop(1,'rgba(3,9,13,0)');c.fillStyle=g;c.fillRect(-1,-1,2,2);c.restore();}
    drawConformal(c,w,u,A.proj,true);drawNav(c,w,t,dt,u);
    {const th=clamp(ch*0.09,40,90);c.save();c.globalAlpha=0.95;drawTracker(c,w,cw*0.05,Math.max(ch*0.1,60*u),Math.min(cw*0.56,cw-R.w-cw*0.1),th,u,RM?true:((t*3)%1)<0.6);c.restore();}}
  if(!overlay)drawPedals(c,w,u);
}
function navRegion(u){
  const w=Math.round(clamp(cw*(NAV.big?0.5:0.34),190,NAV.big?640:450)), h=Math.round(Math.min(w*1.0,ch*0.84));
  return {x:cw-w-Math.max(12,cw*0.045), y:Math.max(12,ch*0.1), w, h:Math.min(h,ch*0.78)};
}
function drawNav(c,w,t,dt,u,Rin,fixedRange){
  const P=w.player, R=Rin||navRegion(u), hi=headerInfo(w), flash=RM?true:((t*3)%1)<0.6;
  if(!Rin)NAV.rects={panel:[R.x,R.y,R.w,R.h]};
  c.save();c.lineCap='round';c.lineJoin='round';
  const col=hi.col;
  // --- flat top-down radar, heading up, like a sim-racing proximity radar: your car low in the frame so more of the
  // road ahead fits, range rings from your car, everything drawn to scale, side bars when a car is alongside.
  // The range zooms in when cars are close and out at speed.
  const bb=fixedRange?0:Math.round(R.h*0.13), mx=R.x, my=R.y, mw=R.w, mh=R.h-bb;
  let ahead=clamp(60+P.v*2.2,90,300);
  if(w.near&&w.dNear<300) ahead=clamp(w.dNear+40,80,320);
  let side=false; for(const tc of w.traffic){const d=dSigned(P.s,tc.s); if(d>-25&&d<40){side=true;break;}}
  if(side) ahead=Math.min(ahead,55);
  ahead*=NAV.zoom; const kk=dt>0?1-Math.exp(-dt*2.4):0;
  if(!fixedRange)NAV.cur=lerp(NAV.cur,ahead,kk);
  const A=fixedRange||NAV.cur, cx=mx+mw/2, ye=my+mh*0.7, K=(ye-(my+mh*0.03))/A, minFw=-(my+mh-ye)/K, dmax=A*1.05;
  const E=egoPose(w), rx=-E.fz, rz=E.fx;
  const loc=(x,z)=>{const dx=x-E.x,dz=z-E.z;return [dx*rx+dz*rz,dx*E.fx+dz*E.fz];};
  const pr=(rt,fw)=>[cx+rt*K,ye-fw*K];
  const fade=fw=>1-0.7*clamp((fw-A*0.6)/(A*0.5),0,1);
  // radar face: a dark rounded square with range rings centred on your car
  c.save();rr(c,mx,my,mw,mh,12*u);c.fillStyle='rgba(4,8,12,.55)';c.fill();c.strokeStyle=HC.faint;c.lineWidth=1*u;c.stroke();c.clip();
  const ring=[10,25,50,100,200].find(v=>v*K>=mh*0.2)||200;
  c.font=`${8.5*u}px "B612 Mono", monospace`;c.textAlign='left';c.textBaseline='bottom';c.lineWidth=1*u;
  for(let r=ring;r<A*1.25;r+=ring){c.strokeStyle='rgba(196,248,255,.1)';c.beginPath();c.arc(cx,ye,r*K,0,TAU);c.stroke();c.fillStyle=HC.dim;c.fillText(r+' M',cx+4*u,ye-r*K-2*u);}
  c.strokeStyle='rgba(196,248,255,.07)';c.beginPath();c.moveTo(cx,my);c.lineTo(cx,my+mh);c.moveTo(mx,ye);c.lineTo(mx+mw,ye);c.stroke();
  const st=Math.max(1,A/120);
  // flag sections: marshal sectors under a yellow or red flag, shaded across the track, flag at each sector start
  if(w.flags&&w.secLen){const n=w.flags.length,sl=w.secLen;
    for(let k=0;k<n;k++){const f=w.flags[k];if(!f)continue;const d0=dSigned(P.s,k*sl),d1=d0+sl;if(d1<minFw-10||d0>dmax)continue;
      const Lp=[],Rp=[];for(let d=Math.max(d0,minFw-10);d<=Math.min(d1,dmax)+0.01;d+=st){const a=worldPos(P.s+d,-HW),b=worldPos(P.s+d,HW),la=loc(a.x,a.z),lb=loc(b.x,b.z);Lp.push(pr(la[0],la[1]));Rp.push(pr(lb[0],lb[1]));}
      if(Lp.length>1){c.fillStyle=f===2?'rgba(255,59,47,.4)':'rgba(255,194,71,.32)';c.beginPath();Lp.forEach((q,i)=>i?c.lineTo(q[0],q[1]):c.moveTo(q[0],q[1]));for(let i=Rp.length-1;i>=0;i--)c.lineTo(Rp[i][0],Rp[i][1]);c.closePath();c.fill();}
      if(d0>=minFw&&d0<=dmax){const p=worldPos(k*sl,HW+2.5),l=loc(p.x,p.z),q=pr(l[0],l[1]);flagIcon(c,q[0],q[1],f,7*u);}}}
  const strip=(latF,colr,lw,dash,glow)=>{
    const bands=[[],[],[],[]];let prev=null;
    for(let d=minFw-8;d<=dmax;d+=st){const p=worldPos(P.s+d,latF(d)),l=loc(p.x,p.z);if(l[1]<minFw){prev=null;continue;}const q=pr(l[0],l[1]);
      if(prev){const b=Math.min(3,Math.floor((1-fade(l[1]))*4));bands[b].push(prev[0],prev[1],q[0],q[1]);}prev=q;}
    if(dash)c.setLineDash(dash);
    for(const pass of glow?[0,1]:[1]){c.strokeStyle=colr;c.lineWidth=pass?lw:lw*3.2;
      bands.forEach((seg,b)=>{if(!seg.length)return;c.globalAlpha=(1-b*0.26)*(pass?1:0.18);c.beginPath();
        for(let i=0;i<seg.length;i+=4){c.moveTo(seg[i],seg[i+1]);c.lineTo(seg[i+2],seg[i+3]);}c.stroke();});}
    c.globalAlpha=1;c.setLineDash([]);};
  strip(()=>-WALL,HC.faint,1*u); strip(()=>WALL,HC.faint,1*u);
  strip(()=>-HW,HC.mid,1.8*u,null,true); strip(()=>HW,HC.mid,1.8*u,null,true);
  // on-board radar: field-of-view edges, this scan's raw returns (barrier returns faint), confirmed tracks as diamonds
  const RD=w.radar;
  if(RD&&RD.ox!=null){const O=loc(RD.ox,RD.oz),RT='57,230,180';c.lineWidth=1*u;c.setLineDash([2*u,4*u]);
    for(const [hf,rm] of [[9,Math.min(250,RD.rng||250)],[45,80]])for(const sg of [-1,1]){const a=sg*hf*Math.PI/180+(NAV.yawD||0),seg=[];
      for(let r=2;r<=rm;r+=Math.max(2,rm/40)){const fw=O[1]+r*Math.cos(a);if(fw>dmax)break;seg.push(pr(O[0]+r*Math.sin(a),fw));}
      if(seg.length>1){c.strokeStyle=`rgba(${RT},.32)`;c.beginPath();seg.forEach((q,k)=>k?c.lineTo(q[0],q[1]):c.moveTo(q[0],q[1]));c.stroke();}}
    c.setLineDash([]);
    for(const d of RD.dets){const l=loc(d.x,d.z);if(l[1]<minFw||l[1]>dmax)continue;const q=pr(l[0],l[1]),r=(d.st?1.3:2)*u;
      c.fillStyle=d.st?`rgba(${RT},.35)`:`rgba(${RT},.9)`;c.fillRect(q[0]-r,q[1]-r,2*r,2*r);}
    for(const T of RD.tracks){if(!T.conf||T.barrier)continue;const l=loc(T.x,T.z);if(l[1]<minFw||l[1]>dmax)continue;const q=pr(l[0],l[1]),r=4.5*u;
      c.strokeStyle=T.obj?`rgb(${RT})`:HC.amb;c.lineWidth=1.5*u;c.beginPath();c.moveTo(q[0],q[1]-r);c.lineTo(q[0]+r,q[1]);c.lineTo(q[0],q[1]+r);c.lineTo(q[0]-r,q[1]);c.closePath();c.stroke();}}

  // corner labels
  for(const cn of CORNERS){const d=dSigned(P.s,cn.apex);if(d<0||d>dmax)continue;const p=worldPos(cn.apex,-cn.sg*(WALL+5)),l=loc(p.x,p.z);if(l[1]<minFw)continue;const q=pr(l[0],l[1]);c.globalAlpha=fade(l[1]);hudTag(c,q[0],q[1],'T'+cn.n,HC.mid,u,8.5);c.globalAlpha=1;}
  // footprints in perspective
  const poly=(rt0,fw0,hr,hf,aL,aW,oa,ob)=>{const pts=[];for(const [a,b] of [[aL,aW],[aL,-aW],[-aL,-aW],[-aL,aW]]){const A2=a+(oa||0),B2=b+(ob||0);const rt=rt0+hr*A2+hf*B2,fw=fw0+hf*A2-hr*B2;if(fw<minFw)return null;pts.push(pr(rt,fw));}return pts;};
  const shape=(pts,stroke,fill,lw,dash)=>{if(!pts)return;c.beginPath();pts.forEach((q,k)=>k?c.lineTo(q[0],q[1]):c.moveTo(q[0],q[1]));c.closePath();if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=lw;if(dash)c.setLineDash(dash);c.stroke();c.setLineDash([]);}};
  // car icons keep a readable minimum size at long range (positions stay to scale)
  const cs=Math.max(1,16*u/(5.4*K)),pc=(rt0,fw0,hr,hf,aL,aW,oa,ob)=>poly(rt0,fw0,hr,hf,aL*cs,aW*cs,(oa||0)*cs,(ob||0)*cs);
  const car=(rt0,fw0,hr,hf,colr,mode)=>{
    if(mode!=='hidden'){for(const [a,b] of [[1.75,0.84],[1.75,-0.84],[-1.6,0.84],[-1.6,-0.84]])shape(pc(rt0,fw0,hr,hf,0.36,0.2,a,b),null,colr,0);
      shape(pc(rt0,fw0,hr,hf,0.05,0.95,2.7,0),null,colr,0);}
    shape(pc(rt0,fw0,hr,hf,2.55,0.5),colr,mode==='hidden'?null:(mode==='ego'?'rgba(196,248,255,.3)':'rgba(196,248,255,.14)'),1.6*u,mode==='hidden'?[3*u,2.5*u]:null);
    if(mode==='ego')shape(pc(rt0,fw0,hr,hf,0.5,0.28,1.5,0),null,colr,0);};
  const lh2=(x,z,hx,hz)=>{const l=loc(x,z);return [l[0],l[1],hx*rx+hz*rz,hx*E.fx+hz*E.fz];};
  for(const h of w.hazards){if(h.gone)continue;const d=dSigned(P.s,h.s);if(d<-20||d>RANGE)continue;
    const p=worldPos(h.s,h.lat),hd=headingAt(h.s,h.yaw||0),L2=lh2(p.x,p.z,hd[0],hd[1]),hcol=w.alert===2&&h===w.near?HC.red:HC.amb;
    if(L2[1]<=dmax){shape(poly(L2[0],L2[1],L2[2],L2[3],h.halfLen,h.halfW),hcol,flash?'rgba(255,194,71,.28)':null,1.8*u);
      const q=pr(L2[0],L2[1]),s=clamp(K*5,12*u,24*u);hazIcon(c,h.type,q[0],q[1]-s*0.9,s,hcol,flash);
      c.fillStyle=hcol;c.font=`700 ${9.5*u}px "B612 Mono", monospace`;c.textAlign='center';c.textBaseline='alphabetic';c.fillText(Math.round(d)+' M',q[0],q[1]-s*1.75);}
    else{const txt=`▲ ${h.label.toUpperCase()} ${Math.round(d)} M`;hudTag(c,cx,my+12*u,txt,hcol,u,9.5);}}
  for(const tc of w.traffic){const d=dSigned(P.s,tc.s);if(d<minFw-6||d>dmax)continue;const p=worldPos(tc.s,tc.lat),hd=headingAt(tc.s,carYaw(tc)),L2=lh2(p.x,p.z,hd[0],hd[1]);
    c.globalAlpha=fade(L2[1]);car(L2[0],L2[1],L2[2],L2[3],tc.closing?HC.red:HC.pri,tc.vis?'solid':'hidden');
    {const q=pr(L2[0],L2[1]);drawCallSign(c,q[0],q[1],clamp(5.4*K*cs*0.3,7*u,11*u),callSign(w,tc));}c.globalAlpha=1;}
  car(0,0,Math.sin(NAV.yawD||0),Math.cos(NAV.yawD||0),HC.pri,'ego');
  drawFlagChip(c,w,P.s,mx+8*u,my+8*u,u);
  // side bars: a car overlapping you lights the bar on its side, amber, red when there is little room
  for(const sg of [-1,1]){let gap=null;
    for(const tc of w.traffic){const d=dSigned(P.s,tc.s),dl=tc.lat-P.lat;if(Math.abs(d)<6&&Math.sign(dl)===sg&&Math.abs(dl)<5){const g=Math.abs(dl)-2;if(gap==null||g<gap)gap=g;}}
    if(gap==null)continue;const bh2=mh*0.34;c.fillStyle=gap<0.6?HC.red:HC.amb;c.globalAlpha=0.9;rr(c,sg<0?mx+6*u:mx+mw-12*u,ye-bh2/2,6*u,bh2,3*u);c.fill();c.globalAlpha=1;}
  // wheel-to-wheel gap
  for(const tc of w.traffic){const d=dSigned(P.s,tc.s);if(Math.abs(d)>6.5)continue;const dl=tc.lat-P.lat,sg=Math.sign(dl)||1,gap=Math.max(0,Math.abs(dl)-2.0);
    const fw=d*0.5,a=pr(sg*1.0,fw),b=pr(dl-sg*1.0,fw),colr=gap<0.6?HC.red:HC.amb;
    c.strokeStyle=colr;c.lineWidth=1.6*u;c.beginPath();c.moveTo(a[0],a[1]);c.lineTo(b[0],b[1]);c.moveTo(a[0],a[1]-5*u);c.lineTo(a[0],a[1]+5*u);c.moveTo(b[0],b[1]-5*u);c.lineTo(b[0],b[1]+5*u);c.stroke();
    c.fillStyle=colr;c.font=`700 ${11*u}px "B612 Mono", monospace`;c.textAlign='center';c.textBaseline='alphabetic';c.fillText(gap.toFixed(1)+' M',(a[0]+b[0])/2,a[1]-9*u);}
  c.restore();
  // --- bottom row: pass sign, visibility, radar status (not on the compact AR radar)
  if(!fixedRange){
  const by=R.y+R.h-bb, bh=bb*0.86, bw=Math.max(80*u,R.w*0.3);
  if(hi.kind==='haz'&&P.v>hi.h.vpass+2){const px=R.x+4*u,s=bh;c.strokeStyle=col;c.lineWidth=1.8*u;rr(c,px,by,s*0.9,s,4*u);c.stroke();
    c.fillStyle=col;c.textAlign='center';c.font=`700 ${s*0.18}px "B612 Mono", monospace`;c.fillText('PASS',px+s*0.45,by+s*0.24);c.font=`700 ${s*0.42}px "B612 Mono", monospace`;c.fillText(String(Math.round(hi.h.vpass*3.6)),px+s*0.45,by+s*0.64);}
  c.fillStyle=w.vis<120?HC.amb:HC.mid;c.textAlign='right';c.font=`700 ${10.5*u}px "B612 Mono", monospace`;c.fillText(`VIS ${Math.round(w.vis)} M`,R.x+R.w-4*u,by+bh*0.72);
  c.fillStyle=HC.dim;c.font=`${9*u}px "B612 Mono", monospace`;c.fillText(NAV.zoom===1?'AUTO RANGE':'RANGE ×'+(1/NAV.zoom).toFixed(1),R.x+R.w-4*u,by+bh*0.28);
  if(RD&&RD.rng){c.textAlign='center';c.fillStyle='rgba(57,230,180,.85)';c.font=`700 ${10*u}px "B612 Mono", monospace`;c.fillText(`RADAR ${Math.round(RD.rng)} M`,R.x+R.w*0.55,by+bh*0.72);
    c.fillStyle=HC.dim;c.font=`${9*u}px "B612 Mono", monospace`;c.fillText(`77 GHZ · −${RD.att.toFixed(1)} DB · ${RD.tracks.filter(T=>T.conf&&!T.barrier).length} TRK`,R.x+R.w*0.55,by+bh*0.28);}
  }
  c.textBaseline='alphabetic';
  c.restore();
}
// flags: the next flagged marshal sector within `range` m ahead ({f: 1 yellow / 2 red, d: metres, k: sector})
function nextFlag(w,s,range){if(!w.flags||!w.secLen)return null;const n=w.flags.length,sl=w.secLen,k0=Math.floor(wrapS(s)/sl)%n;
  for(let i=0;i<n;i++){const k=(k0+i)%n,f=w.flags[k];if(!f)continue;const d=i?dSigned(s,k*sl):0;if(d>range)return null;return {f,d:Math.max(0,d),k};}return null;}
const FLAG_COL=['','#FFC247','#FF3B2F'];
function flagIcon(c,x,y,f,s){c.save();c.strokeStyle='#E8EEF2';c.lineWidth=Math.max(1,s*0.1);c.beginPath();c.moveTo(x,y);c.lineTo(x,y-s*1.6);c.stroke();
  c.fillStyle=FLAG_COL[f];c.beginPath();c.moveTo(x,y-s*1.6);c.quadraticCurveTo(x+s*0.6,y-s*1.75,x+s*1.2,y-s*1.55);c.lineTo(x+s*1.2,y-s*0.85);c.quadraticCurveTo(x+s*0.6,y-s*1.05,x,y-s*0.9);c.closePath();c.fill();c.restore();}
function drawFlagChip(c,w,s,x,y,u){const nf=nextFlag(w,s,700);if(!nf)return;
  const txt=`${nf.f===2?'RED':'YELLOW'} · S${nf.k+1}${nf.d>1?' · '+Math.round(nf.d)+' M':''}`;c.save();c.font=`700 ${10.5*u}px "B612 Mono", monospace`;
  const tw=c.measureText(txt).width,bw=tw+30*u,bh=20*u;c.fillStyle='rgba(0,0,0,.55)';rr(c,x,y,bw,bh,4*u);c.fill();c.strokeStyle=FLAG_COL[nf.f];c.lineWidth=1.5*u;c.stroke();
  flagIcon(c,x+9*u,y+bh-4*u,nf.f,8*u);c.fillStyle=FLAG_COL[nf.f];c.textAlign='left';c.textBaseline='middle';c.fillText(txt,x+22*u,y+bh/2+0.5*u);c.restore();return bw;}
// AR / screen view: flagged sectors tinted on the road, flag posts on both barriers at the start of each sector
function arFlags(c,w,A,P0,u){if(!w.flags||!w.secLen)return;const n=w.flags.length,sl=w.secLen;c.save();
  for(let k=0;k<n;k++){const f=w.flags[k];if(!f)continue;const d0=dSigned(P0.s,k*sl),d1=d0+sl;if(d1<2||d0>240)continue;
    const L1=[],R1=[];for(let d=Math.max(d0,2);d<=Math.min(d1,240)+0.01;d+=d<40?2:4){const a=A.proj(P0.s+d,-HW,0.02),b=A.proj(P0.s+d,HW,0.02);if(a&&b){L1.push(a);R1.push(b);}}
    if(L1.length>1){c.fillStyle=f===2?'rgba(255,59,47,.26)':'rgba(255,194,71,.2)';c.beginPath();L1.forEach((p,i)=>i?c.lineTo(p[0],p[1]):c.moveTo(p[0],p[1]));for(let i=R1.length-1;i>=0;i--)c.lineTo(R1[i][0],R1[i][1]);c.closePath();c.fill();}
    if(d0>=2&&d0<=240)for(const sg of [-1,1]){const b=A.proj(P0.s+d0,sg*(WALL-0.2),0),t=A.proj(P0.s+d0,sg*(WALL-0.2),2.4);if(!b||!t)continue;
      flagIcon(c,t[0],b[1],f,clamp((b[1]-t[1])/1.6,4*u,40*u));}}
  c.restore();}
function drawPedals(c,w,u,speed){
  const P=w.player, x=cw/2, y=ch*0.93, showSpeed=speed||!w.opts.hud, drive=w.opts.driver==='drive';
  if(!showSpeed&&!drive)return;
  c.save();
  const bh=34*u, bw=5*u;
  if(drive){c.strokeStyle=HC.dim;c.lineWidth=1*u;c.strokeRect(x-38*u,y-bh,bw,bh);c.strokeRect(x+33*u,y-bh,bw,bh);
    c.fillStyle=HC.red;c.fillRect(x-38*u,y-bh*P.brk,bw,bh*P.brk);c.fillStyle='#7DFFB8';c.fillRect(x+33*u,y-bh*P.thr,bw,bh*P.thr);
    const st=P.steer||0;c.strokeStyle=HC.dim;c.lineWidth=1.6*u;c.beginPath();c.arc(x,y-bh+6*u,22*u,-Math.PI*0.8,-Math.PI*0.2);c.stroke();
    const a=-Math.PI/2+st*Math.PI*0.3;c.fillStyle=HC.pri;c.beginPath();c.arc(x+Math.cos(a)*22*u,y-bh+6*u+Math.sin(a)*22*u,3.2*u,0,TAU);c.fill();
    if(P.beta!=null&&Math.abs(P.beta)>0.1&&P.v>5){c.fillStyle=HC.amb;c.textAlign='center';c.font=`700 ${13*u}px "B612 Mono", monospace`;c.fillText('DRIFT '+Math.round(Math.abs(P.beta)*57.3)+'°',x,y-bh-62*u);}
    if(P.gear!=null){c.fillStyle=HC.pri;c.textAlign='center';c.font=`700 ${22*u}px "B612 Mono", monospace`;c.fillText(P.rev?'R':String(P.gear+1),x,y-bh-24*u);
      const f=clamp((P.rpm-9000)/2800,0,1),lit=Math.round(f*15),blink=P.rpm>11600&&((performance.now()/70)|0)%2;
      for(let i=0;i<15;i++){const lx=x+(i-7)*7.5*u,ly=y-bh-48*u,col=i<5?'#35D98A':i<10?'#FF4B3A':'#4A9CFF';
        c.fillStyle=i<lit&&!blink?col:'rgba(196,248,255,.12)';c.beginPath();c.arc(lx,ly,2.6*u,0,TAU);c.fill();}}}
  if(showSpeed){c.fillStyle=HC.pri;c.textAlign='center';c.font=`700 ${20*u}px "B612 Mono", monospace`;c.fillText(String(Math.round(P.v*3.6)),x,y-12*u);
    c.font=`${8.5*u}px "B612 Mono", monospace`;c.fillText('KM/H',x,y-1*u);}
  c.restore();
}
/*<HUD*/
function drawHUD(w,t,dt){
  hc.setTransform(dpr,0,0,dpr,0,0);hc.clearRect(0,0,cw,ch);
  const u=clamp(Math.min(cw/1100,ch/620),0.55,1.4), o=w.opts;
  // the game screen stays clean: no boxes, no radar panel and no position tracker (the phone HUD, AR, VR and
  // SIM AR carry those); only gear and speed remain
  NAV.rects=null;$('combiner').hidden=true;
  drawPedals(hc,w,u,true);
}

/* ================= AUDIO (optional) ================= */
let AC=null,eng=null;
function audioStart(){
  try{AC=AC||new (window.AudioContext||window.webkitAudioContext)();AC.resume();
    if(!eng){const o1=AC.createOscillator(),o2=AC.createOscillator(),f=AC.createBiquadFilter(),g=AC.createGain();o1.type='sawtooth';o2.type='square';o2.detune.value=-1200;f.type='lowpass';f.frequency.value=1100;g.gain.value=0;
      o1.connect(f);o2.connect(f);f.connect(g);g.connect(AC.destination);o1.start();o2.start();
      const nb=AC.createBuffer(1,AC.sampleRate*2,AC.sampleRate),d=nb.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;
      const ns=AC.createBufferSource();ns.buffer=nb;ns.loop=true;const nf=AC.createBiquadFilter();nf.type='highpass';nf.frequency.value=1800;const ng=AC.createGain();ng.gain.value=0;ns.connect(nf);nf.connect(ng);ng.connect(AC.destination);ns.start();
      eng={o1,o2,g,ng};}
  }catch(e){AC=null;}
}
function beep(){if(!AC||!ui.sound)return;const t=AC.currentTime;for(let k=0;k<2;k++){const o=AC.createOscillator(),g=AC.createGain();o.type='sine';o.frequency.value=1250;g.gain.setValueAtTime(0,t+k*0.14);g.gain.linearRampToValueAtTime(0.09,t+k*0.14+0.01);g.gain.linearRampToValueAtTime(0,t+k*0.14+0.1);o.connect(g);g.connect(AC.destination);o.start(t+k*0.14);o.stop(t+k*0.14+0.12);}}
function audioUpdate(w,running){
  if(!eng||!AC)return;const on=ui.sound&&running&&!w.done,v=w.player.v,g=[0,22,33,43,52,61,70,78,99];let gi=1;while(gi<g.length-1&&v>g[gi])gi++;
  const rpm=w.player.rpm?clamp(w.player.rpm/12000,0.3,1):clamp(0.45+0.55*(v-g[gi-1])/(g[gi]-g[gi-1]),0.3,1);
  eng.o1.frequency.setTargetAtTime(160+rpm*380,AC.currentTime,0.04);eng.o2.frequency.setTargetAtTime(160+rpm*380,AC.currentTime,0.04);
  eng.g.gain.setTargetAtTime(on?0.028:0,AC.currentTime,0.08);eng.ng.gain.setTargetAtTime(ui.sound?0.012+0.03*w.rain:0,AC.currentTime,0.2);
}

/* ================= UI ================= */
const ui={aids:true,traffic:12,scn:'free',hud:true,visor:true,driver:'drive',steer:'assist',cam:'cockpit',rain:SCN.free.rain,sound:false};
let world=null, running=false, doneShownAt=null, runCount=0, lastAlert=0, shake=0, touchUsed=false;
const LOG=[];
function optsFromUI(){return {hud:ui.hud,visor:ui.visor,driver:ui.driver,steer:ui.steer,rain:ui.rain,traffic:ui.traffic,aids:ui.aids};}
function resetWorld(){world=makeWorld(ui.scn,optsFromUI());buildDynamic(world);paintSky(ui.rain);rainInit=false;camInit=false;NAV.cur=160;syncScene(world,0,0);renderIntro();}
function seg(onId,offId,key,onVal,offVal){
  $(onId).addEventListener('click',()=>{ui[key]=onVal;syncControls();applyLive();});
  $(offId).addEventListener('click',()=>{ui[key]=offVal;syncControls();applyLive();});
}
seg('hudOn','hudOff','hud',true,false); seg('aidOn','aidOff','aids',true,false); seg('visOn','visOff','visor',true,false); seg('drvYou','drvModel','driver','drive','model'); seg('stAssist','stFull','steer','assist','full');
[6,12,20].forEach(n=>$('tr'+n).addEventListener('click',()=>{ui.traffic=n;syncControls();if(running)liveTraffic();else resetWorld();}));
$('camCock').addEventListener('click',()=>{ui.cam='cockpit';syncControls();});
$('camChase').addEventListener('click',()=>{ui.cam='chase';syncControls();});
$('sndOn').addEventListener('click',()=>{ui.sound=true;audioStart();syncControls();});
$('sndOff').addEventListener('click',()=>{ui.sound=false;syncControls();});
$('rain').addEventListener('input',e=>{ui.rain=e.target.value/100;syncControls();world.rain=ui.rain;world.opts.rain=ui.rain;paintSky(ui.rain);if(!running)renderIntro();});
// settings apply straight away, also in the middle of a run
function applyLive(){
  if(!running){world.opts=optsFromUI();renderIntro();return;}
  const w=world,was=w.opts.driver;Object.assign(w.opts,optsFromUI());
  if(was==='model'&&w.opts.driver==='drive'){const P=w.player;Object.assign(P,{vx:P.v,vy:0,r:0,psi:0,delta:0,steer:0,wf:null,rev:0});}
  $('touch').hidden=!(w.opts.driver==='drive'&&(touchUsed||matchMedia('(pointer: coarse)').matches));}
// a new field of cars around you when the traffic setting changes mid-run
function liveTraffic(){const w=world,P=w.player;
  w.traffic=genTraffic(ui.traffic).map((T,i)=>carFrom(T,P.s,P.lapc||0,i));w.opts.traffic=ui.traffic;buildDynamic(w);}
function syncControls(){
  const set=(id,v)=>$(id).setAttribute('aria-pressed',v?'true':'false');
  set('aidOn',ui.aids);set('aidOff',!ui.aids);$('aidOn').disabled=$('aidOff').disabled=ui.driver!=='drive';
  set('hudOn',ui.hud);set('hudOff',!ui.hud);set('visOn',ui.visor);set('visOff',!ui.visor);set('drvYou',ui.driver==='drive');set('drvModel',ui.driver==='model');
  set('stAssist',ui.steer==='assist');set('stFull',ui.steer==='full');
  [6,12,20].forEach(n=>set('tr'+n,ui.traffic===n));
  set('camCock',ui.cam==='cockpit');set('camChase',ui.cam==='chase');set('sndOn',ui.sound);set('sndOff',!ui.sound);
  $('rainOut').textContent=Math.round(ui.rain*100)+'%';
  if($('scenSet'))$('scenSet').classList.toggle('locked',running);
  $('stAssist').disabled=$('stFull').disabled=ui.driver!=='drive';
  $('runBtn').textContent=running?'Stop run':'Start run';
  ['drawBtn','defBtn'].forEach(id=>$(id).disabled=running);
}
function metaLine(o){return `Radar ${o.hud?'on':'off'} · Visor ${o.visor?'on':'off'} · ${o.driver==='model'?'Autopilot':'You drive'+(o.steer==='full'?' (full steering)':'')} · Rain ${Math.round(o.rain*100)}%`;}
function renderIntro(){const s=SCN[ui.scn];$('iRef').textContent=s.ref+' · '+TRACK_NAME;$('iTitle').textContent=s.title;$('iBlurb').textContent=s.blurb();
  const how=ui.driver==='drive'?(ui.steer==='assist'?'<kbd>W</kbd> gas · <kbd>S</kbd>/<kbd>Space</kbd> brake · hold <kbd>A</kbd>/<kbd>D</kbd> to move across the track, let go to rejoin the racing line.':'<kbd>W</kbd> gas · <kbd>S</kbd> brake · <kbd>A</kbd>/<kbd>D</kbd> steer. Too fast in a corner and you run wide into the wall.'):'Autopilot drives. Watch how early it reacts.';
  const howRev=ui.driver==='drive'?' Stopped? Hold <kbd>S</kbd> to reverse, <kbd>W</kbd> to go forward again.':'';
  $('iMeta').innerHTML=metaLine(optsFromUI())+'<br>'+how+howRev+(s.free?' <kbd>X</kbd> drops a hazard.':'');}
// ---- views: Drive is the full-screen sim; Setup, Phone and Circuit open as sheets over it (the sim keeps running)
function showView(v){document.body.dataset.view=v;
  document.querySelectorAll('.tabs [role=tab]').forEach(b=>b.setAttribute('aria-selected',b.dataset.view===v?'true':'false'));
  if(v==='drive')stage.focus({preventScroll:true});else if(v==='circuit'&&typeof drawMini==='function'&&N)drawMini();}
document.querySelectorAll('.tabs [role=tab]').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));
showView('drive');
function startRun(){
  showView('drive');
  if(!PHYS.ok){if(PHYS.err)toast('<b class="info">Physics core did not load</b>Run <code>npm run build:physics</code> and reload.');else PHYS.ready.then(()=>{if(PHYS.ok&&!running)startRun();});return;}
  if(ui.sound)audioStart();
  world=makeWorld(ui.scn,optsFromUI());buildDynamic(world);paintSky(ui.rain);camInit=false;NAV.cur=160;
  running=true;doneShownAt=null;lastAlert=0;shake=0;
  $('introCard').hidden=true;$('resultCard').hidden=true;$('dropBtn').hidden=!world.sc.free;
  $('touch').hidden=!(ui.driver==='drive'&&(touchUsed||matchMedia('(pointer: coarse)').matches));
  syncControls();stage.focus({preventScroll:true});
}
function stopRun(){running=false;resetWorld();$('introCard').hidden=false;$('resultCard').hidden=true;$('dropBtn').hidden=true;$('touch').hidden=true;syncControls();}
function fmtM(d){return d==null?'—':Math.round(d)+' m';}
function srcText(s){return s==='hud'?'HUD':s==='visor'?'visor light':s==='eyes'?'saw it':s==='you'?'you braked':'';}
function showResult(){
  const r=world.result;runCount++;
  LOG.unshift(Object.assign({n:runCount},r));renderLog();
  $('rRef').textContent=`Run ${runCount} · ${SCN[r.scn].title} · ${metaLine(r.opts)}`;
  const v=$('rVerdict');v.className='verdict '+r.verdict;v.textContent=verdictText(r);
  const warn=r.opts.hud||r.opts.visor?(r.warnD!=null?`${fmtM(r.warnD)}<small>${r.lead!=null?r.lead.toFixed(1)+' s before':'before the hazard'}</small>`:'—'):'—<small>Radar off</small>';
  $('rMetrics').innerHTML=`<div><dt>Warned</dt><dd>${warn}</dd></div><div><dt>In sight</dt><dd>${fmtM(r.seenD)}<small>eyes only</small></dd></div><div><dt>On-board radar</dt><dd>${fmtM(r.radarD)}<small>77 GHz, first track</small></dd></div><div><dt>Reacted</dt><dd>${r.reactD!=null?fmtM(Math.max(0,r.reactD)):'never'}<small>${r.reactD!=null?srcText(r.src):'no reaction'}</small></dd></div>`;
  const flip=!(r.opts.hud||r.opts.visor);$('rFlip').textContent=flip?'Again with radar on':'Again with radar off';$('rFlip').dataset.flip=flip?'on':'off';
  $('resultCard').hidden=false;$('dropBtn').hidden=true;$('touch').hidden=true;running=false;syncControls();
}
$('rFlip').addEventListener('click',()=>{const on=$('rFlip').dataset.flip==='on';ui.hud=on;ui.visor=on;syncControls();startRun();});
$('rSame').addEventListener('click',()=>startRun());
$('iStart').addEventListener('click',()=>startRun());
$('runBtn').addEventListener('click',()=>{running?stopRun():startRun();});
function renderLog(){
  if(!LOG.length||!$('logBody'))return;
  $('logBody').innerHTML=LOG.map(r=>`<tr><td class="n">${r.n}</td><td>${SCN[r.scn].title}</td><td>${esc(r.track)}</td><td>${r.opts.hud?'On':'Off'}</td><td>${r.opts.driver==='model'?'Autopilot':'You'}</td><td>${r.opts.hud||r.opts.visor?fmtM(r.warnD):'—'}</td><td>${fmtM(r.seenD)}</td><td>${r.reactD!=null?fmtM(Math.max(0,r.reactD)):'—'}</td><td><span class="chip ${r.verdict}">${chipText(r)}</span></td></tr>`).join('');
}
function esc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
let toastT=0;
function toast(html){const t=$('toast');t.innerHTML=html;t.hidden=false;toastT=3.6;}
function dropHazard(){
  const w=world;if(!running||!w.sc.free||w.done)return;
  const P=w.player;let best=null;
  for(const c of CORNERS){const d=dSigned(P.s,c.s1);if(d>220&&d<Math.min(900,L/2-10)&&(!best||d<best.d))best={c,d};}
  const s=best?wrapS(best.c.s1+Math.min(35,best.c.exitLen*0.45)):wrapS(P.s+Math.min(450,L/3));
  const type=Math.random()<0.6?'car':'tractor';
  const h=mkHaz(type,s,{yaw:type==='car'?0.4:0.5});w.hazards.push(h);const m=hazMesh(h);dyn.add(m);hazardMeshes.push(m);
  toast(`<b class="info">${h.label} placed</b>Hidden just past ${best?'T'+best.c.n:'the road ahead'}, ${Math.round(dSigned(P.s,s))} m ahead. Will you see it in time?`);
}
$('dropBtn').addEventListener('click',e=>{e.stopPropagation();dropHazard();stage.focus({preventScroll:true});});

// input
const K={up:0,down:0,left:0,right:0}, TOUCH={gas:0,brake:0,left:0,right:0};
const KEYMAP={KeyW:'up',ArrowUp:'up',KeyS:'down',ArrowDown:'down',Space:'down',KeyA:'left',ArrowLeft:'left',KeyD:'right',ArrowRight:'right'};
addEventListener('keydown',e=>{
  const tag=e.target&&e.target.tagName;if(tag==='INPUT'&&e.target.type==='text')return;
  if(!$('builder').hidden){if(e.code==='Escape')closeBuilder();return;}
  if(KEYMAP[e.code]&&running){e.preventDefault();K[KEYMAP[e.code]]=1;return;}
  if(e.code==='Enter'&&tag!=='BUTTON'){e.preventDefault();if(!running)startRun();}
  else if(e.code==='Escape'&&document.body.dataset.view!=='drive'){showView('drive');}
  else if(e.code==='Escape'&&running){stopRun();}
  else if(e.code==='KeyC'){ui.cam=ui.cam==='cockpit'?'chase':'cockpit';syncControls();}
  else if(e.code==='KeyN'){NAV.big=!NAV.big;}
  else if(e.code==='KeyK'){calibKey=!calibKey;updateCalib();}
  else if(e.code==='KeyX'){dropHazard();}
  else if(e.code==='Equal'||e.code==='NumpadAdd'){NAV.zoom=clamp(NAV.zoom/1.3,0.4,3);}
  else if(e.code==='Minus'||e.code==='NumpadSubtract'){NAV.zoom=clamp(NAV.zoom*1.3,0.4,3);}
  else if(e.code==='KeyH'&&!running){ui.hud=!ui.hud;ui.visor=ui.hud;syncControls();applyLive();}
  else if(e.code==='KeyR'&&running){startRun();}
});
addEventListener('keyup',e=>{if(KEYMAP[e.code])K[KEYMAP[e.code]]=0;});
addEventListener('blur',()=>{for(const k in K)K[k]=0;});
function inRect(x,y,r){return r&&x>=r[0]&&x<=r[0]+r[2]&&y>=r[1]&&y<=r[1]+r[3];}
stage.addEventListener('pointerdown',e=>{
  if(e.target.closest('.card,.drop,.touch'))return;
  const r=stage.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
  if(NAV.rects){if(inRect(x,y,NAV.rects.plus)){NAV.zoom=clamp(NAV.zoom/1.3,0.4,3);return;} if(inRect(x,y,NAV.rects.minus)){NAV.zoom=clamp(NAV.zoom*1.3,0.4,3);return;}
    if(inRect(x,y,NAV.rects.panel)){NAV.big=!NAV.big;return;}}
  if(e.pointerType==='touch'){touchUsed=true;if(running&&ui.driver==='drive')$('touch').hidden=false;}
});
document.querySelectorAll('.touch button').forEach(b=>{
  const k=b.dataset.k,on=v=>{TOUCH[k]=v;b.classList.toggle('on',!!v);};
  b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);on(1);});
  b.addEventListener('pointerup',()=>on(0));b.addEventListener('pointercancel',()=>on(0));b.addEventListener('lostpointercapture',()=>on(0));
});
function readInput(){
  let thr=Math.max(K.up,TOUCH.gas), brk=Math.max(K.down,TOUCH.brake), st=(K.right+TOUCH.right)-(K.left+TOUCH.left);
  try{const gps=navigator.getGamepads?navigator.getGamepads():[];for(const gp of gps){if(!gp)continue;const ax=gp.axes[0]||0;if(Math.abs(ax)>0.08)st+=ax;
    if(gp.buttons[7])thr=Math.max(thr,gp.buttons[7].value);if(gp.buttons[6])brk=Math.max(brk,gp.buttons[6].value);if(gp.buttons[0]&&gp.buttons[0].pressed)thr=1;if(gp.buttons[1]&&gp.buttons[1].pressed)brk=1;break;}}catch(e){}
  const pw=activeWheel();if(REMOTE.phones>0&&pw){st+=pw.steer;thr=Math.max(thr,pw.gas);brk=Math.max(brk,pw.brake);}
  return {throttle:clamp(thr,0,1),brake:clamp(brk,0,1),steer:clamp(st,-1,1)};
}

/* ================= PHONE WHEEL (only when served by the local server) ================= */
const REMOTE={phones:0,steer:0,gas:0,brake:0,t:0,ws:null,live:false};
// the phone draws the visor HUD itself: send the track once, then ~30 compact state updates per second
const r2=v=>Math.round(v*100)/100, r4=v=>Math.round(v*1e4)/1e4;
function sendTrack(){if(!REMOTE.live||!REMOTE.phones)return;
  remoteSend({t:'track',name:TRACK_NAME,N,L,DS,PX:Array.from(PX,r2),PZ:Array.from(PZ,r2),TX:Array.from(TX,r4),TZ:Array.from(TZ,r4),H:Array.from(H,r2),SL:Array.from(SL,r4),LAT:Array.from(LATRL,r2),VP:Array.from(VPROF,r2),
    C:CORNERS.map(c=>({s0:r2(c.s0),s1:r2(c.s1),sg:c.sg,angle:r4(c.angle),n:c.n,apex:r2(c.apex)}))});}
let stateLast=0;
function phoneFrame(w,t,dt,now){
  if(!REMOTE.live||!REMOTE.phones||now-stateLast<22)return;const ws=REMOTE.ws;if(!ws||ws.readyState!==1||ws.bufferedAmount>64000)return;
  stateLast=now;const P=w.player,RD=w.radar;
  // radar picture for the phone: origin, reach, loss, this scan's returns [x,z,static] and tracks [x,z,flags]
  let rd=null;if(RD&&RD.ox!=null){const d=[],k=[];for(const q of RD.dets.slice(0,90))d.push(r2(q.x),r2(q.z),q.st?1:0);
    for(const T of RD.tracks)if(T.conf&&!T.barrier)k.push(r2(T.x),r2(T.z),T.obj?1:0);rd={o:[r2(RD.ox),r2(RD.oz)],g:Math.round(RD.rng),a:r2(RD.att),d,k};}
  // force feedback for the phone's vibration motor: kerb rumble, tyre slip, impacts, cornering load, spray
  const inCorner=CORNERS.some(cn=>dSigned(cn.s0-12,P.s)>=0&&dSigned(P.s,cn.s1+12)>0),drive=w.opts.driver==='drive';
  // tyre channels from physics/vehicle.c: aligning torque (steering weight), front/rear saturation past the peak
  // (understeer scrub / oversteer slide), lock-up, wheelspin; plus kerbs, impacts, spray and aquaplaning
  const ffb=[Math.abs(P.lat)>HW-1.1&&inCorner&&P.v>3?clamp(P.v/40,0.3,1):0,
    (w.t-(P.lastHitT||-9)<0.15||w.traffic.some(c=>c.touch))?1:0,
    drive?clamp(Math.abs(P.mz||0)*2.2,0,1):0,
    drive?clamp(((P.satF||0)-0.95)*2.5,0,1):0,
    drive?clamp(((P.satR||0)-0.95)*2.5,0,1):0,
    drive?clamp((-Math.min(P.kf||0,P.kr||0)-0.1)*3,0,1):0,
    drive?clamp(((P.kr||0)-0.12)*3,0,1):0,
    w.spray||0, drive?(P.aqua||0):0].map(r2);
  remoteSend({t:'w',tm:r2(t),tw:Math.round(now),cm:[r4(camera.position.x),r4(camera.position.y),r4(camera.position.z),r4(camera.quaternion.x),r4(camera.quaternion.y),r4(camera.quaternion.z),r4(camera.quaternion.w)],mk:calibOn()?calibCentres():null,fg:w.flags?[r2(w.secLen)].concat(Array.from(w.flags)):null,dr:drive?1:0,hd:w.opts.hud?1:0,bh:w.behind?[r2(w.behind.d),w.behind.side,r2(w.behind.cl)]:null,scr:[Math.round(cw),Math.round(ch)],sp:r2(w.spray||0),rd,ffb,
    p:[r2(P.s),r2(P.lat),r4(P.psi||0),r2(P.latV||0),r2(P.slideV||0),r2(P.v),r2(P.vx==null?P.v:P.vx),P.lapc||0,r2(P.brk||0),r2(P.thr||0),P.rev?-2:P.gear==null?-1:P.gear,Math.round(P.rpm||0),r4(P.beta||0),r4(P.steer||0)],
    tr:w.traffic.map(c=>[r2(c.s),r2(c.lat),r2(c.latV),r2(c.v),c.vis?1:0,c.closing?1:0,c.lapc||0]),
    hz:w.hazards.map(h=>[h.type,r2(h.s),r2(h.lat),r2(h.yaw||0),h.halfLen,h.halfW,h.vis?1:0,h.gone?1:0,r2(h.avoid),h.vpass,h.label]),
    a:w.alert,ni:w.near?w.hazards.indexOf(w.near):-1,dn:r2(w.dNear),vis:Math.round(w.vis),fo:w.flagOn?1:0,fl:w.sc.flag||'',z:r4(NAV.zoom)});
}
// Several phones can be linked. Each has an id and a role: a wheel phone drives; a phone in AR is a viewer that
// shows what the driver sees and is never read for input. Only the freshest wheel phone steers.
REMOTE.dev=new Map();
function phoneDev(id){id=id||'phone';let d=REMOTE.dev.get(id);if(!d){d={id,ar:false,steer:0,gas:0,brake:0,t:0};REMOTE.dev.set(id,d);}return d;}
function activeWheel(){const now=performance.now();let b=null;for(const d of REMOTE.dev.values())if(!d.ar&&now-d.t<500&&(!b||d.t>b.t))b=d;return b;}
function phoneRoles(){let v=0;for(const d of REMOTE.dev.values())if(d.ar)v++;
  const wheels=Math.max(0,REMOTE.phones-v),was=REMOTE.viewers||0;REMOTE.viewers=v;REMOTE.wheels=wheels;
  phoneAR(v>0&&wheels===0);
  if(v>was&&wheels>0)toast('<b class="info">AR viewer linked</b>The wheel phone drives; the viewer shows the driver\'s view.');
  remotePanel();}
// with only viewers linked, the autopilot drives (a passenger view of what the driver would see). As soon as a
// wheel phone is linked, or AR is switched off, the car goes back to the mode chosen before.
function phoneAR(on){if(!!REMOTE.ar===on)return;REMOTE.ar=on;
  if(on){REMOTE.prevDriver=ui.driver;ui.driver='model';}else ui.driver=REMOTE.prevDriver||ui.driver;
  const w=world;if(w&&running){const was=w.opts.driver;w.opts.driver=ui.driver;
    if(was==='model'&&ui.driver==='drive'){const P=w.player;Object.assign(P,{vx:P.v,vy:0,r:0,psi:0,delta:0,steer:0,wf:null});}}
  syncControls();applyLive();
  toast(on?'<b class="info">Phone AR · autopilot driving</b>The phone shows what the driver would see. Link a second phone as the wheel, or turn AR off, to drive.':`<b class="info">Phone AR off</b>${ui.driver==='drive'?'You are driving again.':'Autopilot keeps driving.'}`);}
// SIM AR calibration dots: four coloured dots in the corners of the game view. A phone pointed at the screen finds
// them and maps the game screen onto its camera image, so its HUD lands exactly on the sim picture.
let calibKey=false;
const calibOn=()=>document.body.classList.contains('calib-on');
function updateCalib(){let on=calibKey;for(const d of REMOTE.dev.values())if(d.sim)on=true;document.body.classList.toggle('calib-on',on);}
function calibCentres(){const r=stage.getBoundingClientRect(),out=[];
  for(const i of [0,1,2,3]){const b=document.querySelector('.calib .c'+i).getBoundingClientRect();out.push(r2(b.left+b.width/2-r.left),r2(b.top+b.height/2-r.top));}
  return out;}
function remoteSend(o){const ws=REMOTE.ws;if(ws&&ws.readyState===1)ws.send(JSON.stringify(o));}
function remotePanel(){
  if(!REMOTE.live)return;
  const n=REMOTE.phones,ok=n>0,st=$('phStatus'),v=REMOTE.viewers||0,wh=Math.max(0,n-v);
  const fresh=performance.now()-REMOTE.t<600, who=[wh?`${wh} wheel`:'',v?`${v} AR view`:''].filter(Boolean).join(' + ');
  st.textContent=!ok?'Waiting for a phone':!wh?`${who} · autopilot driving`:fresh?`${n>1?n+' phones':'Phone'} linked · ${who} · ${REMOTE.rate||0} inputs/s`:'Wheel phone linked but sending nothing. Reload the wheel page and keep it in front';
  st.classList.toggle('ok',ok&&(fresh||!wh));
}
async function remoteInit(){
  let info;try{const r=await fetch('/info',{cache:'no-store'});if(!r.ok)return;info=await r.json();}catch(e){return;}
  if(!info||info.app!=='look-ahead-radar'||info.remote)return;   // opened from another computer: no phone link
  REMOTE.live=true;$('phonePanel').hidden=false;$('tabPhone').hidden=false;
  $('qr').src='/qr.svg?u='+encodeURIComponent(info.lan);$('urlLan').textContent=info.lan;$('urlUsb').textContent=info.usb;
  const adb=()=>fetch('/info',{cache:'no-store'}).then(r=>r.json()).then(i=>{$('usbState').textContent=i.adb==='ready'?'USB link is ready. Open the address above in Chrome on the phone.':i.adb==='no device'?'No phone on USB. Turn on USB debugging and plug it in, or use Wi-Fi.':i.adb==='not found'?'adb is not installed, so use Wi-Fi.':'adb reverse failed. Unplug and replug the phone.';}).catch(()=>{});
  adb();setInterval(adb,4000);
  const connect=()=>{const ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws?role=game');REMOTE.ws=ws;
    ws.onmessage=e=>{let m;try{m=JSON.parse(e.data);}catch(_){return;}
      if(m.t==='hello'){sendTrack();}
      else if(m.t==='in'){const d=phoneDev(m.id);d.steer=+m.s||0;d.gas=+m.g||0;d.brake=+m.b||0;d.t=performance.now();
        if(!d.ar){REMOTE.steer=d.steer;REMOTE.gas=d.gas;REMOTE.brake=d.brake;REMOTE.t=d.t;REMOTE.n=(REMOTE.n||0)+1;}}
      else if(m.t==='bye'){REMOTE.dev.delete(m.id);phoneRoles();updateCalib();}
      else if(m.t==='phones'){const was=REMOTE.phones;REMOTE.phones=m.n;
        if(m.ids)for(const id of [...REMOTE.dev.keys()])if(!m.ids.includes(id))REMOTE.dev.delete(id);phoneRoles();
        if(m.n>was)sendTrack();
        if(m.n>0&&was===0){if(!running){ui.driver='drive';ui.steer='full';syncControls();applyLive();}toast('<b class="info">Phone wheel linked</b>Full steering: tilt to turn the wheels. Traction and stability control are on.');}
        if(m.n===0&&was>0){toast('<b class="info">Phone wheel disconnected</b>Keyboard controls still work.');}}
      else if(m.t==='cmd'){if(m.c==='start'&&!running)startRun();else if(m.c==='stop'&&running)stopRun();else if(m.c==='drop')dropHazard();else if(m.c==='ar'){phoneDev(m.id).ar=!!m.on;phoneRoles();}else if(m.c==='sim'){phoneDev(m.id).sim=!!m.on;updateCalib();}else if(m.c==='cam'){ui.cam=ui.cam==='cockpit'?'chase':'cockpit';syncControls();}}};
    ws.onclose=()=>{REMOTE.phones=0;remotePanel();setTimeout(connect,1000);};};
  connect();
  setInterval(()=>{REMOTE.rate=(REMOTE.n||0);REMOTE.n=0;remotePanel();},1000);
  setInterval(()=>{const w=world;if(!w||!REMOTE.phones)return;const P=w.player,nh=w.near&&w.dNear<RANGE&&w.opts.hud?w.near:null;
    remoteSend({t:'st',ap:REMOTE.ar?1:0,wh:REMOTE.wheels||0,a:w.alert,k:Math.round(P.v*3.6),r:running&&!w.done,w:!!P.onWall,h:nh?nh.label:'',d:nh?Math.round(w.dNear):0});
    const deg=REMOTE.steer*45;$('mSteerV').textContent=(deg>0?'R ':deg<0?'L ':'')+Math.abs(Math.round(REMOTE.steer*100))+'%';
    const f=$('mSteer').querySelector('.fill'),v=REMOTE.steer;f.style.left=(v<0?50+v*50:50)+'%';f.style.width=Math.abs(v)*50+'%';
    $('mGas').querySelector('.fill').style.width=REMOTE.gas*100+'%';$('mBrake').querySelector('.fill').style.width=REMOTE.brake*100+'%';},80);
}

/* ================= CIRCUIT PANEL & BUILDER ================= */
const MINI={bg:null,T:null,sc:1,t:0};
function drawMini(){
  const cv=$('miniMap'),W=cv.width,Hh=cv.height,bg=document.createElement('canvas');bg.width=W;bg.height=Hh;const c=bg.getContext('2d');
  c.fillStyle='#070B10';c.fillRect(0,0,W,Hh);
  c.strokeStyle='rgba(120,160,190,.06)';c.lineWidth=1;for(let x=0;x<W;x+=40){c.beginPath();c.moveTo(x,0);c.lineTo(x,Hh);c.stroke();}for(let y=0;y<Hh;y+=40){c.beginPath();c.moveTo(0,y);c.lineTo(W,y);c.stroke();}
  let minx=1e9,maxx=-1e9,minz=1e9,maxz=-1e9;for(let i=0;i<N;i+=4){minx=Math.min(minx,PX[i]);maxx=Math.max(maxx,PX[i]);minz=Math.min(minz,PZ[i]);maxz=Math.max(maxz,PZ[i]);}
  const s=Math.min((W-120)/(maxx-minx),(Hh-120)/(maxz-minz)),ox=(W-(maxx-minx)*s)/2-minx*s,oz=(Hh-(maxz-minz)*s)/2-minz*s,T=(x,z)=>[ox+x*s,oz+z*s];
  MINI.T=T;MINI.sc=s;
  c.fillStyle='#111922';c.strokeStyle='#18222d';for(const bf of FOOT){c.beginPath();bf.pts.forEach((p,k)=>{const q=T(p[0],p[1]);k?c.lineTo(q[0],q[1]):c.moveTo(q[0],q[1]);});c.closePath();c.fill();c.stroke();}
  const path=new Path2D();for(let i=0;i<=N;i+=3){const q=T(PX[i%N],PZ[i%N]);i?path.lineTo(q[0],q[1]):path.moveTo(q[0],q[1]);}path.closePath();
  c.lineJoin='round';c.lineCap='round';c.strokeStyle='#2c3a47';c.lineWidth=Math.max(9,2*WALL*s);c.stroke(path);c.strokeStyle='#4a5b69';c.lineWidth=Math.max(6,2*HW*s);c.stroke(path);
  // corners
  c.font='700 13px "B612 Mono", monospace';c.textAlign='center';c.textBaseline='middle';
  CORNERS.forEach(cn=>{const p=worldPos(cn.apex,-cn.sg*(WALL+30)),q=T(p.x,p.z);c.fillStyle='rgba(196,248,255,.55)';c.fillText('T'+cn.n,q[0],q[1]);});
  // start/finish and direction
  const sf=T(PX[0],PZ[0]);c.save();c.translate(sf[0],sf[1]);c.rotate(Math.atan2(TZ[0],TX[0])+Math.PI/2);for(let k=-3;k<3;k++)for(let r=0;r<2;r++){c.fillStyle=(k+r)%2?'#111':'#fff';c.fillRect(k*4,-4+r*4,4,4);}c.restore();
  const d0=worldPos(14,0),d1=worldPos(60,0),a0=T(d0.x,d0.z),a1=T(d1.x,d1.z),ang=Math.atan2(a1[1]-a0[1],a1[0]-a0[0]);
  c.strokeStyle='rgba(196,248,255,.5)';c.lineWidth=2;c.beginPath();c.moveTo(a0[0],a0[1]);c.lineTo(a1[0],a1[1]);c.stroke();c.fillStyle='rgba(196,248,255,.5)';c.beginPath();c.moveTo(a1[0]+Math.cos(ang)*9,a1[1]+Math.sin(ang)*9);c.lineTo(a1[0]+Math.cos(ang+2.4)*8,a1[1]+Math.sin(ang+2.4)*8);c.lineTo(a1[0]+Math.cos(ang-2.4)*8,a1[1]+Math.sin(ang-2.4)*8);c.fill();
  // where each scenario's hazard is
  c.font='700 10px "B612 Mono", monospace';
  MINI.bg=bg;
  $('cName').textContent=TRACK_NAME;$('cLen').textContent=(L/1000).toFixed(2)+' km';$('cCorners').textContent=CORNERS.length;
  $('cStraight').textContent=Math.round(SPOTS.crestStraight.len)+' m';
  drawMiniLive(world);
}
function drawMiniLive(w){
  const cv=$('miniMap');if(!MINI.bg||!w)return;const c=cv.getContext('2d'),T=MINI.T,P=w.player;
  c.drawImage(MINI.bg,0,0);
  // the stretch of track the radar is covering right now
  if(w.opts.hud){c.lineCap='round';c.lineJoin='round';
    for(let d=0;d<RANGE;d+=6){const a=worldPos(P.s+d,0),b=worldPos(P.s+d+6,0),qa=T(a.x,a.z),qb=T(b.x,b.z);c.strokeStyle=`rgba(57,230,180,${0.75*(1-d/RANGE*0.7)})`;c.lineWidth=Math.max(4,2*HW*MINI.sc*0.55);c.beginPath();c.moveTo(qa[0],qa[1]);c.lineTo(qb[0],qb[1]);c.stroke();}}
  // hazards
  for(const h of w.hazards){if(h.gone)continue;const p=worldPos(h.s,h.lat),q=T(p.x,p.z),col=w.alert===2&&h===w.near?'#FF4B3A':'#FFC247';hazIcon(c,h.type,q[0],q[1]-4,18,col,true,'#0A0E13');}
  // cars, in tracker colours; hollow if spray, walls or a crest hide them from you
  c.font='700 10px "B612 Mono", monospace';c.textAlign='center';c.textBaseline='bottom';
  w.traffic.forEach((t,i)=>{const p=worldPos(t.s,t.lat),q=T(p.x,p.z),col=TRK_COLS[i%TRK_COLS.length];
    c.beginPath();c.arc(q[0],q[1],5.5,0,TAU);if(t.vis){c.fillStyle=col;c.fill();}else{c.setLineDash([2.5,2]);c.strokeStyle=col;c.lineWidth=1.8;c.stroke();c.setLineDash([]);}
    if(t.closing){c.strokeStyle='#FF4B3A';c.lineWidth=2;c.beginPath();c.arc(q[0],q[1],9,0,TAU);c.stroke();}
    c.fillStyle=col;c.fillText(TRK_CODES[i%TRK_CODES.length],q[0],q[1]-8);});
  // you: an arrow pointing where the car is heading
  const hd=headingAt(P.s,carYaw(P,true)),pp=worldPos(P.s,P.lat),q=T(pp.x,pp.z),ang=Math.atan2(hd[1],hd[0]);
  c.save();c.translate(q[0],q[1]);c.rotate(ang);c.fillStyle='#C4F8FF';c.strokeStyle='#0A0E13';c.lineWidth=2;
  c.beginPath();c.moveTo(11,0);c.lineTo(-7,-7);c.lineTo(-3,0);c.lineTo(-7,7);c.closePath();c.fill();c.stroke();c.restore();
  c.strokeStyle='rgba(196,248,255,.5)';c.lineWidth=1.5;c.beginPath();c.arc(q[0],q[1],15,0,TAU);c.stroke();
  // position readout
  const ri=raceInfo(w);c.textAlign='left';c.textBaseline='bottom';c.fillStyle='#C4F8FF';c.font='700 26px "B612 Mono", monospace';const by=cv.height-18;c.fillText('P'+ri.pos,22,by);
  const pw=c.measureText('P'+ri.pos).width;c.font='700 13px "B612 Mono", monospace';c.fillStyle='rgba(196,248,255,.6)';c.fillText('/'+ri.n+'   LAP '+ri.lap+'   '+Math.round(P.v*3.6)+' KM/H',26+pw,by-4);
}
function applyTrack(raw,name){
  if(running)stopRun();
  buildTrack(raw,name);physTrack();buildTrackMeshes();drawMini();resetWorld();sendTrack();
}

const B={mode:'upload',img:null,proc:null,pick:null,tol:60,km:4.5,rev:false,loop:null,drawing:false,draw:[]};
const bc=$('bCanvas'),bx=bc.getContext('2d'),BW=bc.width,BH=bc.height;
function openBuilder(mode){B.mode=mode;$('builder').hidden=false;syncBuilder();redrawBuilder();}
function closeBuilder(){$('builder').hidden=true;}
function syncBuilder(){
  $('bTabUp').setAttribute('aria-pressed',B.mode==='upload'?'true':'false');$('bTabDraw').setAttribute('aria-pressed',B.mode==='draw'?'true':'false');
  $('bUpActions').hidden=B.mode!=='upload';$('bDrawActions').hidden=B.mode!=='draw';$('bPickWrap').hidden=B.mode!=='upload';
  $('bHint').textContent=B.mode==='upload'?'Click the track line in the image to match its colour. Magenta is the lap the builder found.':'Draw one lap in a single stroke. It closes itself when you let go.';
  $('bKmOut').textContent=B.km.toFixed(1)+' km';$('bTolOut').textContent=B.tol;
  $('bSwatch').style.background=B.pick?`rgb(${B.pick.join(',')})`:'';$('bPickTxt').textContent=B.pick?'Matching the colour you clicked':'Auto: everything that is not background';
  $('bBuild').disabled=!B.loop;
}
function status(msg,kind){const s=$('bStatus');s.textContent=msg;s.className='b-status '+(kind||'');}
function fitRect(iw,ih){const s=Math.min(BW/iw,BH/ih);return {s,x:(BW-iw*s)/2,y:(BH-ih*s)/2};}
function redrawBuilder(){
  bx.fillStyle='#F1F0EA';bx.fillRect(0,0,BW,BH);
  if(B.mode==='upload'){
    if(B.img){const F=fitRect(B.img.width,B.img.height);bx.drawImage(B.img,F.x,F.y,B.img.width*F.s,B.img.height*F.s);bx.fillStyle='rgba(241,240,234,.35)';bx.fillRect(0,0,BW,BH);}
    else{bx.fillStyle='#8B8F93';bx.font='600 18px "B612", sans-serif';bx.textAlign='center';bx.fillText('Drop a screenshot here, or paste it with ⌘V',BW/2,BH/2);}
  } else {
    bx.strokeStyle='#E2E1D9';bx.lineWidth=1;for(let x=0;x<BW;x+=40){bx.beginPath();bx.moveTo(x,0);bx.lineTo(x,BH);bx.stroke();}for(let y=0;y<BH;y+=40){bx.beginPath();bx.moveTo(0,y);bx.lineTo(BW,y);bx.stroke();}
    if(B.drawing&&B.draw.length>1){bx.strokeStyle='#2B3542';bx.lineWidth=5;bx.lineJoin='round';bx.lineCap='round';bx.beginPath();B.draw.forEach((p,k)=>k?bx.lineTo(p[0],p[1]):bx.moveTo(p[0],p[1]));bx.stroke();}
    else if(!B.loop){bx.fillStyle='#8B8F93';bx.font='600 18px "B612", sans-serif';bx.textAlign='center';bx.fillText('Draw one lap here',BW/2,BH/2);}
  }
  if(B.loop&&!B.drawing){const pts=B.rev?B.loop.slice().reverse():B.loop;
    bx.strokeStyle='rgba(255,255,255,.9)';bx.lineWidth=9;bx.lineJoin='round';bx.beginPath();pts.forEach((p,k)=>k?bx.lineTo(p[0],p[1]):bx.moveTo(p[0],p[1]));bx.closePath();bx.stroke();
    bx.strokeStyle=NC.route;bx.lineWidth=5;bx.stroke();
    const a=pts[0],b=pts[Math.min(pts.length-1,8)],ang=Math.atan2(b[1]-a[1],b[0]-a[0]);
    bx.fillStyle='#1F5FD6';bx.beginPath();bx.arc(a[0],a[1],8,0,TAU);bx.fill();bx.save();bx.translate(a[0],a[1]);bx.rotate(ang);bx.fillStyle='#1F5FD6';bx.beginPath();bx.moveTo(26,0);bx.lineTo(12,-8);bx.lineTo(12,8);bx.fill();bx.restore();
    bx.fillStyle='#15181C';bx.font='700 13px "B612 Mono", monospace';bx.textAlign='left';bx.fillText('START',a[0]+12,a[1]-12);}
}
function loadFile(file){
  if(!file||!/^image\//.test(file.type)){status('That is not an image. Use a PNG, JPG or WebP of a circuit map.','err');return;}
  const url=URL.createObjectURL(file),im=new Image();
  im.onload=()=>{URL.revokeObjectURL(url);B.img=im;B.pick=null;B.rev=false;const nm=file.name.replace(/\.[^.]+$/,'').replace(/[_-]+/g,' ').trim();$('bName').value=!nm||/^(screen ?shot|image|clipboard|스크린샷|화면)/i.test(nm)?'My circuit':nm.slice(0,40);prepProc();detect();};
  im.onerror=()=>{URL.revokeObjectURL(url);status('That image could not be read. Try a PNG or JPG.','err');};
  im.src=url;
}
function prepProc(){const im=B.img,k=Math.min(1,380/Math.max(im.width,im.height)),w=Math.max(16,Math.round(im.width*k)),h=Math.max(16,Math.round(im.height*k));
  const cv=document.createElement('canvas');cv.width=w;cv.height=h;const ctx=cv.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.drawImage(im,0,0,w,h);B.proc={cv,ctx,w,h};}
function detect(){
  if(!B.proc)return;
  const r=detectLoop(B.proc.ctx,B.proc.w,B.proc.h,B.pick,B.tol);
  if(!r.ok){B.loop=null;status(r.msg,'err');}
  else{const F=fitRect(B.proc.w,B.proc.h);B.loop=r.pts.map(([x,y])=>[F.x+(x+0.5)*F.s,F.y+(y+0.5)*F.s]);
    status(`Found a closed lap (${r.method}, ${r.pts.length} points). Check the magenta line follows the track, then build.`,'ok');}
  syncBuilder();redrawBuilder();
}
// image -> closed lap, in C++ (physics/trace.cpp): colour mask, close gaps, largest blob, thin to a centreline,
// drop dead ends, walk the loop (or trace the outline)
function detectLoop(ctx,W,H,pick,tol){
  const X=PHYS.x;if(!X)return {ok:false,msg:'The tracer is still loading. Try again in a moment.'};
  new Uint8Array(X.memory.buffer,X.trace_rgba(),W*H*4).set(ctx.getImageData(0,0,W,H).data);
  const n=X.trace_run(W,H,pick?1:0,pick?pick[0]:0,pick?pick[1]:0,pick?pick[2]:0,tol);
  if(n===-1)return {ok:false,msg:'No track line found. Click on the track in the image to pick its colour, or raise the colour match.'};
  if(n===-2)return {ok:false,msg:'Most of the image matched, so the track could not be separated. Click on the track line to pick its colour, or lower the colour match.'};
  if(n<0)return {ok:false,msg:'Found the track but could not follow it all the way round. Make sure the lap is one closed line, or try Draw.'};
  const P=new Int32Array(X.memory.buffer,X.trace_points(),n*2),pts=[];for(let i=0;i<n;i++)pts.push([P[2*i],P[2*i+1]]);
  return {ok:true,pts,method:X.trace_method()?'outline':'centreline'};
}
function sampleMap(){
  const cv=document.createElement('canvas');cv.width=900;cv.height=600;const c=cv.getContext('2d');
  c.fillStyle='#EEF0EA';c.fillRect(0,0,900,600);
  c.fillStyle='#CFE0EA';c.beginPath();c.moveTo(560,600);c.bezierCurveTo(640,520,820,540,900,470);c.lineTo(900,600);c.fill();
  c.strokeStyle='#D9DBD3';c.lineWidth=6;for(let x=40;x<900;x+=95){c.beginPath();c.moveTo(x,0);c.lineTo(x+40,600);c.stroke();}for(let y=30;y<600;y+=90){c.beginPath();c.moveTo(0,y);c.lineTo(900,y-30);c.stroke();}
  const P=[[150,470],[520,480],[700,470],[770,415],[745,330],[640,300],[600,230],[680,165],[800,140],[830,90],[760,58],[520,70],[420,130],[330,108],[230,150],[170,240],[118,330],[110,420]];
  c.strokeStyle='#B8232B';c.lineWidth=11;c.lineJoin='round';c.lineCap='round';c.beginPath();
  for(let i=0;i<P.length;i++){const a=P[i],b=P[(i+1)%P.length],mx=(a[0]+b[0])/2,my=(a[1]+b[1])/2;if(i===0){const z=P[P.length-1];c.moveTo((z[0]+a[0])/2,(z[1]+a[1])/2);}c.quadraticCurveTo(a[0],a[1],mx,my);}
  c.closePath();c.stroke();
  c.lineWidth=4;c.beginPath();c.moveTo(190,474);c.quadraticCurveTo(230,500,300,501);c.lineTo(440,503);c.quadraticCurveTo(495,502,515,481);c.stroke();
  c.fillStyle='#111';c.fillRect(300,462,3,24);
  c.font='700 15px sans-serif';c.fillStyle='#4A4F55';c.fillText('HARBOUR',640,560);c.fillText('OLD TOWN',300,300);c.fillText('TUNNEL',540,40);
  [[560,445,'1'],[800,440,'2'],[610,330,'3'],[860,160,'4'],[520,108,'5'],[210,120,'6'],[80,300,'7']].forEach(([x,y,t])=>{c.fillStyle='#1B1E22';c.beginPath();c.arc(x,y,11,0,TAU);c.fill();c.fillStyle='#fff';c.font='700 12px sans-serif';c.textAlign='center';c.fillText(t,x,y+4);c.textAlign='left';});
  c.fillStyle='#1B1E22';c.font='700 22px sans-serif';c.fillText('Harbour Street Circuit',30,40);
  return cv;
}
$('drawBtn').addEventListener('click',()=>{B.loop=null;B.draw=[];openBuilder('draw');status('');});
$('defBtn').addEventListener('click',()=>applyTrack(defaultLoop(),'Grand Prix circuit'));
$('bChoose').addEventListener('click',()=>$('fileIn').click());
$('fileIn').addEventListener('change',e=>{const f=e.target.files&&e.target.files[0];if(f){if($('builder').hidden)openBuilder('upload');loadFile(f);}e.target.value='';});
$('bSample').addEventListener('click',()=>{B.img=sampleMap();B.pick=null;B.rev=false;$('bName').value='Harbour Street Circuit';B.km=3.4;$('bKm').value=34;prepProc();detect();});
$('bTabUp').addEventListener('click',()=>{B.mode='upload';B.loop=null;if(B.proc)detect();syncBuilder();redrawBuilder();});
$('bTabDraw').addEventListener('click',()=>{B.mode='draw';B.loop=null;status('');syncBuilder();redrawBuilder();});
$('bClose').addEventListener('click',closeBuilder);
$('builder').addEventListener('click',e=>{if(e.target===$('builder'))closeBuilder();});
$('bKm').addEventListener('input',e=>{B.km=e.target.value/10;syncBuilder();});
$('bTol').addEventListener('input',e=>{B.tol=+e.target.value;syncBuilder();});
$('bTol').addEventListener('change',()=>detect());
$('bAuto').addEventListener('click',()=>{B.pick=null;B.tol=60;$('bTol').value=60;detect();});
$('bRev').addEventListener('click',()=>{B.rev=!B.rev;redrawBuilder();});
$('bClear').addEventListener('click',()=>{B.loop=null;B.draw=[];status('');syncBuilder();redrawBuilder();});
$('bBuild').addEventListener('click',()=>{
  if(!B.loop)return;let pts=B.rev?B.loop.slice().reverse():B.loop.slice();
  const k=B.km*1000/polyLen(pts);pts=pts.map(p=>[p[0]*k,p[1]*k]);
  closeBuilder();applyTrack(pts,($('bName').value||'My circuit').trim());
  $('circH').scrollIntoView({behavior:RM?'auto':'smooth',block:'nearest'});
});
const bpos=e=>{const r=bc.getBoundingClientRect();return [(e.clientX-r.left)*BW/r.width,(e.clientY-r.top)*BH/r.height];};
bc.addEventListener('pointerdown',e=>{
  const p=bpos(e);
  if(B.mode==='upload'){if(!B.proc)return;const F=fitRect(B.proc.w,B.proc.h),x=Math.floor((p[0]-F.x)/F.s),y=Math.floor((p[1]-F.y)/F.s);
    if(x<1||y<1||x>=B.proc.w-1||y>=B.proc.h-1)return;const d=B.proc.ctx.getImageData(x-1,y-1,3,3).data;let r=0,g=0,b=0;for(let i=0;i<9;i++){r+=d[i*4];g+=d[i*4+1];b+=d[i*4+2];}
    B.pick=[Math.round(r/9),Math.round(g/9),Math.round(b/9)];B.tol=Math.max(B.tol,55);$('bTol').value=B.tol;detect();return;}
  bc.setPointerCapture(e.pointerId);B.drawing=true;B.draw=[p];B.loop=null;redrawBuilder();
});
bc.addEventListener('pointermove',e=>{if(!B.drawing)return;const p=bpos(e),l=B.draw[B.draw.length-1];if(Math.hypot(p[0]-l[0],p[1]-l[1])>3){B.draw.push(p);redrawBuilder();}});
const endDraw=()=>{if(!B.drawing)return;B.drawing=false;
  if(B.draw.length<30||polyLen(B.draw)<600){B.loop=null;status('That lap is too short. Draw a bigger loop.','err');}
  else{B.loop=B.draw.slice();status('Lap drawn. It closes from where you let go back to the start.','ok');}
  syncBuilder();redrawBuilder();};
bc.addEventListener('pointerup',endDraw);bc.addEventListener('pointercancel',endDraw);
// circuit from a screenshot: drop it anywhere on the page, paste it (⌘V), or click the drop area to browse
function takeImage(f){if(!f)return;if($('builder').hidden)openBuilder('upload');B.mode='upload';syncBuilder();loadFile(f);}
{const all=$('dropAll'),zone=$('dropzone');let depth=0;
  const files=e=>e.dataTransfer&&[...e.dataTransfer.types].includes('Files');
  addEventListener('dragenter',e=>{if(!files(e))return;e.preventDefault();depth++;all.hidden=false;zone.classList.add('over');});
  addEventListener('dragover',e=>{if(!files(e))return;e.preventDefault();e.dataTransfer.dropEffect='copy';});
  addEventListener('dragleave',e=>{if(!files(e))return;depth=Math.max(0,depth-1);if(!depth){all.hidden=true;zone.classList.remove('over');}});
  addEventListener('drop',e=>{if(!files(e))return;e.preventDefault();depth=0;all.hidden=true;zone.classList.remove('over');
    const fs=[...e.dataTransfer.files];takeImage(fs.find(f=>/^image\//.test(f.type))||fs[0]);});
  addEventListener('paste',e=>{if(e.target.closest&&e.target.closest('input,textarea'))return;
    const it=[...((e.clipboardData&&e.clipboardData.items)||[])].find(i=>i.type.startsWith('image/'));if(it){e.preventDefault();takeImage(it.getAsFile());}});
  zone.addEventListener('click',()=>$('fileIn').click());
  zone.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('fileIn').click();}});}

/* ================= FRAME ================= */
let camInit=false;
const camPos=new THREE.Vector3(), camLook=new THREE.Vector3(), eye=new THREE.Vector3(), vel=new THREE.Vector3(), lastCam=new THREE.Vector3();
function setRain(m,on){const r=m.userData.rain;if(r){r[0].visible=on;r[1].visible=on;}}
function syncScene(w,t,dt){
  const P=w.player;
  placeObj(player,P.s,P.lat,carYaw(P,true),0);player.updateMatrixWorld();
  if(playerGLB){const chase=ui.cam==='chase';playerGLB.visible=chase;player.visible=!chase;if(chase){playerGLB.position.copy(player.position);playerGLB.quaternion.copy(player.quaternion);setRain(playerGLB,(t*4)%1<0.5&&w.rain>0.15);}}
  key.position.set(player.position.x-18,player.position.y+42,player.position.z+12);key.target.position.copy(player.position);key.target.updateMatrixWorld();
  const roll=(m,v)=>{const wl=m.userData&&m.userData.wheels;if(wl)for(const q of wl)q.roll.rotation.x-=v*dt/q.r;};roll(player,P.v);
  const fs=P.delta!=null&&w.opts.driver==='drive'?P.delta*1.4:(P.steer||0)*0.35; player.userData.front.forEach(wh=>wh.rotation.y=-fs);
  const blink=(t*4)%1<0.5&&w.rain>0.15;
  setRain(player,blink);
  w.traffic.forEach((c,i)=>{const m=trafficMeshes[i];placeObj(m,c.s,c.lat,carYaw(c),0);setRain(m,blink||!!c.braking);roll(m,c.v);m.updateMatrixWorld();});
  w.hazards.forEach((h,i)=>{const m=hazardMeshes[i];if(!m)return;m.visible=!h.gone;if(h.gone)return;
    if(h.type==='marshal'){const run=h.moving;placeObj(m,h.s,h.lat,run?(h.dir>0?Math.PI/2:-Math.PI/2):0,0);const ph=run?Math.sin(t*14)*0.7:0;const l=m.userData.limbs;l[0].rotation.x=ph;l[1].rotation.x=-ph;l[2].rotation.x=-ph;l[3].rotation.x=ph;m.position.y+=run?Math.abs(Math.sin(t*14))*0.06:0;}
    else placeObj(m,h.s,h.lat,h.yaw,0);
    if(m.userData.rain)setRain(m,(t*2.2)%1<0.5);
    if(m.userData.beacon)m.userData.beacon.material.opacity=0.35+0.65*Math.max(0,Math.sin(t*9));});
  for(const f of flagPosts){f.userData.flags.forEach((fl,k)=>fl.rotation.y=Math.sin(t*6+k)*0.7+0.2);f.userData.led.material.color.setHex((t*2)%1<0.55?0xffcc00:0x221c00);}
  const v=P.v;
  if(ui.cam==='cockpit'){
    const sh=RM?0:(0.004+v*0.00007)+shake+(P.onWall?0.02:0);
    eye.set((Math.random()-0.5)*sh-clamp((P.ay||0)*0.0022,-0.06,0.06),1.0+(Math.random()-0.5)*sh,0.1+clamp((P.ax||0)*0.0016,-0.05,0.05));player.localToWorld(eye);camera.position.copy(eye);
    camera.quaternion.copy(player.quaternion);camera.rotateX(-0.035+(P.braking?-0.018:0.006));
    camInit=false;
  } else {
    eye.set(0,2.5,8.2);player.localToWorld(eye);camLook.set(0,0.9,-9);player.localToWorld(camLook);
    if(!camInit){camPos.copy(eye);camInit=true;}else camPos.lerp(eye,1-Math.exp(-dt*7));
    camera.position.copy(camPos);camera.lookAt(camLook);
  }
  camera.updateMatrixWorld();sky.position.copy(camera.position);
  if(dt>0){vel.copy(camera.position).sub(lastCam).divideScalar(dt);if(vel.length()>120)vel.set(0,0,0);}
  lastCam.copy(camera.position);
  // fog: a little denser than the visibility figure, plus a floodlit white-out inside another car's spray
  const sp=w.spray||0, farT=lerp(Math.min(w.vis*0.9,480),20,sp*0.92);
  scene.fog.far=lerp(scene.fog.far,farT,dt>0?1-Math.exp(-dt*(sp>0.05?7:3)):1);scene.fog.near=Math.min(scene.fog.far*0.07,14)*(1-sp*0.85);
  scene.fog.color.copy(FOG_BASE).lerp(SPRAY_C,sp*0.65);
  for(const st of STREAKS){const dx=camera.position.x-st.position.x,dz=camera.position.z-st.position.z;if(dx*dx+dz*dz<250*250)st.rotation.y=Math.atan2(-dx,-dz);}
}
function resize(){
  const r=stage.getBoundingClientRect();cw=Math.max(1,r.width);ch=Math.max(1,r.height);dpr=Math.min(window.devicePixelRatio||1,2);
  if(!resize.done){renderer.setPixelRatio(Math.min(dpr,1.75));resize.done=true;}renderer.setSize(cw,ch,false);if(composer){composer.setPixelRatio(renderer.getPixelRatio());composer.setSize(cw,ch);}resizeDrops();camera.aspect=cw/ch;camera.updateProjectionMatrix();
  dpr=Math.min(dpr,1.5);hud.width=Math.round(cw*dpr);hud.height=Math.round(ch*dpr);
  sprayMat.uniforms.uScale.value=(ch*renderer.getPixelRatio())/(2*Math.tan(FOV*Math.PI/360));
}
const visorEl=$('visor'), flashEl=$('flash'), statusEl=$('status');
const sprayFx={el:$('sprayfx'),v:-1}, rearFx={el:$('rearfx'),k:'',was:false};
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

const dropsCv=$('drops'), dctx=dropsCv.getContext('2d'), DROPS=[];
function resizeDrops(){dropsCv.width=Math.round(cw*0.6);dropsCv.height=Math.round(ch*0.6);}
function drawDrops(dt,w){
  const W=dropsCv.width,H=dropsCv.height,v=w.player.v,rain=w.rain,sp=w.spray||0;dropsCv.style.opacity=1;
  const spawn=sp*(70+v*1.4)*dt;for(let k=0;k<spawn||Math.random()<spawn-k;k++){if(DROPS.length>160)break;DROPS.push({x:Math.random()*W,y:Math.random()*H,r:1+Math.random()*(2.5+rain*3),a:0,life:1.5+Math.random()*3});}
  dctx.clearRect(0,0,W,H);const cx=W/2,cy=H*0.55,push=Math.min(1.2,v/60);
  for(let i=DROPS.length-1;i>=0;i--){const d=DROPS[i];d.a+=dt;if(d.a>d.life){DROPS.splice(i,1);continue;}
    d.x+=(d.x-cx)/W*push*140*dt;d.y+=((d.y-cy)/H*push*90+(push<0.3?14:0))*dt;
    const f=Math.min(1,d.a*4)*(1-Math.max(0,(d.a-d.life+0.6)/0.6)),g=dctx.createRadialGradient(d.x-d.r*0.3,d.y-d.r*0.35,d.r*0.1,d.x,d.y,d.r);
    g.addColorStop(0,`rgba(255,255,255,${0.55*f})`);g.addColorStop(0.35,`rgba(200,215,230,${0.12*f})`);g.addColorStop(0.85,`rgba(10,14,20,${0.28*f})`);g.addColorStop(1,'rgba(10,14,20,0)');
    dctx.fillStyle=g;dctx.beginPath();dctx.arc(d.x,d.y,d.r,0,TAU);dctx.fill();
    if(push>0.5){dctx.strokeStyle=`rgba(210,225,240,${0.08*f})`;dctx.lineWidth=d.r*0.6;dctx.beginPath();dctx.moveTo(d.x,d.y);dctx.lineTo(d.x-(d.x-cx)*0.05,d.y-(d.y-cy)*0.05);dctx.stroke();}}
}
let tPrev=performance.now(), acc=0, simT=0, statusT=0;
function frame(now){
  requestAnimationFrame(frame);
  const dt=Math.min(0.05,(now-tPrev)/1000);tPrev=now;simT+=dt;
  const w=world, inp=readInput(), T0=performance.now();
  if(running&&!w.done){acc+=dt;const h=1/120;while(acc>=h){step(w,h,inp);acc-=h;if(w.done)break;}}
  else acc=0;
  if(w.done&&running&&doneShownAt==null){doneShownAt=now;if(w.result.verdict==='contact'||w.result.verdict==='crash')shake=0.06;}
  if(doneShownAt!=null&&running&&now-doneShownAt>((w.result.verdict==='contact'||w.result.verdict==='crash')?1300:700))showResult();
  shake*=Math.exp(-dt*3);
  // free drive: report each hazard you pass
  while(w.events.length){const h=w.events.shift(),v=hazVerdict(h);runCount++;
    const r={n:runCount,verdict:v,kmh:Math.round(h.passV*3.6),warnD:h.warnD,seenD:h.firstSeenD,reactD:h.reactD,src:h.src,opts:Object.assign({},w.opts),scn:'free',track:TRACK_NAME,what:h.label};
    LOG.unshift(r);renderLog();
    toast(`<b class="${v}">${v==='safe'?'Safe pass':'Near miss'} · ${r.kmh} km/h</b>${h.label}. ${h.warnD!=null?'Radar warned '+Math.round(h.warnD)+' m out. ':''}${h.firstSeenD!=null?'In sight at '+Math.round(h.firstSeenD)+' m. ':''}${h.rdrD!=null?'On-board radar at '+Math.round(h.rdrD)+' m. ':''}${h.reactD!=null?'You braked '+Math.round(h.reactD)+' m before.':'You did not brake.'}`);}
  if(toastT>0){toastT-=dt;if(toastT<=0)$('toast').hidden=true;}
  if(running&&!w.done){const rate=w.rain*w.rain;
    w.traffic.forEach((c,i)=>{const n=Math.round(rate*clamp(c.v/50,0,1.6)*240*dt+Math.random()*0.6),m=trafficMeshes[i],vel=new THREE.Vector3(0,0,-1).applyQuaternion(m.quaternion).multiplyScalar(c.v);
      if(n>0){emitSpray(m,[-0.82,0.3,1.9],vel,n);emitSpray(m,[0.82,0.3,1.9],vel,n);emitSpray(m,[0,0.45,2.4],vel,Math.ceil(n/2));}
      const nf=Math.round(waterDepth(c.s,c.lat,w.rain)*clamp(c.v/50,0,1.6)*450*dt+Math.random()*0.5);if(nf>0&&c.v>3){emitTyreSpray(m,-1,vel,nf);emitTyreSpray(m,1,vel,nf);}});
    if(w.opts.driver==='drive'&&w.player.sliding){const sl=clamp(Math.abs(w.player.ar)*4+Math.max(0,w.player.kr)*2+Math.max(0,-w.player.kf),0,2),ns=Math.round(sl*60*dt+Math.random()*0.6);
      if(ns>0){const vel=new THREE.Vector3(0,0,-1).applyQuaternion(player.quaternion).multiplyScalar(w.player.v*0.3);emitSpray(player,[-0.8,0.35,1.6],vel,ns);emitSpray(player,[0.8,0.35,1.6],vel,ns);}}
    const n=Math.round(rate*clamp(w.player.v/50,0,1.6)*70*dt+Math.random()*0.4);if(n>0){const vel=new THREE.Vector3(0,0,-1).applyQuaternion(player.quaternion).multiplyScalar(fwdSpeed(w));emitSpray(player,[-0.82,0.3,1.9],vel,n);emitSpray(player,[0.82,0.3,1.9],vel,n);}
    {const P=w.player,nf=Math.round(waterDepth(P.s,P.lat,w.rain)*clamp(P.v/50,0,1.6)*1200*dt+Math.random()*0.5);
      if(nf>0&&P.v>3){const vel=new THREE.Vector3(0,0,-1).applyQuaternion(player.quaternion).multiplyScalar(fwdSpeed(w));emitTyreSpray(player,-1,vel,nf);emitTyreSpray(player,1,vel,nf);}}}
  const T1=performance.now();
  syncScene(w,simT,dt);
  updateSpray(dt,w.rain);updateRain(dt,camera.position,vel,w.rain);
  MINI.t-=dt;if(MINI.t<=0&&MINI.visible!==false){MINI.t=0.066;drawMiniLive(w);}
  const T2=performance.now();
  if(composer)composer.render();else renderer.render(scene,camera);
  {const sp=w.spray||0,v=Math.round((ui.cam==='cockpit'?sp:sp*0.5)*100)/100;if(v!==sprayFx.v){sprayFx.v=v;sprayFx.el.style.setProperty('--spray',v);}}
  if(ui.cam==='cockpit'&&((w.spray||0)>0.01||DROPS.length))drawDrops(dt,w);else{dropsCv.style.opacity=0;DROPS.length=0;}
  const T3=performance.now();
  drawHUD(w,simT,dt);
  rearGlow(rearFx.el,rearFx,running&&(w.opts.hud||w.opts.visor)?w.behind:null);
  const T4=performance.now();
  phoneFrame(w,simT,dt,now);
  const T5=performance.now();
  const PF=window.__perf||(window.__perf={sim:0,scene:0,gl:0,hud:0,phone:0,frame:0});const e=(k,v)=>PF[k]=PF[k]*0.95+v*0.05;
  e('sim',T1-T0);e('scene',T2-T1);e('gl',T3-T2);e('hud',T4-T3);e('phone',T5-T4);e('frame',dt*1000);
  // adaptive resolution: drop render scale when frames run long, recover when there is headroom
  PF.adapt=(PF.adapt||0)+dt;
  if(PF.adapt>2){PF.adapt=0;const pr=renderer.getPixelRatio(),cap=Math.min(window.devicePixelRatio||1,1.75);
    if(PF.frame>21&&pr>0.75){renderer.setPixelRatio(Math.max(0.75,pr-0.25));resize();}
    else if(PF.frame<15&&pr<cap){renderer.setPixelRatio(Math.min(cap,pr+0.25));resize();}}
  const o=w.opts;let va=0,vc=CAU;
  if(o.visor&&w.alert>0){if(w.alert===2){vc=DAN;va=RM?0.9:(0.35+0.65*((simT*6)%1<0.5?1:0));}else{va=0.55+(RM?0:0.12*Math.sin(simT*3));}}
  visorEl.style.setProperty('--vc',vc);visorEl.style.opacity=va.toFixed(3);
  if(w.alert===2&&lastAlert!==2&&running&&o.visor)beep();lastAlert=w.alert;
  flashEl.style.opacity=(w.done&&w.result&&(w.result.verdict==='contact'||w.result.verdict==='crash')&&running)?Math.min(1,shake*14).toFixed(2):'0';
  audioUpdate(w,running);
  statusT-=dt;if(statusT<=0){statusT=0.1;
    const P=w.player;let st;
    if(!running)st='Ready · press Start';else if(w.done)st='Run over';
    else if(o.driver==='drive')st=`${P.onWall?'On the wall! ':''}${w.touches?w.touches+' car touches · ':''}${w.scrapes?w.scrapes+' wall hits':'clean so far'}`;
    else {const a=w.hazards.find(h=>h.aware&&!h.passed);st=a?`Autopilot: ${a.src==='eyes'?'saw it, braking':a.src==='hud'?'warned by radar, slowing':'visor light, lifting'}`:'Autopilot: flat out';}
    statusEl.innerHTML=`<span><b>${SCN[w.sc.key].title}</b> · ${esc(TRACK_NAME)} · T ${w.t.toFixed(1)} s</span><span>${st}</span>`;}
}

/* ================= BOOT ================= */
new ResizeObserver(resize).observe(stage);resize();
new IntersectionObserver(es=>{MINI.visible=es[0].isIntersecting;}).observe($('miniMap'));
// everything below needs the track, which is built by the C++ core
PHYS.ready.then(()=>{
  if(!PHYS.ok){stage.insertAdjacentHTML('beforeend','<p class="noscript">The physics core (physics.wasm) did not load. Run npm run build:physics, then reload.</p>');return;}
  buildTrack(defaultLoop(),'Grand Prix circuit');physTrack();buildTrackMeshes();drawMini();
  $('rain').value=Math.round(ui.rain*100);syncControls();resetWorld();
  if(document.fonts&&document.fonts.ready)document.fonts.ready.then(()=>drawMini());
  requestAnimationFrame(frame);
  remoteInit();
});
window.__dbg={scene,renderer,sprayPts,PHYS,rainL,get tg(){return trackGroup;},hc,get world(){return world;},ui,REMOTE,kap:s=>sampleArr(KC,s),get streaks(){return STREAKS;},MATS,get pg(){return playerGLB;},get glb(){return CAR_GLB;}};
})();
