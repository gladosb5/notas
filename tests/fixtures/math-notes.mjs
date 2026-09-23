// Development regressions, NOT independent handwriting accuracy evidence.
// Vector paths are authored examples, not captured human test-set samples.
const glyphs={
  '6':[[[25,2],[12,4],[4,17],[3,32],[10,40],[22,38],[28,29],[23,21],[12,20],[3,28]]],
  '1':[[[6,9],[15,1],[15,40]]],
  '4':[[[22,1],[3,27],[30,27]],[[22,1],[22,40]]],
  '+':[[[2,22],[30,22]],[[16,8],[16,36]]],
  '*':[[[4,10],[28,34]],[[28,10],[4,34]]],
  '=':[[[2,15],[32,15]],[[2,28],[32,28]]],
  'h':[[[3,1],[3,40],[5,24],[14,18],[23,22],[24,40]]],
  'i':[[[9,20],[9,40]],[[9,7],[9,8]]]
};
export function writing(text,x=40,y=140,prefix='target',scale=1,spacing=1){
  const paths=[];
  let charIndex=0;
  for(const ch of text){
    let strokeIndex=0;
    for(const points of glyphs[ch]||[]){
      const t0=charIndex*120+strokeIndex*18;
      paths.push({points:points.map(([a,b])=>[x+a*scale,y+b*scale]),t0,t1:t0+10});
      strokeIndex++;
    }
    x+=(ch==='i'?22:43)*scale*spacing;
    charIndex++;
  }
  return paths.map(({points,t0,t1},i)=>({id:prefix+'-'+i,author:'user',w:2.8*scale,t0,t1,
    pts:points.flatMap(([x,y])=>[x,y,.5]),
    bbox:[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))]}));
}
export function stroke(id,points,w=2.8,t0=0){
  return {id,author:'user',w,t0,t1:t0+10,pts:points.flatMap(([x,y])=>[x,y,.5]),
    bbox:[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))]};
}
export const samples=[];
// Geometry-only regressions exercise notebook segmentation without pretending
// that their schematic strokes form a labelled OCR corpus. Unit tests include
// these, while the end-to-end transcription benchmark uses `samples` only.
export const groupingSamples=[];
// Adjacent rows with vertically aligned '=' marks. Their bars overlap strongly
// in x but belong to different row contexts and must never union transitively.
{
  const top=writing('61+1=',40,100,'bars-top',1,.46),bottom=writing('61+1=',40,143,'bars-bottom',1,.46);
  samples.push({id:'adjacent-parallel-bars',base_id:'adjacent-parallel-bars',kind:'crowded',expected:'61+1=',
    categories:['crowded','adjacent_equations','parallel_bars'],source:'authored-vector-regression',
    strokes:[...top,...bottom],targetIds:top.map(s=>s.id)});
}
// A fraction whose numerator and denominator touch the separator by a few px.
// This is authored grouping evidence only; recognition still decides the math.
{
  const numerator=[stroke('frac-num',[[76,118],[83,132],[90,139]],2.8,0)],
    bar=[stroke('frac-bar',[[66,138],[101,138]],2.8,1)],
    denominator=[stroke('frac-den',[[76,137],[83,145],[90,158]],2.8,2)];
  groupingSamples.push({id:'touching-fraction',base_id:'touching-fraction',kind:'fraction',expected:'fraction',
    categories:['fraction','touching'],source:'authored-vector-regression',strokes:[...numerator,...bar,...denominator],
    targetIds:[...numerator,...bar,...denominator].map(s=>s.id)});
}
// A small superscript overlaps the base's right edge rather than leaving a gap.
{
  const base=[stroke('script-base',[[48,140],[49,112],[64,111],[72,126],[70,142]],3,0)],
    sup=[stroke('script-sup',[[68,112],[75,101],[82,111],[75,119]],2.4,1)];
  groupingSamples.push({id:'touching-script',base_id:'touching-script',kind:'script',expected:'script',categories:['script','touching'],
    source:'authored-vector-regression',strokes:[...base,...sup],targetIds:[...base,...sup].map(s=>s.id)});
}
// A detached script fragment can sit about one body-height from its base while a
// complete neighboring row is also nearby. Stroke-count, containment and order
// context should reattach the small fragment without treating the other row as
// another script component.
{
  const base=writing('61+1=',40,140,'context-base',1,.5),
    script=[stroke('context-script-a',[[72,181],[77,190],[83,184]],2.3,900),
      stroke('context-script-b',[[84,182],[88,191],[92,186]],2.3,918)],
    neighbor=writing('4+1=',34,96,'context-neighbor',1,.5);
  groupingSamples.push({id:'contained-script-near-row',base_id:'contained-script-near-row',kind:'script',expected:'script',
    categories:['script','crowded','adjacent_equations'],source:'authored-vector-regression',
    strokes:[...base,...script,...neighbor],targetIds:[...base,...script].map(s=>s.id)});
}
for(const expected of ['61+1=','hi=4','hi*4']){
  for(const layout of ['isolated','crowded']){
    // Crowded samples deliberately remove the comfortable inter-character and
    // inter-line whitespace the grouping code used to rely on. With spacing
    // below .5, neighboring glyph boxes touch or nearly touch. The rows above
    // and below sit only a few pixels outside the target row, so their plus/one
    // vertical strokes are close enough to expose transitive line merging.
    const target=writing(expected,40,140,'target',1,layout==='crowded'?.32:1);
    const distractors=layout==='crowded'?[
      ...writing('4+1=',34,96,'above',1,.48),...writing('6+4=',46,184,'below',1,.48),
      // A long down-stroke from the upper working passes beside the target row.
      // It must stay with that row rather than widening its bbox into a bridge.
      stroke('above-long-downstroke',[[113,109],[114,132],[115,154],[116,169]]),
      ...writing('61+4=',300,58,'heading',1.7,.62),...writing('4+1=',315,226,'diagram',1.7,.62)
    ]:[];
    samples.push({id:expected+'-'+layout,base_id:expected,kind:layout,expected,
      categories:[layout,expected.startsWith('hi')?'named_variable':'arithmetic'],
      source:'authored-vector-regression',strokes:[...target,...distractors],targetIds:target.map(s=>s.id)});
  }
}
samples.push({id:'user-pens',base_id:'user-pens',kind:'named_variable',expected:'Pens=3',
  categories:['named_variable','user_report'],source:'user-screenshot-regression',
  image:'tests/fixtures/pens-user.png',crop:[20,30,294,130]});
