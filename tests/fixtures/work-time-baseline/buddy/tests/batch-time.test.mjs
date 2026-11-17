import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../src/engine/upstream.js';
import {craftingDefaults,craftingPlayer,craftingJobs} from '../src/engine/crafting-model.js';
import {collectionDefaults,collectionPlayers,estimateCollection,validateCollection,importCollection} from '../src/engine/collection-model.js';
import {copyCharacter} from '../src/character-snapshot.js';
import {playerFixture} from './fixtures/player.js';
import {batchTimeModel,estimateBatchTime,estimateWorkTime} from '../src/engine/batch-time.js';
import {bronzePickaxeCalibration} from './fixtures/batch-calibration.js';
const job=id=>game.recipes.find(job=>job.id===id);
const player=()=>craftingPlayer(craftingDefaults()).player;
const estimate=(id,count,options={})=>estimateBatchTime({job:job(id),count,player:player(),actionSeconds:2,...options});
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-6,`${actual} ≈ ${expected}`);

test('work entrance selection follows the current point rather than the best warehouse neighbour',()=>{
 const result=estimate(51,1,{siteId:43,actionSeconds:.6});
 assert.equal(result.distance,6);assert.equal(result.returnDistance,6);
 assert.equal(result.walkTicks,6);assert.equal(result.returnWalkTicks,6);
 near(result.overheadSeconds,12.6);near(result.seconds,13.2);
});

test('gathering routes preserve asymmetric first legs and the later warehouse entrance',()=>{
 const copper=estimate(1,29,{siteId:1,actionSeconds:.6});
 assert.equal(copper.distance,12);assert.equal(copper.returnDistance,11);
 assert.equal(copper.cycleStart,1);assert.equal(copper.cycleLength,1);
 assert.equal(copper.cycleOutwardDistance,11);assert.equal(copper.cycleReturnDistance,11);
 assert.equal(copper.totalWalkTicks,45);near(copper.overheadSeconds,35.4);
 const tin=estimate(2,29,{siteId:6,actionSeconds:.6});
 assert.equal(tin.distance,21);assert.equal(tin.returnDistance,22);
 assert.equal(tin.cycleOutwardDistance,22);assert.equal(tin.cycleReturnDistance,22);
 assert.equal(tin.totalWalkTicks,87);near(tin.overheadSeconds,60.6);
});

test('walking rounds each directed leg separately and resets its remainder',()=>{
 const p=player();p.equipment.mount=104328;
 const result=estimate(1,29,{siteId:1,player:p,actionSeconds:.6});
 assert.equal(result.strideSpeed,2500);assert.equal(result.walkTicks,5);
 assert.equal(result.returnWalkTicks,5);assert.equal(result.totalWalkTicks,20);
 near(result.overheadSeconds,20.4);
});

test('finite retained tasks deposit the last product without an extra full-pack probe',()=>{
 const result=estimate(51,1,{siteId:43,actionSeconds:.6});
 assert.equal(batchTimeModel.version,3);
 // 5 initial + 2 final + two starts + 12 walking + one work tick.
 near(result.seconds,13.2);
});

test('huge batch counts use the first route once and repeat only the stable cycle',()=>{
 const count=28000000000000,result=estimate(1,count,{siteId:1,actionSeconds:0});
 assert.equal(result.batches,1000000000000);
 assert.equal(result.totalWalkTicks,22000000000001);
 assert.equal(result.cycleDistance,22);
 near(result.overheadSeconds,17999999999999.4);
});

test('an explicit site with no walkable entrance preserves known work and unknown logistics',()=>{
 const site={id:99991,x:-10,y:-10,jobIds:[99991]},j={...job(41),id:99991};
 game.world.sites.push(site);game.world.siteById.set(site.id,site);
 try{
  const result=estimateBatchTime({job:j,count:10,player:player(),actionSeconds:2,siteId:site.id});
  assert.equal(result.status,'unknownTime');assert.equal(result.workSeconds,20);assert.equal(result.seconds,null);
 }finally{game.world.sites.pop();game.world.siteById.delete(site.id);}
});

