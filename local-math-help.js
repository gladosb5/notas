(function(){
'use strict';
function affine(node,variable){
  if(node.isParenthesisNode)return affine(node.content,variable);
  if(node.isConstantNode&&typeof node.value==='number'&&Number.isFinite(node.value))return [0,node.value];
  if(node.isSymbolNode&&node.name===variable)return [1,0];
  if(!node.isOperatorNode)throw new Error('Unsupported expression');
  const a=affine(node.args[0],variable),b=node.args[1]?affine(node.args[1],variable):null;
  if(!b){if(node.op==='-')return a.map(x=>-x);if(node.op==='+')return a;}
  if(node.op==='+')return [a[0]+b[0],a[1]+b[1]];
  if(node.op==='-')return [a[0]-b[0],a[1]-b[1]];
  if(node.op==='*'&&(!a[0]||!b[0]))return [a[0]*b[1]+b[0]*a[1],a[1]*b[1]];
  if(node.op==='/'&&b[0]===0&&b[1]!==0)return a.map(x=>x/b[1]);
  if(node.op==='^'&&b[0]===0&&b[1]===1)return a;
  throw new Error('Only linear expressions are supported here');
}
function linear(source){
  const m=N.mathcore,s=m.normalize(source),sides=s.split('=');
  if(sides.length!==2||/[<>!]/.test(s))return null;
  const variables=[...new Set(m.freeVars(sides[0]).concat(m.freeVars(sides[1])))];
  if(variables.length!==1)return null;
  const variable=variables[0];
  try{
    const left=affine(m.parseRaw(sides[0]),variable),right=affine(m.parseRaw(sides[1]),variable);
    const a=left[0]-right[0],b=right[1]-left[1];
    if(![a,b,...left,...right].every(Number.isFinite))return null;
    return {variable,left,right,a,b,root:a?b/a:null};
  }catch{return null;}
}
function verifyPair(a,b){
  const m=N.mathcore,A=m.normalize(a),B=m.normalize(b);
  try{
    if(A.includes('=')||B.includes('=')){
      const x=linear(A),y=linear(B);
      if(!x||!y||x.variable!==y.variable)return null;
      if(!x.a||!y.a){
        const kind=t=>t.a?'one':t.b===0?'all':'none';
        return kind(x)===kind(y);
      }
      // Restrict proof to safely representable integer coefficients. No random sampling.
      const vals=[x.a,x.b,y.a,y.b,x.a*y.b,y.a*x.b];
      if(!vals.every(Number.isSafeInteger))return null;
      return x.a*y.b===y.a*x.b;
    }
    if(m.freeVars(A).length||m.freeVars(B).length)return null;
    const x=m.evalRaw(A,m.baseScope()),y=m.evalRaw(B,m.baseScope());
    return typeof x==='number'&&typeof y==='number'&&Number.isFinite(x)&&Number.isFinite(y)?x===y:null;
  }catch{return null;}
}
function help(question,level,nodes){
  const m=N.mathcore,query=question.trim();
  const explicit=query.replace(/^(?:solve|calculate|evaluate|help(?: me)?(?: with)?|explain)\s+/i,'').replace(/\?$/,'').trim();
  let target=nodes.filter(n=>n.src&&!(n.ref?.review)).at(-1);
  // Accept the operators tablets and international keyboards commonly insert;
  // mathcore.normalize already converts them to the calculator's ASCII form.
  const isExpression=explicit.length>0&&/^[\d\sA-Za-z_+\-*/^().=×✕✖÷−–—π√]+$/.test(explicit)&&/[\d=π√]/.test(explicit)&&!/[A-Za-z]{3,}\s+[A-Za-z]{2,}/.test(explicit);
  if(isExpression)target={id:null,src:explicit};
  const general=/^(help|hint|next step|full solution|explain|what next|solve this|help me|check my work)?[?.!]*$/i.test(query);
  if(!isExpression&&!general)return {say:'I can give local maths hints for a typed expression or the last expression on your page. Try “2x + 3 = 11”. Open-ended questions are not supported.',ops:[]};
  if(!target)return {say:'Write or type an expression first. Handwriting is read and calculated automatically.',ops:[]};
  const ops=target.id?[{op:'underline',target:target.id}]:[];
  const eq=linear(target.src),fmt=x=>m.fmt(x);
  if(eq){
    const {a,b,variable:v}=eq;
    if(!a)return {say:b===0?'Both sides simplify to the same expression, so every value works.':'The variable terms cancel but the constants disagree, so this equation has no solution.',ops};
    const text=[
      'Which operation would help you isolate '+v+' while keeping both sides equal?',
      'Collect the '+v+' terms on the left and constants on the right, then divide by the coefficient of '+v+'.',
      'Collect like terms: '+fmt(a)+v+' = '+fmt(b)+'.',
      'Collect like terms: '+fmt(a)+v+' = '+fmt(b)+'. Divide both sides by '+fmt(a)+': '+v+' = '+fmt(b/a)+'.'
    ];
    return {say:text[level],ops};
  }
  const src=m.normalize(target.src);
  if(src.includes('='))return {say:'Step-by-step hints currently cover linear equations in one variable. You can still use the calculator for supported equations.',ops};
  try{
    const result=m.evalRaw(src,N.core.S.scope||m.baseScope());
    if(typeof result==='function'||typeof result==='boolean')throw new Error('Unsupported');
    const text=[
      'Which part should you calculate first: brackets, powers, or an operation?',
      'Work inside brackets first, then powers, multiplication and division, then addition and subtraction.',
      /\(/.test(src)?'Start with the innermost brackets. Replace that result before continuing.':/\^/.test(src)?'Evaluate the powers first.':'Work from left to right through multiplication and division before adding or subtracting.',
      src+' = '+fmt(result)+'. The local calculator evaluated this expression.'
    ];
    return {say:text[level],ops};
  }catch{return {say:'I cannot give a reliable hint for this expression yet. Check the reading, define any variables, or try a linear equation such as 2x + 3 = 11.',ops};}
}
N.localMath={linear,verifyPair,help};
})();
