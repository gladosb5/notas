/* =========================================================================
   DIAGRAM - what is drawn on the page, as opposed to written on it.
   The readers turn writing into words and formulas; a box, a circle, an
   arrow or a pair of axes is none of those, and nota was told nothing about
   them. Here the drawn strokes are told apart from the writing by shape,
   put together into what they draw (a triangle, a flowchart's boxes and the
   arrows between them, a food chain, a Venn diagram, a graph and its curve)
   and the writing round them is attached to the part it labels. The result
   is a few lines of plain text that stand in the page's context where the
   drawing is, so the drawing goes to the model as words: never as ink or a
   picture.

   Everything here is geometry on stroke points, with no reader and no page:
   find() takes strokes and returns the drawings with the stroke groups that
   label them; describe() takes one drawing and the labels' readings and
   returns its text. The caller reads the labels in between.
   ========================================================================= */
(function(root){
'use strict';

/* ---- geometry ---- */
const hyp=Math.hypot;
function pointsOf(st){const p=st.pts||[],out=[];for(let i=0;i+1<p.length;i+=3)out.push([p[i],p[i+1]]);return out;}
function boxOf(pts){let a=Infinity,b=Infinity,c=-Infinity,d=-Infinity;for(const q of pts){if(q[0]<a)a=q[0];if(q[1]<b)b=q[1];if(q[0]>c)c=q[0];if(q[1]>d)d=q[1];}return [a,b,c,d];}
function joinBox(a,b){return a?[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[2],b[2]),Math.max(a[3],b[3])]:b.slice();}
function grow(b,r){return [b[0]-r,b[1]-r,b[2]+r,b[3]+r];}
function mid(b){return [(b[0]+b[2])/2,(b[1]+b[3])/2];}
function boxesMeet(a,b){return a[0]<=b[2]&&b[0]<=a[2]&&a[1]<=b[3]&&b[1]<=a[3];}
function sub(a,b){return [a[0]-b[0],a[1]-b[1]];}
function dot(a,b){return a[0]*b[0]+a[1]*b[1];}
function unit(v){const L=hyp(v[0],v[1])||1;return [v[0]/L,v[1]/L];}
function dist(a,b){return hyp(a[0]-b[0],a[1]-b[1]);}
function pathLength(pts){let L=0;for(let i=1;i<pts.length;i++)L+=dist(pts[i],pts[i-1]);return L;}
/* the angle at b between the arms to a and c, in degrees */
function cornerAngle(a,b,c){const u=unit(sub(a,b)),v=unit(sub(c,b));return Math.acos(Math.max(-1,Math.min(1,dot(u,v))))*180/Math.PI;}
function simplify(pts,tol){
  if(pts.length<3)return pts.slice();
  const keep=new Uint8Array(pts.length);keep[0]=keep[pts.length-1]=1;
  const stack=[[0,pts.length-1]];
  while(stack.length){
    const [a,b]=stack.pop();let far=-1,best=tol;
    for(let i=a+1;i<b;i++){const d=segDist(pts[i],pts[a],pts[b]);if(d>best){best=d;far=i;}}
    if(far>=0){keep[far]=1;stack.push([a,far],[far,b]);}
  }
  return pts.filter((p,i)=>keep[i]);
}
function closest(p,a,b){
  const d=sub(b,a),L=dot(d,d);
  const t=L?Math.max(0,Math.min(1,dot(sub(p,a),d)/L)):0;
  return {t,at:[a[0]+t*d[0],a[1]+t*d[1]]};
}
function segDist(p,a,b){return dist(p,closest(p,a,b).at);}
/* the nearest point of a path, and how far along the path it is (0..1) */
function nearOnPath(p,path){
  let best=Infinity,where=0,at=path[0],walked=0;
  const total=pathLength(path)||1;
  if(path.length===1)return {d:dist(p,path[0]),along:0,at:path[0]};
  for(let i=1;i<path.length;i++){
    const c=closest(p,path[i-1],path[i]),d=dist(p,c.at),seg=dist(path[i-1],path[i]);
    if(d<best){best=d;where=(walked+c.t*seg)/total;at=c.at;}
    walked+=seg;
  }
  return {d:best,along:where,at};
}
function segmentsCross(a,b,c,d){
  const r=sub(b,a),s=sub(d,c),den=r[0]*s[1]-r[1]*s[0];
  if(Math.abs(den)<1e-9)return false;
  const q=sub(c,a),t=(q[0]*s[1]-q[1]*s[0])/den,u=(q[0]*r[1]-q[1]*r[0])/den;
  return t>=0&&t<=1&&u>=0&&u<=1;
}
function pathsCross(p,q){
  for(let i=1;i<p.length;i++)for(let j=1;j<q.length;j++)if(segmentsCross(p[i-1],p[i],q[j-1],q[j]))return true;
  return false;
}
function inside(p,poly){
  let yes=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const a=poly[i],b=poly[j];
    if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;
  }
  return yes;
}
function area(poly){let s=0;for(let i=0,j=poly.length-1;i<poly.length;j=i++)s+=(poly[j][0]+poly[i][0])*(poly[j][1]-poly[i][1]);return Math.abs(s)/2;}
/* how far a box is from a path: 0 when the path runs through it */
function boxPathDist(b,path){
  const c=[[b[0],b[1]],[b[2],b[1]],[b[2],b[3]],[b[0],b[3]]];
  let best=Infinity;
  for(let i=0;i<path.length;i++){
    const p=path[i];
    if(p[0]>=b[0]&&p[0]<=b[2]&&p[1]>=b[1]&&p[1]<=b[3])return 0;
    if(i){
      for(let k=0;k<4;k++){
        if(segmentsCross(path[i-1],p,c[k],c[(k+1)%4]))return 0;
        best=Math.min(best,segDist(c[k],path[i-1],p));
      }
    }
    best=Math.min(best,boxPointDist(b,p));
  }
  return best;
}
function boxPointDist(b,p){return hyp(Math.max(b[0]-p[0],p[0]-b[2],0),Math.max(b[1]-p[1],p[1]-b[3],0));}

/* ---- a stroke, measured ---- */
function measure(st){
  const pts=pointsOf(st),b=st.bbox&&st.bbox.length===4?st.bbox:boxOf(pts);
  const w=b[2]-b[0],h=b[3]-b[1],size=Math.max(w,h),len=pathLength(pts);
  const chord=pts.length>1?dist(pts[0],pts[pts.length-1]):0;
  const v=simplify(pts,Math.max(2,size*.05));
  return {st,id:st.id,pts,b,w,h,size,len,chord,v,
    closed:pts.length>=6&&chord<=Math.max(8,size*.22)&&len>=size*1.9,
    straight:pts.length>1&&len>0&&chord>=len*.92};
}
/* back-and-forth in x and y: a word in joined-up writing turns back on
   itself again and again; a drawn curve, bend or arc hardly ever */
function reversals(v,min){
  let n=0;
  for(const k of [0,1]){
    let sign=0;
    for(let i=1;i<v.length;i++){
      const d=v[i][k]-v[i-1][k];
      if(Math.abs(d)<min)continue;
      const s=Math.sign(d);if(sign&&s!==sign)n++;sign=s;
    }
  }
  return n;
}

/* ---- arrowheads ----
   A head drawn in the same stroke as its shaft: at one end the pen turns
   sharply back, and what follows the turn is short beside the shaft and
   stays behind the tip. The tip and the shaft's direction there are kept;
   the shaft is the stroke without its head. */
function headInStroke(v,H){
  const tryEnd=list=>{
    /* the earliest turn after which everything stays behind the tip: a
       head drawn out, back and out again is all head */
    for(let k=Math.max(1,list.length-5);k<=list.length-2;k++){
      const tip=list[k],shaft=list.slice(0,k+1),tail=list.slice(k);
      const shaftLen=pathLength(shaft);
      if(shaftLen<1.2*H)continue;
      /* the direction at the tip is taken over the last stretch of the
         shaft, not its last little wobble */
      let back=k-1;while(back>0&&dist(list[back],tip)<Math.min(shaftLen*.3,H))back--;
      const dir=unit(sub(tip,list[back]));
      let far=0;for(const q of tail)far=Math.max(far,dist(q,tip));
      if(far<Math.max(6,.4*H,shaftLen*.1)||far>Math.min(2.5*H,shaftLen*.4))continue;
      /* barbs on both sides make a head; a single one is the flick of a
         pen lifting off a bar or a bracket unless a separate barb answers
         it on the other side (see headStrokeAt) */
      let ok=true,left=0,right=0;
      for(const q of tail.slice(1)){
        const d=sub(q,tip),L=hyp(d[0],d[1]);
        if(L<far*.3)continue;
        const c=dot(d,dir)/L;
        if(c>-.15||c<-.985){ok=false;break;}
        const cross=(d[0]*dir[1]-d[1]*dir[0])/L;
        if(cross>.17)left=Math.max(left,L);else if(cross<-.17)right=Math.max(right,L);
      }
      if(ok&&(left||right))return {k,tip,dir,shaft,half:!(left&&right),side:left?1:-1};
    }
    return null;
  };
  const end=tryEnd(v);
  const rest=end?end.shaft:v;
  const start=tryEnd(rest.slice().reverse());
  const shaft=start?start.shaft.slice().reverse():rest;
  return {start,end,shaft};
}
/* A head drawn as strokes of its own: a V whose point sits on the end of
   the shaft and opens back along it, or two short barbs leaving the end
   backwards on either side. */
