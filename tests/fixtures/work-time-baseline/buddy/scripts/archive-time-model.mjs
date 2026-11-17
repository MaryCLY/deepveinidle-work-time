import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadGameWorkOracle} from '../tests/helpers/game-work-oracle.mjs';
import {bronzePickaxeCalibration} from '../tests/fixtures/batch-calibration.js';
import {batchTimeModel} from '../src/engine/batch-time.js';

const root=fileURLToPath(new URL('..',import.meta.url));
const reportDirectory=path.join(root,'.test-artifacts','time-model');
const archiveDirectory=path.join(root,'docs','model-testing','2026-11-17-alpha');
const baseCommit='a176d4e2b8adef66f711e1596cd8f787570e4d6b';
const sourcePaths=['vendor/game-original.js','vendor/manifest.json','src/engine/upstream.js',
 'src/engine/batch-time.js','scripts/check-time-model.mjs','scripts/archive-time-model.mjs',
 'tests/helpers/game-work-oracle.mjs','tests/fixtures/batch-calibration.js','tests/fixtures/chrome-time-references.js'];
const normalize=text=>text.replace(/\r\n/g,'\n');
const digest=text=>crypto.createHash('sha256').update(normalize(text),'utf8').digest('hex');
const requireCondition=(condition,message)=>{if(!condition)throw Error(message);};
const csv=rows=>rows.map(row=>row.map(value=>value??'').join(',')).join('\n')+'\n';
const json=value=>JSON.stringify(value,null,2)+'\n';

