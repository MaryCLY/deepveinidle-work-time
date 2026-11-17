import test from 'node:test';
import assert from 'node:assert/strict';
import {loadGameWorkOracle} from './helpers/game-work-oracle.mjs';
import {estimateBatchTime} from '../src/engine/batch-time.js';
import * as game from '../src/engine/upstream.js';
import {bronzePickaxeCalibration} from './fixtures/batch-calibration.js';
import {chromeTimeReferences} from './fixtures/chrome-time-references.js';

const oracle=loadGameWorkOracle();
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} ≈ ${b}`);

test('finite logistics match original game state transitions at fixed crafting batch boundaries',()=>{
 const player=oracle.createPlayer({patch:bronzePickaxeCalibration.player});
 for(const [count,ticks] of [[1,16],[14,29],[15,44],[28,57]]){
  const expected=oracle.finite({jobId:51,siteId:43,count,player,everyAttemptLands:true});
  assert.equal(expected.totalTicks,ticks);assert.equal(expected.workTicks,count);
  const actual=estimateBatchTime({job:game.recipes.find(j=>j.id===51),siteId:43,count,player,actionSeconds:.6});
  near(actual.overheadSeconds,expected.overheadSeconds);
 }
});

test('finite logistics match original paths for gathering, stacked goods and tight crafting capacities',()=>{
 const players=[oracle.createPlayer(),oracle.createPlayer({patch:bronzePickaxeCalibration.player}),
  oracle.createPlayer({patch:{equipment:{mount:328},perks:{pockets:5},masteries:{move:200},brews:{swift:1060000},brewTier:{swift:4}}})];
 for(const player of players)for(const jobId of [1,3,41,45,51,230,248,420])for(const tier of [0,4]){
  const siteId=oracle.selectSite(jobId,player),capacity=oracle.batchCapacity({jobId,tier,player});
  const boundary=Number.isFinite(capacity)?capacity:28;
  for(const count of new Set([1,boundary,boundary+1])){
   const expected=oracle.finite({jobId,siteId,tier,count,player,everyAttemptLands:true});
   const actual=estimateBatchTime({job:game.recipes.find(j=>j.id===jobId),siteId,tier,count,player,actionSeconds:.6});
   assert.equal(actual.status,'ok');
   assert.ok(Math.abs(actual.overheadSeconds-expected.overheadSeconds)<1e-7,
    `job ${jobId}, tier ${tier}, count ${count}, stride ${actual.strideSpeed}: ${actual.overheadSeconds} vs original ${expected.overheadSeconds}`);
  }
 }
});

test('original oracle keeps randomness separate from isolated logistics and rejects unsupported counts',()=>{
 const player=oracle.createPlayer({patch:bronzePickaxeCalibration.player});
 const options={jobId:51,siteId:43,count:28,player};
 const isolated=oracle.finite({...options,everyAttemptLands:true}),normal=oracle.finite({...options,seed:1});
 assert.equal(isolated.workTicks,28);assert.ok(normal.workTicks>isolated.workTicks);
 assert.equal(normal.overheadTicks,isolated.overheadTicks);assert.equal(player.route,null);assert.equal(player.pack.length,0);
 assert.throws(()=>oracle.finite({...options,count:1.5}),{code:'invalidOracleCount'});
 assert.throws(()=>oracle.finite({...options,maxTicks:1}),{code:'oracleTickLimit'});
 assert.throws(()=>oracle.finite({...options,jobId:240}),{code:'unsupportedOracleJob'});
 const hourly=oracle.hourly({jobId:51,siteId:43,player,seed:1});
 assert.ok(hourly.outputPerHour>0);assert.equal(hourly.ticks,6000);
 assert.ok(hourly.nominalSeconds[28]>hourly.nominalSeconds[1]);
 near(oracle.pureSeconds(51,player),1.1092807977947496);
});

test('oracle preserves remaining potion duration when moving a captured configuration to its fixed clock',()=>{
 const player=oracle.createPlayer({patch:{lastTick:46000000,brews:{swift:46000060,quick:45999999},brewTier:{swift:2}}});
 assert.equal(player.brews.swift-player.lastTick,60);
 assert.ok(player.brews.quick<=player.lastTick);
});

test('equipment and mastery cohorts retain the work probabilities observed in Chrome',()=>{
 for(const cohort of chromeTimeReferences.cohorts){
  const player=oracle.createPlayer({patch:cohort.player});
  for(const reference of cohort.rows){
   const job=game.recipes.find(job=>job.id===reference.jobId);
   assert.ok(job,`${cohort.id}: missing old recipe ${reference.jobId}`);
   assert.ok(Math.abs(game.workChance(job,player)-reference.chance)<1e-12,
    `${cohort.id}: job ${job.id} differs from the captured game probability`);
  }
 }
});
