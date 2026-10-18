const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
function engine(cas=false){
  const S={settings:{angle:'deg',fractions:false},lines:[],strokes:[],clusters:[]};
  const N={core:{S,M:{},$:()=>({}),markDirty(){}}};
  const ctx=vm.createContext({N,window:{},document:{documentElement:{}},getComputedStyle:()=>({getPropertyValue:()=>''}),console,setTimeout,clearTimeout,auditSolves:0});
  for(const f of ['math',...(cas?['nerdamer','algebra','calculus','solve']:[])])vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/'+f+'.js'),'utf8'),ctx);
  ctx.window.math=ctx.math;
  const html=fs.readFileSync(path.join(__dirname,'../notas.html'),'utf8').replaceAll('\r\n','\n'),a=html.indexOf('/* =========================================================================\n   MATH CORE');
  vm.runInContext(html.slice(a,html.indexOf('</script>',a)).replace('N.mathcore = {','N.mathcore = { evalNode,evalNodeFresh,solve,').replace('function solve(src, scope){','function solve(src, scope){globalThis.auditSolves++;'),ctx);
  N.mathcore.harden();
  const evaluate=src=>{const n={ref:{}};N.mathcore.evalNodeFresh(n,N.mathcore.baseScope(),new Set(),N.mathcore.normalize(src).replace(/=\s*$/,''));return n;};
  return {S,m:N.mathcore,evaluate,ctx};
}
test('F54/F58/F64: exact trig, poles, undefined arithmetic and written notation',()=>{
  const {S,evaluate}=engine();
  for(const [src,want] of [['cos(90)','0'],['sin(180)','0'],['sin(30)','0.5'],['cos(60)','0.5'],[String.raw`\arcsin(0.5)`,'30'],[String.raw`\sin^{-1}(0.5)`,'30'],[String.raw`\sin^{2}(30)+\cos^{2}(30)`,'1'],[String.raw`\log_{2}8`,'3'],[String.raw`\log_2 8`,'3'],[String.raw`\log_{2}{(4+4)}`,'3']])assert.equal(evaluate(src).result,want,src);
  for(const src of ['tan(90)','sec(90)','csc(180)','cot(0)','5/0','0/0','a=5/0','1e308*1e308'])assert.match(evaluate(src).error,/undefined|non-finite/,src);
  S.settings.angle='rad';assert.equal(evaluate('sin(pi)').result,'0');
  assert.notEqual(evaluate('sin(1e-20)').result,'0','small real angles remain nonzero');
});
test('F12: tiny values remain distinct while roundoff cancellation is accepted',()=>{
  const {evaluate}=engine();
  for(const src of ['1e-20=0','1e-20=2e-20','10^(-20)=0','1.6e-19*2=5e-19'])assert.notEqual(evaluate(src).stated,true,src);
  for(const src of ['0.1+0.2-0.3=0','(0.1+0.2-0.3)*1e-20=0','0.1+0.2=0.3'])assert.equal(evaluate(src).stated,true,src);
});
test('F55/F56/F57: CAS candidates are checked, complex quadratics work and tails are not roots',()=>{
  for(const cas of [false,true]){
    const {S,m,evaluate}=engine(cas);
    const irrational=evaluate('x^2=2').result;assert.ok(irrational.includes('1.4142135623731'),irrational);assert.ok(!irrational.includes('/'));
    assert.match(evaluate('x^2=-4').result,/2i|2 i/);
    assert.match(evaluate('x^2+x+1=0').result,/0\.86602540378444/);
    for(const src of ['1/x=0','2^x=0','e^x=0'])assert.equal(m.solve(src,m.baseScope()),'',src);
    const trig=evaluate('sin(x)=0.5').result;assert.match(trig,/30/);assert.match(trig,/150/);assert.ok(trig.length<150,trig);
    S.settings.angle='rad';assert.ok(!m.solve('cos(x)=2',m.baseScope()));
  }
});
test('F63: an unchanged unsolvable equation evaluates once, even after another line changes',()=>{
  const {m,ctx,S}=engine();
  const node={id:'line',kind:'line',src:'1/x=0',ref:{}};
  m.evalNode(node,m.baseScope(),new Set());assert.equal(node.error,'cannot solve this yet');assert.equal(ctx.auditSolves,1);
  m.evalNode({id:'other',kind:'line',src:'2+2',ref:{}},m.baseScope(),new Set());
  m.evalNode(node,m.baseScope(),new Set());assert.equal(node.error,'cannot solve this yet');assert.equal(ctx.auditSolves,1);
  S.settings.angle='rad';m.evalNode(node,m.baseScope(),new Set());assert.equal(ctx.auditSolves,2);
});
