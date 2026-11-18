import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {createRuleEngine as createWorkTimeEngine,batchTimeModel} from '../src/rule-engine.js';

const baseline=new URL('./fixtures/work-time-baseline/',import.meta.url);
const archive=new URL('buddy/docs/model-testing/2026-11-17-alpha/',baseline);
const sourcePaths=[
 'docs/model-testing/2026-11-17-alpha/README.md',
 'docs/model-testing/2026-11-17-alpha/manifest.json',
 'docs/model-testing/2026-11-17-alpha/summary.json',
 'docs/model-testing/2026-11-17-alpha/logistics.csv',
 'docs/model-testing/2026-11-17-alpha/hourly-probability.csv',
 'docs/model-testing/2026-11-17-alpha/finite-probability.csv',
 'docs/model-testing/2026-11-17-alpha/representative-paths.json',
 'docs/model-testing/2026-11-17-alpha/phase-traces.json',
 'tests/fixtures/batch-calibration.js','tests/fixtures/chrome-time-references.js',
 'docs/test-server.md','docs/superpowers/plans/2026-11-17-batch-time-routes.md',
 'docs/superpowers/plans/2026-11-17-timing-model-optimization.md',
 'src/engine/batch-time.js','src/engine/work-expectation.js','src/engine/rarity-probabilities.js',
 'src/engine/work-player.js','src/engine/upstream.js','vendor/manifest.json',
 'scripts/check-time-model.mjs','scripts/archive-time-model.mjs','tests/helpers/game-work-oracle.mjs',
 'tests/batch-time.test.mjs','tests/time-model-oracle.test.mjs','tests/model-archive.test.mjs',
];
const normalized=url=>Buffer.from(fs.readFileSync(url,'utf8').replace(/\r\n/g,'\n'),'utf8');
const readJson=url=>JSON.parse(normalized(url).toString('utf8'));
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function csv(name){
 const lines=normalized(new URL(name,archive)).toString('utf8').trimEnd().split('\n'),columns=lines.shift().split(',');
 return lines.map(line=>{
  const values=line.split(',');assert.equal(values.length,columns.length,name);
  return Object.fromEntries(values.map((value,index)=>{
   const number=value===''?null:Number(value);assert.ok(number===null||Number.isFinite(number),name);
   return [columns[index],number];
  }));
 });
}
const near=(actual,expected,tolerance,label)=>assert.ok(Number.isFinite(actual)&&Math.abs(actual-expected)<tolerance,`${label}: ${actual} != ${expected}`);

test('historical snapshot preserves all requested records with portable source fingerprints',()=>{
 const origin=readJson(new URL('origin.json',baseline)),manifest=readJson(new URL('manifest.json',archive));
 assert.equal(origin.schemaVersion,1);assert.equal(origin.source.repository,'https://github.com/MaryCLY/deepveinidle-buddy');
 assert.match(origin.source.head,/^[a-f0-9]{40}$/);assert.ok(Number.isFinite(Date.parse(origin.collectedAt)));
 assert.equal(origin.hashNormalization,'utf8-lf');assert.equal(origin.copyVerification.rawBytesEqual,true);
 assert.deepEqual(origin.files.map(file=>file.sourcePath).sort(),[...sourcePaths].sort());
 assert.equal(origin.files.length,25);
 for(const file of origin.files){
  assert.equal(file.path,'buddy/'+file.sourcePath);assert.match(file.raw.sha256,/^[a-f0-9]{64}$/);assert.ok(file.raw.bytes>0);
  const raw=fs.readFileSync(new URL(file.path,baseline));
  assert.equal(raw.length,file.raw.bytes,file.path+'/raw bytes');assert.equal(hash(raw),file.raw.sha256,file.path+'/raw sha256');
  const bytes=normalized(new URL(file.path,baseline));assert.equal(bytes.length,file.normalized.bytes,file.path);
  assert.equal(hash(bytes),file.normalized.sha256,file.path);
  if(file.sourcePath==='src/engine/batch-time.js'){
   assert.equal(file.sourceKind,'git-blob');assert.equal(file.sourceRevision,'e50b1b53b05e56f297608caddbe340b8d79ab809');
  }else{
   assert.equal(file.sourceKind,'working-tree');assert.equal(file.sourceRevision,origin.source.head);
  }
 }
 assert.equal(origin.totalRawBytes,origin.files.reduce((sum,file)=>sum+file.raw.bytes,0));
 assert.deepEqual(fs.readdirSync(archive).sort(),sourcePaths.filter(name=>name.startsWith('docs/model-testing/')).map(name=>name.split('/').at(-1)).sort());
 for(const input of manifest.inputs){
  if(input.path==='vendor/game-original.js'){
   assert.equal(origin.originalGameBundle.copied,false);assert.equal(origin.originalGameBundle.sha256,input.sha256);
   assert.equal(origin.originalGameBundle.labPath,'vendor/game-original.js');continue;
  }
  const file=origin.files.find(file=>file.sourcePath===input.path);assert.ok(file,input.path);
  assert.equal(file.normalized.sha256,input.sha256,input.path);assert.equal(file.normalized.bytes,input.bytes,input.path);
 }
 assert.ok(!fs.existsSync(new URL('buddy/vendor/game-original.js',baseline)));
});

