import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createWorkTimeEngine} from '../src/index.js';

const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-10,`${actual} != ${expected}`);
const recipe={id:1,skill:'mining',levelReq:10,baseTicks:5,inputs:[],output:{itemId:1,qty:2},plain:true};
function game(patch={}){
 return {tickMs:600,recipes:[recipe],levelSpeedCoefficient:.005,
  recipeInputs:job=>job.inputs,recipeOutput:(job,tier)=>job.output.itemId+tier*1000,
  withRarity:(id,tier)=>id+tier*1000,itemSupportsRarity:()=>false,
  ...patch};
}
const character=(patch={})=>({skills:{mining:{level:10,speedMultiplier:1,...patch}}});
const task=(patch={})=>({jobId:1,count:10,discard:true,...patch});

test('final character level and speed produce literal expected action time and count yields',()=>{
 const result=createWorkTimeEngine(game()).estimateTaskTime({character:character({level:30,speedMultiplier:2}),task:task()});
 assert.equal(result.status,'ok');close(result.actionSeconds,15/11);close(result.seconds,150/11);
 assert.equal(result.attempts,10);assert.equal(result.quantity,20);assert.deepEqual(result.materials,{});assert.deepEqual(result.products,{1:20});
 const target=createWorkTimeEngine(game()).estimateTaskTime({character:character(),task:{jobId:1,quantity:5,discard:true}});
 assert.equal(target.attempts,3);assert.equal(target.quantity,6);close(target.seconds,9);
});

test('quality combines decimal luck, personal bonus, world bonus and hot bonus',()=>{
 const g=game({recipes:[{...recipe,plain:false}],itemSupportsRarity:()=>true,
  rarityThresholds:{uncommon:.1,rare:.04,epic:.01,legendary:.002},hotRarityMultiplier:()=>1.5});
 const result=createWorkTimeEngine(g).estimateTaskTime({character:character({luck:.2,rareFindBonus:.3}),task:task({tier:1,count:100}),environment:{tick:123,worldRarityBonus:.2}});
 close(result.quality,.144);close(result.quantity,28.8);close(result.products[1],152);close(result.products[1001],28.8);
 close(result.products[2001],14.4);close(result.products[3001],3.84);close(result.products[4001],.96);
 const target=createWorkTimeEngine(g).estimateTaskTime({character:character({luck:.2,rareFindBonus:.3}),task:{jobId:1,tier:1,quantity:2,discard:true},environment:{tick:123,worldRarityBonus:.2}});
 close(target.attempts,1/.144);assert.equal(target.quantity,2);
});

test('burn and caught decay by level, final failure multiplier, wait and consumed materials',()=>{
 const job={...recipe,skill:'thieving',plain:true,output:{itemId:1,qty:2},inputs:[{itemId:7,qty:3}],
  burn:{chanceAtReq:.4,safeAtLevel:30,itemId:8},caught:{chanceAtReq:.2,safeAtLevel:30,stunTicks:6}};
 const result=createWorkTimeEngine(game({recipes:[job]})).estimateTaskTime({character:{skills:{thieving:{level:20,speedMultiplier:1,failureMultiplier:.5}}},task:task({count:100})});
 close(result.burn,.1);close(result.caught,.05);close(result.waitSeconds,.135);close(result.quantity,171);
 close(result.products[1],171);close(result.products[8],10);assert.deepEqual(result.materials,{7:300});
 close(result.workSeconds,100*(.6/(1.05/5)+.135));
});

