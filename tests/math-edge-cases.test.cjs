const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
function engine(){
  const S={settings:{angle:'deg',fractions:false},lines:[],strokes:[],clusters:[]};
  const N={core:{S,M:{},$:()=>({}),markDirty(){}}};
  const context={N,window:{},document:{documentElement:{}},getComputedStyle:()=>({getPropertyValue:()=>''}),console,setTimeout,clearTimeout};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/math.js'),'utf8'),context);
  context.window.math=context.math;
  const html=fs.readFileSync(path.join(__dirname,'../notas.html'),'utf8');
  const normalized=html.replaceAll('\r\n','\n'),at=normalized.indexOf('/* =========================================================================\n   MATH CORE');
  const code=normalized.slice(at,normalized.indexOf('</script>',at)).replace('N.mathcore = {','N.mathcore = { evalNode, evalNodeFresh, solve,');
  vm.runInContext(code,context);N.mathcore.harden();
  return {S,m:N.mathcore};
}
test('nested LaTeX keeps arithmetic structure and meaning',async()=>{
  const {m}=engine();
  for(const [src,expected] of [[String.raw`\sqrt{3^{2}+4^{2}}`,'5'],[String.raw`\frac{1}{2^{3}}`,'0.125'],[String.raw`1\frac{1}{2}+1`,'2.5'],[String.raw`\lvert-3\rvert`,'3'],[String.raw`x=2\pm3`,'5 or -1'],['log(100)','2'],['ln(exp(2))','2'],['sec(60)','2']]){const n={ref:{}};m.evalNodeFresh(n,m.baseScope(),new Set(),m.normalize(src));assert.equal(n.result,expected,src+' normalized='+m.normalize(src)+' error='+n.error);}
});
test('equations route both sides through the solver and preserve reserved functions',()=>{
  const {m}=engine(),scope=m.baseScope(),defined=new Set();
  for(const [src,expected] of [['3=x+1','x = 2'],['3h=12','h = 4'],['5t=20','t = 4'],['x=3','3'],['2x+3=11','x = 4'],['(x+1)(x-1)=0','x = -1 or 1'],['1000x=5000000','x = 5000'],['2x=2x','all x'],['4!=25','24']]){const n={ref:{}};m.evalNodeFresh(n,scope,defined,m.normalize(src));assert.equal(n.result,expected,src+' '+n.error);}
  const n={ref:{}};m.evalNodeFresh(n,scope,defined,'sin(x)=0.5');assert.equal(m.evalRaw('sin(90)',scope),1);
  assert.notEqual(m.solve('1/x=0',scope),'x = 0');
});
test('numeric formatting and equality do not fabricate precision',()=>{
  const {m,S}=engine(),n={ref:{}};
  m.evalNodeFresh(n,m.baseScope(),new Set(),'99999*99999=9999800002');assert.equal(n.stated,undefined);assert.equal(n.result,'9999800001');
  assert.match(m.fmt(2**100),/^≈ /);S.settings.fractions=true;assert.ok(!m.fmt(Math.sqrt(2)).includes('/'));assert.equal(m.fmt(.125),'1/8');
});
test('cached function definitions bind to the current evaluation scope',()=>{
  const {m}=engine();
  const lines=[{id:'f',kind:'line',src:'f(x)=x+b',ref:{}},{id:'b',kind:'line',src:'b=1',ref:{}},{id:'value',kind:'line',src:'f(1)=',ref:{}}];
  let scope=m.baseScope(),defined=new Set();for(const n of lines)m.evalNode(n,scope,defined);assert.equal(lines[2].result,'2');
  lines[1].src='b=100';scope=m.baseScope();defined=new Set();for(const n of lines)m.evalNode(n,scope,defined);assert.equal(lines[2].result,'101');
});
