import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {loadGameWorkOracle} from '../tests/helpers/game-work-oracle.mjs';
import {bronzePickaxeCalibration} from '../tests/fixtures/batch-calibration.js';
import {estimateBatchTime,batchTimeModel} from '../src/engine/batch-time.js';
import * as modelGame from '../src/engine/upstream.js';

const projectRoot=fileURLToPath(new URL('..',import.meta.url));
const outputDirectory=path.join(projectRoot,'.test-artifacts','time-model');
const chromeFixtureUrl=new URL('../tests/fixtures/chrome-time-references.js',import.meta.url);
const chromeReferences=fs.existsSync(chromeFixtureUrl)?(await import(chromeFixtureUrl.href)).chromeTimeReferences:null;
const inputPaths=['vendor/game-original.js','vendor/manifest.json','src/engine/upstream.js','src/engine/batch-time.js',
 'scripts/check-time-model.mjs','tests/helpers/game-work-oracle.mjs','tests/fixtures/batch-calibration.js','tests/fixtures/chrome-time-references.js'];
function inputFingerprints(){
 return {hashNormalization:'utf8-lf',files:inputPaths.map(name=>{
  const filename=path.join(projectRoot,name);if(!fs.existsSync(filename))return {path:name,missing:true};
  const text=fs.readFileSync(filename,'utf8').replace(/\r\n/g,'\n');
  return {path:name,bytes:Buffer.byteLength(text),sha256:crypto.createHash('sha256').update(text,'utf8').digest('hex')};
 })};
}
const epsilon=1e-7;
const seeds=Array.from({length:32},(_,index)=>index+1);
const probabilityJobs=[1,41,45,51,68,230,420];
const oracle=loadGameWorkOracle(),raw=oracle.game;
const configurations=[
 {id:'level100-unmounted',create:()=>oracle.createPlayer()},
 {id:'test-character',create:()=>oracle.createPlayer({patch:bronzePickaxeCalibration.player})},
 {id:'fast-large-pack',create:()=>oracle.createPlayer({patch:{equipment:{mount:328},perks:{pockets:5},
  masteries:{move:200},brews:{swift:1060000},brewTier:{swift:4}}})}
];
const classifiedError=(error,details)=>({...details,code:error.code??error.name,message:error.message});
function exclusionReason(job){
 if(['farming','thieving','alchemy'].includes(job.skill)||job.upgrade)return 'productExceptionOrFarming';
 if(job.levelReq>100)return 'aboveConfiguredLevel';
 if(!raw.world.sites.some(site=>site.jobIds.includes(job.id)))return 'noWorldSite';
 return null;
}
const supported=job=>exclusionReason(job)===null;
const modelJob=id=>modelGame.recipes.find(job=>job.id===id);

function statistics(values){
 if(!values.length)return {samples:0};
 const sorted=[...values].sort((a,b)=>a-b),mean=values.reduce((sum,value)=>sum+value,0)/values.length;
 const percentile=ratio=>sorted[Math.floor((sorted.length-1)*ratio)];
 const standardDeviation=Math.sqrt(values.reduce((sum,value)=>sum+(value-mean)**2,0)/values.length);
 const standardError=standardDeviation/Math.sqrt(values.length);
 return {samples:values.length,mean,standardDeviation,standardError,mean95Interval:[mean-1.96*standardError,mean+1.96*standardError],
  min:sorted[0],p05:percentile(.05),median:percentile(.5),p95:percentile(.95),max:sorted.at(-1)};
}