test('an entrance without a reachable path cannot become zero-distance logistics',()=>{
 const site={id:99992,x:220,y:83,jobIds:[99992]},j={...job(41),id:99992},saved=[];
 for(let y=site.y-2;y<=site.y+2;y++)for(let x=site.x-2;x<=site.x+2;x++){
  const index=y*game.world.width+x;saved.push([index,game.world.collision[index]]);
  game.world.collision[index]=Math.max(Math.abs(x-site.x),Math.abs(y-site.y))===2||x===site.x&&y===site.y?1:0;
 }
 game.world.sites.push(site);game.world.siteById.set(site.id,site);
 try{
  assert.ok(game.siteEntrance(game.world,site.x,site.y,0,{x:200,y:83}));
  const result=estimateBatchTime({job:j,count:10,player:player(),actionSeconds:2,siteId:site.id});
  assert.equal(result.status,'unknownTime');assert.equal(result.workSeconds,20);assert.equal(result.seconds,null);
 }finally{
  for(const [index,value]of saved)game.world.collision[index]=value;
  game.world.sites.pop();game.world.siteById.delete(site.id);
 }
});

test('quality-specific stacked materials keep their route and capacity at a batch boundary',()=>{
 for(const tier of [0,1,2,3,4]){
  const result=estimate(248,28,{tier,siteId:43,actionSeconds:.6});
  assert.equal(result.batchCapacity,27);assert.equal(result.batches,2);
  assert.equal(result.distance,6);assert.equal(result.returnDistance,6);
  near(result.overheadSeconds,24.6);near(result.seconds,41.4);
 }
});

test('retained crafting includes warehouse endpoints and adds a new turnover only beyond capacity',()=>{
 const one=estimate(41,14),two=estimate(41,15);
 assert.equal(one.status,'ok');assert.equal(one.batchCapacity,14);assert.equal(one.batches,1);
 assert.equal(one.distance,3);near(one.overheadSeconds,9);near(one.seconds,37);
 assert.equal(two.batches,2);near(two.overheadSeconds,17.4);near(two.seconds,47.4);
 assert.ok(two.seconds>one.seconds+2);
});

test('stacked inputs and products stay in one batch for huge quantities while armour fills the pack',()=>{
 const gems=estimate(230,1e9),hoods=estimate(248,28);
 assert.equal(gems.status,'ok');assert.equal(gems.batches,1);near(gems.seconds,2000000012.6);
 assert.equal(hoods.batchCapacity,27);assert.equal(hoods.batches,2);
 // The reviewed old item rules keep food crops unstacked and monster materials stacked.
 assert.equal(game.item(170).stackable,false);assert.equal(game.item(240).stackable,true);
});

test('fractional expected gathering counts preserve work expectation and round only capacity boundaries',()=>{
 const whole=estimate(1,28),fraction=estimate(1,28.1);
 assert.equal(whole.batchCapacity,28);assert.equal(whole.batches,1);near(whole.seconds,73.4);
 assert.equal(fraction.batches,2);assert.equal(fraction.workSeconds,56.2);near(fraction.overheadSeconds,35.4);
});

test('only gathering discard, theft and upgrades can omit movement inputs',()=>{
 const p={};
 assert.equal(estimate(1,10,{player:p,discard:true}).seconds,20);
 assert.equal(estimate(41,10,{player:p,discard:true}).status,'unknownTime');
 assert.deepEqual(estimate(41,10,{discard:true}),estimate(41,10));
 assert.equal(estimate(240,10,{player:p}).seconds,20);
 const upgrade=craftingJobs.find(job=>job.upgrade);
 const result=estimateBatchTime({job:upgrade,count:10,player:p,actionSeconds:3});
 assert.equal(result.seconds,30);assert.equal(result.overheadSeconds,0);assert.equal(result.batches,0);
});

