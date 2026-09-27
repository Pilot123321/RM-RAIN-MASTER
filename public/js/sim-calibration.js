/* Pure geometry and acquisition state shared by SIM AR and its regression tests. */
(function(root){
'use strict';
function frameSize(width,height,maxSide=640,maxPixels=640*480){
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return null;
  const scale=Math.min(1,maxSide/Math.max(width,height),Math.sqrt(maxPixels/(width*height)));
  return {width:Math.max(1,Math.floor(width*scale)),height:Math.max(1,Math.floor(height*scale))};
}
function cover(width,height,outWidth,outHeight){
  const scale=Math.max(outWidth/width,outHeight/height);
  return {scale,x:(outWidth-width*scale)/2,y:(outHeight-height*scale)/2};
}
function frameToCanvas(points,width,height,outWidth,outHeight){
  const c=cover(width,height,outWidth,outHeight);
  return points.map(([x,y])=>[c.x+x*c.scale,c.y+y*c.scale]);
}
function validQuad(points){
  if(!Array.isArray(points)||points.length!==4||points.some(p=>!p||p.length!==2||p.some(v=>!Number.isFinite(v))))return false;
  let sign=0,area=0;
  for(let i=0;i<4;i++){
    const a=points[i],b=points[(i+1)%4],c=points[(i+2)%4];
    const ab=Math.hypot(b[0]-a[0],b[1]-a[1]),bc=Math.hypot(c[0]-b[0],c[1]-b[1]);
    const cross=(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);
    if(ab<8||bc<8||Math.abs(cross)<0.015*ab*bc)return false;
    if(sign&&Math.sign(cross)!==sign)return false;
    sign=Math.sign(cross);area+=a[0]*b[1]-b[0]*a[1];
  }
  return Math.abs(area)/2>=256;
}
function project(h,x,y){
  const d=h[6]*x+h[7]*y+h[8];
  if(!Number.isFinite(d)||Math.abs(d)<1e-8)return null;
  const p=[(h[0]*x+h[1]*y+h[2])/d,(h[3]*x+h[4]*y+h[5])/d];
  return p.every(Number.isFinite)?p:null;
}
function validHomography(h,width,height){
  if(h.length!==9||!Array.from(h).every(Number.isFinite))return false;
  const corners=[[0,0],[width,0],[width,height],[0,height]];
  const denominators=corners.map(([x,y])=>h[6]*x+h[7]*y+h[8]);
  // The projective horizon must not cross the displayed screen, even outside the dots.
  if(!denominators.every(d=>Math.abs(d)>1e-8&&Math.sign(d)===Math.sign(denominators[0])))return false;
  return validQuad(corners.map(([x,y])=>project(h,x,y)));
}
class Tracker{
  constructor(){this.reset();}
  reset(){this.points=null;this.seen=-Infinity;this.mask=0;this.acquired=0;}
  update(mask,points,now){
    this.mask=mask;
    if(mask!==15||!validQuad(points)){this.resetAcquisition();return false;}
    // Require two consecutive complete frames to acquire. Never invent an unseen corner.
    this.acquired++;
    this.points=points.map(p=>p.slice());this.seen=now;
    return this.acquired>=2;
  }
  resetAcquisition(){this.points=null;this.acquired=0;this.seen=-Infinity;}
  ready(now){return this.acquired>=2&&this.points!==null&&now-this.seen<250;}
}
const api={frameSize,cover,frameToCanvas,validQuad,project,validHomography,Tracker};
if(typeof module==='object'&&module.exports)module.exports=api;
else root.SimCalibration=api;
})(typeof window==='undefined'?this:window);
