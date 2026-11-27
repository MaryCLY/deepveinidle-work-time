import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {compileGameFile} from '../src/game-file.js';
import {createWorkTimeEngine} from '../src/index.js';
import {createBatchTimeEstimator} from '../src/batch-time.js';
import {digest,extractNative,loadReplaySnapshot,replaySource1227,sequenceArgs,workModelSymbols1227} from './native-replay.mjs';

// Offline sample runner. Counts are comma-separated, seeds are consecutive, and
// snapshot and output paths are relative to the current directory or absolute.
const usage='node scripts/sample-gathering-work-time.mjs <snapshot.js> [seed-count] [counts] [start-seed] [output.json]';
const args=process.argv.slice(2);
if(args.length===1&&args[0]==='--help'){
 console.log(usage+'\nDefaults: 48 seeds, counts 440,444,448,1000, starting seed 1.\nOutput: .test-artifacts/gathering-drop-native/trials.json.');
 process.exit(0);
}
const [snapshot,rawSeedCount='48',rawCounts='440,444,448,1000',rawStartSeed='1',output='.test-artifacts/gathering-drop-native/trials.json']=args;
if(args.length>5||!snapshot?.trim()||!output.trim())throw Error(usage);
const {seedCount,counts,startSeed,seeds}=sequenceArgs(rawSeedCount,rawCounts,rawStartSeed);
const outputPath=path.resolve(output);
const {source,sourceVersion,sourceUrl,sha256,checkOutputPath}=loadReplaySnapshot(snapshot,outputPath,[replaySource1227]);
const compiled=compileGameFile(source,{symbols:workModelSymbols1227,sourceVersion,sourceUrl});
assert.deepEqual(compiled.diagnostics,[]);
assert.equal(compiled.source.sha256,sha256);
const {gameFile}=await import('data:text/javascript;base64,'+Buffer.from(compiled.code).toString('base64'));
const secondsPerTick=gameFile.tickMs/1000;
const {version:workTimeVersion}=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const modelModules=['effective-engine.js','batch-time.js','gathering-pack.js'];
function modelDigests(){
 return Object.fromEntries(modelModules.map(name=>[name,digest(readFileSync(new URL('../src/'+name,import.meta.url)))]));
}
const modelSha256=modelDigests();

const symbols={
 createPlayer:'Foo',startWork:'mh',tick:'HMo',context:'clo',siteEntrance:'Ts',
 world:'X',jobs:'xe',levelXp:'os',level:'Ge',baseItemId:'io',encode:'Un',withRarity:'Te',
 questDay:'ub',questWeek:'$oo',workChance:'X3o',dungeonKeyTier:'iZ',
 workSpeed:'JL',strideSpeed:'dD',capacity:'Es',earringBonus:'fm',
};
const {native,declarationCount}=extractNative(source,symbols);
const engine=createWorkTimeEngine(gameFile);
const skills=['mining','woodcutting','fishing'];
const clock=1000000;
assert.ok(skills.every(skill=>gameFile.hotRarityMultiplier(clock,skill)===1),'Snapshot has a hot rarity bonus.');
const level=100;
const bank=native.world.bankById.get(1);
const entrance=native.siteEntrance(native.world,bank.x,bank.y,0);
const keyfinder={itemId:986,tier:4,plus:25};
const equipEarring=native.encode(native.withRarity(keyfinder.itemId,keyfinder.tier),keyfinder.plus);
function createPlayer(earring){
 const player=native.createPlayer(0,'local-native-sampling',entrance.x,entrance.y,clock);
 for(const skill of skills)player.skills[skill]=native.levelXp(level);
 player.homeBank=1;
 player.unlimitedBank=true;
 Object.assign(player.masteries,{craft:0,gather:0,move:0,rare:0});
 Object.assign(player.perks,{quick:0,hands:0,pockets:0});
 player.equipment.earring=earring?equipEarring:null;
 player.quests={day:native.questDay(clock),week:native.questWeek(clock),daily:[],weekly:[]};
 return player;
}

