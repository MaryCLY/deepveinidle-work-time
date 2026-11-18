import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createRuleEngine as createWorkTimeEngine,batchTimeModel,gatheringSkills,toolSlots} from '../src/rule-engine.js';

const source={sourceVersion:'1.0.1214',sourceSha256:'cb67b9c88201f9768b3ec90ffdbeb0ccf7d33b897649c019f13b95c6f0785dc5'};
const root=fileURLToPath(new URL('../',import.meta.url));
const packageDirectory=root;
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-7,`${actual} ≈ ${expected}`);

// A complete controlled game adapter: an open straight route, explicit item
// stacking and deterministic action rules. It can also run outside this repo.
function createAdapter(distance=3){
 const bank={id:1,x:0,y:0},site={id:10,x:distance+2,y:0,jobIds:[1,41,230,248]};
 const world={sites:[site],bankById:new Map([[1,bank]]),siteById:new Map([[10,site]])};
 return {
  world,tickMs:600,masteryRankLimit:200,swiftSpeedBonus:.1,
  rarityThresholds:{uncommon:.1,rare:.03,epic:.01,legendary:.001},
  siteEntrance:(_world,x,y,_actor,from)=>({x:from&&from.x>x?x+1:x-1,y}),
  walkPath:(_world,x1,y1,x2,y2)=>Array.from({length:Math.abs(x2-x1)+Math.abs(y2-y1)},()=>0),
  tool:()=>({slot:'mount'}),mountStride:player=>player.stride??1000,
  brewStrength:()=>0,masteryMultiplier:()=>1,inventoryCapacity:player=>player.slots??28,
  recipeInputs:(job,tier)=>job.inputs.map(input=>({...input,itemId:input.itemId+tier*1000})),
  recipeOutput:(job,tier)=>job.output.itemId+tier*1000,
  item:id=>({id,stackable:id%1000===2}),
  workChance:job=>job.chance??.5,upgradeTicks:(_player,upgrade)=>upgrade.ticks,
  burnChance:job=>job.burnChance??0,caughtChance:job=>job.caughtChance??0,
  itemSupportsRarity:()=>true,level:xp=>xp,
  toolLuck:()=>0,equipmentLuck:()=>0,combine:(...values)=>values.reduce((a,b)=>a*b,1),
  brewRarityMultiplier:()=>1,hotRarityMultiplier:()=>1,houseRarityMultiplier:()=>1,
 };
}
// The warehouse origin is (1,0); each directed walk has distance 3 by default.
function adapter(distance=3){
 const game=createAdapter(distance),entrance=game.siteEntrance;
 game.siteEntrance=(world,x,y,actor,from)=>from?entrance(world,x,y,actor,from):{x:x+1,y};
 return game;
}
const player=()=>({lastTick:100,skills:{smithing:1,mining:1,thieving:1},equipment:{mount:null,pickaxe:null,gloves:null},masteries:{move:0},perks:{pockets:0},brews:{},brewTier:{}});
const craft=()=>({id:41,skill:'smithing',levelReq:1,inputs:[{itemId:1,qty:2}],output:{itemId:3,qty:1}});
const gather=()=>({id:1,skill:'mining',levelReq:1,inputs:[],output:{itemId:1,qty:1}});
const engine=()=>createWorkTimeEngine(adapter(),source);

