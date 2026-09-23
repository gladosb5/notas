// Pure online-ink feature extraction shared by the production worker and tests.
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.NOTAS_INK_FEATURES=api;
})(typeof self!=='undefined'?self:globalThis,function(){
'use strict';
const EPS=1e-6,MAX_POINTS=12000,MAX_STROKES=512;

function tracesFrom(strokes){
  if(!Array.isArray(strokes)||!strokes.length||strokes.length>MAX_STROKES)throw new Error('Invalid stroke selection.');
  const traces=[];let total=0;
  const ordered=strokes.slice().sort((a,b)=>(Number(a.t0)||0)-(Number(b.t0)||0));
  for(const st of ordered){
    const pts=st.pts;if(!Array.isArray(pts)||pts.length<3||pts.length%3)continue;
    const n=pts.length/3;if((total+=n)>MAX_POINTS)throw new Error('Select a smaller expression.');
    const t0=Number(st.t0)||0,t1=Number(st.t1),end=Number.isFinite(t1)&&t1>t0?t1:t0+Math.max(1,n-1),trace=[];
    const times=Array.isArray(st.times)&&st.times.length===n&&st.times.every((v,i,a)=>Number.isFinite(Number(v))&&Number(v)>=0&&(!i||Number(v)>=Number(a[i-1])))?st.times:null;
    for(let i=0;i<n;i++){
      const x=Number(pts[i*3]),y=Number(pts[i*3+1]);
      if(!Number.isFinite(x)||!Number.isFinite(y))continue;
      // New notes retain genuine point intervals. Old notes and imported legacy
      // strokes still get deterministic interpolation across their stroke span.
      const t=times?t0+Number(times[i]):(n===1?t0:t0+(end-t0)*i/(n-1));
      trace.push([x,y,t]);
    }
    if(trace.length)traces.push(trace);
  }
  if(!traces.length)throw new Error('No usable pen strokes found.');
  return traces;
}

function features(strokes){
  const traces=tracesFrom(strokes),all=traces.flat(),xs=all.map(p=>p[0]),ys=all.map(p=>p[1]),ts=all.map(p=>p[2]);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys),minT=Math.min(...ts),maxT=Math.max(...ts);
  const xyRange=Math.max(maxX-minX,maxY-minY)+EPS,tRange=maxT-minT+EPS;
  const norm=traces.map(trace=>trace.map(([x,y,t])=>[(x-minX)/xyRange,(y-minY)/xyRange,(t-minT)/tRange]));
  const exprMinY=Math.min(...norm.flat().map(p=>p[1])),exprMaxY=Math.max(...norm.flat().map(p=>p[1])),exprYSpan=exprMaxY-exprMinY+EPS,rows=[];
  for(const trace of norm){
    const n=trace.length,speed=new Float64Array(n),ux=new Float64Array(n),uy=new Float64Array(n),dist=new Float64Array(n);
    let traceMin=Infinity,traceMax=-Infinity;for(const p of trace){traceMin=Math.min(traceMin,p[1]);traceMax=Math.max(traceMax,p[1]);}
    for(let i=0;i<n;i++){
      let dx=0,dy=0,dt=0;
      if(i){dx=trace[i][0]-trace[i-1][0];dy=trace[i][1]-trace[i-1][1];dt=trace[i][2]-trace[i-1][2];dist[i]=Math.hypot(dx,dy);speed[i]=dt>EPS?dist[i]/dt:0;ux[i]=dist[i]>EPS?dx/dist[i]:0;uy[i]=dist[i]>EPS?dy/dist[i]:0;}
      let curve=0,acc=0;if(i){acc=dt>EPS?(speed[i]-speed[i-1])/dt:0;if(i>1){const theta=Math.atan2(ux[i-1]*uy[i]-uy[i-1]*ux[i],ux[i-1]*ux[i]+uy[i-1]*uy[i]);curve=dist[i]>EPS?theta/dist[i]:0;}}
      rows.push([trace[i][0],trace[i][1],trace[i][2],dx,dy,dt,speed[i],curve,acc,i===0?1:0,((traceMin+traceMax)/2-exprMinY)/exprYSpan,(traceMax-traceMin)/exprYSpan]);
    }
  }
  for(const col of [3,4,5,6,7,8]){
    const mean=rows.reduce((s,r)=>s+r[col],0)/rows.length;
    const variance=rows.reduce((s,r)=>s+(r[col]-mean)**2,0)/rows.length,std=Math.sqrt(variance)+EPS;
    for(const row of rows)row[col]=Math.max(-5,Math.min(5,(row[col]-mean)/std));
  }
  return {data:Float32Array.from(rows.flat()),points:rows.length};
}
function resample(strokes,factor){
  if(!Number.isFinite(factor)||factor<.5||factor>1.5)throw new Error('Invalid pen sampling factor.');
  return tracesFrom(strokes).map(trace=>{
    const count=trace.length,length=count<2?count:Math.max(2,Math.round((count-1)*factor)+1),pts=[],times=[],t0=trace[0][2];
    for(let i=0;i<length;i++){
      const at=length===1?0:i*(count-1)/(length-1),a=Math.floor(at),b=Math.min(count-1,a+1),mix=at-a;
      pts.push(trace[a][0]*(1-mix)+trace[b][0]*mix,trace[a][1]*(1-mix)+trace[b][1]*mix,.5);
      times.push(trace[a][2]*(1-mix)+trace[b][2]*mix-t0);
    }
    return {t0,t1:trace[count-1][2],pts,times};
  });
}
return {tracesFrom,features,resample};
});
