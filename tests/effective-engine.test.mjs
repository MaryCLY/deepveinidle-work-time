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

function bossGame(patch={}){
 const stations=[{kind:'chute',tiles:[{x:3,y:0}]},{kind:'chute',tiles:[{x:5,y:0}]}];
 return game({
  bossUnlockLevel:90,bossFeedRecipe:()=>({...recipe,baseTicks:30}),bossFeedParts:()=>3,
  bossUsesFarmingSpeed:()=>false,bosses:[{id:0,key:'heart',chestLook:'chest',look:'boss',
   skills:['mining','smithing'],classes:[{cls:'ore',skill:'mining',items:[1]}]}],
  bossHeartLayout:{site:{x:2,y:0},stations},
  world:{sites:[{id:8,look:'chest',x:0,y:0},{id:9,look:'boss',x:2,y:0}]},
  baseItemId:id=>id%1000,itemTier:id=>Math.floor(id/1000),itemSupportsRarity:()=>true,
  item:()=>({stackable:false}),siteEntrance:()=>({x:1,y:0}),
  walkPath:(_world,x,_y,targetX)=>Array.from({length:Math.abs(targetX-x)}),
  ...patch,
 });
}

function bossOptions(skill={},movement={capacity:4,strideSpeed:2000}){
 return {character:{skills:{mining:{level:90,speedMultiplier:50,...skill}},movement},task:{bossId:0,itemId:1001}};
}

test('boss feed caps each of three segments at one success per tick and averages a two-station supply cycle',()=>{
 const result=createWorkTimeEngine(bossGame({source:{sourceVersion:'boss-fixture'}})).estimateBossFeedRate(bossOptions());
 assert.equal(result.status,'ok');
 close(result.feedSecondsPerItem,1.8);
 close(result.logisticsSecondsPerItem,1.65);
 close(result.secondsPerItem,3.45);
 close(result.itemsPerHour,3600/3.45);
 assert.equal(result.source.sourceVersion,'boss-fixture');
 assert.equal(result.route.bankSiteId,8);
 assert.deepEqual(result.route.stations,[{x:3,y:0},{x:5,y:0}]);
});

test('boss feed can use the paired profession to join but checks the selected item level and quality',()=>{
 const engine=createWorkTimeEngine(bossGame());
 const options=bossOptions({level:10});
 assert.equal(engine.estimateBossFeedRate(options).status,'unknownTime');
 options.character.skills.smithing={level:89};
 assert.equal(engine.estimateBossFeedRate(options).status,'levelTooLow');
 options.character.skills.smithing.level=90;
 assert.equal(engine.estimateBossFeedRate(options).status,'ok');
 options.character.skills.mining.level=9;
 assert.equal(engine.estimateBossFeedRate(options).status,'levelTooLow');
 options.task.itemId=5001;
 assert.equal(engine.estimateBossFeedRate(options).status,'ineligibleItem');
});

test('missing boss path keeps the expected action time and zero usable slots cannot be resupplied',()=>{
 const options=bossOptions({speedMultiplier:2});
 const result=createWorkTimeEngine(bossGame({walkPath:()=>null})).estimateBossFeedRate(options);
 assert.equal(result.status,'unknownTime');
 assert.equal(result.secondsPerItem,null);
 close(result.feedSecondsPerItem,45/7);
 options.character.movement.capacity=0;
 const unreachable=createWorkTimeEngine(bossGame()).estimateBossFeedRate(options);
 assert.equal(unreachable.status,'unreachable');
 close(unreachable.feedSecondsPerItem,45/7);
});

function stackedFarmGame(){
 return bossGame({bosses:[{id:3,key:'blight',look:'boss',chestLook:'chest',skills:['farming','herbalism'],
   classes:[{cls:'crops',skill:'farming',items:[1]}]}],
  bossFeedRecipe:()=>({...recipe,skill:'farming',baseTicks:30}),bossUsesFarmingSpeed:()=>true,
  bossBlightLayout:{site:{x:2,y:0},stations:[{kind:'trough',tiles:[{x:3,y:0}]}]},item:()=>({stackable:true})});
}