test('upgrade uses separate final speed, rounded base ticks and no ordinary speed or quality',()=>{
 const upgrade={id:2,skill:'mining',levelReq:10,from:[1],to:[2],extra:[]};
 const g=game({upgradeRecipes:[upgrade],upgradeBaseTicks:()=>9,
  upgradeMaterials:()=>({named:[{itemId:7,qty:3}]}),upgradeResult:(_job,id)=>id+1,baseItemId:id=>id%1000,itemTier:id=>Math.floor(id/1000)});
 const result=createWorkTimeEngine(g).estimateTaskTime({character:character({speedMultiplier:999,upgradeSpeedMultiplier:2}),task:{jobId:'upgrade-2',tier:2,count:3}});
 assert.equal(result.actionSeconds,3);assert.equal(result.quantity,3);assert.equal(result.seconds,9);
 assert.deepEqual(result.materials,{2001:3,7:9});assert.deepEqual(result.products,{2002:3});
 const fast=createWorkTimeEngine(g).estimateTaskTime({character:character({upgradeSpeedMultiplier:100}),task:{jobId:'upgrade-2',count:1}});
 assert.equal(fast.actionSeconds,.6);
});

test('explicit recipe bonus counts successful events and merges minimum uncommon quality',()=>{
 const job={...recipe,skill:'thieving',bonus:{itemId:9,chance:.1},caught:{chanceAtReq:.2,safeAtLevel:30,stunTicks:1}};
 const g=game({recipes:[job],itemSupportsRarity:id=>id===9,bonusMinimumUncommon:()=>true,
  rarityThresholds:{uncommon:.1,rare:.04,epic:.01,legendary:.002},hotRarityMultiplier:()=>1});
 const result=createWorkTimeEngine(g).estimateTaskTime({character:{skills:{thieving:{level:10,speedMultiplier:1,failureMultiplier:1,luck:0,rareFindBonus:0}}},task:task({count:100}),environment:{tick:0,worldRarityBonus:0}});
 close(result.products[1],160);assert.equal(result.products[9],undefined);close(result.products[1009],7.68);close(result.products[2009],.24);close(result.products[3009],.064);close(result.products[4009],.016);
});

test('missing capabilities are isolated to the executed feature and no failure fields default silently',()=>{
 const engine=createWorkTimeEngine(game());
 assert.equal(engine.estimateTaskTime({character:character(),task:task()}).status,'ok');
 assert.throws(()=>engine.estimateTaskTime({character:character(),task:{jobId:1,count:1,quantity:1}}),/invalidQuantity/);
 assert.throws(()=>engine.estimateTaskTime({character:character(),task:task({count:.5})}),/invalidQuantity/);
 assert.throws(()=>engine.estimateTaskTime({character:character(),task:task({jobId:999})}),/invalidJob/);
 assert.throws(()=>engine.estimateTaskTime({character:character({level:10.5}),task:task()}),/invalidWorkConfiguration/);
 assert.equal(engine.estimateTaskTime({character:character({level:9}),task:task()}).status,'levelTooLow');
 const slow=engine.estimateTaskTime({character:character({speedMultiplier:0}),task:task()});
 assert.equal(slow.status,'unreachable');assert.equal(slow.seconds,null);assert.equal(slow.products,null);
 const risk=createWorkTimeEngine(game({recipes:[{...recipe,burn:{chanceAtReq:.2,safeAtLevel:30,itemId:8}}]}));
 assert.throws(()=>risk.estimateTaskTime({character:character(),task:task()}),/invalidWorkConfiguration/);
 const bonus=createWorkTimeEngine(game({recipes:[{...recipe,bonus:{itemId:9,chance:.1}}],itemSupportsRarity:()=>true}));
 assert.throws(()=>bonus.estimateTaskTime({character:character(),task:task()}),error=>error.capability==='bonusMinimumUncommon');
 const qualities=createWorkTimeEngine(game({recipes:[{...recipe,plain:false}],itemSupportsRarity:()=>true}));
 assert.throws(()=>qualities.estimateTaskTime({character:character(),task:task()}),error=>error.capability==='rarityThresholds');
});