test('construction accepts omitted or unrelated source metadata and validates only the container',()=>{
 for(const metadata of [undefined,{}, {...source,sourceVersion:'new'}, {...source,sourceSha256:'0'.repeat(64)}]){
  const work=createWorkTimeEngine(adapter(),metadata);
  assert.equal(work.workActionSeconds(craft(),player()),1.2);
 }
 assert.equal(typeof createWorkTimeEngine().estimateBatchTime,'function');
 assert.equal(typeof createWorkTimeEngine({}).workQualities,'function');
 for(const invalid of [null,[],3,'game'])assert.throws(()=>createWorkTimeEngine(invalid),/invalidGameAdapter.*createWorkTimeEngine.*game/);
 assert.ok(Object.isFrozen(batchTimeModel));assert.ok(Object.isFrozen(gatheringSkills));assert.ok(Object.isFrozen(toolSlots));
 assert.ok(gatheringSkills.includes('thieving'));assert.equal(toolSlots.mining,'pickaxe');
});
test('retained manufacturing counts warehouse walks and crosses its capacity only after attempt 14',()=>{
 const work=engine(),one=work.estimateBatchTime({job:craft(),count:14,player:player(),actionSeconds:2});
 assert.equal(one.status,'ok');assert.equal(one.batchCapacity,14);assert.equal(one.batches,1);
 assert.equal(one.distance,3);assert.equal(one.totalWalkTicks,6);near(one.overheadSeconds,9);near(one.seconds,37);
 const two=work.estimateBatchTime({job:craft(),count:15,player:player(),actionSeconds:2});
 assert.equal(two.batches,2);near(two.overheadSeconds,17.4);near(two.seconds,47.4);
 assert.equal(one.sourceVersion,'1.0.1214');assert.equal(one.originAssumption,'main-city-bank');
});

test('stacked inputs reserve output room and fully stacked goods need one batch',()=>{
 const work=engine(),job={...craft(),id:248,inputs:[{itemId:2,qty:1}]};
 for(const tier of [0,1,2,3,4]){
  const result=work.estimateBatchTime({job,tier,count:28,player:player(),actionSeconds:2});
  assert.equal(result.batchCapacity,27);assert.equal(result.batches,2);
 }
 const stacked={...job,id:230,output:{itemId:2,qty:1}};
 const result=work.estimateBatchTime({job:stacked,count:1e9,player:player(),actionSeconds:2});
 assert.equal(result.batches,1);assert.equal(result.batchCapacity,null);near(result.seconds,2000000009);
});

test('fractional gathering rounds batch boundaries but preserves expected work and scales to huge counts',()=>{
 const work=engine(),job=gather();
 const result=work.estimateBatchTime({job,count:28.1,player:player(),actionSeconds:2});
 assert.equal(result.batches,2);near(result.workSeconds,56.2);near(result.overheadSeconds,15.6);
 const huge=work.estimateBatchTime({job,count:28000000000000,player:player(),actionSeconds:0});
 assert.equal(huge.batches,1000000000000);assert.equal(huge.totalWalkTicks,6000000000000);
 near(huge.overheadSeconds,8399999999998.8);
});

test('walking rounds directed legs separately and every engine owns its path cache',()=>{
 const first=createWorkTimeEngine(adapter(3),source),second=createWorkTimeEngine(adapter(6),source);
 const options={job:craft(),count:1,player:player(),actionSeconds:2};
 near(first.estimateBatchTime(options).overheadSeconds,9);
 near(second.estimateBatchTime(options).overheadSeconds,12.6);
 near(first.estimateBatchTime(options).overheadSeconds,9);
 const fast=first.estimateBatchTime({...options,player:{...player(),stride:2500}});
 assert.equal(fast.walkTicks,2);assert.equal(fast.returnWalkTicks,2);near(fast.overheadSeconds,7.8);
});