test('bulk stacked farm items use crop speed without a level correction or repeated refills',()=>{
 const result=createWorkTimeEngine(stackedFarmGame()).estimateBossFeedRate({character:{skills:{farming:{level:90,speedMultiplier:2}},
  movement:{capacity:2}},task:{bossId:3,itemId:1001}});
 assert.equal(result.status,'ok');
 close(result.secondsPerItem,9);
 assert.equal(result.logisticsSecondsPerItem,0);
 close(result.itemsPerHour,400);
});

test('stackable boss stock takes one item per refill when nothing fits after opening its stack',()=>{
 const result=createWorkTimeEngine(stackedFarmGame()).estimateBossFeedRate({character:{skills:{farming:{level:90,speedMultiplier:2}},
  movement:{capacity:1,strideSpeed:1000}},task:{bossId:3,itemId:1001}});
 assert.equal(result.status,'ok');
 assert.equal(result.route.itemsPerRefill,1);
 close(result.logisticsSecondsPerItem,7.2);
 close(result.secondsPerItem,16.2);
});

test('boss feed preserves a known resupply time when only feeding speed is unavailable',()=>{
 const result=createWorkTimeEngine(bossGame()).estimateBossFeedRate(bossOptions({speedMultiplier:undefined}));
 assert.equal(result.status,'unknownTime');
 assert.equal(result.reason,'skillSpeed');
 assert.equal(result.feedSecondsPerItem,null);
 close(result.logisticsSecondsPerItem,1.65);
 assert.equal(result.secondsPerItem,null);
});

test('sea boss keeps the representative fish route and reports the range across complete station groups',()=>{
 const g=bossGame({bosses:[{id:1,key:'kraken',look:'boss',chestLook:'chest',skills:['fishing','cooking'],
   classes:[{cls:'raw',skill:'fishing',items:[1]}]}],
  bossFeedRecipe:()=>({...recipe,skill:'fishing',baseTicks:30}),
  bossKrakenLayout:{site:{x:2,y:0},stations:[{kind:'stove',tiles:[{x:6,y:0}]},{kind:'barrel',tiles:[{x:2,y:0}]}]}});
 const options={character:{skills:{fishing:{level:90,speedMultiplier:50}},movement:{capacity:4,strideSpeed:2000}},
  task:{bossId:1,itemId:1001}};
 const result=createWorkTimeEngine(g).estimateBossFeedRate(options);
 assert.deepEqual(result.route.stationKinds,['barrel']);
 close(result.secondsPerItem,3.3);
 close(result.secondsPerItemRange.min,3.3);
 close(result.secondsPerItemRange.max,3.9);
 g.bossKrakenLayout.stations.pop();
 const partial=createWorkTimeEngine(g).estimateBossFeedRate(options);
 assert.equal(partial.status,'unknownTime');
 close(partial.feedSecondsPerItem,1.8);
 assert.equal(partial.secondsPerItemRange,null);
});