// Historical model v2, retained only as a reporting baseline. Its shortest depot
// distance and fixed phase formula never supply expected values to the oracle.
function legacyOverhead({jobId,siteId,tier,count,player}){
 const job=raw.job(jobId),site=raw.world.siteById.get(siteId),bank=raw.world.bankById.get(1);
 let distance=Infinity;
 for(let index=0;index<8;index++){
  const entrance=raw.atEntrance(raw.world,site.x,site.y,0,undefined,index);
  if(entrance)distance=Math.min(distance,raw.bankDistance(raw.world,bank,entrance.x,entrance.y));
 }
 const speed=Math.round(raw.mountStride(player)*(1+raw.swiftSpeedBonus*raw.brewStrength(player,'swift'))*raw.masteryMultiplier(player.masteries,'move'));
 const slots=raw.inventoryCapacity(player),inputs=raw.inputs(job,tier);
 const nonstacked=inputs.filter(i=>!raw.item(i.itemId).stackable).reduce((sum,i)=>sum+i.qty,0);
 const stacks=new Set(inputs.filter(i=>raw.item(i.itemId).stackable).map(i=>i.itemId)).size;
 const stackedOutput=raw.item(raw.output(job,tier)).stackable;
 const capacity=nonstacked?Math.floor((slots-stacks-(stackedOutput?1:0))/nonstacked):stackedOutput?Infinity:Math.floor((slots-stacks)/job.output.qty);
 const batches=Number.isFinite(capacity)?Math.ceil(count/capacity):1;
 const legTicks=Math.ceil(distance*1000/speed)+(distance>0?1:0);
 return ((job.inputs.length?5:2)+3+(batches-1)*6+2*batches*legTicks)*.6;
}

function checkedModel(options){
 const result=estimateBatchTime({...options,job:modelJob(options.jobId)});
 if(result.status!=='ok'||!Number.isFinite(result.seconds)||!Number.isFinite(result.overheadSeconds)){
  const error=new Error(`Model returned ${result.status}/${result.reason??''}`);error.code='modelUnavailable';throw error;
 }
 return result;
}

function isolatedMatrix(){
 const cases=[],errors=[];
 for(const job of raw.recipes.filter(supported))for(const configuration of configurations){
  const player=configuration.create();
  let siteId;
  try{siteId=oracle.selectSite(job.id,player);}catch(error){errors.push(classifiedError(error,{jobId:job.id,configuration:configuration.id,phase:'selectSite'}));continue;}
  const tiers=raw.supportsRarity(job.output.itemId)?[0,1,2,3,4]:[0];
  for(const tier of tiers){
   let capacity;
   try{capacity=oracle.batchCapacity({jobId:job.id,tier,player});}catch(error){errors.push(classifiedError(error,{jobId:job.id,tier,configuration:configuration.id,phase:'capacity'}));continue;}
   const boundary=Number.isFinite(capacity)&&capacity>0&&capacity<=1000?capacity:28;
   for(const count of new Set([1,Math.max(1,boundary-1),boundary,boundary+1,boundary*3+1])){
    const identity={jobId:job.id,name:job.name,siteId,tier,count,configuration:configuration.id};
    try{
     const expected=oracle.finite({jobId:job.id,siteId,tier,count,player,everyAttemptLands:true});
     const actual=checkedModel({jobId:job.id,siteId,tier,count,player,actionSeconds:.6});
     const previousOverhead=legacyOverhead({jobId:job.id,siteId,tier,count,player});
     cases.push({...identity,original:expected,model:{seconds:actual.seconds,overheadSeconds:actual.overheadSeconds,
      capacity:actual.batchCapacity,batches:actual.batches,distance:actual.distance,returnDistance:actual.returnDistance},
      overheadErrorSeconds:actual.overheadSeconds-expected.overheadSeconds,
      legacyOverheadErrorSeconds:previousOverhead-expected.overheadSeconds});
    }catch(error){errors.push(classifiedError(error,{...identity,phase:'finiteIsolation'}));}
   }
  }
 }
 return {cases,errors};
}

function probabilityMatrix(){
 const hourly=[],finite=[],errors=[];
 for(const jobId of probabilityJobs)for(const configuration of configurations){
  const player=configuration.create(),job=raw.job(jobId),siteId=oracle.selectSite(jobId,player);
  const pureSeconds=oracle.pureSeconds(jobId,player),modelPureSeconds=modelGame.tickMs/1000/modelGame.workChance(modelJob(jobId),player);
  const model=checkedModel({jobId,siteId,count:10000000,player,actionSeconds:modelPureSeconds});
  const outputSuccessProbability=job.burn?1-modelGame.burnChance(modelJob(jobId),player):1;
  const estimatedOutputPerHour=10000000/model.seconds*3600*job.output.qty*outputSuccessProbability;
  const samples=[];
  for(const seed of seeds)try{samples.push(oracle.hourly({jobId,siteId,player,seed}));}
  catch(error){errors.push(classifiedError(error,{jobId,siteId,seed,configuration:configuration.id,phase:'hourlyProbability'}));}
  const rate=statistics(samples.map(sample=>sample.outputPerHour));
  hourly.push({jobId,siteId,configuration:configuration.id,pureSeconds,modelPureSeconds,pureSecondsError:modelPureSeconds-pureSeconds,modelOutputPerHour:estimatedOutputPerHour,
   originalRate:rate,rateErrorPercent:rate.mean>0?100*(estimatedOutputPerHour/rate.mean-1):null,
   outputSuccessProbability,samples});
 }
 const player=configurations[1].create();
 for(const count of [1,14,15,28]){
  const samples=[];
  for(const seed of seeds)try{samples.push(oracle.finite({jobId:51,siteId:43,count,player,seed}));}
  catch(error){errors.push(classifiedError(error,{jobId:51,siteId:43,count,seed,phase:'finiteProbability'}));}
  const original=statistics(samples.map(sample=>sample.seconds));
  const model=checkedModel({jobId:51,siteId:43,count,player,actionSeconds:oracle.pureSeconds(51,player)});
  finite.push({jobId:51,siteId:43,count,modelSeconds:model.seconds,original,meanErrorSeconds:model.seconds-original.mean,samples});
 }
 return {hourly,finite,errors};
}

