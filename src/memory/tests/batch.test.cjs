// Dependency-free tests of the actual manager class; no MCP server is started.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const {stripTypeScriptTypes} = require('node:module');
const {spawnSync} = require('node:child_process');
async function manager(file) {
 const source = await fs.readFile(path.join(__dirname,'../index.ts'),'utf8');
 const body = source.slice(source.indexOf('interface Entity'),source.indexOf('const knowledgeGraphManager'));
 const context = vm.createContext({fs,MEMORY_FILE_PATH:file,Error});
 const Klass = vm.runInContext(stripTypeScriptTypes(body)+';KnowledgeGraphManager',context);
 return new Klass();
}
async function fixture(t) {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'memory-batch-test-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'graph.jsonl');return {file,m:await manager(file)};
}
const plain=x=>JSON.parse(JSON.stringify(x));
if (process.env.MEMORY_BATCH_TEST_READ) {
 manager(process.env.MEMORY_BATCH_TEST_READ).then(m=>m.readGraph()).then(g=>console.log(JSON.stringify(g))).catch(e=>{console.error(e);process.exitCode=1;});
} else {
 test('duplicate entity names in a batch preserve first entity and ordering',async t=>{
 const {m}=await fixture(t);
 const input=[{name:'A',entityType:'project',observations:['first']},{name:'A',entityType:'other',observations:['second']},{name:'B',entityType:'project',observations:[]}];
 assert.deepEqual(plain(await m.createEntities(input)),[input[0],input[2]]);
 assert.equal((await m.readGraph()).entities.length,2);
 assert.equal((await m.createEntities(input)).length,0);
 });
 test('duplicate relation triples ignored within and across batches',async t=>{
 const {m}=await fixture(t);const r={from:'A',to:'B',relationType:'uses'};const s={...r,relationType:'tests'};
 assert.deepEqual(plain(await m.createRelations([r,r,s])),[r,s]);
 assert.equal((await m.createRelations([r,s])).length,0);
 });
 test('observations deduplicate each input and repeated entity entries',async t=>{
 const {m}=await fixture(t);await m.createEntities([{name:'A',entityType:'project',observations:['old']}]);
 const result=await m.addObservations([{entityName:'A',contents:['old','new','new']},{entityName:'A',contents:['new','later','later']}]);
 assert.deepEqual(plain(result).map(r=>r.addedObservations),[['new'],['later']]);
 assert.deepEqual(plain((await m.readGraph()).entities[0].observations),['old','new','later']);
 });
 test('records survive a fresh process and deletion remains persisted',async t=>{
 const {m,file}=await fixture(t);await m.createEntities([{name:'A',entityType:'project',observations:['old']},{name:'B',entityType:'project',observations:[]}]);
 await m.createRelations([{from:'A',to:'B',relationType:'uses'}]);
 const read=()=>{const p=spawnSync(process.execPath,[__filename],{env:{...process.env,MEMORY_BATCH_TEST_READ:file},encoding:'utf8',timeout:10000});assert.equal(p.status,0,p.stderr);return JSON.parse(p.stdout);};
 assert.equal(read().entities.length,2);
 await m.deleteEntities(['A']);const graph=read();assert.deepEqual(graph.entities.map(e=>e.name),['B']);assert.deepEqual(graph.relations,[]);
 });
}