test('retained outputs use final movement directly and missing movement preserves known work time',()=>{
 const g=game({world:{sites:[{id:2,x:1,y:0,jobIds:[1]}],bankById:new Map([[1,{id:1,x:0,y:0}]])},
  siteEntrance:()=>({x:0,y:0}),item:()=>({stackable:false})});
 const engine=createWorkTimeEngine(g);
 const unknown=engine.estimateTaskTime({character:character(),task:task({discard:false})});
 assert.equal(unknown.status,'unknownTime');assert.equal(unknown.reason,'movementConfiguration');close(unknown.workSeconds,30);
 const finalCharacter={...character(),movement:{strideSpeed:1000,capacity:4}};
 const result=engine.estimateTaskTime({character:finalCharacter,task:task({discard:false})});
 assert.equal(result.batches,5);assert.equal(result.batchCapacity,2);assert.equal(result.overheadSeconds,16.8);close(result.seconds,46.8);
});


test('explicit upgrade input chooses matching recipe branch and infers its tier without losing input identity',()=>{
 const upgrade={id:2,skill:'mining',levelReq:10,from:[1,3],to:[2,4],extra:[]};
 const g=game({upgradeRecipes:[upgrade],upgradeBaseTicks:()=>9,baseItemId:id=>id%1000,itemTier:id=>Math.floor(id/1000),
  upgradeMaterials:()=>({named:[]}),upgradeResult:(_job,id)=>id+1});
 const engine=createWorkTimeEngine(g),c=character({upgradeSpeedMultiplier:1});
 assert.throws(()=>engine.estimateTaskTime({character:c,task:{jobId:'upgrade-2',count:1}}),/inputItemId/);
 const result=engine.estimateTaskTime({character:c,task:{jobId:'upgrade-2',inputItemId:2003,count:1}});
 assert.deepEqual(result.materials,{2003:1});assert.deepEqual(result.products,{2004:1});assert.equal(result.quality,1);
 assert.throws(()=>engine.estimateTaskTime({character:c,task:{jobId:'upgrade-2',inputItemId:2003,tier:1,count:1}}),/invalidWorkConfiguration/);
 assert.throws(()=>engine.estimateTaskTime({character:c,task:{jobId:'upgrade-2',inputItemId:2009,count:1}}),/invalidWorkConfiguration/);
});

test('count can have zero expected target yield while impossible quantity remains unreachable',()=>{
 const engine=createWorkTimeEngine(game());
 const attempted=engine.estimateTaskTime({character:character(),task:task({tier:4,count:2})});
 assert.equal(attempted.status,'ok');assert.equal(attempted.quantity,0);assert.deepEqual(attempted.products,{1:4});
 const target=engine.estimateTaskTime({character:character(),task:{jobId:1,tier:4,quantity:2,discard:true}});
 assert.equal(target.status,'unreachable');assert.equal(target.attempts,null);assert.equal(target.products,null);
});

test('pure final batch time does not demand risk, rarity, material yields or original movement attributes',()=>{
 const engine=createWorkTimeEngine({tickMs:600,levelSpeedCoefficient:.005,recipes:[{...recipe,plain:false,burn:{},bonus:{}}]});
 const result=engine.estimateBatchTime({character:character(),task:task()});
 assert.equal(result.status,'ok');close(result.seconds,30);
 assert.equal(engine.workActionSeconds({character:character(),task:task()}),.6/.2);
 assert.throws(()=>engine.estimateBatchTime({character:character(),task:{jobId:1,quantity:1,discard:true}}),/invalidQuantity/);
});