test('missing logistics and unreachable capacity preserve explicit unknown or unreachable results',()=>{
 const work=engine(),options={job:craft(),count:10,player:player(),actionSeconds:2};
 const missing=work.estimateBatchTime({...options,player:{}});
 assert.equal(missing.status,'unknownTime');assert.equal(missing.reason,'movementConfiguration');
 assert.equal(missing.seconds,null);assert.equal(missing.workSeconds,20);
 const noSite=work.estimateBatchTime({...options,siteId:999});
 assert.equal(noSite.status,'unknownTime');assert.equal(noSite.reason,'workLocation');
 const noPath=createWorkTimeEngine({...adapter(),walkPath:()=>null},source).estimateBatchTime(options);
 assert.equal(noPath.status,'unknownTime');assert.equal(noPath.workSeconds,20);
 assert.equal(work.estimateBatchTime({...options,player:{...player(),slots:0}}).status,'unreachable');
 for(const count of [0,-1,Infinity,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>work.estimateBatchTime({...options,count}),/invalidQuantity/);
 assert.throws(()=>work.estimateBatchTime({...options,count:Number.MAX_SAFE_INTEGER,actionSeconds:2}),/quantityOverflow/);
 assert.equal(work.estimateBatchTime({...options,actionSeconds:NaN}).reason,'actionTime');
});

test('only gathering discard, theft and upgrades omit logistics',()=>{
 const work=engine(),options={count:10,player:{},actionSeconds:2,discard:true};
 assert.equal(work.estimateBatchTime({...options,job:gather()}).seconds,20);
 assert.equal(work.estimateBatchTime({...options,job:craft()}).status,'unknownTime');
 assert.equal(work.estimateBatchTime({...options,job:{...gather(),skill:'thieving'}}).seconds,20);
 const upgrade={...craft(),upgrade:{ticks:5}};
 assert.equal(work.estimateBatchTime({...options,job:upgrade}).overheadSeconds,0);
 assert.equal(work.workActionSeconds(upgrade,player()),3);
 assert.equal(work.workActionSeconds({...craft(),chance:0},player()),null);
});

test('quality probabilities use captured tick and rarity while plain jobs stay ordinary',()=>{
 const work=createWorkTimeEngine({...adapter(),hotRarityMultiplier:(tick,skill)=>tick===100&&skill==='mining'?2:1},source);
 const job=gather(),qualities=work.workQualities(player(),job,100,0);
 for(const [index,expected]of [.8,.14,.04,.018,.002].entries())near(qualities[index],expected);
 near(work.workQualities(player(),job,101,0)[0],.9);
 near(work.workQualities(player(),job,101,100)[0],.8);
 assert.deepEqual(work.workQualities(player(),{...job,plain:true},100,100),[1,0,0,0,0]);
 const result=work.estimateWorkExpectation({job:{...job,plain:true},tier:4,quantity:1,player:player(),tick:100});
 assert.equal(result.status,'unreachable');assert.equal(result.quality,0);
});

test('target expectation keeps burned and caught attempts and waiting separate from action seconds',()=>{
 const work=engine(),job={...gather(),output:{itemId:1,qty:2},chance:.25,burnChance:.1,caughtChance:.2,caught:{stunTicks:8}};
 const options={job,quantity:5,player:player(),tick:100,discard:true};
 const result=work.estimateWorkExpectation(options);
 assert.equal(result.status,'ok');assert.equal(result.quantity,6);near(result.attempts,4.62962962962963);
 near(result.actionSeconds,2.4);near(result.waitSeconds,.84);near(result.quality,.9);
 const total=work.estimateTaskTime(options);near(total.seconds,15);near(total.workSeconds,15);assert.equal(total.overheadSeconds,0);
 assert.equal(total.actionSeconds,result.actionSeconds);assert.equal(total.waitSeconds,result.waitSeconds);
 const theft=work.estimateTaskTime({...options,job:{...job,skill:'thieving'},discard:false});near(theft.seconds,15);
});

test('task entry composes ordinary work, upgrade rounding and minimum skill level without Buddy state',()=>{
 const work=engine(),options={job:craft(),quantity:4,player:player(),tick:100};
 const task=work.estimateTaskTime(options);assert.equal(task.attempts,4);near(task.seconds,13.8);near(task.actionSeconds,1.2);
 const low=work.estimateTaskTime({...options,job:{...craft(),levelReq:2}});
 assert.equal(low.status,'levelTooLow');assert.equal(low.seconds,null);
 const upgrade=work.estimateTaskTime({...options,job:{...craft(),upgrade:{ticks:5},output:{itemId:3,qty:2}},quantity:5});
 assert.equal(upgrade.attempts,3);assert.equal(upgrade.quantity,6);assert.equal(upgrade.seconds,9);
 assert.equal(upgrade.waitSeconds,0);assert.equal(upgrade.burn,0);assert.equal(upgrade.caught,0);
 for(const quantity of [0,-1,Infinity])assert.throws(()=>work.estimateWorkExpectation({...options,quantity}),/invalidQuantity/);
});

test('npm packed package installs offline and calculates without adjacent repositories or root src',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'dvi-work-time-package-'));
 try{
  const cache=path.join(directory,'cache'),consumer=path.join(directory,'consumer');await fs.mkdir(consumer);
  const run=(command,args,options={})=>execFileSync(command,args,{encoding:'utf8',windowsHide:true,timeout:30000,...options});
  // Invoke npm's JS CLI on Windows so cmd.exe cannot preserve argument quotes.
  const npmCli=path.join(path.dirname(process.execPath),'node_modules','npm','bin','npm-cli.js');
  const runNpm=(args,options={})=>process.platform==='win32'
   ?run(process.execPath,[npmCli,...args],options)
   :run('npm',args,options);
  const packed=JSON.parse(runNpm(['pack',packageDirectory,'--json','--ignore-scripts','--offline','--cache',cache,'--pack-destination',directory],{cwd:directory}))[0];
  assert.equal(packed.name,'@dvi-lab/work-time');assert.equal(packed.version,'0.2.0');
  assert.ok(packed.files.some(file=>file.path==='LICENSE'));assert.ok(packed.files.some(file=>file.path==='README.md'));
  assert.ok(packed.files.every(file=>file.path==='package.json'||file.path==='README.md'||file.path==='LICENSE'||file.path.startsWith('src/')));
  assert.ok(!packed.files.some(file=>file.path.includes('check-game-file')));
  // Archive already-built parser artifacts without invoking their source prepare scripts.
  // npm 10's directory fetcher runs prepare despite --ignore-scripts during npm pack.
  const dependencies={},lock=JSON.parse(await fs.readFile(path.join(root,'package-lock.json'),'utf8'));
  for(const [dependency,metadata] of Object.entries(lock.packages).filter(([name])=>name.startsWith('node_modules/'))){
   const name=dependency.slice(13),stage=path.join(directory,'parser-'+name.replaceAll('/','-'));
   await fs.cp(path.join(root,dependency),path.join(stage,'package'),{recursive:true});
   const artifact=name.replaceAll('/','-')+'-'+metadata.version+'.tgz';
   run('tar',['-czf',path.join(directory,artifact),'-C',stage,'package']);
   dependencies[name]='file:../'+artifact;
  }
  await fs.writeFile(path.join(consumer,'package.json'),JSON.stringify({private:true,type:'module',dependencies})+'\n');
  runNpm(['install',path.join(directory,packed.filename),'--offline','--ignore-scripts','--no-audit','--no-fund','--cache',cache],{cwd:consumer});
  const script=[
   "import assert from 'node:assert/strict';",
   "import {createWorkTimeEngine} from '@dvi-lab/work-time';",
   "import {compileGameFile} from '@dvi-lab/work-time/game-file';",
   "const compiled=compileGameFile(\"export const tickMs=600,levelSpeedCoefficient=.005,recipes=[{id:1,skill:'mining',levelReq:1,baseTicks:2,inputs:[],output:{itemId:1,qty:1},plain:true}]; export const recipeInputs=job=>job.inputs;\",{sourceVersion:'future'});",
   "assert.equal(compiled.features.tickMs,true);assert.equal(compiled.features.world,false);assert.ok(compiled.diagnostics.some(issue=>issue.feature==='world'&&issue.code==='missingDeclaration'));",
   "const {gameFile}=await import('data:text/javascript;base64,'+Buffer.from(compiled.code).toString('base64'));",
   "const result=createWorkTimeEngine(gameFile).estimateTaskTime({character:{skills:{mining:{level:1,speedMultiplier:1}}},task:{jobId:1,count:4,discard:true}});",
   "assert.equal(result.status,'ok');assert.ok(Math.abs(result.seconds-4.8)<1e-7);assert.deepEqual(result.products,{1:4});",
   "console.log('isolated-consumer-ok');"
  ].join('\n');
  await fs.writeFile(path.join(consumer,'check.mjs'),script);
  assert.equal(run(process.execPath,['check.mjs'],{cwd:consumer}).trim(),'isolated-consumer-ok');
  const installed=JSON.parse(await fs.readFile(path.join(consumer,'node_modules','@dvi-lab','work-time','package.json'),'utf8'));
  assert.deepEqual(Object.keys(installed.exports).sort(),['.','./game-file']);
  assert.equal(installed.bin,undefined);
  assert.equal(installed.type,'module');assert.deepEqual(installed.dependencies,{acorn:'8.15.0','eslint-scope':'8.4.0'});assert.equal(installed.exports['./game-file'],'./src/game-file.js');
  assert.deepEqual(installed.scripts,{"test":"node --test tests/work-time-package.test.mjs tests/work-time-baseline.test.mjs tests/game-file.test.mjs tests/effective-engine.test.mjs"});
 }finally{
  // Only this test's newly created directory is removed, never existing files.
  await fs.rm(directory,{recursive:true,force:true});
 }
});



