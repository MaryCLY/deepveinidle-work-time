import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {compileGameFile} from '../src/game-file.js';
import {createWorkTimeEngine} from '../src/index.js';
import {digest,extractNative,loadReplaySnapshot,replaySource1227,sequenceArgs,workModelSymbols1227} from './native-replay.mjs';

const defaultCounts='1,9,10,14,15,28,29,120';
const defaultOutput='.test-artifacts/crafting-native/trials.json';
const usage='node scripts/sample-crafting-work-time.mjs <snapshot.js> [seed-count] [counts] [start-seed] [output.json]';
const args=process.argv.slice(2);
if(args.length===1&&args[0]==='--help'){
 console.log(`${usage}\nDefaults: 32 seeds, counts ${defaultCounts}, starting seed 1.\nOutput: ${defaultOutput}.`);
 process.exit(0);
}
const [snapshot,rawSeedCount='32',rawCounts=defaultCounts,rawStartSeed='1',output=defaultOutput]=args;
if(args.length>5||!snapshot?.trim()||!output.trim())throw Error(usage);
const {source,sourceVersion,sourceUrl,sha256,checkOutputPath}=loadReplaySnapshot(snapshot,output,[replaySource1227]);
const {seedCount,counts,startSeed,seeds}=sequenceArgs(rawSeedCount,rawCounts,rawStartSeed);

const compiled=compileGameFile(source,{symbols:workModelSymbols1227,sourceVersion,sourceUrl});
assert.deepEqual(compiled.diagnostics,[]);
const {gameFile}=await import('data:text/javascript;base64,'+Buffer.from(compiled.code).toString('base64'));
const engine=createWorkTimeEngine(gameFile);
const {native,declarationCount}=extractNative(source,{
 createPlayer:'Foo',startWork:'mh',tick:'HMo',context:'clo',siteEntrance:'Ts',
 world:'X',jobs:'xe',levelXp:'os',level:'Ge',item:'ie',recipeInputs:'tn',
 questDay:'ub',questWeek:'$oo',workChance:'X3o',workSpeed:'JL',strideSpeed:'dD',capacity:'Es',
});
const {version:workTimeVersion}=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const modelSha256=Object.fromEntries(['effective-engine.js','batch-time.js','game-file.js'].map(name=>
 [name,digest(readFileSync(new URL('../src/'+name,import.meta.url)))]));
const secondsPerTick=gameFile.tickMs/1000;
const bankId=1,clock=1000000,level=100,maxTicks=100000;
const bank=native.world.bankById.get(bankId);
const entrance=native.siteEntrance(native.world,bank.x,bank.y,0);
const paths=new Map();

function createPlayer(skill,inputs,count){
 const player=native.createPlayer(0,'native-crafting-replay',entrance.x,entrance.y,clock);
 player.skills[skill]=native.levelXp(level);
 player.homeBank=bankId;
 player.unlimitedBank=true;
 Object.assign(player.masteries,{craft:0,move:0,rare:0});
 Object.assign(player.perks,{quick:0,hands:0,pockets:0});
 player.quests={day:native.questDay(clock),week:native.questWeek(clock),daily:[],weekly:[]};
 for(const {itemId,qty} of inputs)player.bank[itemId]=(player.bank[itemId]??0)+qty*count;
 return player;
}

function replay({job,tier,count,inputs,siteId,seed}){
 const state=createPlayer(job.skill,inputs,count);
 const initialActionIndex=state.actionIndex;
 const context={...native.context(native.world,seed),paths,hypothetical:true};
 const label=`recipe ${job.id}, tier ${tier}, count ${count}, seed ${seed}`;
 const initialChance=native.workChance(job,state);
 assert.ok(native.startWork(state,context,siteId,job.id,'bank',count,tier),label);
 assert.equal(state.route.siteId,siteId,label);
 const deposits=[],events={},products={};
 let workTicks=0,walkTicks=0,produced=0,returning=false,lastDay=state.quests.day;
 for(let elapsed=1;elapsed<=maxTicks;elapsed++){
  const next=state.lastTick+1;
  if(state.activity==='working')workTicks++;
  if(state.activity==='walking')walkTicks++;
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
   if(event.kind==='produced'&&event.jobId===job.id){
    produced++;
    products[event.itemId]=(products[event.itemId]??0)+(event.qty??1);
   }else if(event.kind==='burnt'){
    products[event.itemId]=(products[event.itemId]??0)+1;
   }else if(event.kind==='deposited'){
    assert.ok(beforeBank,label);
    deposits.push({tick:elapsed,attempts:state.actionIndex-initialActionIndex,slots:beforeBank.length});
   }
  }
  if(returning&&state.activity==='idle'&&state.route===null){
   assert.equal(state.pack.length,0,label);
   assert.ok(Math.abs(state.x-bank.x)<=1&&Math.abs(state.y-bank.y)<=1,label);
   assert.equal(state.actionIndex-initialActionIndex,count,label);
   assert.equal(produced+(events.burnt??0)+(events.caught??0),count,label);
   assert.equal(native.level(state.skills[job.skill]),level,label);
   return {seed,initialChance,elapsed,workTicks,walkTicks,overheadTicks:elapsed-workTicks,
    batches:deposits.length,deposits,events,products};
  }
  if(!returning&&state.route?.limit===0){
   // The finite native route finishes at the site. Append the model's final
   // warehouse leg using the same native movement and banking steps.
   state.route.limit=null;
   state.route.phase='toBank';
   state.activity='idle';
   returning=true;
  }
  assert.ok(state.route||returning,`Native route stopped early (${label}): ${JSON.stringify(state.lastStop)}`);
 }
 throw Error(`Native manufacturing did not return within ${maxTicks} ticks (${label}).`);
}

