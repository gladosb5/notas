// What is drawn rather than written, told to nota as words: shapes, lines
// and arrows, graphs, and the writing that labels them. Strokes are made up
// here; a label's reading is the word its strokes were made for.
const test=require('node:test');
const assert=require('node:assert/strict');
const D=require('../diagram.js');

const H=20;
function stroke(id,pts,step=3){
  const out=[];
  for(let i=0;i<pts.length;i++){
    if(!i){out.push(pts[0]);continue;}
    const a=pts[i-1],b=pts[i],n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/step));
    for(let k=1;k<=n;k++)out.push([a[0]+(b[0]-a[0])*k/n,a[1]+(b[1]-a[1])*k/n]);
  }
  const flat=out.flatMap(p=>[p[0],p[1],.5]);
  const xs=out.map(p=>p[0]),ys=out.map(p=>p[1]);
  return {id,author:'user',w:2.4,pts:flat,bbox:[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)]};
}
const ring=(id,cx,cy,rx,ry=rx)=>stroke(id,Array.from({length:61},(_,i)=>[cx+rx*Math.cos(i*Math.PI/30),cy+ry*Math.sin(i*Math.PI/30)]));
/* a written word: one small zigzag per letter, on a baseline at y */
const words=new Map();
function word(name,x,y,text){
  words.set(name,text);
  const out=[];
  [...text].forEach((ch,i)=>{
    const l=x+i*(.55*H+.2*H);
    out.push(stroke(name+':'+i,[[l,y-.8*H],[l+.15*H,y],[l+.3*H,y-.6*H],[l+.45*H,y],[l+.55*H,y-.5*H]],2));
  });
  return out;
}
const wordEnd=(x,text)=>x+text.length*(.75*H)-.2*H;
const read=l=>{
  const names=[...new Set(l.strokeIds.map(id=>id.split(':')[0]))].filter(n=>words.has(n));
  return names.map(n=>words.get(n)).join(' ');
};
function run(strokes){
  const found=D.find(strokes);
  return found.diagrams.map(d=>D.describe(d,read).join('\n'));
}

test('a flowchart: boxes, a decision diamond and the arrows between them',()=>{
  const s=[
    stroke('box1',[[100,40],[240,40],[240,90],[100,90],[100,40]]),
    ...word('start',125,75,'Start'),
    stroke('dia',[[170,150],[250,200],[170,250],[90,200],[170,150]]),
    ...word('q',140,210,'x>5'),
    stroke('box2',[[300,175],[440,175],[440,225],[300,225],[300,175]]),
    ...word('print',320,210,'print'),
    /* down from the box to the diamond, the head a separate V */
    stroke('a1',[[170,92],[170,146]]),stroke('a1h',[[160,134],[170,147],[180,134]]),
    /* across to the second box, the head drawn in the same stroke */
    stroke('a2',[[252,200],[296,200],[284,190],[296,200],[284,210]]),
    ...word('yes',260,190,'yes'),
  ];
  const out=run(s);
  assert.equal(out.length,1,'one drawing: '+out.join('\n---\n'));
  const t=out[0];
  assert.match(t,/rectangle \d "Start"/);
  assert.match(t,/diamond \d "x>5"/);
  assert.match(t,/rectangle \d "print"/);
  assert.match(t,/arrow from rectangle \d "Start" to diamond \d "x>5"/);
  assert.match(t,/arrow from diamond \d "x>5" to rectangle \d "print", labelled "yes"/);
});

test('a food chain: words joined by arrows, no shapes',()=>{
  const s=[
    ...word('grass',40,100,'grass'),
    stroke('a1',[[40+5*15,92],[200,92],[188,82],[200,92],[188,102]]),
    ...word('rabbit',215,100,'rabbit'),
    stroke('a2',[[wordEnd(215,'rabbit')+12,92],[440,92]]),stroke('a2h',[[428,82],[441,92],[428,102]]),
    ...word('fox',455,100,'fox'),
  ];
  const out=run(s);
  assert.equal(out.length,1,out.join('\n---\n'));
  assert.match(out[0],/arrow from "grass" \(\d+, \d+\) to "rabbit"/);
  assert.match(out[0],/arrow from "rabbit" \(\d+, \d+\) to "fox"/);
});

test('a Venn diagram: overlapping circles, their names and what is in each part',()=>{
  const s=[
    ring('A',200,200,90),ring('B',320,200,90),
    ...word('na',150,95,'A'),...word('nb',370,95,'B'),
    ...word('one',140,210,'1'),...word('two',255,210,'2'),...word('three',370,210,'3'),
  ];
  const out=run(s);
  assert.equal(out.length,1,out.join('\n---\n'));
  const t=out[0];
  assert.match(t,/circle 1 "A"/);
  assert.match(t,/circle 2 "B"/);
  assert.match(t,/circle 1 "A" and circle 2 "B" overlap/);
  assert.match(t,/"1" is inside circle 1 "A", outside circle 2 "B"/);
  assert.match(t,/"2" is inside circle \d "[AB]" and circle \d "[AB]"/);
  assert.match(t,/"3" is inside circle 2 "B", outside circle 1 "A"/);
});