test('offline package consumption ignores an unrelated npm_execpath',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'dvi-work-time-manager-'));
 try{
  const unrelatedCli=path.join(directory,'unrelated-package-manager.cjs');
  await fs.writeFile(unrelatedCli,"throw Error('unrelated-package-manager-used');\n");
  const environment={...process.env,npm_execpath:unrelatedCli};
  delete environment.NODE_TEST_CONTEXT;
  let output;
  try{output=execFileSync(process.execPath,[
   '--test','--test-reporter=tap','--test-name-pattern','^npm packed package installs offline and calculates without adjacent repositories or root src$',
   fileURLToPath(import.meta.url),
  ],{
   encoding:'utf8',windowsHide:true,timeout:30000,
   env:environment,
  });}catch(error){throw Error('Isolated package subprocess failed:\n'+error.stdout+'\n'+error.stderr);}
  assert.match(output,/ok \d+ - npm packed package installs offline/);
 }finally{
  await fs.rm(directory,{recursive:true,force:true});
 }
});



test('batch timing rejects invalid tier before gathering discard can bypass logistics',()=>{
 const work=engine(),options={job:gather(),count:1,player:{},actionSeconds:2,discard:true};
 for(const tier of [-1,5,1.2,NaN,'1',null])assert.throws(()=>work.estimateBatchTime({...options,tier}),/invalidTier/);
 for(const tier of [0,1,2,3,4])assert.equal(work.estimateBatchTime({...options,tier}).seconds,2);
});