const cases=[
 {jobId:41,tier:0}, // Bronze bar: two nonstackable inputs.
 {jobId:603,tier:2}, // Cobalt flask: stacked and nonstackable inputs.
 {jobId:226,tier:0}, // Nourishing draught: stacked inputs and output.
 {jobId:307,tier:4}, // Wyrm ring: stacked inputs and nonstackable output.
 {jobId:700,tier:0}, // Steel whetstone: nonstackable inputs and ten stackable outputs.
 {jobId:703,tier:0}, // Maple arrows: mixed inputs and ten stackable outputs.
 {jobId:68,tier:0}, // Cook shark: active burn chance at the reference level.
];
const mean=values=>values.reduce((sum,value)=>sum+value,0)/values.length;
function measure(predicted,trials,read){
 const values=trials.map(read),errors=values.map(value=>predicted-value);
 return {predicted,meanObserved:mean(values),meanSignedError:mean(errors),mae:mean(errors.map(Math.abs))};
}
const summaries=[];
for(const {jobId,tier} of cases)for(const count of counts){
 const job=native.jobs.find(recipe=>recipe.id===jobId);
 const inputs=native.recipeInputs(job,tier);
 assert.ok(job&&!job.retired&&inputs.length>0);
 const player=createPlayer(job.skill,inputs,count);
 const character={skills:{[job.skill]:{level:native.level(player.skills[job.skill]),
  speedMultiplier:native.workSpeed(player,job.skill).combined,failureMultiplier:1,luck:0,rareFindBonus:0}},
  movement:{strideSpeed:native.strideSpeed(player),capacity:native.capacity(player)}};
 const task={jobId,tier,count},environment={tick:clock,worldRarityBonus:0};
 const estimate=engine.estimateTaskTime({character,task,environment});
 assert.equal(estimate.status,'ok');
 const trials=seeds.map(seed=>replay({job,tier,count,inputs,siteId:estimate.siteId,seed}));
 const metrics={
  batches:measure(estimate.batches,trials,row=>row.batches),
  work:measure(estimate.workSeconds,trials,row=>row.workTicks*secondsPerTick),
  overhead:measure(estimate.overheadSeconds,trials,row=>row.overheadTicks*secondsPerTick),
  total:measure(estimate.seconds,trials,row=>row.elapsed*secondsPerTick),
 };
 const ingredients=inputs.map(({itemId,qty})=>({itemId,qty,stackable:native.item(itemId).stackable}));
 summaries.push({task,name:job.name,skill:job.skill,ingredients,character,environment,estimate,metrics,trials});
}
const sourceInfo={sourceVersion,sourceUrl,sha256,workTimeVersion,modelSha256,nativeDeclarations:declarationCount,
 secondsPerTick,bankId,clock,level,maxTicks,counts,startSeed,seeds};
const outputPath=path.resolve(output);
mkdirSync(path.dirname(outputPath),{recursive:true});
checkOutputPath();
writeFileSync(outputPath,JSON.stringify({sourceInfo,summaries},null,2)+'\n');
console.log(`Game ${sourceVersion} · ${seedCount*summaries.length} native manufacturing runs · ${outputPath}`);
for(const [key,label] of [['batches','Trips'],['work','Work (s)'],['overhead','Logistics (s)'],['total','Total (s)']]){
 const rows=summaries.map(row=>row.metrics[key]);
 console.log(`${label}  ${mean(rows.map(row=>row.mae)).toFixed(3)} MAE, ${mean(rows.map(row=>row.meanSignedError)).toFixed(3)} bias`);
}