export function archiveTimeModel(){
 const summary=JSON.parse(fs.readFileSync(path.join(reportDirectory,'summary.json'),'utf8'));
 const details=JSON.parse(fs.readFileSync(path.join(reportDirectory,'details.json'),'utf8'));
 const generatedInputs=summary.sourceInputs;
 requireCondition(generatedInputs?.hashNormalization==='utf8-lf'&&generatedInputs.files?.length===8,
  'Formal report has no complete source fingerprints; rerun node scripts/check-time-model.mjs');
 const recordedInputs=new Map(generatedInputs.files.map(file=>[file.path,file]));
 requireCondition(recordedInputs.size===8,'Formal report has duplicate source fingerprints');
 for(const name of sourcePaths.filter(name=>name!=='scripts/archive-time-model.mjs')){
  const recorded=recordedInputs.get(name),content=normalize(fs.readFileSync(path.join(root,name),'utf8'));
  requireCondition(recorded?.sha256===digest(content)&&recorded.bytes===Buffer.byteLength(content),
   `Report input fingerprint mismatch: ${name}; rerun node scripts/check-time-model.mjs`);
 }
 requireCondition(summary.model.version===3&&JSON.stringify(summary.model)===JSON.stringify(batchTimeModel),'Report model differs from the current model');
 requireCondition(summary.errorCount===0&&summary.isolatedLogistics.mismatches===0,'Only a successful formal report can be archived');
 requireCondition(details.isolation.cases.length===14950,'Unexpected logistics case count');
 const configurations=summary.coverage.configurations;
 const configurationIndex=id=>{
  const index=configurations.indexOf(id);requireCondition(index>=0,`Unknown configuration: ${id}`);return index;
 };
 const logistics=[['jobId','siteId','tier','count','configurationIndex','capacity','batches','distance','returnDistance',
  'oracleTotalTicks','oracleWorkTicks','oracleWalkTicks','oracleOverheadSeconds','modelOverheadSeconds','v2OverheadErrorSeconds'],
 ...details.isolation.cases.map(row=>[row.jobId,row.siteId,row.tier,row.count,configurationIndex(row.configuration),
  row.model.capacity,row.model.batches,row.model.distance,row.model.returnDistance,row.original.totalTicks,
  row.original.workTicks,row.original.walkTicks,row.original.overheadSeconds,row.model.overheadSeconds,row.legacyOverheadErrorSeconds])];
 const hourly=[['jobId','siteId','tier','configurationIndex','seed','quantity','ticks','endedAfter','outputPerHour'],
  ...details.probability.hourly.flatMap(group=>group.samples.map(sample=>[group.jobId,group.siteId,sample.tier,
   configurationIndex(group.configuration),sample.seed,sample.quantity,sample.ticks,sample.endedAfter,sample.outputPerHour]))];
 const finite=[['jobId','siteId','tier','count','seed','totalTicks','workTicks','overheadTicks','walkTicks','produced','quantity','burnt','bonus','free','levelUp'],
  ...details.probability.finite.flatMap(group=>group.samples.map(sample=>[sample.jobId,sample.siteId,sample.tier,group.count,
   sample.seed,sample.totalTicks,sample.workTicks,sample.overheadTicks,sample.walkTicks,sample.events.produced,
   sample.events.quantity,sample.events.burnt,sample.events.bonus,sample.events.free,sample.events.levelUp]))];
 requireCondition(hourly.length-1===672&&finite.length-1===128,'Unexpected probability sample counts');
 const representativePaths=details.isolation.cases.filter(row=>row.configuration==='test-character'&&row.tier===0
  &&[1,3,41,51,230,248,420].includes(row.jobId)
  &&(row.count===1||row.count===row.model.capacity||row.count===row.model.capacity+1));
 requireCondition(representativePaths.length===18,'Unexpected representative path count');
 const oracle=loadGameWorkOracle();
 requireCondition(summary.source.sha256===oracle.metadata.sha256,'Oracle source differs from the formal report');
 const phaseTraces=[1,14,15,28].map(count=>oracle.finite({jobId:51,siteId:43,count,
  player:oracle.createPlayer({patch:bronzePickaxeCalibration.player}),seed:1,everyAttemptLands:true,trace:true}));
 const {generatedAt,elapsedSeconds,...stableSummary}=summary;
 const data={
  'summary.json':{content:json({capturedAt:generatedAt,...stableSummary}),description:'Formal report summary; runtime duration omitted.'},
  'logistics.csv':{content:csv(logistics),rows:14950,description:'All formal isolated logistics cases, including the historical v2 error.'},
  'hourly-probability.csv':{content:csv(hourly),rows:672,description:'Normal-probability primary output for 21 groups and seeds 1 through 32.'},
  'finite-probability.csv':{content:csv(finite),rows:128,description:'Normal-probability finite bronze pickaxe samples; final banking appended.'},
  'representative-paths.json':{content:json(representativePaths),rows:18,description:'Selected formal cases with original path legs, endpoints, event counts and both model results.'},
  'phase-traces.json':{content:json(phaseTraces),rows:4,description:'Deterministic tick traces regenerated from the reviewed original source, seed 1, everyAttemptLands true.'},
 };
 fs.mkdirSync(archiveDirectory,{recursive:true});
 const files=Object.entries(data).map(([name,{content,rows,description}])=>{
  fs.writeFileSync(path.join(archiveDirectory,name),content);
  return {path:name,bytes:Buffer.byteLength(normalize(content)),sha256:digest(content),...(rows===undefined?{}:{rows}),description};
 });
 const manifest={
  schemaVersion:1,stage:'0.6.0-alpha',recordDate:'2026-11-17',sourceBaseCommit:baseCommit,
  sourceState:'Working tree before the alpha commit; source file hashes identify the inputs, not a fabricated final commit.',
  capturedAt:generatedAt,source:summary.source,model:summary.model,
  hashNormalization:'utf8-lf',hashEncoding:'UTF-8 with CRLF normalized to LF; bytes are normalized byte lengths.',
  inputs:[...generatedInputs.files,(()=>{
   const name='scripts/archive-time-model.mjs',content=fs.readFileSync(path.join(root,name),'utf8');
   return {path:name,bytes:Buffer.byteLength(normalize(content)),sha256:digest(content)};
  })()],
  configurations:[
   {index:0,id:'level100-unmounted',level:100,playerFactory:'oracle.createPlayer()',patch:{}},
   {index:1,id:'test-character',level:100,playerFactory:'oracle.createPlayer({patch:bronzePickaxeCalibration.player})',fixture:'tests/fixtures/batch-calibration.js#player'},
   {index:2,id:'fast-large-pack',level:100,playerFactory:'oracle.createPlayer({patch})',patch:{equipment:{mount:328},perks:{pockets:5},
    masteries:{move:200},brews:{swift:1060000},brewTier:{swift:4}}},
  ],
  design:{bankId:1,actorId:0,initialTick:1000000,tickMs:600,origin:{x:200,y:83},pack:'empty',finalBanking:'explicitly appended',
   tierPolicy:'0 through 4 when original output supports rarity, otherwise 0',
   finiteBoundaryCounts:'unique [1,max(1,capacity-1),capacity,capacity+1,capacity*3+1]; capacity fallback 28 for unbounded capacity',
   isolatedSeed:1,seeds:Array.from({length:32},(_,index)=>index+1),hourlyJobs:[1,41,45,51,68,230,420],finiteJobId:51,finiteCounts:[1,14,15,28],
   phaseTraceCounts:[1,14,15,28],logisticsToleranceSeconds:1e-7,capacityBlank:'unbounded, represented as null by the production model'},
  roles:{chrome:'Observed nominal references and mechanism checks; not blind holdout data.',
   logistics:'Independent original-state-machine implementation under forced successful attempts; not random total-time accuracy.',
   probability:'Synthetic original-source multi-seed cross-check; not real-account stopwatch data.',
   reservedFiniteReferences:'Counts 1 and 28 were initially reserved and not used to fit fixed phase constants; this archive is retrospective.'},
  files,excludedFromArchive:['34 MB detailed report','generated oracle bundle','account identifiers, credentials and chat','temporary logs and scratch scans'],
 };
 fs.writeFileSync(path.join(archiveDirectory,'manifest.json'),json(manifest));
 const totalBytes=files.reduce((sum,file)=>sum+file.bytes,0)+Buffer.byteLength(json(manifest));
 requireCondition(totalBytes<1500000,'Archive exceeds the intended size budget');
 return {directory:path.relative(root,archiveDirectory),files:files.length+1,bytes:totalBytes,logisticsCases:14950,hourlySamples:672,finiteSamples:128};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{console.log(JSON.stringify(archiveTimeModel()));}catch(error){console.error(error.message);process.exitCode=1;}
}