function headStrokeAt(m,end,dir,H,shaftLen){
  if(m.size>Math.min(2.5*H,shaftLen*.45)||m.size<Math.max(3,.2*H))return false;
  const tol=Math.max(9,.9*H);
  const v=simplify(m.pts,Math.max(1.5,m.size*.12));
  if(v.length===3||v.length===4){
    let k=1;if(v.length===4)k=cornerAngle(v[0],v[1],v[2])<cornerAngle(v[1],v[2],v[3])?1:2;
    const apex=v[k],a=v[0],c=v[v.length-1],ang=cornerAngle(a,apex,c);
    /* the point at the end of the shaft, not short of it, and the V
       opening straight back along it with an arm either side */
    if(dist(apex,end)<=tol&&ang>=15&&ang<=135&&dot(sub(apex,end),dir)>=-.4*H){
      const opening=unit([(a[0]+c[0])/2-apex[0],(a[1]+c[1])/2-apex[1]]);
      const side=q=>{const d=sub(q,apex);return d[0]*dir[1]-d[1]*dir[0];};
      if(dot(opening,dir)<-.75&&side(a)*side(c)<0)return true;
    }
  }
  if(m.straight&&m.len<=Math.max(2.2*H,shaftLen*.5)){
    const p=m.pts[0],q=m.pts[m.pts.length-1];
    for(const [near,far] of [[p,q],[q,p]]){
      if(dist(near,end)>tol)continue;
      const c=dot(unit(sub(far,near)),dir);
      if(c<-.25&&c>-.97)return 'barb';
    }
  }
  if(m.closed&&m.size<=Math.max(1.6*H,shaftLen*.4)&&boxPointDist(m.b,end)<=tol*.5)return true;
  return false;
}

/* a bar drawn as one stroke standing on an axis: up, across, down */
function archOf(path,H){
  const v=simplify(path,Math.max(3,.3*H));
  if(v.length!==4)return null;
  const [a,b,c,d]=v,up=(p,q)=>Math.abs(p[0]-q[0])<=Math.abs(p[1]-q[1])*.3;
  if(!up(a,b)||!up(c,d)||Math.abs(b[1]-c[1])>Math.abs(b[0]-c[0])*.3||Math.abs(a[1]-d[1])>.8*H)return null;
  const base=(a[1]+d[1])/2,top=(b[1]+c[1])/2;
  if(base-top<H)return null;
  return {l:Math.min((a[0]+b[0])/2,(c[0]+d[0])/2),r:Math.max((a[0]+b[0])/2,(c[0]+d[0])/2),top,base};
}

/* the flick of a pen landing on or lifting off a line, taken off it so
   a bar with a hook is still straight */
function unhook(v,H){
  let out=v.slice();
  for(let guard=0;guard<4&&out.length>2;guard++){
    const total=pathLength(out),cut=Math.max(.45*H,total*.12);
    if(dist(out[out.length-1],out[out.length-2])<=cut&&cornerAngle(out[out.length-3],out[out.length-2],out[out.length-1])<120){out=out.slice(0,-1);continue;}
    if(dist(out[0],out[1])<=cut&&cornerAngle(out[0],out[1],out[2])<120){out=out.slice(1);continue;}
    break;
  }
  return out;
}

/* ---- closed outlines: what shape they are ---- */
function outlineKind(loop,size){
  const b=boxOf(loop),w=b[2]-b[0],h=b[3]-b[1];
  const cx=(b[0]+b[2])/2,cy=(b[1]+b[3])/2,rx=Math.max(1,w/2),ry=Math.max(1,h/2);
  let dev=0,worst=0;
  for(const p of loop){const e=Math.abs(hyp((p[0]-cx)/rx,(p[1]-cy)/ry)-1);dev+=e;worst=Math.max(worst,e);}
  dev/=loop.length;
  /* corners: the loop opened at its point furthest from the start, each
     half simplified, then corners that are hardly corners dropped */
  let far=0;for(let i=1;i<loop.length;i++)if(dist(loop[0],loop[i])>dist(loop[0],loop[far]))far=i;
  const tol=size*.06;
  let corners=[...simplify(loop.slice(0,far+1),tol).slice(0,-1),...simplify([...loop.slice(far),loop[0]],tol).slice(0,-1)];
  for(let changed=true;changed&&corners.length>3;){
    changed=false;
    for(let i=0;i<corners.length&&corners.length>3;i++){
      const a=corners[(i+corners.length-1)%corners.length],c=corners[(i+1)%corners.length];
      if(cornerAngle(a,corners[i],c)>155||dist(a,corners[i])<size*.08){corners.splice(i,1);changed=true;break;}
    }
  }
  let fit=0;
  for(const p of loop){let d=Infinity;for(let i=0;i<corners.length;i++)d=Math.min(d,segDist(p,corners[i],corners[(i+1)%corners.length]));fit=Math.max(fit,d);}
  const round=dev<.085&&worst<.2;
  if(round&&(corners.length>4||fit>size*.07))return {kind:Math.abs(w-h)<=Math.max(w,h)*.18?'circle':'ellipse',corners:null};
  if(corners.length>=3&&corners.length<=6&&fit<=size*.09)return {kind:polygonKind(corners,b),corners};
  if(round)return {kind:Math.abs(w-h)<=Math.max(w,h)*.18?'circle':'ellipse',corners:null};
  return {kind:'closed shape',corners:null};
}
function polygonKind(c,b){
  if(c.length===3)return 'triangle';
  if(c.length===5)return 'pentagon';
  if(c.length===6)return 'hexagon';
  const w=b[2]-b[0],h=b[3]-b[1];
  const angles=c.map((p,i)=>cornerAngle(c[(i+3)%4],p,c[(i+1)%4]));
  const square=angles.every(a=>Math.abs(a-90)<16);
  const dir=i=>unit(sub(c[(i+1)%4],c[i]));
  const parallel=(i,j)=>Math.abs(Math.abs(dot(dir(i),dir(j)))-1)<.03;
  const axis=i=>{const d=dir(i);return Math.abs(d[0])>.97||Math.abs(d[1])>.97;};
  if(square)return Math.abs(w-h)<=Math.max(w,h)*.12&&axis(0)?'square':'rectangle';
  /* a decision box: each corner near the middle of a side of its box */
  const onMid=c.every(p=>Math.min(Math.abs(p[0]-(b[0]+b[2])/2)/w+Math.min(Math.abs(p[1]-b[1]),Math.abs(p[1]-b[3]))/h,
    Math.abs(p[1]-(b[1]+b[3])/2)/h+Math.min(Math.abs(p[0]-b[0]),Math.abs(p[0]-b[2]))/w)<.2);
  if(onMid)return 'diamond';
  const p02=parallel(0,2),p13=parallel(1,3);
  if(p02&&p13)return 'parallelogram';
  if(p02||p13)return 'trapezium';
  return 'quadrilateral';
}

/* ---- labels: the writing beside and inside a drawing, in word groups ----
   Writing strokes close on a row join, as do a dot over its stem and the
   parts of a stacked fraction; nothing joins across a drawn line, so the
   two ends of an arrow, or two boxes side by side, keep their own words. */
function labelGroups(list,H,walls){
  const parent=list.map((_,i)=>i),find=i=>parent[i]===i?i:(parent[i]=find(parent[i]));
  const order=list.map((_,i)=>i).sort((a,b)=>list[a].b[0]-list[b].b[0]);
  const blocked=(p,q)=>{
    const a=mid(p.b),c=mid(q.b),box=[Math.min(a[0],c[0]),Math.min(a[1],c[1]),Math.max(a[0],c[0]),Math.max(a[1],c[1])];
    for(const w of walls){if(!boxesMeet(grow(box,1),w.b))continue;if(pathsCross([a,c],w.v))return true;}
    return false;
  };
  for(let x=0;x<order.length;x++){
    const p=list[order[x]];
    for(let y=x+1;y<order.length;y++){
      const q=list[order[y]];
      if(q.b[0]-p.b[2]>.9*H&&q.b[0]>p.b[2])continue;
      const dx=Math.max(p.b[0]-q.b[2],q.b[0]-p.b[2],0),dy=Math.max(p.b[1]-q.b[3],q.b[1]-p.b[3],0);
      const vo=Math.min(p.b[3],q.b[3])-Math.max(p.b[1],q.b[1]),ho=Math.min(p.b[2],q.b[2])-Math.max(p.b[0],q.b[0]);
      const row=dx<=.85*H&&vo>=Math.min(p.h,q.h,H)*.25;
      const stacked=dy<=.45*H&&ho>=Math.min(p.w,q.w)*.3;
      if((row||stacked)&&find(order[x])!==find(order[y])&&!blocked(p,q))parent[find(order[x])]=find(order[y]);
    }
  }
  const sets=new Map();
  list.forEach((m,i)=>{const r=find(i);if(!sets.has(r))sets.set(r,[]);sets.get(r).push(m);});
  return [...sets.values()].map(ms=>{
    const b=ms.reduce((a,m)=>joinBox(a,m.b),null);
    return {strokeIds:ms.map(m=>m.id),b,w:b[2]-b[0],h:b[3]-b[1]};
  });
}