test('mount, movement mastery, swift brew and pockets independently affect logistics',()=>{
 const p=player();p.equipment.mount=328;p.masteries.move=100;p.perks.pockets=5;p.brews.swift=100;p.brewTier.swift=4;
 const result=estimate(41,16,{player:p});
 assert.equal(result.status,'ok');assert.equal(result.batchCapacity,16);assert.equal(result.batches,1);
 assert.equal(result.strideSpeed,2688);near(result.overheadSeconds,7.8);
 assert.ok(estimate(1,10,{player:p}).overheadSeconds<estimate(1,10).overheadSeconds);
});

test('missing movement configuration, unreachable work sites and impossible pack sizes stay explicit',()=>{
 assert.equal(estimate(41,1,{player:{}}).status,'unknownTime');
 const noSites=estimateBatchTime({job:{...job(41),id:-1},count:1,player:player(),actionSeconds:2});
 assert.equal(noSites.status,'unknownTime');assert.equal(noSites.seconds,null);
 const impossible={...job(41),inputs:[{itemId:1,qty:100}]};
 assert.equal(estimateBatchTime({job:impossible,count:1,player:player(),actionSeconds:2}).status,'unreachable');
 assert.throws(()=>estimate(41,Infinity),/invalidQuantity/);assert.throws(()=>estimate(41,-1),/invalidQuantity/);
});

test('character capture and collection import retain bound movement ranks and logistical fields',()=>{
 const p=playerFixture();p.equipment.mount=game.encode(game.withRarity(328,2),3);p.perks.pockets=4;
 p.brews.swift=p.lastTick+100;p.brewTier.swift=2;p.masteries.move=7;
 p.masteryPage=1;p.masterySkills={smithing:2};p.masteryAway={2:{craft:20,move:90}};
 const copied=copyCharacter(p);
 assert.equal(copied.equipment.mount,p.equipment.mount);assert.equal(copied.perks.pockets,4);assert.equal(copied.brewTier.swift,2);
 const s=importCollection(collectionDefaults(),{version:2,capturedAt:Date.now(),player:copied,worldTick:p.lastTick,worldBuffs:[],worldBuffsVersion:1});
 const players=collectionPlayers(s);
 assert.equal(players.bySkill.smithing.masteries.move,90);assert.equal(players.bySkill.mining.masteries.move,7);
 assert.equal(players.craft.equipment.mount,p.equipment.mount);assert.equal(game.inventoryCapacity(players.craft),32);
 assert.equal(game.brewStrength(players.craft,'swift'),1.6);
});

test('old collection configuration explicitly adopts baseline logistics without accepting damaged new fields',()=>{
 const s=collectionDefaults();delete s.config.gear.mount;delete s.config.perks.pockets;delete s.config.brews.swift;delete s.config.masteries.move;
 const restored=validateCollection(s);
 assert.deepEqual(restored.config.gear.mount,{id:0,tier:0,plus:0});assert.equal(restored.config.perks.pockets,0);
 assert.equal(restored.config.brews.swift,-1);assert.equal(restored.config.masteries.move,0);
 restored.config.perks.pockets='4';assert.throws(()=>validateCollection(restored),/invalidConfiguration/);
});

test('collection keeps caught waiting and uses the same retained batch model unless discard is selected',()=>{
 const s={...collectionDefaults(),initialized:true,worldTick:1000000},j=job(1);
 const retained=estimateCollection(s,1,j),discarded=estimateCollection({...s,discardProducts:true},1,j);
 assert.equal(retained.status,'ok');assert.ok(retained.seconds>discarded.seconds);
 assert.equal(discarded.seconds,discarded.attempts*discarded.actionSeconds);
 const theft=job(240),theftRow=estimateCollection(s,theft.output.itemId,theft);
 assert.equal(theftRow.seconds,theftRow.attempts*(theftRow.actionSeconds+theftRow.caught*7*game.tickMs/1000));
});