test('sea boss preserves the two known alternate timings if the representative route is unavailable',()=>{
 const g=bossGame({bosses:[{id:1,key:'kraken',look:'boss',chestLook:'chest',skills:['fishing','cooking'],
   classes:[{cls:'raw',skill:'fishing',items:[1]}]}],
  bossFeedRecipe:()=>({...recipe,skill:'fishing',baseTicks:30}),
  bossKrakenLayout:{site:{x:2,y:0},stations:[{kind:'barrel',tiles:[{x:3,y:0}]},{kind:'stove',tiles:[{x:6,y:0}]}]},
  siteEntrance:(_world,_x,_y,_seed,_station,trip)=>({x:1,y:trip%2}),
  walkPath:(_world,x,_y,targetX,targetY)=>x===3&&targetY===1?null:Array.from({length:Math.abs(targetX-x)}),
 });
 const result=createWorkTimeEngine(g).estimateBossFeedRate({character:{skills:{fishing:{level:90,speedMultiplier:50}},
  movement:{capacity:4,strideSpeed:2000}},task:{bossId:1,itemId:1001}});
 assert.equal(result.status,'unknownTime');
 assert.equal(result.secondsPerItem,null);
 close(result.secondsPerItemRange.min,3.6);
 close(result.secondsPerItemRange.max,3.9);
 assert.equal(result.secondsPerItemRange.knownRoutes,2);
 assert.equal(result.secondsPerItemRange.routeCount,3);
});

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
 const g=gatheringGame({recipes:[recipe],world:{sites:[{id:2,x:1,y:0,jobIds:[1]}],bankById:new Map([[1,{id:1,x:0,y:0}]])},
  siteEntrance:()=>({x:0,y:0}),item:()=>({stackable:false})});
 const engine=createWorkTimeEngine(g);
 const unknown=engine.estimateTaskTime({character:character(),task:task({discard:false})});
 assert.equal(unknown.status,'unknownTime');assert.equal(unknown.reason,'movementConfiguration');close(unknown.workSeconds,30);
 const finalCharacter={...character({keyDropMultiplier:1}),movement:{strideSpeed:1000,capacity:4}};
 const result=engine.estimateTaskTime({character:finalCharacter,task:task({discard:false})});
 assert.equal(result.batches,5);assert.equal(result.batchCapacity,2);assert.equal(result.overheadSeconds,16.8);close(result.seconds,46.8);
});

function gatheringGame(patch={}){
 return game({
  recipes:[{...recipe,output:{itemId:1,qty:1}}],
  world:{sites:[{id:2,x:3,y:0,jobIds:[1]}],bankById:new Map([[1,{id:1,x:0,y:0}]])},
  siteEntrance:(_world,x)=>({x:x===3?2:0,y:0}),
  walkPath:(_world,x,_y,targetX)=>Array.from({length:Math.abs(targetX-x)}),
  item:id=>({stackable:![1,10,12].includes(id)}),coinItemId:99,
  dungeonKeyTier:()=>({finds:[]}),levelXp:level=>level*100,
  dungeonKeyBaseTicks:(job,xp)=>job.baseTicks+xp/1000,
  dungeonKeyChance:(find,ticks,multiplier)=>find.chance*ticks*multiplier,
  skillPet:()=>undefined,
  hotRarityMultiplier:()=>1,
  ...patch,
 });
}

function gatheringOptions(count,{capacity=4,skill={},task:patch={}}={}){
 return {character:{...character({luck:0,rareFindBonus:0,keyDropMultiplier:1,...skill}),movement:{strideSpeed:1000,capacity}},
  environment:{tick:0,worldRarityBonus:0},task:task({discard:false,count,...patch})};
}

test('forced key rolls use the character multiplier and occupy distinct stacks outside expected products',()=>{
 const engine=createWorkTimeEngine(gatheringGame({
  dungeonKeyTier:()=>({finds:[{itemId:8,chance:1/12},{itemId:9,chance:1/12},{itemId:99,chance:1/12}]}),
 }));
 const options=gatheringOptions(7,{skill:{keyDropMultiplier:2}});
 const result=engine.estimateTaskTime(options);
 assert.equal(result.batchCapacity,2);
 assert.equal(result.batches,4);
 close(result.seconds,48.6);
 assert.deepEqual(result.products,{1:7});
 assert.equal(engine.estimateBatchTime(options).seconds,result.seconds);
 assert.deepEqual(engine.estimateWorkExpectation(options).products,{1:7});
});

test('key rarity uses adjusted base ticks and scales the chance of picking up a stack',()=>{
 const engine=createWorkTimeEngine(gatheringGame({
  dungeonKeyTier:()=>({finds:[{itemId:8,chance:1/30},{itemId:9,chance:1/30}]}),
  hotRarityMultiplier:()=>1.5,
 }));
 const rare=gatheringOptions(7,{skill:{luck:.25,rareFindBonus:.3,keyDropMultiplier:2}});
 rare.environment.worldRarityBonus=.2;
 const forced=engine.estimateBatchTime(rare);
 assert.equal(forced.batchCapacity,2);
 assert.equal(forced.batches,4);
 const none=createWorkTimeEngine(gatheringGame({dungeonKeyTier:()=>({finds:[{itemId:8,chance:0}]})}));
 assert.equal(none.estimateBatchTime(gatheringOptions(7)).batchCapacity,4);
 assert.equal(none.estimateBatchTime(gatheringOptions(7)).batches,2);
});