/* ---- finding the drawings ---- */
function find(strokes,opts={}){
  const skip=opts.skip||new Set();
  const all=[];
  for(const st of strokes||[])if(st&&!skip.has(st.id)&&Array.isArray(st.pts)&&st.pts.length>=3)all.push(measure(st));
  const H=opts.H||handOf(all);
  const used=new Set();
  const shapes=[];

  /* single closed strokes */
  for(const m of all){
    if(!m.closed||m.size<Math.max(28,2*H)||Math.min(m.w,m.h)<Math.max(10,.9*H))continue;
    const loop=m.pts.slice();
    const k=outlineKind(loop,m.size);
    shapes.push({kind:k.kind,corners:k.corners,outline:k.corners||simplify(loop,Math.max(1.5,m.size*.02)),b:m.b,strokeIds:[m.id]});
    used.add(m.id);
  }

  /* open strokes that could be drawn: long straight lines, and bends,
     arcs and curves that are too big and too smooth to be writing */
  const open=[];
  for(const m of all){
    if(used.has(m.id)||m.pts.length<2)continue;
    const heads=headInStroke(m.v,H);
    const shaft=heads.start||heads.end?heads.shaft:unhook(heads.shaft,H),shaftLen=pathLength(shaft);
    const sb=boxOf(shaft),sw=sb[2]-sb[0],sh=sb[3]-sb[1];
    const straight=shaftLen>0&&dist(shaft[0],shaft[shaft.length-1])>=shaftLen*.92;
    const smooth=reversals(shaft,Math.max(3,.4*H))<=2&&m.len<=1.6*(m.w+m.h)+2*H;
    const headed=!!(heads.start||heads.end);
    let kind=null;
    if(straight&&shaftLen>=Math.max(14,1.0*H))kind='line';
    else if(!straight&&smooth&&Math.max(sw,sh)>=Math.max(30,2.4*H))kind='bend';
    if(!kind)continue;
    if(radical(m,H))continue;
    open.push({m,heads,shaft,len:shaftLen,kind,headed});
  }

  /* outlines made of several strokes: box sides drawn one by one, a
     triangle as a roof and a base. Ends that meet are joined; a loop the
     strokes close is a shape, the largest loop first, so a rectangle with
     a diagonal is a rectangle and a line across it. */
  const edges=open.filter(o=>!o.headed&&(o.kind==='line'||o.kind==='bend'));
  const tol=Math.max(8,.75*H);
  /* ends are matched through a grid, so a page of writing, whose letter
     stems are all candidate edges, costs no more than its strokes */
  const nodes=[],grid=new Map(),cell=p=>Math.floor(p[0]/tol)+','+Math.floor(p[1]/tol);
  const nodeAt=p=>{
    const cx=Math.floor(p[0]/tol),cy=Math.floor(p[1]/tol);
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const n of grid.get((cx+dx)+','+(cy+dy))||[]){
      if(dist(n.p,p)<=tol){n.n++;n.p=[(n.p[0]*(n.n-1)+p[0])/n.n,(n.p[1]*(n.n-1)+p[1])/n.n];return n;}
    }
    const n={p:p.slice(),n:1,id:nodes.length};nodes.push(n);
    const k=cell(p);if(!grid.has(k))grid.set(k,[]);grid.get(k).push(n);
    return n;
  };
  const graph=edges.map(e=>({e,a:nodeAt(e.shaft[0]),z:nodeAt(e.shaft[e.shaft.length-1]),b:boxOf(e.shaft)}));
  /* an end overshooting a corner meets the other stroke near its end */
  const ends=new Map();for(const g of graph)for(const n of [g.a,g.z])ends.set(n,(ends.get(n)||0)+1);
  for(const g of graph)for(const end of ['a','z']){
    if(ends.get(g[end])>1)continue;
    const p=end==='a'?g.e.shaft[0]:g.e.shaft[g.e.shaft.length-1];
    for(const o of graph){
      if(o===g||boxPointDist(o.b,p)>tol*.7)continue;
      const near=nearOnPath(p,o.e.shaft);
      if(near.d>tol*.7)continue;
      if(near.along<.2)g[end]=o.a;else if(near.along>.8)g[end]=o.z;
      else continue;
      break;
    }
  }
  /* loops are looked for among strokes whose ends meet, a group at a time,
     the largest loop of a group first */
  const root=new Map(),top=n=>{while(root.has(n)&&root.get(n)!==n)n=root.get(n);return n;};
  for(const g of graph){for(const n of [g.a,g.z])if(!root.has(n))root.set(n,n);const x=top(g.a),y=top(g.z);if(x!==y)root.set(x,y);}
  const touching=new Map();for(const g of graph){if(g.a===g.z)continue;const r=top(g.a);if(!touching.has(r))touching.set(r,[]);touching.get(r).push(g);}
  for(const group of touching.values()){
    if(group.length<2)continue;
    const inLoop=new Set();
    for(let guard=0;guard<12;guard++){
      const cycle=bestCycle(group.filter(g=>!inLoop.has(g)));
      if(!cycle)break;
      const loop=[];
      for(const {g,forward} of cycle){const s=forward?g.e.shaft:g.e.shaft.slice().reverse();loop.push(...(loop.length?s.slice(1):s));}
      const lb=boxOf(loop),size=Math.max(lb[2]-lb[0],lb[3]-lb[1]);
      if(size<Math.max(28,1.8*H)||Math.min(lb[2]-lb[0],lb[3]-lb[1])<Math.max(10,.9*H)||area(loop)<size*size*.08){for(const c of cycle)inLoop.add(c.g);continue;}
      const raw=[];for(const {g,forward} of cycle){const s=forward?g.e.m.pts:g.e.m.pts.slice().reverse();raw.push(...s);}
      const k=outlineKind(raw,size);
      shapes.push({kind:k.kind,corners:k.corners,outline:k.corners||simplify(loop,Math.max(1.5,size*.02)),b:lb,strokeIds:cycle.map(c=>c.g.e.m.id)});
      for(const c of cycle){inLoop.add(c.g);used.add(c.g.e.m.id);}
    }
  }

  /* what is left over and long enough is a line or an arrow */
  const rest=open.filter(o=>!used.has(o.m.id));
  const smalls=all.filter(m=>!used.has(m.id)&&m.size<=Math.max(2.6*H,40));
  const connectors=[];
  for(const o of rest){
    /* a letter's stem is a short straight stroke too: a line has to be
       well longer than the writing, an arrow somewhat longer */
    if(o.kind==='line'&&o.len<1.8*H)continue;
    const shaft=o.shaft,a=shaft[0],z=shaft[shaft.length-1];
    const dirA=unit(sub(a,shaft[Math.min(1,shaft.length-1)])),dirZ=unit(sub(z,shaft[Math.max(0,shaft.length-2)]));
    const whole=h=>!!h&&!h.half;
    const c={kind:'line',curved:o.kind==='bend',path:shaft,a,z,dirA,dirZ,headA:whole(o.heads.start),headZ:whole(o.heads.end),
      halfA:o.heads.start&&o.heads.start.half?o.heads.start.side:0,halfZ:o.heads.end&&o.heads.end.half?o.heads.end.side:0,strokeIds:[o.m.id],len:o.len,m:o.m};
    connectors.push(c);
  }
  /* separate head strokes, claimed by the nearest end that takes them */
  const claimed=new Set();
  for(const c of connectors){
    for(const end of ['A','Z']){
      if(c['head'+end])continue;
      const p=end==='A'?c.a:c.z,dir=end==='A'?c.dirA:c.dirZ;
      let barbs=[];
      for(const m of smalls){
        if(claimed.has(m.id)||c.strokeIds.includes(m.id)||boxPointDist(m.b,p)>Math.max(9,.9*H))continue;
        const r=headStrokeAt(m,p,dir,H,c.len);
        if(r===true){c['head'+end]=true;c.strokeIds.push(m.id);claimed.add(m.id);barbs=[];break;}
        if(r==='barb')barbs.push(m);
      }
      /* barbs either side of the end; a hook drawn with the shaft counts as one */
      const half=c['half'+end],sideOf=m=>{const q=dist(m.pts[0],p)<dist(m.pts[m.pts.length-1],p)?m.pts[m.pts.length-1]:m.pts[0],d=sub(q,p);return Math.sign(d[0]*dir[1]-d[1]*dir[0]);};
      const left=barbs.find(m=>sideOf(m)>0),right=barbs.find(m=>sideOf(m)<0);
      const pair=half?(half>0?right:left)?[half>0?right:left]:null:left&&right?[left,right]:null;
      if(pair){c['head'+end]=true;for(const m of pair){c.strokeIds.push(m.id);claimed.add(m.id);}}
    }
  }
  for(const c of connectors)if(c.headA||c.headZ)c.kind='arrow';
  for(let i=connectors.length-1;i>=0;i--){const c=connectors[i];if(c.kind==='line'&&!c.curved&&c.len<3*H)connectors.splice(i,1);}

  /* what the writing nearby says a line is not: a fraction bar has
     writing over and under its middle, an underline has writing on top of
     it, a crossing out runs through words, an equals sign is two lines */
  const writingAll=all.filter(m=>!used.has(m.id)&&!claimed.has(m.id)&&m.size<Math.max(2.6*H,40));
  const keep=[];
  for(const c of connectors){
    const zone=grow(boxOf(c.path),2*H),writingNear=writingAll.filter(m=>boxesMeet(m.b,zone));
    if(!c.curved){
      const d=unit(sub(c.z,c.a)),flat=Math.abs(d[1])<.2;
      if(flat){
        const l=Math.min(c.a[0],c.z[0]),r=Math.max(c.a[0],c.z[0]),y=(c.a[1]+c.z[1])/2,span=r-l;
        const m0=l+span*.2,m1=r-span*.2;
        const over=writingNear.filter(m=>m.b[3]<=y+.3*H&&y-m.b[3]<=1.8*H&&m.b[2]>m0&&m.b[0]<m1);
        const under=writingNear.filter(m=>m.b[1]>=y-.3*H&&m.b[1]-y<=1.8*H&&m.b[2]>m0&&m.b[0]<m1);
        if(over.length&&under.length&&span<12*H)continue;
        let covered=0;for(const m of over)if(y-m.b[3]<=.8*H&&m.b[3]<=y+.3*H)covered+=Math.min(r,m.b[2])-Math.max(l,m.b[0]);
        if(c.kind==='line'&&covered>=span*.45&&!under.length)continue;
      }
      const om=o=>[(o.a[0]+o.z[0])/2,(o.a[1]+o.z[1])/2];
      if(c.kind==='line'&&c.len<6*H&&connectors.some(o=>o!==c&&o.kind==='line'&&!o.curved&&Math.abs(dot(unit(sub(o.z,o.a)),d))>.97&&nearOnPath(om(o),c.path).d<.8*H&&Math.abs(o.len-c.len)<c.len*.35))continue;
    }
    let through=0;
    const along=unit(sub(c.z,c.a));
    /* writing close over or under the middle stretch of a line */
    const across=[-along[1],along[0]];
    const sides=new Set();
    for(const m of writingNear){
      const q=mid(m.b),n=nearOnPath(q,c.path);
      if(n.along>.2&&n.along<.8&&n.d<=1.5*H){const off=dot(sub(q,n.at),across);if(Math.abs(off)>.2*H)sides.add(Math.sign(off));}
    }
    c.crowded=sides.size>=2;
    for(const m of writingNear){
      if(boxPathDist(m.b,c.path)>0)continue;
      /* a tick across a line is not a crossed-out word */
      if(m.straight&&m.len>2&&Math.abs(dot(unit(sub(m.pts[m.pts.length-1],m.pts[0])),along))<.35)continue;
      const n=nearOnPath(mid(m.b),c.path);if(n.along>.15&&n.along<.85)through++;
    }
    if(through>=3)continue;
    /* a bracket, a root sign or a big sigma bends round writing; a drawn
       curve between things does not have it tucked inside */
    if(c.curved&&c.kind==='line'&&!archOf(c.path,H)){
      const cb=boxOf(c.path);let held=0;
      for(const m of writingNear){const q=mid(m.b);if(q[0]>cb[0]&&q[0]<cb[2]&&q[1]>cb[1]&&q[1]<cb[3]&&nearOnPath(q,c.path).along>.1&&nearOnPath(q,c.path).along<.9)held++;}
      if(held>=2)continue;
    }
    keep.push(c);
  }
  connectors.length=0;connectors.push(...keep);

  /* axes: two long lines across each other, or meeting in an L, with room
     to the right and upwards; ticks across them are part of them */
  const axesList=[];
  const flat=c=>!c.curved&&Math.abs(unit(sub(c.z,c.a))[1])<.2&&c.len>=4*H;
  const tall=c=>!c.curved&&Math.abs(unit(sub(c.z,c.a))[0])<.2&&c.len>=4*H;
  for(const hx of connectors.filter(flat))for(const vy of connectors.filter(tall)){
    if(hx.axis||vy.axis)continue;
    const hl=Math.min(hx.a[0],hx.z[0]),hr=Math.max(hx.a[0],hx.z[0]),hy=(hx.a[1]+hx.z[1])/2;
    const vt=Math.min(vy.a[1],vy.z[1]),vb=Math.max(vy.a[1],vy.z[1]),vx=(vy.a[0]+vy.z[0])/2;
    const t=Math.max(10,1.2*H);
    if(vx<hl-t||vx>hr+t||hy<vt-t||hy>vb+t)continue;
    if(hr-vx<3*H||hy-vt<3*H)continue;
    const o=[vx,hy];
    /* two cuts of a pie meet like axes, but inside the circle */
    if(shapes.some(sh=>inside(o,sh.outline)))continue;
    const ax={origin:o,xEnd:[hr,hy],xStart:[hl,hy],yEnd:[vx,vt],yStart:[vx,vb],strokeIds:[...hx.strokeIds,...vy.strokeIds],ticksX:0,ticksY:0};
    hx.axis=vy.axis=true;axesList.push(ax);
  }
  /* an L drawn in one stroke */
  for(const c of connectors){
    if(!c.curved||c.axis)continue;
    const v=simplify(c.path,Math.max(3,.3*H));
    if(v.length!==3)continue;
    const [p,q,r]=v,ang=cornerAngle(p,q,r);
    if(Math.abs(ang-90)>20)continue;
    const up=p[1]<q[1]-3*H?p:r[1]<q[1]-3*H?r:null,right=p[0]>q[0]+3*H?p:r[0]>q[0]+3*H?r:null;
    if(!up||!right||up===right)continue;
    axesList.push({origin:q,xEnd:right,xStart:q,yEnd:up,yStart:q,strokeIds:c.strokeIds.slice(),ticksX:0,ticksY:0});
    c.axis=true;
  }
  /* a number line: a long level line with ticks across it */
  for(const c of connectors){
    if(c.axis||!flat(c)||c.len<6*H)continue;
    const l=Math.min(c.a[0],c.z[0]),r=Math.max(c.a[0],c.z[0]),y=(c.a[1]+c.z[1])/2;
    const ticks=smalls.filter(m=>!claimed.has(m.id)&&m.straight&&m.h>=m.w*2.5&&m.h<=2.4*H&&m.b[1]<=y+2&&m.b[3]>=y-2&&m.b[0]>=l-4&&m.b[2]<=r+4);
    if(ticks.length<3)continue;
    for(const t of ticks){claimed.add(t.id);c.strokeIds.push(t.id);}
    axesList.push({origin:[l,y],xEnd:[r,y],xStart:[l,y],yEnd:null,yStart:null,strokeIds:c.strokeIds.slice(),line:true,ticksX:ticks.length,ticksY:0,heads:(c.headA?1:0)+(c.headZ?1:0)});
    c.axis=true;
  }
  for(const ax of axesList){
    if(ax.line)continue;
    const xr=[Math.min(ax.xStart[0],ax.xEnd[0]),Math.max(ax.xStart[0],ax.xEnd[0])],yr=[Math.min(ax.yStart[1],ax.yEnd[1]),Math.max(ax.yStart[1],ax.yEnd[1])];
    for(const m of smalls){
      if(claimed.has(m.id)||!m.straight||m.size>1.6*H||m.size<Math.max(3,.25*H))continue;
      if(m.h>=m.w*2.5&&m.b[1]<=ax.origin[1]+2&&m.b[3]>=ax.origin[1]-2&&m.b[0]>=xr[0]&&m.b[2]<=xr[1]){claimed.add(m.id);ax.strokeIds.push(m.id);ax.ticksX++;}
      else if(m.w>=m.h*2.5&&m.b[0]<=ax.origin[0]+2&&m.b[2]>=ax.origin[0]-2&&m.b[1]>=yr[0]&&m.b[3]<=yr[1]){claimed.add(m.id);ax.strokeIds.push(m.id);ax.ticksY++;}
    }
  }
  const lineConnectors=connectors.filter(c=>!c.axis);

  /* the graph's own marks: curves and lines inside the axes, and dots */
  for(const ax of axesList){
    ax.curves=[];ax.dots=[];ax.bars=[];
    if(ax.line)continue;
    /* bars: boxes, or up-across-down strokes, standing on the across axis */
    const foot=Math.max(10,.8*H),y0=ax.origin[1],xl=Math.min(ax.xStart[0],ax.origin[0])-H,xr=ax.xEnd[0]+H;
    for(const sh of shapes){
      if(!['rectangle','square','quadrilateral','trapezium','parallelogram'].includes(sh.kind))continue;
      if(Math.abs(sh.b[3]-y0)>foot||sh.b[0]<xl||sh.b[2]>xr||sh.b[1]>y0-.5*H)continue;
      sh.bar=ax;ax.bars.push({shape:sh,l:sh.b[0],r:sh.b[2],top:sh.b[1],strokeIds:sh.strokeIds});
    }
    const region=[Math.min(ax.xStart[0],ax.origin[0])-H,Math.min(ax.yEnd[1],ax.origin[1])-H,ax.xEnd[0]+H,Math.max(ax.yStart[1],ax.origin[1])+H];
    for(const c of lineConnectors){
      if(c.inAxes)continue;
      const cb=boxOf(c.path);
      if(cb[0]<region[0]-H||cb[2]>region[2]+H||cb[1]<region[1]-H||cb[3]>region[3]+H)continue;
      c.inAxes=ax;
      const arch=c.kind==='line'?archOf(c.path,H):null;
      if(arch&&Math.abs(arch.base-y0)<=foot){c.bar=true;ax.bars.push({connector:c,l:arch.l,r:arch.r,top:arch.top,strokeIds:c.strokeIds});}
      else ax.curves.push(c);
    }
  }

  /* labels: the writing in and around the candidate drawings */
  const walls=[...shapes.map(s=>({b:s.b,v:[...s.outline,s.outline[0]]})),...lineConnectors.map(c=>({b:boxOf(c.path),v:c.path})),
    ...axesList.flatMap(a=>[{b:boxOf([a.xStart,a.xEnd]),v:[a.xStart,a.xEnd]},...(a.yEnd?[{b:boxOf([a.yStart,a.yEnd]),v:[a.yStart,a.yEnd]}]:[])])];
  if(!shapes.length&&!lineConnectors.length&&!axesList.length)return {H,diagrams:[]};
  const drawingIds=new Set([...used,...claimed]);
  for(const c of lineConnectors)for(const id of c.strokeIds)drawingIds.add(id);
  for(const a of axesList)for(const id of a.strokeIds)drawingIds.add(id);
  const zones=[...shapes.map(x=>x.b),...lineConnectors.map(c=>boxOf(c.path)),...axesList.map(a=>boxOf(a.yEnd?[a.xStart,a.xEnd,a.yStart,a.yEnd]:[a.xStart,a.xEnd]))].map(b=>grow(b,3*H));
  const writing=all.filter(m=>!drawingIds.has(m.id)&&zones.some(z=>boxesMeet(m.b,z)));
  /* dots inside a graph are points on it, not writing */
  for(const ax of axesList){
    if(ax.line)continue;
    for(const m of writing)if(m.size<=Math.max(4,.3*H)&&mid(m.b)[0]>ax.origin[0]+.5*H&&mid(m.b)[1]<ax.origin[1]-.5*H&&mid(m.b)[0]<ax.xEnd[0]&&mid(m.b)[1]>ax.yEnd[1]){ax.dots.push({at:mid(m.b),id:m.id});drawingIds.add(m.id);}
  }
  const labels=labelGroups(writing.filter(m=>!drawingIds.has(m.id)),H,walls);
  labels.forEach((l,i)=>{l.id='L'+i;l.c=mid(l.b);});

  /* ---- what each part is attached to ---- */
  const items=[];   /* every part, for the components below */
  shapes.forEach((s,i)=>{s.type='shape';s.i=i;s.poly=s.outline;s.area=area(s.outline);items.push(s);});
  lineConnectors.forEach(c=>{c.type='connector';items.push(c);});
  axesList.forEach(a=>{a.type='axes';items.push(a);});
  const reach=Math.max(9,1.1*H);
  const attachEnd=(c,p,dir)=>{
    let best=null,bestD=Infinity;
    for(const s of shapes){
      const n=nearOnPath(p,[...s.poly,s.poly[0]]);
      const into=inside(p,s.poly);
      /* a line wholly inside a shape (a radius, a diagonal) starts at a
         point of it; one that comes from outside meets its edge */
      if(n.d<=reach||into){
        const d=into?Math.min(n.d,reach*.9):n.d;
        if(d<bestD||(into&&best&&best.shape&&s.area<best.shape.area)){
          let at='edge',corner=-1;
          if(s.corners){s.corners.forEach((q,k)=>{if(dist(q,p)<=reach*1.3&&(corner<0||dist(q,p)<dist(s.corners[corner],p)))corner=k;});}
          if(corner>=0)at='corner';
          else if(into&&n.d>reach){const sc=mid(s.b);at=dist(p,sc)<=Math.max(reach,Math.min(s.b[2]-s.b[0],s.b[3]-s.b[1])*.15)?'centre':'inside';}
          best={shape:s,at,corner};bestD=d;
        }
      }
    }
    for(const l of labels){
      if(l.b[0]>p[0]+3*H||l.b[2]<p[0]-3*H||l.b[1]>p[1]+3*H||l.b[3]<p[1]-3*H)continue;
      const d=boxPointDist(l.b,p);
      if(d>Math.max(reach*1.3,2.5*H))continue;
      /* a word an arrow points at lies beyond its end, not beside it; one
         straight ahead may be a little further off */
      const toward=dot(unit(sub(l.c,p)),dir);
      if(d>0&&toward<.15||d>reach*1.3&&toward<.6)continue;
      if(d<bestD||(best&&best.shape&&!inside(l.c,best.shape.poly)&&d<=bestD+reach*.5)){best={label:l};bestD=d;}
    }
    if(!best)for(const o of lineConnectors){
      if(o===c)continue;
      const n=nearOnPath(p,o.path);
      if(n.d<=reach*.8)return {connector:o,along:n.along};
    }
    return best;
  };
  for(const c of lineConnectors){
    /* a curve or a bar on a graph joins nothing: the word under a bar's
       foot is its name, not where it leads */
    if(c.inAxes){c.from=c.to=null;continue;}
    c.from=attachEnd(c,c.a,c.dirA);c.to=attachEnd(c,c.z,c.dirZ);
    if(c.from&&c.to&&c.from.label&&c.from.label===c.to.label)c.to=null;
  }
  const endLabels=new Set();
  for(const c of lineConnectors)for(const e of [c.from,c.to])if(e&&e.label)endLabels.add(e.label);

  /* right-angle marks: a small square corner tucked into a corner */
  const marks=[];
  for(const m of writing){
    if(drawingIds.has(m.id)||m.size>2.2*H||m.size<.4*H)continue;
    const v=simplify(m.pts,Math.max(1.5,m.size*.15));
    if(v.length!==3||Math.abs(cornerAngle(v[0],v[1],v[2])-90)>22)continue;
    for(const s of shapes){
      if(!s.corners||s.corners.length>6)continue;
      const k=s.corners.findIndex(q=>dist(q,v[1])<=Math.max(1.6*H,m.size*1.8)&&dist(q,v[0])<=Math.max(2*H,m.size*2)&&dist(q,v[2])<=Math.max(2*H,m.size*2));
      if(k<0||!inside(v[1],s.poly))continue;
      marks.push({shape:s,corner:k,id:m.id});drawingIds.add(m.id);break;
    }
  }
  if(marks.length){const gone=new Set(marks.map(m=>m.id));for(const l of labels)l.strokeIds=l.strokeIds.filter(id=>!gone.has(id));}
  const liveLabels=labels.filter(l=>l.strokeIds.length);

  for(const l of liveLabels){
    if(endLabels.has(l)){l.role={node:true};continue;}
    const c=l.c,lr=Math.max(.6*l.h,.5*H);
    /* beside a line or an arrow, away from its ends */
    let best=null,bestD=Infinity;
    for(const k of lineConnectors){
      if(k.inAxes||!boxesMeet(grow(l.b,Math.max(1.1*H,lr)),k.zone||(k.zone=boxOf(k.path))))continue;
      const n=nearOnPath(c,k.path),d=boxPathDist(l.b,k.path);
      if(d<=Math.max(1.1*H,lr)&&n.along>.08&&n.along<.92&&d<bestD){best={connector:k};bestD=d;}
    }
    if(best){l.role=best;continue;}
    /* at a corner or along a side of a figure */
    for(const s of shapes){
      if(!s.corners||s.bar)continue;
      const plain=PLAIN.includes(s.kind),into=inside(c,s.poly);
      if(plain&&into)continue;
      s.corners.forEach((q,k)=>{const d=boxPointDist(l.b,q);if(d<=Math.max(1.6*H,lr)&&d<bestD){best={shape:s,corner:k,enclosed:into};bestD=d;}});
      for(let k=0;k<s.corners.length;k++){
        const a=s.corners[k],b=s.corners[(k+1)%s.corners.length],n=closest(c,a,b);
        const d=boxPathDist(l.b,[a,b]);
        if(d<=Math.max(1.3*H,lr)&&n.t>.2&&n.t<.8&&d<bestD-.3*H){best={shape:s,side:k,enclosed:into};bestD=d;}
      }
    }
    if(best){l.role=best;continue;}
    /* in a graph: the axes' names and numbers, and what is written on it */
    for(const ax of axesList){
      const o=ax.origin,xe=ax.xEnd,ye=ax.yEnd;
      const nearOrigin=boxPointDist(l.b,o)<=1.2*H&&c[0]<=o[0]+.6*H&&c[1]>=o[1]-.6*H;
      if(nearOrigin){best={axes:ax,origin:true};break;}
      /* under the across axis and left of the upright one are its numbers;
         what there does not read as a number is the axis's name, which
         describe() sorts out once the writing is read */
      if(!ax.line&&l.b[1]>=o[1]-.4*H&&l.b[1]-o[1]<=2*H&&c[0]>=Math.min(ax.xStart[0],o[0])-H&&c[0]<=xe[0]+H){best={axes:ax,xNumber:true};break;}
      if(ye&&l.b[2]<=o[0]+.4*H&&o[0]-l.b[2]<=2.4*H&&c[1]>=ye[1]-H&&c[1]<=Math.max(ax.yStart[1],o[1])+H){best={axes:ax,yNumber:true};break;}
      if(ax.line&&Math.abs(c[1]-o[1])<=2.5*H&&c[0]>=o[0]-H&&c[0]<=xe[0]+H){best={axes:ax,onLine:true};break;}
      if(boxPointDist(l.b,xe)<=2.2*H&&c[0]>=xe[0]-2*H){best={axes:ax,xTitle:true};break;}
      if(ye&&boxPointDist(l.b,ye)<=2.2*H&&c[1]<=ye[1]+2*H){best={axes:ax,yTitle:true};break;}
      if(ye&&c[0]>o[0]&&c[0]<xe[0]+H&&c[1]<o[1]&&c[1]>ye[1]-H){
        let curve=null,cd=Infinity;
        for(const k of ax.curves){const d=boxPathDist(l.b,k.path);if(d<=1.4*H&&d<cd){curve=k;cd=d;}}
        best=curve?{axes:ax,curve}:{axes:ax,inGraph:true};break;
      }
    }
    if(best){l.role=best;continue;}
    /* inside shapes; for overlapping circles, which ones */
    const holders=shapes.filter(s=>inside(c,s.poly)).sort((a,b)=>a.area-b.area);
    if(holders.length){l.role={inside:holders};continue;}
    /* just outside a shape: its name */
    for(const s of shapes){const d=boxPathDist(l.b,[...s.poly,s.poly[0]]);if(d<=Math.max(1.8*H,lr)&&d<bestD){best={caption:s};bestD=d;}}
    if(best){l.role=best;continue;}
    l.role=null;
  }

  /* ---- drawings: parts joined by what touches what ---- */
  const parent=new Map(),findP=x=>{let r=x;while(parent.get(r)!==r)r=parent.get(r);parent.set(x,r);return r;};
  const join=(a,b)=>{parent.set(findP(a),findP(b));};
  for(const it of items)parent.set(it,it);
  for(const l of liveLabels)parent.set(l,l);
  for(const c of lineConnectors){
    for(const e of [c.from,c.to]){if(!e)continue;join(c,e.shape||e.label||e.connector);}
    if(c.inAxes)join(c,c.inAxes);
  }
  for(const ax of axesList)for(const b of ax.bars)if(b.shape)join(b.shape,ax);
  for(let i=0;i<shapes.length;i++)for(let j=i+1;j<shapes.length;j++){
    const a=shapes[i],b=shapes[j];
    if(!boxesMeet(a.b,b.b))continue;
    const pa=[...a.poly,a.poly[0]],pb=[...b.poly,b.poly[0]];
    const overlap=pathsCross(pa,pb),within=inside(mid(b.b),a.poly)&&b.area<a.area||inside(mid(a.b),b.poly)&&a.area<b.area;
    if(overlap){(a.overlaps=a.overlaps||[]).push(b);(b.overlaps=b.overlaps||[]).push(a);join(a,b);}
    else if(within){const [small,big]=a.area<b.area?[a,b]:[b,a];small.within=big;join(a,b);}
  }
  for(const l of liveLabels){
    const r=l.role;if(!r)continue;
    const owner=r.connector||r.shape||r.axes||r.caption||(Array.isArray(r.inside)&&r.inside[0]);
    if(owner)join(l,owner);
  }
  const groups=new Map();
  for(const it of [...items,...liveLabels]){const r=findP(it);if(!groups.has(r))groups.set(r,{shapes:[],connectors:[],axes:[],labels:[]});
    const g=groups.get(r);
    if(it.type==='shape')g.shapes.push(it);else if(it.type==='connector')g.connectors.push(it);else if(it.type==='axes')g.axes.push(it);else g.labels.push(it);}
  const diagrams=[];
  for(const g of groups.values()){
    /* a box or a ring on its own is a frame round some writing, and a
       line on its own is a rule; what makes a drawing is the parts
       together, a figure, a graph, or an arrow from something */
    /* A figure on its own counts when something names a part of it, or
       when it is far bigger than writing: a loop in a letter can come out
       as a triangle or a hexagon, but it is neither large nor labelled. */
    const odd=g.shapes.some(s=>{
      if(['rectangle','square','circle','ellipse','closed shape'].includes(s.kind))return false;
      const size=Math.max(s.b[2]-s.b[0],s.b[3]-s.b[1]);
      if(['pentagon','hexagon'].includes(s.kind))return size>=5*H;
      return size>=5*H||marks.some(m=>m.shape===s)||g.labels.some(l=>l.role&&(l.role.shape===s||l.role.caption===s));
    });
    /* an arrow needs something at one end; a straight line something at
       both (words matched across a page, a branch of a tree); a curve
       without a head reaches a shape, as a mind map's branches do */
    const linked=g.connectors.some(c=>{
      const ends=[c.from,c.to].filter(e=>e&&(e.shape||e.label));
      /* a short arrow between two short marks is notation (x -> 0), not
         a drawing: it needs a shape, or words, at its ends */
      if(c.kind==='arrow'&&c.len<3.5*H)return ends.length>=2&&ends.some(e=>e.shape||e.label.w>=1.4*H)||ends.some(e=>e.shape);
      if(c.kind==='arrow')return ends.length>=1;
      if(c.curved)return ends.length>=2&&ends.some(e=>e.shape);
      if(ends.some(e=>e.shape))return ends.length>=2||!!(c.from&&c.to);
      /* a plain line between words only, as in matching or a tree: long,
         its words in line beyond its ends, and nothing written over or
         under its middle the way a fraction bar or an integral has */
      if(!(ends.length>=2||(ends.length===1&&c.from&&c.to)))return false;
      if(c.len<4*H)return false;
      for(const [e,p,d] of [[c.from,c.a,c.dirA],[c.to,c.z,c.dirZ]])if(e&&e.label&&boxPointDist(e.label.b,p)>0&&dot(unit(sub(e.label.c,p)),d)<.6)return false;
      return !c.crowded;
    });
    /* axes with something on them: a curve, a point or marks along them */
    const graph=g.axes.some(a=>a.line?a.ticksX>=3:a.curves.length||a.bars.length||a.dots.length||a.ticksX+a.ticksY>=2);
    if(!(linked||g.shapes.length>=2||odd||graph))continue;
    if(g.shapes.length===0&&!graph&&g.connectors.every(c=>c.inAxes))continue;
    let box=null;const ids=new Set();
    for(const s of g.shapes){box=joinBox(box,s.b);s.strokeIds.forEach(id=>ids.add(id));}
    for(const c of g.connectors){box=joinBox(box,boxOf(c.path));c.strokeIds.forEach(id=>ids.add(id));}
    for(const a of g.axes){box=joinBox(box,boxOf(a.yEnd?[a.xStart,a.xEnd,a.yStart,a.yEnd]:[a.xStart,a.xEnd]));a.strokeIds.forEach(id=>ids.add(id));a.dots.forEach(d=>ids.add(d.id));}
    const frame=box.slice();
    for(const l of g.labels){box=joinBox(box,l.b);l.strokeIds.forEach(id=>ids.add(id));}
    for(const m of marks)if(g.shapes.includes(m.shape))ids.add(m.id);
    diagrams.push({bbox:box,frame,strokeIds:[...ids],H,shapes:g.shapes,connectors:g.connectors,axes:g.axes,labels:g.labels,
      marks:marks.filter(m=>g.shapes.includes(m.shape))});
  }
  /* writing that sits inside a drawing's own outline but is attached to
     nothing still belongs to it, at its place */
  for(const l of liveLabels){
    if(diagrams.some(d=>d.labels.includes(l)))continue;
    const d=diagrams.find(d=>{const f=d.frame;return l.c[0]>=f[0]&&l.c[0]<=f[2]&&l.c[1]>=f[1]&&l.c[1]<=f[3];});
    if(!d)continue;
    d.labels.push(l);l.strokeIds.forEach(id=>d.strokeIds.push(id));d.bbox=joinBox(d.bbox,l.b);
  }
  diagrams.sort((a,b)=>a.bbox[1]-b.bbox[1]||a.bbox[0]-b.bbox[0]);
  return {H,diagrams};
}
/* The height of the writing, from strokes small enough to be letters, at
   a high quantile as the recogniser takes it: dots, bars and crossbars are
   strokes too, and a median of them undersizes the hand. A page of nothing
   but a drawing falls back to an ordinary hand. */