function nominalComparison(){
 const fixture=bronzePickaxeCalibration,player=configurations[1].create(),pureSeconds=oracle.pureSeconds(fixture.jobId,player);
 return {source:'Chrome test-server rounded linear prediction, not a stopwatch',fixtureDate:fixture.capturedDate,
  sourceVersion:fixture.sourceVersion,gameVersion:fixture.gameVersion,observedOutputPerHour:fixture.observedProductionPerHour,
  cases:Object.entries(fixture.observedTaskSeconds).map(([countText,nominalSeconds])=>{
   const count=Number(countText),model=checkedModel({jobId:fixture.jobId,siteId:fixture.siteId,count,player,actionSeconds:pureSeconds});
   return {jobId:fixture.jobId,siteId:fixture.siteId,count,nominalSeconds,finiteTaskSeconds:model.seconds,
    differenceSeconds:model.seconds-nominalSeconds,errorPercent:100*(model.seconds/nominalSeconds-1)};
  })};
}

function chromeComparison(){
 if(!chromeReferences)return {available:false,cohorts:[],errors:[]};
 const cohorts=[],errors=[];
 for(const cohort of chromeReferences.cohorts){
  const player=oracle.createPlayer({patch:cohort.player}),cases=[],skipped=[];
  for(const row of cohort.rows){
   const job=raw.recipes.find(job=>job.id===row.jobId);
   if(!job||!supported(job)){skipped.push({jobId:row.jobId,reason:job?'productExceptionOrFarming':'missingOldCatalog'});continue;}
   try{
    const outputBase=raw.baseItemId(job.output.itemId);
    const primaryQuantity=Object.entries(row.items).reduce((sum,[itemId,quantity])=>raw.baseItemId(Number(itemId))===outputBase?sum+quantity:sum,0);
    if(!(primaryQuantity>0)||!(row.ticks>0)||!(row.chance>0)){
     const error=new Error('Chrome reference requires positive primary output, ticks and chance');error.code='invalidChromeReference';throw error;
    }
    const modelChance=modelGame.workChance(modelJob(job.id),player),pureSeconds=modelGame.tickMs/1000/modelChance;
    const model=checkedModel({jobId:job.id,siteId:row.siteId,tier:row.tier??0,count:10000000,player,actionSeconds:pureSeconds});
    const successProbability=job.burn?1-modelGame.burnChance(modelJob(job.id),player):1;
    const modelSecondsPerOutput=model.seconds/(10000000*job.output.qty*successProbability);
    const chromeSecondsPerOutput=row.ticks*.6/primaryQuantity;
    cases.push({jobId:job.id,name:job.name,siteId:row.siteId,primaryQuantity,ticks:row.ticks,
     chromeChance:row.chance,modelChance,chanceDifference:modelChance-row.chance,
     chanceErrorPercent:100*(modelChance/row.chance-1),modelSecondsPerOutput,chromeSecondsPerOutput,
     unitTimeErrorPercent:100*(modelSecondsPerOutput/chromeSecondsPerOutput-1)});
   }catch(error){errors.push(classifiedError(error,{jobId:row.jobId,siteId:row.siteId,cohort:cohort.id,phase:'chromeNominal'}));}
  }
  cohorts.push({id:cohort.id,cases,skipped,signedUnitTimeErrorPercent:statistics(cases.map(row=>row.unitTimeErrorPercent)),
   absoluteUnitTimeErrorPercent:statistics(cases.map(row=>Math.abs(row.unitTimeErrorPercent))),
   chanceDifference:statistics(cases.map(row=>row.chanceDifference))});
 }
 return {available:true,capturedDate:chromeReferences.capturedDate,gameVersion:chromeReferences.gameVersion,
  sourceVersion:chromeReferences.sourceVersion,meaning:'Hourly linear game nominal per primary output, separate from finite completion time.',cohorts,errors};
}