test('stackable bonus charges each item ID on its first drop in the trip',()=>{
 const job={...recipe,output:{itemId:1,qty:1},bonus:{itemId:8,chance:.5}};
 const result=createWorkTimeEngine(gatheringGame({recipes:[job]})).estimateBatchTime(gatheringOptions(7));
 close(result.batchCapacity,3+2/17);
 close(result.batches,2+225/289);
 close(result.totalWalkTicks,4*(2+225/289));
});

test('each trip independently has a chance of ending with the shorter capacity',()=>{
 const job={...recipe,output:{itemId:1,qty:1},bonus:{itemId:12,chance:1/7}};
 const engine=createWorkTimeEngine(gatheringGame({recipes:[job]}));
 const result=engine.estimateBatchTime(gatheringOptions(8));
 close(result.batchCapacity,3.5);
 close(result.batches,2.75);
 close(result.totalWalkTicks,11);
 close(result.walkStarts,5.5);
 close(result.overheadSeconds,18.6);
 const long=engine.estimateBatchTime(gatheringOptions(1e12));
 assert.ok(Math.abs(long.batches-285714285714.6531)<.001);
 assert.ok(Number.isFinite(long.seconds));
});

test('one more work attempt cannot shorten the estimate at the exact trip cutoff',()=>{
 const job={...recipe,output:{itemId:1,qty:1},bonus:{itemId:12,chance:28/27.85-1}};
 const engine=createWorkTimeEngine(gatheringGame({recipes:[job],
  world:{sites:[{id:2,x:40,y:0,jobIds:[1]}],bankById:new Map([[1,{id:1,x:0,y:0}]])},
  siteEntrance:(_world,x)=>({x:Math.max(0,x-1),y:0}),
 }));
 const estimate=count=>engine.estimateBatchTime(gatheringOptions(count,{capacity:28,skill:{speedMultiplier:1000}}));
 const cutoff=estimate(27*128),next=estimate(27*128+1),later=estimate(27*128+44);
 close(cutoff.batchCapacity,27.85);
 assert.ok(next.seconds>=cutoff.seconds,`${next.seconds} < ${cutoff.seconds}`);
 assert.ok(next.batches>=cutoff.batches);
 assert.ok(next.totalWalkTicks>=cutoff.totalWalkTicks);
 assert.ok(next.walkStarts>=cutoff.walkStarts);
 assert.ok(later.overheadSeconds>next.overheadSeconds);
});

test('nonstackable bonus adds expected walking only when it can change the number of trips',()=>{
 const job={...recipe,output:{itemId:1,qty:1},bonus:{itemId:12,chance:.5}};
 const engine=createWorkTimeEngine(gatheringGame({recipes:[job]}));
 const result=engine.estimateBatchTime(gatheringOptions(10,{capacity:5}));
 close(result.batchCapacity,10/3);
 close(result.batches,3+8/27);
 close(result.totalWalkTicks,4*(3+8/27));
 const short=engine.estimateBatchTime(gatheringOptions(6,{capacity:5}));
 assert.equal(short.batches,2);
 close(short.overheadSeconds,13.2);
 assert.equal(engine.estimateBatchTime(gatheringOptions(12,{capacity:6})).batchCapacity,4);
});

test('pet drops add nonstackable slots and a zero-slot pack stays unreachable',()=>{
 const engine=createWorkTimeEngine(gatheringGame({skillPet:()=>({itemId:10}),skillPetChance:()=>1}));
 const result=engine.estimateTaskTime(gatheringOptions(7));
 assert.equal(result.batchCapacity,2);
 assert.equal(result.batches,4);
 assert.deepEqual(result.products,{1:7});
 assert.equal(engine.estimateBatchTime(gatheringOptions(7,{capacity:0})).status,'unreachable');
});