function handOf(measured){
  const hs=measured.filter(m=>m.size<=90).map(m=>m.h).filter(h=>h>2).sort((a,b)=>a-b);
  return Math.max(12,Math.min(60,hs.length?hs[Math.ceil((hs.length-1)*.7)]:20));
}
function heightOf(strokes){return handOf((strokes||[]).filter(st=>st&&Array.isArray(st.pts)&&st.pts.length>=3).map(measure));}
/* a square root sign over a long expression is drawn like a bend; it
   starts high, dips to a tick, rises steeply and runs right over writing */
function radical(m,H){
  const p=m.pts,b=m.b,w=m.w,h=m.h;
  if(h<.8*H||w<1.5*H)return false;
  let low=0;for(let i=1;i<p.length;i++)if(p[i][1]>p[low][1])low=i;
  if(p[0][0]>b[0]+w*.25||p[low][0]>b[0]+w*.35)return false;
  const end=p[p.length-1];
  if(end[0]<b[2]-w*.1||end[1]>b[1]+h*.25)return false;
  let top=-1;for(let i=low;i<p.length;i++)if(p[i][1]<=b[1]+h*.25){top=i;break;}
  if(top<0||p[top][0]>b[0]+w*.4)return false;
  for(let i=top;i<p.length;i++)if(p[i][1]>b[1]+h*.3)return false;
  return true;
}
/* the loop of largest area among a few strokes whose ends meet */
function bestCycle(graph){
  if(graph.length<2||graph.length>40)return null;
  const adj=new Map();
  graph.forEach((g,i)=>{for(const [n,o,f] of [[g.a,g.z,true],[g.z,g.a,false]]){if(!adj.has(n))adj.set(n,[]);adj.get(n).push({i,to:o,forward:f});}});
  let best=null,bestArea=0,budget=4000;
  const used=new Uint8Array(graph.length);
  const walk=(start,node,path)=>{
    if(--budget<0)return;
    for(const step of adj.get(node)||[]){
      if(used[step.i])continue;
      if(step.to===start&&path.length>=1){
        const cycle=[...path,step];
        const pts=[];for(const s of cycle){const sh=graph[s.i].e.shaft;pts.push(...(s.forward?sh:sh.slice().reverse()));}
        const a=area(pts);
        if(a>bestArea){bestArea=a;best=cycle.map(s=>({g:graph[s.i],forward:s.forward}));}
        continue;
      }
      if(path.length>=8)continue;
      used[step.i]=1;walk(start,step.to,[...path,step]);used[step.i]=0;
    }
  };
  for(const n of adj.keys()){if((adj.get(n)||[]).length<2)continue;walk(n,n,[]);}
  return best;
}