test('task timing rejects malformed skill XP before game level fallback and accepts fractional XP',()=>{
 let levelCalls=0;
 const game={...adapter(),level:xp=>{levelCalls++;return Number.isFinite(xp)&&xp>=0?Math.max(1,Math.floor(xp)):1;}};
 const work=createWorkTimeEngine(game,source),options={job:gather(),quantity:1,player:player(),tick:100,discard:true};
 for(const xp of [undefined,NaN,-1,'1',null,Infinity]){
  assert.throws(()=>work.estimateTaskTime({...options,player:{...player(),skills:{mining:xp}}}),/invalidWorkConfiguration/);
 }
 assert.equal(levelCalls,0);
 const fractional=work.estimateTaskTime({...options,player:{...player(),skills:{mining:.5}}});
 assert.equal(fractional.status,'ok');assert.equal(levelCalls,1);
});


test('ordinary action probability rejects impossible values while zero stays unreachable',()=>{
 const options={job:gather(),quantity:1,player:player(),tick:100,discard:true};
 for(const chance of [NaN,Infinity,-.1,1.0001,2]){
  const work=createWorkTimeEngine({...adapter(),workChance:()=>chance},source);
  assert.throws(()=>work.workActionSeconds(options.job,options.player),/invalidResult/);
  assert.throws(()=>work.estimateWorkExpectation(options),/invalidResult/);
  assert.throws(()=>work.estimateTaskTime(options),/invalidResult/);
 }
 const zero=createWorkTimeEngine({...adapter(),workChance:()=>0},source);
 assert.equal(zero.workActionSeconds(options.job,options.player),null);
 assert.equal(zero.estimateWorkExpectation(options).status,'unreachable');
 assert.equal(zero.estimateTaskTime(options).status,'unreachable');
 for(const [chance,seconds]of [[.25,2.4],[1,.6]]){
  const work=createWorkTimeEngine({...adapter(),workChance:()=>chance},source);
  near(work.workActionSeconds(options.job,options.player),seconds);
 }
});