const baseline=new URL('./fixtures/work-time-baseline/',import.meta.url);
const archive=new URL('buddy/docs/model-testing/2026-11-17-alpha/',baseline);
const readJson=url=>JSON.parse(fs.readFileSync(url,'utf8'));
function archivedRows(){
 const lines=fs.readFileSync(new URL('logistics.csv',archive),'utf8').trimEnd().split(/\r?\n/),keys=lines.shift().split(',');
 return lines.map(line=>Object.fromEntries(line.split(',').map((value,index)=>[keys[index],value===''?null:Number(value)])));
}
function finalMovement(game,configuration,calibration,design){
 const player={lastTick:design.initialTick,equipment:{mount:null},masteries:{move:0},perks:{pockets:0},brews:{},brewTier:{}};
 const patch=configuration.fixture?calibration.player:configuration.patch;
 for(const [key,value] of Object.entries(patch)){
  if(value&&typeof value==='object'&&!Array.isArray(value))player[key]={...player[key],...value};else player[key]=value;
 }
 const capturedTick=patch.lastTick??design.initialTick;
 const activeSwift=player.brews.swift>capturedTick;
 // Read the frozen configuration once to form final values. The public engine
 // receives only these two movement numbers, never this raw player snapshot.
 const swift=activeSwift?1+game.swiftSpeedBonus*game.brewStrength(player,'swift'):1;
 return {strideSpeed:Math.round(game.mountStride(player)*swift*game.masteryMultiplier(player.masteries,'move')),capacity:game.inventoryCapacity(player)};
}

test('final character batch entry replays every one of the 14950 frozen logistics vectors',async()=>{
 const manifest=readJson(new URL('manifest.json',archive));
 const gameData=await import(new URL('buddy/src/engine/upstream.js',baseline));
 const {bronzePickaxeCalibration}=await import(new URL('buddy/tests/fixtures/batch-calibration.js',baseline));
 const engine=createWorkTimeEngine({...gameData,levelSpeedCoefficient:.005});
 const characters=new Map(manifest.configurations.map(configuration=>[configuration.index,{
  skills:Object.fromEntries(gameData.allSkills.map(skill=>[skill,{level:500,speedMultiplier:1000000}])),
  movement:finalMovement(gameData,configuration,bronzePickaxeCalibration,manifest.design),
 }]));
 const rows=archivedRows(),secondsPerTick=manifest.design.tickMs/1000;
 assert.equal(rows.length,14950);
 for(const row of rows){
  const label=[row.configurationIndex,row.jobId,row.siteId,row.tier,row.count].join('/');
  const result=engine.estimateBatchTime({character:characters.get(row.configurationIndex),task:{jobId:row.jobId,siteId:row.siteId,tier:row.tier,count:row.count}});
  assert.equal(result.status,'ok',label);close(result.workSeconds,row.oracleWorkTicks*secondsPerTick);
  close(result.overheadSeconds,row.oracleOverheadSeconds);close(result.seconds,row.oracleTotalTicks*secondsPerTick);
  assert.equal(result.batches,row.batches,label);assert.equal(result.batchCapacity,row.capacity,label);
  assert.equal(result.siteId,row.siteId,label);assert.equal(result.bankId,manifest.design.bankId,label);
  assert.equal(result.distance,row.distance,label);assert.equal(result.returnDistance,row.returnDistance,label);
  assert.equal(result.totalWalkTicks,row.oracleWalkTicks,label);
 }
});

test('task rejects explicit null tier, malformed discard and nonpositive or ambiguous quantity modes',()=>{
 const engine=createWorkTimeEngine(game());
 for(const patch of [{tier:null},{tier:5},{tier:-1},{tier:1.5},{discard:'yes'},{discard:null},{count:0},{count:Infinity},{count:Number.MAX_SAFE_INTEGER+1}]){
  assert.throws(()=>engine.estimateTaskTime({character:character(),task:task(patch)}),/invalid(Tier|WorkConfiguration|Quantity)/);
 }
 for(const quantity of [null,0,-1,NaN,Infinity])assert.throws(()=>engine.estimateTaskTime({character:character(),task:{jobId:1,quantity,discard:true}}),/invalidQuantity/);
});

test('upgrade time requires only final upgrade speed and game timing, never item yield capabilities',()=>{
 const engine=createWorkTimeEngine({tickMs:600,levelSpeedCoefficient:.005,upgradeBaseTicks:()=>9,
  upgradeRecipes:[{id:2,skill:'mining',levelReq:10}]});
 const options={character:character({upgradeSpeedMultiplier:2}),task:{jobId:'upgrade-2',count:2}};
 assert.equal(engine.workActionSeconds(options),3);
 assert.equal(engine.estimateBatchTime(options).seconds,6);
});