test('pet drop storage follows the item definition',()=>{
 const engine=createWorkTimeEngine(gatheringGame({skillPet:()=>({itemId:11}),skillPetChance:()=>1}));
 assert.equal(engine.estimateBatchTime(gatheringOptions(7)).batchCapacity,3);
});

test('burn fills the pack with a byproduct while caught skips all drops',()=>{
 const job={...recipe,output:{itemId:1,qty:1},bonus:{itemId:8,chance:1},
  burn:{chanceAtReq:.5,safeAtLevel:20,itemId:12},caught:{chanceAtReq:.5,safeAtLevel:20,stunTicks:1}};
 const engine=createWorkTimeEngine(gatheringGame({recipes:[job],dungeonKeyTier:()=>({finds:[{itemId:8,chance:1/6}]})}));
 const options=gatheringOptions(9,{skill:{failureMultiplier:1}});
 const result=engine.estimateTaskTime(options);
 close(result.batchCapacity,4+108/283);
 close(result.batches,2+(175/283)**2);
 assert.deepEqual(result.products,{1:2.25,8:2.25,12:4.5});
 assert.equal(engine.estimateBatchTime(options).batchCapacity,result.batchCapacity);
});

test('a repeated stackable ID uses one slot across qualified main, bonus and key rolls',()=>{
 const job={...recipe,plain:false,output:{itemId:1,qty:1},bonus:{itemId:7,chance:1}};
 const engine=createWorkTimeEngine(gatheringGame({recipes:[job],item:id=>({stackable:id!==1001}),itemSupportsRarity:()=>true,
  rarityThresholds:{uncommon:1,rare:0,epic:0,legendary:0},bonusMinimumUncommon:()=>true,
  dungeonKeyTier:()=>({finds:[{itemId:1007,chance:1/6}]})}));
 const result=engine.estimateBatchTime(gatheringOptions(7));
 assert.equal(result.batchCapacity,3);
 assert.equal(result.batches,3);
});

test('a single random stack can fill a stack-only pack and orders do not drive search cost',()=>{
 const job={...recipe,output:{itemId:7,qty:1},bonus:{itemId:8,chance:.5}};
 const engine=createWorkTimeEngine(gatheringGame({recipes:[job]}));
 assert.equal(engine.estimateBatchTime(gatheringOptions(7,{capacity:2})).batchCapacity,2);
 const large=engine.estimateBatchTime(gatheringOptions(1e12,{capacity:2}));
 assert.equal(large.batches,5e11);
 assert.ok(Number.isFinite(large.seconds));
});

test('deterministic gathering preserves an exact maximum-safe integer capacity',()=>{
 const engine=createWorkTimeEngine(gatheringGame());
 const capacity=Number.MAX_SAFE_INTEGER;
 const result=engine.estimateBatchTime(gatheringOptions(capacity,{capacity,skill:{speedMultiplier:1000}}));
 assert.equal(result.batchCapacity,capacity);
 assert.equal(result.batches,1);
});

