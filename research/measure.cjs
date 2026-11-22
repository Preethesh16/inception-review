const { RepositoryIndex } = require('../src/context.cjs');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const assert = require('node:assert/strict');
const root = path.resolve(process.argv[2] || '../flask-3.1.3');
const files = execFileSync('git',['-C',root,'ls-files','-z'],{encoding:'utf8'}).split('\0')
  .filter(name => /\.(py|rst|md)$/.test(name)).map(name => ({name,text:fs.readFileSync(path.join(root,name),'utf8')}));
const tic = performance.now();
const index = new RepositoryIndex(files);
console.log('Indexed',files.length,'files in',Math.round(performance.now()-tic),'ms');
const prompts = [
  ['CLI','Add a built-in CLI command flask config showing configuration as JSON with secret values masked; provide documentation and tests.'],
  ['Environment','Support custom prefixes and nested keys when loading configuration from environment variables, with tests and documentation'],
  ['Templates','Explain which template loader finds a template when multiple blueprints provide it, including debug output and tests'],
  ['Streaming','Keep the request context available to a streaming generator and describe the pattern for streamed responses'],
];
for (const [label, prompt] of prompts) {
  const t = performance.now();
  const result = index.retrieve(prompt,{budget:2000});
  const total = result.reduce((sum,hit)=>sum+hit.excerpt.length,0);
  assert(total <= 2000);
  console.log(label,Math.round(performance.now()-t),'ms',total,'excerpt chars', result.map(x => x.name+':'+x.line).join(', '));
}
assert.equal(index.retrieve('unrelated',{limit:1,pinned:['docs/config.rst']})[0].reason,'explicit file mention');
assert.deepEqual(index.retrieve('',{budget:0}),[]);
assert.deepEqual(index.retrieve('xqzzqzz'),[]);