test('manufacturing input tier follows game output mapping and needs no gathering luck or environment',()=>{
 const job={...recipe,skill:'smithing',output:{itemId:2,qty:3},inputs:[{itemId:7,qty:2}]};
 const g=game({recipes:[job],recipeInputs:()=>[{itemId:2007,qty:2}],recipeOutput:()=>2});
 const result=createWorkTimeEngine(g).estimateWorkExpectation({character:{skills:{smithing:{level:10,speedMultiplier:2}}},task:{jobId:1,tier:2,quantity:4}});
 assert.equal(result.attempts,2);assert.equal(result.quantity,6);assert.equal(result.quality,1);
 assert.deepEqual(result.materials,{2007:4});assert.deepEqual(result.products,{2:6});
});

test('quality saturation clamps cumulative thresholds without negative product probabilities',()=>{
 const g=game({recipes:[{...recipe,plain:false}],itemSupportsRarity:()=>true,
  rarityThresholds:{uncommon:.5,rare:.25,epic:.1,legendary:.01},hotRarityMultiplier:()=>1});
 const engine=createWorkTimeEngine(g),options={character:character({luck:9,rareFindBonus:0}),task:task({tier:4,count:10}),environment:{tick:0,worldRarityBonus:0}};
 assert.deepEqual(engine.workQualities(options),[0,0,0,.9,.1]);
 const result=engine.estimateTaskTime(options);close(result.quantity,2);assert.deepEqual(result.products,{3001:18,4001:2});
 for(const environment of [undefined,{tick:0},{tick:null,worldRarityBonus:0},{tick:0,worldRarityBonus:NaN}]){
  assert.throws(()=>engine.estimateTaskTime({...options,environment}),/invalidWorkConfiguration/);
 }
 for(const patch of [{luck:undefined},{rareFindBonus:undefined},{luck:NaN},{rareFindBonus:-1}]){
  assert.throws(()=>engine.estimateTaskTime({...options,character:character(patch)}),/invalidWorkConfiguration/);
 }
});

test('plain zero-speed branches report no invented probability or products and require no unrelated capabilities',()=>{
 const engine=createWorkTimeEngine({recipes:[recipe],levelSpeedCoefficient:.005});
 const options={character:character({speedMultiplier:0}),task:task()};
 const result=engine.estimateTaskTime(options);
 assert.equal(result.status,'unreachable');assert.equal(result.actionSeconds,null);assert.equal(result.burn,null);assert.equal(result.quantity,null);
 assert.equal(engine.estimateBatchTime(options).status,'unreachable');
 assert.throws(()=>engine.workActionSeconds({...options,character:character({speedMultiplier:undefined})}),/invalidWorkConfiguration/);
});

test('item quantities combine overlapping sources and malformed game results remain visible',()=>{
 const job={...recipe,skill:'thieving',inputs:[{itemId:7,qty:2},{itemId:7,qty:1}],bonus:{itemId:1,chance:.5}};
 const engine=createWorkTimeEngine(game({recipes:[job]}));
 const result=engine.estimateTaskTime({character:{skills:{thieving:{level:10,speedMultiplier:1}}},task:task({count:2})});
 assert.deepEqual(result.materials,{7:6});assert.deepEqual(result.products,{1:5});
 const sentinel=Error('rule failure');
 const broken=createWorkTimeEngine(game({recipeInputs(){throw sentinel;}}));
 assert.throws(()=>broken.estimateTaskTime({character:character(),task:task()}),error=>error===sentinel);
 const damaged=createWorkTimeEngine(game({recipeInputs:()=>[{itemId:'bad',qty:0}]}));
 assert.throws(()=>damaged.estimateTaskTime({character:character(),task:task()}),/invalidResult/);
});