function characterAttributes(player,skill){
 // The synthetic preset has no active boosts, skill gear, or bonus luck.
 // Native speed, movement, capacity, and Keyfinder rules still supply the final values.
 return {
  skills:{[skill]:{
   level:native.level(player.skills[skill]),speedMultiplier:native.workSpeed(player,skill).combined,
   upgradeSpeedMultiplier:1,luck:0,rareFindBonus:0,failureMultiplier:1,
   keyDropMultiplier:1+native.earringBonus(player.equipment,'keyfinder'),
  }},
  movement:{strideSpeed:native.strideSpeed(player),capacity:native.capacity(player)},
 };
}

const paths=new Map();
function simulate({job,siteId,count,seed,earring}){
 const state=createPlayer(earring);
 const context={...native.context(native.world,seed),paths,hypothetical:true};
 assert.ok(native.startWork(state,context,siteId,job.id,'bank',count));
 assert.equal(state.route.siteId,siteId);
 let workTicks=0,produced=0,returning=false,lastDay=state.quests.day;
 const batches=[],packDropIds={},keyEvents={},events={};
 const keyIds=new Set(native.dungeonKeyTier(job.levelReq).finds.map(key=>key.itemId));
 const initialChance=native.workChance(job,state);
 for(let elapsed=1;elapsed<=100000;elapsed++){
  const next=state.lastTick+1;
  if(state.activity==='working')workTicks++;
  const beforeBank=state.activity==='banking'?[...state.pack]:null;
  if(returning&&beforeBank)state.route=null;
  if(native.questDay(next)!==lastDay){
   lastDay=native.questDay(next);
   state.quests={day:lastDay,week:native.questWeek(next),daily:[],weekly:[]};
  }
  const emitted=[];
  native.tick(state,context,next,emitted);
  for(const event of emitted){
   events[event.kind]=(events[event.kind]??0)+1;
   if(event.kind==='bonus'&&keyIds.has(event.itemId))keyEvents[event.itemId]=(keyEvents[event.itemId]??0)+1;
   if(event.kind==='produced'&&event.jobId===job.id)produced++;
   if(event.kind==='deposited'){
    assert.ok(beforeBank);
    batches.push({slots:beforeBank.length,completed:produced});
    for(const {itemId,qty} of beforeBank){
     if(native.baseItemId(itemId)!==job.output.itemId)packDropIds[itemId]=(packDropIds[itemId]??0)+qty;
    }
   }
  }
  if(returning&&state.activity==='idle'&&state.route===null){
   assert.equal(state.pack.length,0);
   assert.ok(Math.abs(state.x-bank.x)<=1&&Math.abs(state.y-bank.y)<=1);
   assert.equal(produced,count);
   assert.equal(native.level(state.skills[job.skill]),level);
   const directKeys=Object.fromEntries(Object.entries(keyEvents).map(([id,qty])=>[id,qty-(packDropIds[id]??0)]));
   assert.ok(Object.values(directKeys).every(qty=>qty>=0));
   return {
    seed,initialChance,workTicks,elapsed,overheadTicks:elapsed-workTicks,batches:batches.length,
    fullBatchSizes:batches.slice(0,-1).map((batch,index)=>batch.completed-(batches[index-1]?.completed??0)),packDropIds,directKeys,events,
   };
  }
  if(!returning&&state.route?.limit===0){
   // A finite native route stops at the worksite. Append one native bank leg
   // to match work-time's finish-at-warehouse contract.
   state.route.limit=null;
   state.route.phase='toBank';
   state.activity='idle';
   returning=true;
  }
  assert.ok(state.route||returning,`Native task stopped: ${JSON.stringify(state.lastStop)}`);
 }
 throw new Error(`Native task never returned: job=${job.id} seed=${seed} produced=${produced}`);
}