function main(){
 const started=Date.now();
 const sourceInputs=inputFingerprints();
 const isolation=isolatedMatrix(),probability=probabilityMatrix(),nominal=nominalComparison(),chrome=chromeComparison();
 if(JSON.stringify(sourceInputs)!==JSON.stringify(inputFingerprints()))throw Error('Model source files changed during report generation');
 const errors=[...isolation.errors,...probability.errors,...chrome.errors];
 const mismatches=isolation.cases.filter(row=>Math.abs(row.overheadErrorSeconds)>epsilon);
 const summary={schemaVersion:1,generatedAt:new Date().toISOString(),elapsedSeconds:(Date.now()-started)/1000,
  source:oracle.metadata,model:batchTimeModel,sourceInputs,
  coverage:{ordinaryRecipes:new Set(isolation.cases.map(row=>row.jobId)).size,configurations:configurations.map(c=>c.id),
   tiers:[0,1,2,3,4],isolatedCases:isolation.cases.length,hourlyGroups:probability.hourly.length,seeds:seeds.length,
   excludedRecipes:raw.recipes.filter(job=>!supported(job)).map(job=>({jobId:job.id,skill:job.skill,reason:exclusionReason(job)}))},
  isolatedLogistics:{mismatches:mismatches.length,absoluteErrorSeconds:statistics(isolation.cases.map(c=>Math.abs(c.overheadErrorSeconds))),
   legacyV2AbsoluteErrorSeconds:statistics(isolation.cases.map(c=>Math.abs(c.legacyOverheadErrorSeconds))),
   eventCounts:isolation.cases.reduce((totals,row)=>{for(const [key,value]of Object.entries(row.original.events))totals[key]=(totals[key]??0)+value;return totals;},{})},
  hourlyProbability:probability.hourly.map(({samples,...row})=>row),
  finiteProbability:probability.finite.map(({samples,...row})=>row),gameNominal:nominal,
  chromeNominal:{...chrome,cohorts:chrome.cohorts.map(({cases,...cohort})=>({...cohort,caseCount:cases.length}))},
  errors,errorCount:errors.length,
  limitations:['everyAttemptLands isolates logistics; it is not normal work probability.',
   'Finite counts are fixed integer work attempts; burn and free-material events can change actual outputs or capacity.',
   'The game ordinarily ends finite work at the station; the oracle explicitly appends final return and deposit.',
   'Hourly prediction retains original randomness, levels, bonus drops and potion expiry; UI ETA caches are bypassed.',
   'Discard, thieving and upgrades retain the product pure-work exception and are excluded from logistics equality.',
   'No browser, real account, mobile device or production validation is performed by this command.']};
 fs.mkdirSync(outputDirectory,{recursive:true});
 fs.writeFileSync(path.join(outputDirectory,'details.json'),JSON.stringify({isolation,probability,nominal,chrome},null,2)+'\n');
 fs.writeFileSync(path.join(outputDirectory,'summary.json'),JSON.stringify(summary,null,2)+'\n');
 console.log(JSON.stringify({summary:path.join(outputDirectory,'summary.json'),details:path.join(outputDirectory,'details.json'),
  elapsedSeconds:summary.elapsedSeconds,isolatedCases:isolation.cases.length,mismatches:mismatches.length,
  errors:errors.length,absoluteLogisticsError:summary.isolatedLogistics.absoluteErrorSeconds,
  previousAbsoluteLogisticsError:summary.isolatedLogistics.legacyV2AbsoluteErrorSeconds},null,2));
 if(errors.length||mismatches.length)process.exitCode=1;
}

try{main();}catch(error){console.error(JSON.stringify(classifiedError(error,{phase:'fatal'}),null,2));process.exitCode=1;}