test('pure batch and plain qualities ignore missing and malformed unrelated capabilities',()=>{
 const work=createWorkTimeEngine({world:null,rarityThresholds:{},tickMs:NaN});
 for(const job of [gather(),{...gather(),skill:'thieving'},{...craft(),upgrade:{ticks:5}}]){
  const result=work.estimateBatchTime({job,count:2,actionSeconds:3,discard:true});
  assert.equal(result.seconds,6);assert.equal(result.sourceVersion,'1.0.1214');
 }
 assert.deepEqual(work.workQualities(undefined,{plain:true},NaN,NaN),[1,0,0,0,0]);
 assert.equal(work.estimateBatchTime({job:craft(),count:2,actionSeconds:NaN}).reason,'actionTime');
});

test('action branches need only their own rules and preserve method this and adapter exceptions',()=>{
 const zero=createWorkTimeEngine({workChance(){return 0;}});
 assert.equal(zero.workActionSeconds(craft()),null);
 const stopped=zero.estimateWorkExpectation({job:gather(),quantity:1});
 assert.equal(stopped.status,'unreachable');assert.equal(stopped.burn,null);assert.equal(stopped.caught,null);assert.equal(stopped.quality,null);assert.equal(stopped.waitSeconds,null);
 assert.equal(createWorkTimeEngine({level:()=>1,workChance:()=>0}).estimateTaskTime({job:gather(),quantity:1,player:player()}).status,'unreachable');
 const game={tickMs:600,chance:.25,workChance(){return this.chance;},world:null,rarityThresholds:{}};
 assert.equal(createWorkTimeEngine(game).workActionSeconds(craft()),2.4);
 const upgrade={...craft(),upgrade:{ticks:5}},upgrades={tickMs:600,scale:1,upgradeTicks(_player,rule){return this.scale*rule.ticks;}};
 assert.equal(createWorkTimeEngine(upgrades).workActionSeconds(upgrade),3);
 assert.equal(createWorkTimeEngine(upgrades).workActionSeconds({...upgrade,upgrade:{ticks:3}}),1.8);
 const sentinel=Error('rule sentinel');
 assert.throws(()=>createWorkTimeEngine({workChance(){throw sentinel;}}).workActionSeconds(craft()),error=>error===sentinel);
});