test('historical datasets retain their original hashes, all samples and 87 Chrome references',async()=>{
 const manifest=readJson(new URL('manifest.json',archive));assert.equal(manifest.stage,'0.6.0-alpha');
 assert.equal(manifest.source.sourceVersion,'1.0.1214');assert.equal(manifest.model.version,3);assert.equal(manifest.hashNormalization,'utf8-lf');
 assert.equal(manifest.files.length,6);
 for(const file of manifest.files){
  const bytes=normalized(new URL(file.path,archive));assert.equal(bytes.length,file.bytes,file.path);assert.equal(hash(bytes),file.sha256,file.path);
 }
 for(const [name,count]of [['logistics.csv',14950],['hourly-probability.csv',672],['finite-probability.csv',128]])assert.equal(csv(name).length,count,name);
 const hourly=csv('hourly-probability.csv'),groups=new Map();
 for(const row of hourly){const key=[row.jobId,row.siteId,row.tier,row.configurationIndex].join('/');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row.seed);}
 assert.equal(groups.size,21);
 for(const seeds of groups.values())assert.deepEqual(seeds.sort((a,b)=>a-b),manifest.design.seeds);
 assert.equal(manifest.design.seeds.length,32);
 const summary=readJson(new URL('summary.json',archive));assert.equal(summary.coverage.isolatedCases,14950);
 assert.equal(summary.errorCount,0);assert.equal(summary.isolatedLogistics.mismatches,0);
 assert.deepEqual(manifest.inputs.slice(0,8),summary.sourceInputs.files);
 const {chromeTimeReferences}=await import(new URL('buddy/tests/fixtures/chrome-time-references.js',baseline));
 assert.equal(chromeTimeReferences.cohorts.length,4);assert.equal(chromeTimeReferences.cohorts.reduce((sum,group)=>sum+group.rows.length,0),87);
 assert.equal(summary.chromeNominal.cohorts.reduce((sum,group)=>sum+group.caseCount,0),87);
});

test('historical paths and phase traces preserve final banking and all four batch boundaries',()=>{
 const manifest=readJson(new URL('manifest.json',archive));
 const paths=readJson(new URL('representative-paths.json',archive));assert.equal(paths.length,18);
 const copper=paths.find(row=>row.jobId===1&&row.count===1);assert.deepEqual(copper.original.legs.map(leg=>leg.distance),[12,11]);
 for(const row of paths)assert.deepEqual(row.original.initialPosition,manifest.design.origin);
 const traces=readJson(new URL('phase-traces.json',archive));assert.equal(traces.length,4);
 assert.deepEqual(traces.map(trace=>[trace.count,trace.totalTicks]),[[1,16],[14,29],[15,44],[28,57]]);
 for(const trace of traces){
  assert.equal(trace.trace.length,trace.totalTicks);assert.equal(trace.workTicks,trace.count);
  assert.equal(trace.trace.at(-1).after.activity,'idle');assert.equal(trace.trace.at(-1).after.phase,null);
  assert.equal(trace.trace.filter(tick=>tick.appendedFinalReturn).length,1);
 }
});