test('retained gathering logistics require drop inputs',()=>{
 const engine=createWorkTimeEngine(gatheringGame({dungeonKeyTier:undefined}));
 assert.throws(()=>engine.estimateBatchTime(gatheringOptions(7)),error=>error.capability==='dungeonKeyTier');
 const invalid=createWorkTimeEngine(gatheringGame());
 assert.throws(()=>invalid.estimateBatchTime(gatheringOptions(7,{skill:{keyDropMultiplier:.5}})),/invalidWorkConfiguration/);
 assert.equal(engine.estimateBatchTime(gatheringOptions(7,{task:{discard:true}})).batches,0);
 const thieving=createWorkTimeEngine(game({recipes:[{...recipe,skill:'thieving'}]}));
 assert.equal(thieving.estimateBatchTime({character:{skills:{thieving:{level:10,speedMultiplier:1}}},
  task:task({discard:false})}).batches,0);
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

test('final character batch entry replays the 14950 frozen logistics vectors with drops isolated',async()=>{
 const manifest=readJson(new URL('manifest.json',archive));
 const gameData=await import(new URL('buddy/src/engine/upstream.js',baseline));
 const {bronzePickaxeCalibration}=await import(new URL('buddy/tests/fixtures/batch-calibration.js',baseline));
 // The frozen vectors isolate main-item logistics. Supply recipes and drop rules
 // matching those conditions without changing the archive.
 const recipes=gameData.recipes.map(job=>!job.inputs.length&&['mining','fishing','woodcutting'].includes(job.skill)
  ?{...job,bonus:undefined}:job);
 const engine=createWorkTimeEngine({...gameData,recipes,levelSpeedCoefficient:.005,
  dungeonKeyTier:()=>({finds:[]}),skillPet:()=>undefined});
 const environment={tick:manifest.design.initialTick,worldRarityBonus:0};
 const characters=new Map(manifest.configurations.map(configuration=>[configuration.index,{
  skills:Object.fromEntries(gameData.allSkills.map(skill=>[skill,{level:500,speedMultiplier:1000000,luck:0,rareFindBonus:0,keyDropMultiplier:1}])),
  movement:finalMovement(gameData,configuration,bronzePickaxeCalibration,manifest.design),
 }]));
 const rows=archivedRows(),secondsPerTick=manifest.design.tickMs/1000;
 assert.equal(rows.length,14950);
 for(const row of rows){
  const label=[row.configurationIndex,row.jobId,row.siteId,row.tier,row.count].join('/');
  const result=engine.estimateBatchTime({character:characters.get(row.configurationIndex),environment,
   task:{jobId:row.jobId,siteId:row.siteId,tier:row.tier,count:row.count}});
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

test('level one uses ordinary level and speed timing regardless of legacy extra state',()=>{
 const engine=createWorkTimeEngine(game({recipes:[{...recipe,levelReq:1}]}));
 for(const zeroExperience of [undefined,true,false,'true',0]){
  const options={character:character({level:1,zeroExperience}),task:task()};
  const result=engine.estimateTaskTime(options);
  close(result.actionSeconds,3);close(result.seconds,30);
  close(engine.workActionSeconds({...options,character:character({level:1,zeroExperience,speedMultiplier:2})}),1.5);
 }
 close(engine.workActionSeconds({character:character({level:2,zeroExperience:true}),task:task()}),3/1.005);
});

test('level one manufacturing and upgrades retain their ordinary timing',()=>{
 for(const job of [{...recipe,levelReq:1,skill:'smithing'},{...recipe,levelReq:1,inputs:[{itemId:7,qty:1}]}]){
  const engine=createWorkTimeEngine(game({recipes:[job]}));
  close(engine.workActionSeconds({character:{skills:{[job.skill]:{level:1,zeroExperience:true,speedMultiplier:1}}},task:task()}),3);
 }
 const upgrade={id:2,skill:'mining',levelReq:1,from:[1],to:[2],extra:[]};
 const engine=createWorkTimeEngine(game({upgradeRecipes:[upgrade],upgradeBaseTicks:()=>9}));
 close(engine.workActionSeconds({character:character({level:1,zeroExperience:true,upgradeSpeedMultiplier:1}),task:{jobId:'upgrade-2'}}),5.4);
});

test('legacy extra state cannot bypass required speed or make zero speed reachable',()=>{
 const engine=createWorkTimeEngine(game({recipes:[{...recipe,levelReq:1}]}));
 assert.throws(()=>engine.workActionSeconds({character:character({level:1,zeroExperience:true,speedMultiplier:undefined}),task:task()}),/invalidWorkConfiguration/);
 const result=engine.estimateTaskTime({character:character({level:1,zeroExperience:true,speedMultiplier:0}),task:task()});
 assert.equal(result.status,'unreachable');assert.equal(result.seconds,null);
});