test('manufacturing plain gathering nonrarity gathering and upgrades use independent expectation capabilities',()=>{
 const rules={tickMs:600,workChance:()=>.5,burnChance:()=>0,caughtChance:()=>0};
 const work=createWorkTimeEngine(rules);
 assert.equal(work.estimateWorkExpectation({job:craft(),quantity:2}).attempts,2);
 assert.equal(work.estimateWorkExpectation({job:{...gather(),plain:true},quantity:2}).quality,1);
 assert.equal(work.estimateWorkExpectation({job:{...gather(),plain:true},tier:4,quantity:2}).status,'unreachable');
 const nonrare=createWorkTimeEngine({...rules,itemSupportsRarity:()=>false});
 assert.equal(nonrare.estimateWorkExpectation({job:gather(),quantity:2}).quality,1);
 const upgrades=createWorkTimeEngine({tickMs:600,upgradeTicks:(_player,rule)=>rule.ticks});
 assert.equal(upgrades.estimateWorkExpectation({job:{...craft(),upgrade:{ticks:5}},quantity:2}).actionSeconds,3);
});

test('low level tasks stop before work rules while valid minimal plain tasks can discard products',()=>{
 const low=createWorkTimeEngine({level:()=>1});
 assert.equal(low.estimateTaskTime({job:{...gather(),levelReq:2},player:player(),quantity:1}).status,'levelTooLow');
 const work=createWorkTimeEngine({level:()=>1,tickMs:600,workChance:()=>.5,burnChance:()=>0,caughtChance:()=>0});
 const result=work.estimateTaskTime({job:{...gather(),plain:true},player:player(),quantity:2,discard:true});
 assert.equal(result.seconds,2.4);
});

test('missing capabilities report their actual feature and do not poison other methods on the same instance',()=>{
 const work=createWorkTimeEngine({rarityThresholds:{},world:null});
 assert.throws(()=>work.workActionSeconds(craft()),error=>error.message.startsWith('invalidGameAdapter')&&error.feature==='workActionSeconds'&&error.capability==='workChance');
 assert.deepEqual(work.workQualities(null,{plain:true}),[1,0,0,0,0]);
 assert.equal(work.estimateBatchTime({job:gather(),count:1,actionSeconds:2,discard:true}).seconds,2);
 const noTick=createWorkTimeEngine({workChance:()=>.5});
 assert.throws(()=>noTick.workActionSeconds(craft()),error=>error.feature==='workActionSeconds'&&error.capability==='tickMs');
 const noLevel=createWorkTimeEngine({});
 assert.throws(()=>noLevel.estimateTaskTime({job:gather(),player:player(),quantity:1}),error=>error.feature==='estimateTaskTime'&&error.capability==='level');
});

test('quality rules validate thresholds only when used and require tool luck only for equipped tools',()=>{
 const game=adapter();delete game.toolLuck;
 const work=createWorkTimeEngine(game);
 near(work.workQualities(player(),gather(),100,0)[0],.9);
 assert.throws(()=>work.workQualities({...player(),equipment:{...player().equipment,pickaxe:1}},gather(),100,0),error=>error.feature==='workQualities'&&error.capability==='toolLuck');
 const bad=createWorkTimeEngine({...adapter(),rarityThresholds:{}});
 assert.equal(bad.workActionSeconds(craft()),1.2);
 assert.throws(()=>bad.workQualities(player(),gather(),100,0),error=>error.feature==='workQualities'&&error.capability==='rarityThresholds');
 assert.equal(bad.workActionSeconds(craft()),1.2);
});

test('logistics skip unused mount swift site-index and zero-distance path capabilities',()=>{
 const game=adapter();delete game.tool;delete game.brewStrength;delete game.swiftSpeedBonus;delete game.world.siteById;
 const work=createWorkTimeEngine(game),options={job:craft(),count:1,player:player(),actionSeconds:2};
 near(work.estimateBatchTime(options).seconds,11);
 assert.throws(()=>work.estimateBatchTime({...options,siteId:10}),error=>error.feature==='estimateBatchTime.route'&&error.capability==='world.siteById.get');
 assert.throws(()=>work.estimateBatchTime({...options,player:{...player(),equipment:{...player().equipment,mount:1}}}),error=>error.feature==='estimateBatchTime.movement'&&error.capability==='tool');
 assert.throws(()=>work.estimateBatchTime({...options,player:{...player(),brews:{swift:200},brewTier:{swift:0}}}),/invalidGameAdapter.*estimateBatchTime.movement.*swiftSpeedBonus/);
 const adjacent=adapter(0);delete adjacent.walkPath;
 const result=createWorkTimeEngine(adjacent).estimateBatchTime(options);
 assert.equal(result.totalWalkTicks,0);near(result.overheadSeconds,4.2);
});