// Reconstruct only the fields consumed by movement and capacity from the frozen
// manifest and calibration projection. No historical runner or oracle executes.
function movementPlayer(game,configuration,calibration,design){
 const player={id:design.actorId,lastTick:design.initialTick,...design.origin,pack:[],
  skills:Object.fromEntries(game.allSkills.map(skill=>[skill,game.levelXp(configuration.level)])),
  equipment:Object.fromEntries(game.equipmentSlots.map(slot=>[slot,null])),
  masteries:Object.fromEntries(game.masteries.map(mastery=>[mastery.id,0])),perks:{pockets:0},brews:{},brewTier:{}};
 const patch=structuredClone(configuration.fixture?calibration.player:configuration.patch);
 if(configuration.fixture)assert.equal(configuration.fixture,'tests/fixtures/batch-calibration.js#player');
 for(const [key,value]of Object.entries(patch)){
  if(value&&typeof value==='object'&&!Array.isArray(value))player[key]={...player[key],...value};else player[key]=value;
 }
 const capturedTick=patch.lastTick??design.initialTick;
 for(const kind of Object.keys(player.brews)){
  const remaining=player.brews[kind]-capturedTick;player.brews[kind]=remaining>0?design.initialTick+remaining:0;
 }
 player.lastTick=design.initialTick;return player;
}

test('current ESM engine replays all 14950 frozen logistics vectors using only the retained local adapter',async()=>{
 const manifest=readJson(new URL('manifest.json',archive));
 const game=await import(new URL('buddy/src/engine/upstream.js',baseline));
 const {bronzePickaxeCalibration}=await import(new URL('buddy/tests/fixtures/batch-calibration.js',baseline));
 const engine=createWorkTimeEngine(game,{sourceVersion:manifest.source.sourceVersion,sourceSha256:manifest.source.sha256});
 assert.deepEqual(batchTimeModel,manifest.model);
 const players=new Map(manifest.configurations.map(configuration=>[configuration.index,movementPlayer(game,configuration,bronzePickaxeCalibration,manifest.design)]));
 const jobs=new Map(game.recipes.map(job=>[job.id,job])),rows=csv('logistics.csv'),configurations=new Set();
 const secondsPerTick=manifest.design.tickMs/1000,tolerance=manifest.design.logisticsToleranceSeconds;
 assert.equal(rows.length,14950);assert.equal(manifest.configurations.length,3);
 for(const row of rows){
  const label=[row.configurationIndex,row.jobId,row.siteId,row.tier,row.count].join('/'),job=jobs.get(row.jobId),player=players.get(row.configurationIndex);
  assert.ok(job,label);assert.ok(player,label);configurations.add(row.configurationIndex);
  const actual=engine.estimateBatchTime({job,siteId:row.siteId,tier:row.tier,count:row.count,player,actionSeconds:secondsPerTick});
  assert.equal(actual.status,'ok',label);assert.equal(actual.sourceVersion,manifest.source.sourceVersion,label);
  near(actual.overheadSeconds,row.oracleOverheadSeconds,tolerance,label+'/oracleOverhead');
  near(actual.overheadSeconds,row.modelOverheadSeconds,tolerance,label+'/archivedModelOverhead');
  near(actual.seconds,row.oracleTotalTicks*secondsPerTick,tolerance,label+'/totalSeconds');
  near(actual.workSeconds,row.oracleWorkTicks*secondsPerTick,tolerance,label+'/workSeconds');
  assert.equal(actual.batches,row.batches,label);assert.equal(actual.batchCapacity,row.capacity,label);
  assert.equal(actual.siteId,row.siteId,label);assert.equal(actual.bankId,manifest.design.bankId,label);
  assert.equal(actual.originAssumption,'main-city-bank',label);
  assert.equal(actual.distance,row.distance,label);assert.equal(actual.returnDistance,row.returnDistance,label);
  assert.equal(actual.totalWalkTicks,row.oracleWalkTicks,label);
  const initialTicks=job.inputs.length?manifest.model.initialCraftTicks:manifest.model.initialGatherTicks;
  const starts=(row.oracleOverheadSeconds/secondsPerTick-initialTicks-manifest.model.finishTicks-(row.batches-1)*manifest.model.turnoverTicks-row.oracleWalkTicks)/manifest.model.walkStartTicks;
  near(actual.walkStarts,starts,tolerance,label+'/walkStarts');
 }
 assert.equal(configurations.size,3);
});
