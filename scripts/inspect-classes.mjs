import fs from 'node:fs';
import bz from 'unbzip2-stream';
import tar from 'tar-stream';

const extract = tar.extract();
extract.on('entry', (h, stream, next) => {
  if (/classification-task\/fold-1\/(train|test)\.csv$/.test(h.name)) {
    const out = '.dataset/' + h.name.split('/').pop();
    let b = '';
    stream.on('data', c => b += c);
    stream.on('end', () => { fs.writeFileSync(out, b); console.log('saved', out, b.split('\n').length, 'lines'); next(); });
  } else { stream.resume(); stream.on('end', next); }
});
extract.on('finish', () => console.log('done'));
fs.createReadStream('.dataset/HASYv2.tar.bz2').pipe(bz()).pipe(extract);