const testCases=[{jobId:3,earring:false},{jobId:8,earring:true},{jobId:30,earring:false},{jobId:32,earring:false},{jobId:27,earring:false}];
const mean=values=>values.reduce((total,value)=>total+value,0)/values.length;
function metric(predicted,measurements){
 const errors=measurements.map(measured=>predicted-measured);
 return {predicted,meanSignedError:mean(errors),mae:mean(errors.map(Math.abs))};
}
// The historical model used just the requested main item to size the pack.
const estimateLegacyBatchTime=createBatchTimeEstimator(gameFile,{resolveMovement:movement=>({
 strideSpeed:movement.strideSpeed,slots:movement.capacity,
})});
const modelJobs=new Map(gameFile.recipes.map(job=>[job.id,job]));
const summaries=[];
for(const {jobId,earring} of testCases)for(const count of counts){
 const job=native.jobs.find(recipe=>recipe.id===jobId);
 assert.ok(job&&!job.retired&&!job.inputs.length&&skills.includes(job.skill));
 const snapshot=createPlayer(earring),character=characterAttributes(snapshot,job.skill);
 const environment={tick:clock,worldRarityBonus:0};
 const task={jobId,count,tier:0};
 const expectation=engine.estimateWorkExpectation({character,environment,task});
 const old={...expectation,...estimateLegacyBatchTime({job:modelJobs.get(jobId),tier:task.tier,count:expectation.attempts,
  player:character.movement,actionSeconds:expectation.actionSeconds+expectation.waitSeconds})};
 const current=engine.estimateTaskTime({character,environment,task});
 assert.equal(old.status,'ok');
 assert.equal(current.status,'ok');
 assert.equal(old.workSeconds,current.workSeconds);
 assert.deepEqual(old.products,current.products);
 const trials=seeds.map(seed=>simulate({job,siteId:old.siteId,count,seed,earring}));
 const actualBatches=trials.map(trial=>trial.batches);
 const actualOverhead=trials.map(trial=>trial.overheadTicks*secondsPerTick);
 const actualTotal=trials.map(trial=>trial.elapsed*secondsPerTick);
 const fullBatches=trials.flatMap(trial=>trial.fullBatchSizes);
 const packDrops={};
 for(const trial of trials)for(const [id,qty] of Object.entries(trial.packDropIds))packDrops[id]=(packDrops[id]??0)+qty;
 const metrics={
  jobId,job:job.name,skill:job.skill,siteId:old.siteId,earring,count,seeds:seeds.length,actualBatches:mean(actualBatches),
  actualOverhead:mean(actualOverhead),actualTotal:mean(actualTotal),meanFullBatch:fullBatches.length?mean(fullBatches):null,packDrops,
  old:{batchCapacity:old.batchCapacity,batches:metric(old.batches,actualBatches),overhead:metric(old.overheadSeconds,actualOverhead),total:metric(old.seconds,actualTotal)},
  current:{batchCapacity:current.batchCapacity,batches:metric(current.batches,actualBatches),overhead:metric(current.overheadSeconds,actualOverhead),total:metric(current.seconds,actualTotal)},
 };
 summaries.push({jobId,job:job.name,earring,count,character,environment,old,current,metrics,trials});
}
assert.deepEqual(modelDigests(),modelSha256);
const sourceInfo={
 sha256,sourceVersion,sourceUrl,secondsPerTick,workTimeVersion,modelSha256,
 clock,level,bankId:bank.id,keyfinder,nativeDeclarations:declarationCount,counts,startSeed,seeds,
};
mkdirSync(path.dirname(outputPath),{recursive:true});
checkOutputPath();
writeFileSync(outputPath,JSON.stringify({sourceInfo,summaries},null,2)+'\n');
console.log(`Game ${sourceInfo.sourceVersion} · ${seedCount*summaries.length} native runs · ${outputPath}`);
for(const [key,label] of [['batches','Trips'],['overhead','Logistics (s)'],['total','Total (s)']]){
 const summary=model=>{
  const rows=summaries.map(row=>row.metrics[model][key]);
  return `${mean(rows.map(row=>row.mae)).toFixed(3)} MAE, ${mean(rows.map(row=>row.meanSignedError)).toFixed(3)} bias`;
 };
 console.log(`${label}  ${summary('old')} → ${summary('current')}`);
}