test('used malformed adapter results fail explicitly without blocking unrelated action methods',()=>{
 const badEntrance=createWorkTimeEngine({...adapter(),siteEntrance:()=>({x:999,y:999})});
 assert.throws(()=>badEntrance.estimateBatchTime({job:craft(),count:1,player:player(),actionSeconds:2}),/invalidResult/);
 const badPath=createWorkTimeEngine({...adapter(),walkPath:()=>undefined});
 assert.throws(()=>badPath.estimateBatchTime({job:craft(),count:1,player:player(),actionSeconds:2}),/invalidResult/);
 assert.equal(badPath.workActionSeconds(craft()),1.2);
 const badCapacity=createWorkTimeEngine({...adapter(),inventoryCapacity:()=>NaN});
 assert.throws(()=>badCapacity.estimateBatchTime({job:craft(),count:1,player:player(),actionSeconds:2}),/invalidResult/);
 const badRarity=createWorkTimeEngine({...adapter(),itemSupportsRarity:()=>undefined});
 assert.throws(()=>badRarity.estimateWorkExpectation({job:gather(),quantity:1,player:player(),tick:100}),/invalidResult/);
 const missingWorld=createWorkTimeEngine({...adapter(),world:null});
 assert.equal(missingWorld.workActionSeconds(craft()),1.2);
 assert.throws(()=>missingWorld.estimateBatchTime({job:craft(),count:1,player:player(),actionSeconds:2}),error=>error.feature==='estimateBatchTime.route'&&error.capability==='world.sites');
});

test('caught waiting rejects damaged stun values only when that wait is relevant',()=>{
 const rules={tickMs:600,workChance:()=>.5,burnChance:()=>0,caughtChance:()=>.2};
 const work=createWorkTimeEngine(rules),options={job:{...gather(),plain:true},quantity:1};
 for(const stunTicks of [NaN,Infinity,-1,'8']){
  assert.throws(()=>work.estimateWorkExpectation({...options,job:{...options.job,caught:{stunTicks}}}),/invalidResult/);
 }
 assert.equal(work.estimateWorkExpectation(options).waitSeconds,0);
 const uncaught=createWorkTimeEngine({...rules,caughtChance:()=>0});
 assert.equal(uncaught.estimateWorkExpectation({...options,job:{...options.job,caught:{stunTicks:NaN}}}).waitSeconds,0);
});

test('explicit sites use only their indexed target and ignore absent or unrelated site lists',()=>{
 const game=adapter(),options={job:craft(),siteId:10,count:1,player:player(),actionSeconds:2};
 delete game.world.sites;
 near(createWorkTimeEngine(game).estimateBatchTime(options).seconds,11);
 const unrelated=adapter();unrelated.world.sites=[{id:99}];
 near(createWorkTimeEngine(unrelated).estimateBatchTime(options).seconds,11);
});

test('empty or unmatched default sites preserve known work without bank or entrance capabilities',()=>{
 for(const sites of [[],[{id:99,jobIds:[999]}]]){
  const game=adapter();game.world.sites=sites;
  delete game.world.bankById;delete game.world.siteById;delete game.siteEntrance;delete game.walkPath;
  const result=createWorkTimeEngine(game).estimateBatchTime({job:craft(),count:10,player:player(),actionSeconds:2});
  assert.equal(result.status,'unknownTime');assert.equal(result.reason,'workLocation');assert.equal(result.seconds,null);assert.equal(result.workSeconds,20);
 }
});