/* ---- the drawing in words ---- */
/* shapes whose corners are just where the outline turns, not points of a figure */
const PLAIN=['rectangle','square','diamond','parallelogram'];
/* the angle from straight up, turning clockwise as the page is seen */
function clockwise(dx,dy){let a=Math.atan2(dx,-dy);if(a<0)a+=2*Math.PI;return a;}
function quote(t){return '"'+String(t).replace(/\s+/g,' ').trim().slice(0,160)+'"';}
function numberOf(text){
  const t=String(text||'').replace(/[−–—]/g,'-').replace(/\s+/g,'').replace(/,(?=\d{3}\b)/g,'');
  const m=t.match(/^-?\d+(?:\.\d+)?$/);
  if(m)return parseFloat(t);
  const f=t.match(/^(-?\d+)\/(\d+)$/);if(f&&+f[2])return +f[1]/+f[2];
  return null;
}
function describe(d,read){
  const text=l=>{const t=read(l);return t&&/[\p{L}\p{N}]/u.test(t)?String(t).replace(/\s+/g,' ').trim():'';};
  const H=d.H,f=d.bbox,span=Math.max(f[2]-f[0],f[3]-f[1],1);
  const pos=p=>'('+Math.round((p[0]-f[0])/span*100)+', '+Math.round((p[1]-f[1])/span*100)+')';
  const out=[];
  const labels=d.labels.filter(l=>text(l));
  const by=(fn)=>labels.filter(l=>l.role&&fn(l.role));
  const reading=(list)=>list.slice().sort((a,b)=>(Math.round(a.c[1]/H)-Math.round(b.c[1]/H))||a.c[0]-b.c[0]).map(text).join(' ');

  /* ---- graphs ---- */
  for(const ax of d.axes){
    const mine=by(r=>r.axes===ax);
    const o=ax.origin,ux=unit(sub(ax.xEnd,ax.xStart[0]<o[0]-1?ax.xStart:o)),uy=ax.yEnd?unit(sub(ax.yEnd,ax.yStart[1]>o[1]+1?ax.yStart:o)):null;
    const u=p=>dot(sub(p,o),ux),v=p=>uy?dot(sub(p,o),uy):0;
    const fit=(pairs)=>{
      const seen=new Map();for(const [p,val] of pairs)seen.set(val,p);
      if(seen.size<2)return null;
      const xs=[...seen.values()],ys=[...seen.keys()],n=xs.length;
      const mx=xs.reduce((a,b)=>a+b,0)/n,my=ys.reduce((a,b)=>a+b,0)/n;
      let sxy=0,sxx=0;for(let i=0;i<n;i++){sxy+=(xs[i]-mx)*(ys[i]-my);sxx+=(xs[i]-mx)**2;}
      if(!sxx)return null;
      const k=sxy/sxx,c=my-k*mx;
      const rng=Math.max(...ys)-Math.min(...ys);
      for(let i=0;i<n;i++)if(Math.abs(c+k*xs[i]-ys[i])>rng*.15)return null;
      return {k,c};
    };
    const xNums=[],yNums=[];
    for(const l of mine){
      const n=numberOf(text(l));if(n===null)continue;
      if(l.role.xNumber||l.role.onLine)xNums.push([u(l.c),n]);
      if(l.role.yNumber)yNums.push([v(l.c),n]);
      if(l.role.origin){xNums.push([0,n]);yNums.push([0,n]);}
    }
    const lenX=u(ax.xEnd)||1,lenY=ax.yEnd?(v(ax.yEnd)||1):1;
    let sx=fit(xNums),sy=fit(yNums),guess=false;
    if(!sx&&xNums.length===1&&xNums[0][0]){sx={k:xNums[0][1]/xNums[0][0],c:0};guess=true;}
    if(!sy&&yNums.length===1&&yNums[0][0]){sy={k:yNums[0][1]/yNums[0][0],c:0};guess=true;}
    const scaled=!!(sx&&(sy||ax.line));
    const hasX=!!sx,hasY=!!sy;
    if(!sx)sx={k:10/lenX,c:0};
    if(!sy)sy={k:10/lenY,c:0};
    const X=p=>sx.c+sx.k*u(p),Y=p=>sy.c+sy.k*v(p);
    const rangeX=Math.abs(sx.k*lenX)||10,rangeY=Math.abs(sy.k*lenY)||10;
    const dec=r=>Math.max(0,Math.min(4,-Math.floor(Math.log10(r/50))));
    const fx=n=>{const s=(+n.toFixed(dec(rangeX))).toString();return s==='-0'?'0':s;},fy=n=>{const s=(+n.toFixed(dec(rangeY))).toString();return s==='-0'?'0':s;};
    const pt=p=>'('+fx(X(p))+', '+fy(Y(p))+')';
    const named=l=>numberOf(text(l))===null;
    /* a bar chart: the word under each bar names it, what is written on
       or just over it is its value */
    const bars=(ax.bars||[]).slice().sort((a,b)=>a.l-b.l),barWords=new Set();
    for(const b of bars){
      const w=b.r-b.l;
      b.names=mine.filter(l=>l.role.xNumber&&named(l)&&l.c[0]>=b.l-w*.25&&l.c[0]<=b.r+w*.25);
      b.marks=mine.filter(l=>l.role.inGraph&&l.c[0]>=b.l-w*.1&&l.c[0]<=b.r+w*.1&&l.c[1]>=b.top-2*H&&l.c[1]<=o[1]);
      for(const l of [...b.names,...b.marks])barWords.add(l);
    }
    /* a bar chart's across axis carries names, not numbers */
    const unnumbered=ax.line?(hasX?'':'it'):[!hasX&&!bars.length?'the across axis':'',!hasY?'the upright axis':''].filter(Boolean).join(' and ');
    const xTitle=reading(mine.filter(l=>!barWords.has(l)&&(l.role.xTitle||l.role.xNumber&&named(l)))),yTitle=reading(mine.filter(l=>l.role.yTitle||l.role.yNumber&&named(l)));
    if(ax.line){
      out.push('[diagram: a number line'+(scaled?'':'; no numbers are written on it, so places are given on a 0 to 10 scale along it')+']');
      const nums=xNums.slice().sort((a,b)=>a[0]-b[0]).map(x=>x[1]);
      if(nums.length)out.push('numbers written along it: '+nums.join(', '));
      out.push('it runs from '+fx(X(ax.xStart))+' to '+fx(X(ax.xEnd))+(ax.heads?' and goes on past the end'+(ax.heads>1?'s':''):''));
      for(const l of mine.filter(l=>l.role.onLine&&numberOf(text(l))===null))out.push(quote(text(l))+' at '+fx(X(l.c)));
      out.push('[end of diagram]');
      continue;
    }
    out.push('[graph'+(bars.length?' (a bar chart)':'')+': axes crossing at '+pt(o)+(xTitle?'; across: '+quote(xTitle):'')+(yTitle?'; up: '+quote(yTitle):'')+
      (guess?'; positions use the one number written on an axis, taking the axes to cross at 0':'')+
      (unnumbered?'; no numbers are written on '+unnumbered+', so positions along '+(unnumbered.includes(' and ')?'them':'it')+' are on a 0 to 10 scale':'')+']');
    const xs=xNums.filter(x=>x[0]).sort((a,b)=>a[0]-b[0]).map(x=>x[1]),ys=yNums.filter(x=>x[0]).sort((a,b)=>a[0]-b[0]).map(x=>x[1]);
    if(xs.length)out.push('numbers along the across axis: '+xs.join(', '));
    if(ys.length)out.push('numbers up the other axis: '+ys.join(', '));
    ax.curves.forEach((c,i)=>{
      const name=reading(mine.filter(l=>l.role.curve===c));
      const pts=c.m.pts.map(p=>[X(p),Y(p)]);
      const label='curve '+(i+1)+(name?' '+quote(name):'');
      if(!c.curved&&c.kind!=='arrow'&&c.m.straight){
        const a=pts[0],z=pts[pts.length-1],[l,r]=a[0]<=z[0]?[a,z]:[z,a];
        const g=r[0]!==l[0]?(r[1]-l[1])/(r[0]-l[0]):null;
        out.push(label+': a straight line from ('+fx(l[0])+', '+fy(l[1])+') to ('+fx(r[0])+', '+fy(r[1])+')'+(g===null?', upright':scaled?', gradient about '+(+g.toPrecision(2)):''));
        return;
      }
      /* a curve that goes one way across is a function: read off it at
         even steps; anything else is followed along its length */
      let back=0,dir=Math.sign(pts[pts.length-1][0]-pts[0][0]);
      for(let i=1;i<pts.length;i++){const s=pts[i][0]-pts[i-1][0];if(Math.sign(s)===-dir)back+=Math.abs(s);}
      const width=Math.abs(pts[pts.length-1][0]-pts[0][0]);
      const samples=[];
      if(width&&back<=width*.06){
        const sorted=(dir<0?pts.slice().reverse():pts).filter((p,i,a)=>!i||p[0]>=a[i-1][0]);
        const at=x=>{let i=1;while(i<sorted.length-1&&sorted[i][0]<x)i++;const a=sorted[i-1],b=sorted[i],t=b[0]>a[0]?(x-a[0])/(b[0]-a[0]):0;return a[1]+(b[1]-a[1])*Math.max(0,Math.min(1,t));};
        const x0=sorted[0][0],x1=sorted[sorted.length-1][0];
        for(let i=0;i<=8;i++){const x=x0+(x1-x0)*i/8;samples.push([x,at(x)]);}
        const dense=[];for(let i=0;i<=40;i++){const x=x0+(x1-x0)*i/40;dense.push([x,at(x)]);}
        const turns=[];
        for(let i=1;i<dense.length-1;i++){
          const a=dense[i-1][1],b=dense[i][1],cc=dense[i+1][1],r=rangeY*.01;
          if(b>a+r*0&&b>=cc&&b-Math.min(a,cc)>0&&(b-dense[Math.max(0,i-4)][1]>r&&b-dense[Math.min(40,i+4)][1]>r))turns.push('highest point near ('+fx(dense[i][0])+', '+fy(b)+')');
          if(b<a&&b<=cc&&(dense[Math.max(0,i-4)][1]-b>r&&dense[Math.min(40,i+4)][1]-b>r))turns.push('lowest point near ('+fx(dense[i][0])+', '+fy(b)+')');
        }
        const rise=samples[8][1]-samples[0][1];
        const trend=turns.length?turns.join(', '):Math.abs(rise)<rangeY*.03?'level':rise>0?'rising':'falling';
        out.push(label+' through '+samples.map(p=>'('+fx(p[0])+', '+fy(p[1])+')').join(' ')+'; '+trend);
      }else{
        const L=pathLength(pts);let walked=0,next=0,i=1;
        samples.push(pts[0]);
        for(let k=1;k<=8;k++){
          next=L*k/8;
          while(i<pts.length&&walked+dist(pts[i],pts[i-1])<next){walked+=dist(pts[i],pts[i-1]);i++;}
          if(i>=pts.length){samples.push(pts[pts.length-1]);continue;}
          const s=dist(pts[i],pts[i-1])||1,t=(next-walked)/s;
          samples.push([pts[i-1][0]+(pts[i][0]-pts[i-1][0])*t,pts[i-1][1]+(pts[i][1]-pts[i-1][1])*t]);
        }
        out.push(label+', drawn through '+samples.map(p=>'('+fx(p[0])+', '+fy(p[1])+')').join(' '));
      }
    });
    bars.forEach((b,i)=>{
      const name=reading(b.names),mark=reading(b.marks);
      out.push('bar '+(name?quote(name):String(i+1))+': up to '+fy(Y([(b.l+b.r)/2,b.top]))+(mark?', marked '+quote(mark):''));
    });
    for(const dt of ax.dots){
      const name=mine.filter(l=>l.role.inGraph&&boxPointDist(l.b,dt.at)<=1.6*H).map(text).join(' ');
      out.push('point'+(name?' '+quote(name):'')+' at '+pt(dt.at));
    }
    for(const l of mine.filter(l=>l.role.inGraph)){
      if(barWords.has(l)||ax.dots.some(dt=>boxPointDist(l.b,dt.at)<=1.6*H))continue;
      out.push(quote(text(l))+' written at '+pt(l.c));
    }
    out.push('[end of graph]');
  }
  const shapes=d.shapes.filter(s=>!s.bar).sort((a,b)=>(Math.round(a.b[1]/(2*H))-Math.round(b.b[1]/(2*H)))||a.b[0]-b.b[0]);
  /* a pie chart: a round shape cut by lines from its centre. Its slices
     are said clockwise from the top, each with its share of the turn and
     whatever is written in it; the lines are then not said again. */
  const pies=new Map(),spokes=new Set(),pieWords=new Set();
  for(const sh of shapes){
    if(sh.kind!=='circle'&&sh.kind!=='ellipse')continue;
    const cx=(sh.b[0]+sh.b[2])/2,cy=(sh.b[1]+sh.b[3])/2,rx=Math.max(1,(sh.b[2]-sh.b[0])/2),ry=Math.max(1,(sh.b[3]-sh.b[1])/2);
    const reach=p=>hyp((p[0]-cx)/rx,(p[1]-cy)/ry);
    const cuts=[];
    for(const c of d.connectors){
      if(c.inAxes||c.kind!=='line'||c.curved)continue;
      const [hub,rim]=reach(c.a)<reach(c.z)?[c.a,c.z]:[c.z,c.a];
      if(reach(hub)>.3||reach(rim)<.75||reach(rim)>1.3)continue;
      cuts.push({c,at:clockwise(rim[0]-cx,rim[1]-cy)});
    }
    if(cuts.length<2)continue;
    cuts.sort((a,b)=>a.at-b.at);
    const slices=cuts.map((cut,i)=>({from:cut.at,span:((cuts[(i+1)%cuts.length].at-cut.at)+2*Math.PI)%(2*Math.PI)||2*Math.PI,words:[]}));
    for(const l of labels){
      const r=l.role;if(!r)continue;
      if(!(Array.isArray(r.inside)&&r.inside.includes(sh))&&!(r.connector&&cuts.some(cut=>cut.c===r.connector)))continue;
      const at=clockwise(l.c[0]-cx,l.c[1]-cy);
      const slice=slices.find(x=>((at-x.from)+2*Math.PI)%(2*Math.PI)<x.span);
      if(slice){slice.words.push(l);pieWords.add(l);}
    }
    pies.set(sh,slices);for(const cut of cuts)spokes.add(cut.c);
  }
  const connectors=d.connectors.filter(c=>!c.inAxes&&!spokes.has(c));
  if(!shapes.length&&!connectors.length&&d.axes.length)return out;

  /* ---- shapes, lines and arrows ---- */
  const parts=[];
  if(shapes.length)parts.push(shapes.length+' shape'+(shapes.length>1?'s':''));
  const arrows=connectors.filter(c=>c.kind==='arrow').length,plain=connectors.length-arrows;
  if(arrows)parts.push(arrows+' arrow'+(arrows>1?'s':''));
  if(plain)parts.push(plain+' line'+(plain>1?'s':''));
  out.push('[diagram: '+parts.join(', ')+'; places are (across, down) from 0 to 100]');
  const names=new Map(),cornerNames=new Map();
  shapes.forEach((s,i)=>{
    const caption=reading(by(r=>r.caption===s));
    const within=by(r=>Array.isArray(r.inside)&&r.inside[0]===s).filter(l=>!pieWords.has(l));
    const busy=(s.overlaps&&s.overlaps.length)||shapes.some(o=>o.within===s);
    const inner=!busy&&!s.corners||!busy&&PLAIN.includes(s.kind)?reading(within):'';
    s.inner=inner;
    names.set(s,s.kind+' '+(i+1)+(caption?' '+quote(caption):inner?' '+quote(inner):''));
    if(s.corners){
      const cn=s.corners.map((q,k)=>reading(by(r=>r.shape===s&&r.corner===k&&!r.enclosed)));
      cornerNames.set(s,cn);
    }
  });
  /* a corner goes by its letter when one is written there, else its number */
  const cornerName=(s,k)=>(cornerNames.get(s)||[])[k]||String(k+1);
  const sideName=(s,k)=>{const a=(cornerNames.get(s)||[])[k],b=(cornerNames.get(s)||[])[(k+1)%s.corners.length];return a&&b?a+b:String(k+1);};
  for(const s of shapes){
    let line=names.get(s)+' at '+pos(mid(s.b));
    if(s.corners&&!PLAIN.includes(s.kind)||s.corners&&(cornerNames.get(s)||[]).some(Boolean))
      line+=', corners '+s.corners.map((q,k)=>cornerName(s,k)+' '+pos(q)).join(', ');
    if(s.within)line+=', inside '+names.get(s.within);
    out.push(line);
    if(pies.has(s)){
      const slices=pies.get(s);
      out.push('  a pie chart in '+slices.length+' slices, clockwise from the top: '+
        slices.map((x,i)=>(reading(x.words)?quote(reading(x.words)):'slice '+(i+1))+' '+Math.round(x.span/(2*Math.PI)*100)+'%').join(', '));
    }
    if(s.corners){
      s.corners.forEach((q,k)=>{
        const side=reading(by(r=>r.shape===s&&r.side===k));
        if(side)out.push('  side '+sideName(s,k)+' is labelled '+quote(side));
        const angle=reading(by(r=>r.shape===s&&r.corner===k&&r.enclosed));
        if(angle)out.push('  at corner '+cornerName(s,k)+', inside: '+quote(angle));
      });
      for(const m of d.marks)if(m.shape===s)out.push('  right angle marked at corner '+cornerName(s,m.corner));
    }
  }
  for(const s of shapes)for(const o of s.overlaps||[])if(shapes.indexOf(o)>shapes.indexOf(s))out.push(names.get(s)+' and '+names.get(o)+' overlap');
  /* what is written in overlapping or nested shapes says which it is in */
  for(const l of by(r=>Array.isArray(r.inside))){
    if(pieWords.has(l))continue;
    const holders=l.role.inside;
    if(holders.length===1&&holders[0].inner)continue;
    const rest=shapes.filter(s=>(s.overlaps&&s.overlaps.some(o=>holders.includes(o)))&&!holders.includes(s));
    out.push(quote(text(l))+' is inside '+holders.map(s=>names.get(s)).join(' and ')+(rest.length?', outside '+rest.map(s=>names.get(s)).join(' and '):'')+' at '+pos(l.c));
  }
  const endName=(e,p)=>{
    if(!e)return pos(p);
    if(e.label)return quote(text(e.label)||'?')+' '+pos(e.label.c);
    if(e.connector)return 'a point on another line '+pos(p);
    const s=e.shape;
    /* the corner of a box or a decision is just the box; a figure's
       corners are part of the question */
    if(e.at==='corner'&&(!PLAIN.includes(s.kind)||(cornerNames.get(s)||[])[e.corner]))return 'corner '+cornerName(s,e.corner)+' of '+names.get(s);
    if(e.at==='centre')return 'the centre of '+names.get(s);
    if(e.at==='inside')return 'inside '+names.get(s)+' '+pos(p);
    return names.get(s);
  };
  for(const c of connectors){
    const label=reading(by(r=>r.connector===c));
    const kind=(c.curved?'curved ':'')+(c.kind==='arrow'?'arrow':'line');
    let line;
    if(c.headA&&c.headZ)line=kind+' between '+endName(c.from,c.a)+' and '+endName(c.to,c.z)+', pointing both ways';
    else if(c.headA)line=kind+' from '+endName(c.to,c.z)+' to '+endName(c.from,c.a);
    else line=kind+' from '+endName(c.from,c.a)+' to '+endName(c.to,c.z);
    out.push(line+(label?', labelled '+quote(label):''));
  }
  /* words at the ends of lines and arrows already said; the rest */
  const said=new Set();
  for(const c of connectors)for(const e of [c.from,c.to])if(e&&e.label)said.add(e.label);
  for(const l of labels){
    if(said.has(l)||l.role&&!l.role.node)continue;
    out.push(quote(text(l))+' written at '+pos(l.c));
  }
  out.push('[end of diagram]');
  return out;
}

const api={find,describe,heightOf,numberOf,measure};
if(typeof module==='object'&&module.exports)module.exports=api;
else root.NOTAS_DIAGRAM=api;
})(typeof self==='object'?self:globalThis);
