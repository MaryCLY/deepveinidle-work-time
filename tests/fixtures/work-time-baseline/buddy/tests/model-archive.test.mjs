import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const archive=new URL('../docs/model-testing/2026-11-17-alpha/',import.meta.url);
const manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',archive),'utf8'));
const normalized=filename=>fs.readFileSync(filename,'utf8').replace(/\r\n/g,'\n');
const hash=text=>crypto.createHash('sha256').update(text,'utf8').digest('hex');

test('alpha model archive pins real data and reviewed source inputs with portable hashes',()=>{
 assert.equal(manifest.stage,'0.6.0-alpha');assert.equal(manifest.model.version,3);
 assert.equal(manifest.hashNormalization,'utf8-lf');
 assert.equal(manifest.source.sha256,'cb67b9c88201f9768b3ec90ffdbeb0ccf7d33b897649c019f13b95c6f0785dc5');
 for(const file of manifest.files){
  const content=normalized(new URL(file.path,archive));
  assert.equal(hash(content),file.sha256,file.path);assert.equal(Buffer.byteLength(content),file.bytes,file.path);
 }
 assert.deepEqual(new Set(manifest.inputs.map(file=>file.path)),new Set([
  'vendor/game-original.js','vendor/manifest.json','src/engine/upstream.js','src/engine/batch-time.js',
  'scripts/check-time-model.mjs','tests/helpers/game-work-oracle.mjs','tests/fixtures/batch-calibration.js',
  'tests/fixtures/chrome-time-references.js','scripts/archive-time-model.mjs',
 ]));
 for(const file of manifest.inputs){
  assert.match(file.sha256,/^[a-f0-9]{64}$/);assert.ok(file.bytes>0);
 }
 const summary=JSON.parse(normalized(new URL('summary.json',archive)));
 assert.equal(summary.sourceInputs.hashNormalization,'utf8-lf');
 assert.deepEqual(manifest.inputs.slice(0,8),summary.sourceInputs.files);
});

test('archived matrix and seed samples are complete and retain their separate measurement meanings',()=>{
 const rows=name=>normalized(new URL(name,archive)).trimEnd().split('\n');
 for(const [name,count] of [['logistics.csv',14950],['hourly-probability.csv',672],['finite-probability.csv',128]]){
  const records=rows(name),width=records[0].split(',').length;
  assert.equal(records.length-1,count,name);
  assert.ok(records.slice(1).every(row=>row.split(',').length===width),name);
 }
 const hourly=rows('hourly-probability.csv').slice(1).map(row=>row.split(','));
 assert.deepEqual([...new Set(hourly.map(row=>Number(row[4])))].sort((a,b)=>a-b),manifest.design.seeds);
 assert.equal(manifest.design.seeds.length,32);
 const summary=JSON.parse(normalized(new URL('summary.json',archive)));
 assert.equal(summary.coverage.isolatedCases,14950);assert.equal(summary.isolatedLogistics.mismatches,0);assert.equal(summary.errorCount,0);
 assert.equal(summary.chromeNominal.cohorts.reduce((sum,cohort)=>sum+cohort.caseCount,0),87);
 assert.ok(summary.isolatedLogistics.legacyV2AbsoluteErrorSeconds.mean>1.7);
 assert.ok(summary.isolatedLogistics.absoluteErrorSeconds.max<1e-7);
});

test('representative paths and phase traces preserve final banking and batch boundary evidence',()=>{
 const paths=JSON.parse(normalized(new URL('representative-paths.json',archive)));
 assert.equal(paths.length,18);
 const copper=paths.find(row=>row.jobId===1&&row.count===1);
 assert.deepEqual(copper.original.legs.map(leg=>leg.distance),[12,11]);
 const traces=JSON.parse(normalized(new URL('phase-traces.json',archive)));
 assert.deepEqual(traces.map(trace=>[trace.count,trace.totalTicks]),[[1,16],[14,29],[15,44],[28,57]]);
 for(const trace of traces){
  assert.equal(trace.trace.length,trace.totalTicks);assert.equal(trace.workTicks,trace.count);
  assert.equal(trace.trace.at(-1).after.activity,'idle');assert.equal(trace.trace.at(-1).after.phase,null);
  assert.equal(trace.trace.filter(tick=>tick.appendedFinalReturn).length,1);
 }
});