test('work time wrapper only applies stored or explicit discard to gathering',()=>{
 const s={...collectionDefaults(),initialized:true,worldTick:1000000,discardProducts:true},players=collectionPlayers(s),j=job(41);
 assert.equal(estimateWorkTime({...s,initialized:false},j,0,10,players).status,'uninitialized');
 const locked=job(45);assert.equal(estimateWorkTime(s,locked,0,10,players).status,'levelTooLow');
 const discarded=estimateWorkTime(s,j,0,10,players),retained=estimateWorkTime(s,j,0,10,players,{discard:false});
 assert.deepEqual(discarded,retained);assert.ok(retained.overheadSeconds>0);
 assert.deepEqual(estimateWorkTime(s,j,0,10,players,{discard:true}),retained);
 const gathered=estimateWorkTime(s,job(1),0,10,players),banked=estimateWorkTime(s,job(1),0,10,players,{discard:false});
 assert.equal(gathered.overheadSeconds,0);assert.ok(banked.seconds>gathered.seconds);
 assert.equal(estimateWorkTime(s,j,0,10,undefined).status,'unknownTime');
});

test('crafting collection time ignores the gathering discard preference',()=>{
 const s={...collectionDefaults(),initialized:true,worldTick:1000000},j=job(41);
 const retained=estimateCollection(s,40,j),withPreference=estimateCollection({...s,discardProducts:true},40,j);
 assert.deepEqual(withPreference,retained);assert.ok(retained.overheadSeconds>0);
});

test('warehouse origin stays at the main city regardless of the character preferred bank',()=>{
 const defaultDepot=estimate(51,1),second=estimate(51,1,{player:{...player(),homeBank:2}});
 assert.equal(defaultDepot.bankId,1);assert.equal(defaultDepot.siteId,43);assert.equal(defaultDepot.distance,6);
 assert.equal(defaultDepot.originAssumption,'main-city-bank');
 assert.deepEqual(second,defaultDepot);
});

test('explicit calibration sites retain the chosen warehouse and reject mismatched or unknown sites',()=>{
 const fixed=estimate(51,10,{siteId:43,player:{...player(),homeBank:2}});
 assert.equal(fixed.status,'ok');assert.equal(fixed.bankId,1);assert.equal(fixed.siteId,43);assert.equal(fixed.distance,6);
 for(const siteId of [1,9999,'43',null]){
  const bad=estimate(51,10,{siteId});assert.equal(bad.status,'unknownTime');assert.equal(bad.seconds,null);
 }
});

test('same-site production calibration reports the test-server reference without fitting phase constants',t=>{
 const fixture=bronzePickaxeCalibration,p={...playerFixture(),...structuredClone(fixture.player)};
 const state=importCollection(collectionDefaults(),{version:2,capturedAt:Date.now(),player:p,worldTick:p.lastTick,worldBuffs:[],worldBuffsVersion:1});
 const players=collectionPlayers(state),j=job(51),sample=estimateWorkTime(state,j,0,28,players,{siteId:43});
 assert.equal(sample.bankId,1);assert.equal(sample.siteId,43);assert.equal(sample.distance,6);
 assert.equal(sample.strideSpeed,2500);assert.equal(sample.batchCapacity,14);assert.equal(sample.batches,2);
 near(sample.workSeconds/28,1.1092807977947496);near(sample.seconds,48.45986233825299);
 const many=estimateWorkTime(state,j,0,1400000,players,{siteId:43}),rate=1400000/many.seconds*3600;
 const observedRate=fixture.observedProductionPerHour;near(rate,2106.1484467675155);
 t.diagnostic(`same-site nominal comparison: model ${rate.toFixed(3)}/h vs game ${observedRate}/h; ${(100*(rate/observedRate-1)).toFixed(3)}%; finite tasks include final banking`);
});