test('a triangle with named corners, a side length and a right angle',()=>{
  const s=[
    /* drawn as a roof and a base, in two strokes */
    stroke('roof',[[100,300],[100,100],[300,300]]),stroke('base',[[300,300],[100,300]]),
    ...word('cA',70,95,'A'),...word('cB',70,330,'B'),...word('cC',310,330,'C'),
    ...word('side',180,335,'8cm'),
    stroke('right',[[100,280],[120,280],[120,300]]),
  ];
  const out=run(s);
  assert.equal(out.length,1,out.join('\n---\n'));
  const t=out[0];
  assert.match(t,/triangle 1 at \(\d+, \d+\), corners [ABC] \(/);
  assert.match(t,/side (BC|CB) is labelled "8cm"/);
  assert.match(t,/right angle marked at corner B/);
});

test('a graph: axes, numbers along them and a straight line plotted',()=>{
  const s=[
    stroke('xaxis',[[80,400],[480,400]]),stroke('yaxis',[[100,420],[100,60]]),
    /* each number centred on its place: a one-letter word is .55H wide and .8H tall */
    ...word('x0',94.5,430,'0'),...word('x2',194.5,430,'2'),...word('x4',294.5,430,'4'),...word('x6',394.5,430,'6'),
    ...word('y5',70,258,'5'),...word('y10',60,108,'10'),
    /* y = x + 1: (0,1) to (6,7); x: 50px per unit from 100, y: 30px per unit up from 400 */
    stroke('curve',[[100,370],[400,190]]),
    ...word('xt',490,410,'t'),
  ];
  const out=run(s);
  assert.equal(out.length,1,out.join('\n---\n'));
  const t=out[0];
  assert.match(t,/\[graph: axes crossing at \(0, 0\); across: "t"/);
  assert.match(t,/numbers along the across axis: 2, 4, 6/);
  assert.match(t,/curve 1: a straight line from \(0, 1\) to \(6, 7\), gradient about 1/);
});

test('a curve on unnumbered axes is read off at even steps',()=>{
  const pts=[];for(let i=0;i<=40;i++){const x=i/40*8;pts.push([100+x*40,400-(x-4)*(x-4)*18]);}
  const s=[stroke('xaxis',[[100,400],[460,400]]),stroke('yaxis',[[100,400],[100,100]]),stroke('curve',pts)];
  const out=run(s);
  assert.equal(out.length,1,out.join('\n---\n'));
  assert.match(out[0],/no numbers are written on the across axis and the upright axis/);
  assert.match(out[0],/curve 1 through .*; lowest point near/);
});

test('a number line with ticks and numbers',()=>{
  const s=[stroke('line',[[60,200],[460,200]])];
  for(let i=0;i<=4;i++){s.push(stroke('t'+i,[[100+i*80,190],[100+i*80,210]]));s.push(...word('n'+i,95+i*80,240,String(i)));}
  const out=run(s);
  assert.equal(out.length,1,out.join('\n---\n'));
  assert.match(out[0],/a number line/);
  assert.match(out[0],/numbers written along it: 0, 1, 2, 3, 4/);
});

test('writing on its own, a fraction, an underline and a box of notes are not drawings',()=>{
  const s=[
    ...word('w1',40,60,'homework'),...word('w2',260,60,'due'),
    /* a fraction: writing over and under a long bar */
    ...word('num',60,130,'x+1'),stroke('bar',[[50,140],[150,140]]),...word('den',70,170,'2y'),
    /* an underline under a heading */
    ...word('head',40,240,'Photosynthesis'),stroke('ul',[[40,246],[250,246]]),
    /* a box round some notes */
    stroke('frame',[[30,290],[420,290],[420,400],[30,400],[30,290]]),...word('n1',50,330,'light'),...word('n2',50,370,'water'),
    /* a stem of a tall letter is not a line */
    stroke('l',[[300,140],[300,110]]),
  ];
  assert.deepEqual(run(s),[]);
});

test('a line across a circle from its centre is a radius, with its label',()=>{
  const s=[ring('c',200,200,100),stroke('r',[[200,200],[300,200]]),...word('r5',230,190,'5'),...word('o',185,215,'O')];
  const out=run(s);
  assert.equal(out.length,1,out.join('\n---\n'));
  assert.match(out[0],/line from "O" .* to circle 1, labelled "5"|line from the centre of circle 1 to circle 1, labelled "5"/);
});

test('writing inside a figure, by a corner and in the middle, is said without failing',()=>{
  const s=[
    stroke('tri',[[100,400],[300,100],[500,400],[100,400]]),
    /* an angle written inside the bottom-left corner, a note in the middle */
    ...word('ang',118,396,'40'),...word('mid',260,330,'area'),
  ];
  const found=D.find(s);
  assert.equal(found.diagrams.length,1);
  const t=D.describe(found.diagrams[0],read).join('\n');
  assert.match(t,/at corner 1, inside: "40"/);
  assert.match(t,/"area" is inside triangle 1/);
});

test('a bar chart: bars standing on the axis, named underneath, heights in the axis units',()=>{
  /* y: 30px per unit up from 400; numbers 0, 5 and 10 up the side */
  const s=[
    stroke('xaxis',[[100,400],[520,400]]),stroke('yaxis',[[100,400],[100,60]]),
    ...word('y5',70,258,'5'),...word('y10',60,108,'10'),
    /* a box of one stroke, height 7; an up-across-down stroke, height 4; a box, height 9 */
    stroke('b1',[[140,400],[140,190],[200,190],[200,400],[140,400]]),
    stroke('b2',[[260,400],[260,280],[320,280],[320,400]]),
    stroke('b3',[[380,400],[380,130],[440,130],[440,400],[380,400]]),
    ...word('mon',150,430,'Mon'),...word('tue',270,430,'Tue'),...word('wed',390,430,'Wed'),
    ...word('top',395,120,'9'),
  ];
  const out=run(s);
  assert.equal(out.length,1,out.join('\n---\n'));
  const t=out[0];
  assert.match(t,/\[graph \(a bar chart\)/);
  assert.match(t,/bar "Mon": up to 7\b/);
  assert.match(t,/bar "Tue": up to 4\b/);
  assert.match(t,/bar "Wed": up to 9\b, marked "9"/);
  assert.doesNotMatch(t,/across: "Mon/,'the bars\' names are not the axis\'s name');
  assert.doesNotMatch(t,/rectangle/,'bars are not said again as shapes');
});

test('a pie chart: slices clockwise from the top, their shares and their words',()=>{
  /* cuts at 12, 3 and 7:30 o'clock: a quarter, three eighths, three eighths */
  const cx=300,cy=250,r=120,at=a=>[cx+r*Math.sin(a),cy-r*Math.cos(a)];
  const s=[
    ring('pie',cx,cy,r),
    stroke('c1',[[cx,cy],at(0)]),stroke('c2',[[cx,cy],at(Math.PI/2)]),stroke('c3',[[cx,cy],at(Math.PI*1.25)]),
    ...word('red',330,215,'red'),...word('blue',300,330,'blue'),...word('green',215,230,'green'),
  ];
  const out=run(s);
  assert.equal(out.length,1,out.join('\n---\n'));
  assert.match(out[0],/a pie chart in 3 slices, clockwise from the top: "red" 25%, "blue" 3[78]%, "green" 3[78]%/);
  assert.doesNotMatch(out[0],/line from/,'the cuts are not said again as lines');
});

test('a busy page: outlines drawn stroke by stroke are still found among lots of writing',()=>{
  /* sixty rows of tall letters give the page hundreds of straight stems */
  const s=[];
  for(let r=0;r<60;r++)for(let i=0;i<8;i++)s.push(stroke('stem'+r+'_'+i,[[600+i*12,40+r*30],[600+i*12,58+r*30]]));
  s.push(
    /* a box of four strokes, an arrow from it to a triangle of three */
    stroke('t',[[100,100],[220,100]]),stroke('r',[[220,100],[220,160]]),stroke('b',[[220,160],[100,160]]),stroke('l',[[100,160],[100,100]]),
    ...word('in',130,140,'input'),
    stroke('arr',[[222,130],[364,130],[352,120],[364,130],[352,140]]),
    stroke('t1',[[340,180],[400,80]]),stroke('t2',[[400,80],[460,180]]),stroke('t3',[[460,180],[340,180]]),
    ...word('tA',395,70,'A'),
  );
  const out=run(s);
  assert.equal(out.length,1,out.join('\n---\n'));
  assert.match(out[0],/rectangle \d "input"/);
  assert.match(out[0],/triangle \d/);
  assert.match(out[0],/arrow from rectangle \d "input" to (corner \d+ of )?triangle \d/);
});

test('numbers are read the way they are written on axes',()=>{
  assert.equal(D.numberOf('−2'),-2);
  assert.equal(D.numberOf('1,000'),1000);
  assert.equal(D.numberOf('0.5'),.5);
  assert.equal(D.numberOf('1/2'),.5);
  assert.equal(D.numberOf('x'),null);
});
