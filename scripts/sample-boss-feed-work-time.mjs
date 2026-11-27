import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {compileGameFile} from '../src/game-file.js';
import {createWorkTimeEngine} from '../src/index.js';
import {digest,extractNative,loadReplaySnapshot,replaySource1227,sequenceArgs,workModelSymbols1227} from './native-replay.mjs';

const usage='node scripts/sample-boss-feed-work-time.mjs <snapshot.js> [seed-count] [refill-cycles] [start-seed] [output.json]';
const args=process.argv.slice(2);
if(args.length===1&&args[0]==='--help'){
 console.log(usage+'\nDefaults: 8 seeds, 48 refill cycles, starting seed 1.\nOutput: .test-artifacts/boss-feed-native/trials.json.');
 process.exit(0);
}
const [snapshot,rawSeedCount='8',rawCycles='48',rawStartSeed='1',output='.test-artifacts/boss-feed-native/trials.json']=args;
if(args.length>5||!snapshot?.trim()||!output.trim())throw Error(usage);
const {counts:[refillCycles],startSeed,seeds}=sequenceArgs(rawSeedCount,rawCycles,rawStartSeed);
if(rawCycles.includes(','))throw Error(usage);

const outputPath=path.resolve(output);
const {source,sourceVersion,sourceUrl,sha256,checkOutputPath}=loadReplaySnapshot(snapshot,output,[replaySource1227]);
const bossSymbols={
 bosses:'jo',bossUnlockLevel:'gc',bossFeedRecipe:'rv',bossFeedParts:'rSo',bossUsesFarmingSpeed:'qKo',
 bossHeartLayout:'xa',bossKrakenLayout:'Tn',bossColonyLayout:'Id',bossBlightLayout:'ti',bossSiegeLayout:'wl',
};
const compiled=compileGameFile(source,{symbols:{...workModelSymbols1227,...bossSymbols},sourceVersion,sourceUrl});
assert.deepEqual(compiled.diagnostics,[]);
assert.equal(compiled.source.sha256,sha256);
const {gameFile}=await import('data:text/javascript;base64,'+Buffer.from(compiled.code).toString('base64'));
const tickSeconds=gameFile.tickMs/1000,engine=createWorkTimeEngine(gameFile);
const modelPath=new URL('../src/boss-feed.js',import.meta.url),modelSha256=digest(readFileSync(modelPath));
const {native,declarationCount}=extractNative(source,{
 createPlayer:'Foo',world:'X',startBoss:'veo',tick:'HMo',context:'clo',feedChance:'$Ao',
 layout:'g5',bossBank:'leo',siteEntrance:'Ts',item:'ie',
 bosses:'jo',level:'Ge',levelXp:'os',questDay:'ub',questWeek:'$oo',workSpeed:'JL',strideSpeed:'dD',capacity:'Es',
 // The reviewed client initializes the Furnace Heart station index here.
},{initializers:['xa.stations.forEach((e,o)=>{for(const t of e.tiles)i_.has(t.y*4096+t.x)||i_.set(t.y*4096+t.x,o)})']});

const actorId=0,clock=1000000,level=110,bulkItems=1000;
const preferredItems={ore:[8,1],bars:[44,2],logs:[15,0]};
const sameTile=(left,right)=>left.x===right.x&&left.y===right.y;
const tileKey=tile=>tile.x+','+tile.y;
const tileSet=tiles=>tiles.map(tileKey).sort().join('/');

function createPlayer(boss){
 const bank=native.bossBank(native.world,boss);
 assert.ok(bank,'Missing supply depot for '+boss.key);
 const entrance=native.siteEntrance(native.world,bank.x,bank.y,actorId);
 assert.ok(entrance,'Missing supply depot entrance for '+boss.key);
 const player=native.createPlayer(actorId,'local-boss-feed-sample',entrance.x,entrance.y,clock);
 for(const skill of boss.skills)player.skills[skill]=native.levelXp(level);
 player.unlimitedBank=true;
 Object.assign(player.masteries,{move:0,gather:0,craft:0,xp:0});
 Object.assign(player.perks,{quick:0,pockets:0});
 player.quests={day:native.questDay(clock),week:native.questWeek(clock),daily:[],weekly:[]};
 return player;
}

function optionsFor(boss,category,itemId){
 const player=createPlayer(boss);
 return {task:{bossId:boss.id,itemId},character:{
  skills:Object.fromEntries(boss.skills.map(skill=>[skill,{
   level:native.level(player.skills[skill]),speedMultiplier:native.workSpeed(player,skill).combined,
  }])),
  movement:{strideSpeed:native.strideSpeed(player),capacity:native.capacity(player)},
 }};
}

function routesFor(boss,category,primary){
 const layout=native.layout(boss.key),routes=new Map();
 for(const [index,classes] of Object.entries(boss.phases)){
  const phase=Number(index);
  if(!phase||!classes.includes(category.cls))continue;
  const kind=layout.stationKind(category.cls,phase);
  const byTile=new Map();
  for(let trip=0;trip<64;trip++){
   const tile=layout.tileFor(layout.stationFor(kind,actorId,trip));
   byTile.set(tileKey(tile),tile);
  }
  const stations=[...byTile.values()],key=tileSet(stations);
  if(!routes.has(key))routes.set(key,{phase,kind,stations,primary:key===tileSet(primary)});
 }
 return [...routes.values()];
}

const paths=new Map();
function simulate({boss,category,baseItemId,itemId,tier,route,seed,everyAttemptLands,itemsPerRefill,parts}){
 const state=createPlayer(boss),bulk=itemsPerRefill===null;
 const stock=bulk?bulkItems+1:(refillCycles+2)*itemsPerRefill;
 assert.ok(Number.isSafeInteger(stock),'Inventory size overflow.');
 state.bank[itemId]=stock;
 const context={...native.context(native.world,seed),paths,hypothetical:true,everyAttemptLands,
  bossClocks:{[boss.id]:{ticks:[0],phases:[route.phase]}}};
 const settings={only:{[category.cls]:baseItemId},rarities:1<<tier};
 if(route.phase===boss.twoBars)settings.pick=category.cls;
 assert.ok(native.startBoss(state,context,boss.id,tier,settings),'Cannot start '+boss.key+'/'+category.cls);

 const frozenXp=state.skills[category.skill],stations=new Map(),supply=[];
 let measuring=false,elapsed=0,feedTicks=0,moveTicks=0,items=0,successfulParts=0,initialChance;
 for(let tick=clock+1;tick<=clock+2000000;tick++){
  const ready=state.activity==='working'&&state.workJobId!==null&&state.route?.boss.trips>=1;
  if(ready&&(!measuring||state.route.boss.trips===refillCycles+1)){
   assert.ok(route.stations.some(station=>sameTile(state,station)),'Unexpected feeding station.');
   if(measuring&&!bulk)break;
   measuring=true;
  }
  if(measuring){
   elapsed++;
   if(state.activity==='working'&&state.workJobId!==null){
    const chance=native.feedChance(state);
    assert.ok(chance>0&&chance<=1,'Unreachable native feeding tick.');
    initialChance??=chance;
    assert.equal(chance,initialChance,'Native feed probability changed within the synthetic preset.');
    feedTicks++;
   }
   if(state.activity==='walking')moveTicks++;
  }
  const events=[];
  native.tick(state,context,tick,events);
  state.skills[category.skill]=frozenXp;
  assert.ok(state.route?.boss,'Native boss route stopped: '+JSON.stringify(state.lastStop));
  if(!measuring)continue;
  for(const event of events){
   if(event.kind==='withdrew')supply.push({tick,x:state.x,y:state.y,items:event.batches});
   if(event.kind!=='fed')continue;
   assert.equal(event.itemId,itemId);
   assert.equal(event.cls,category.cls);
   assert.equal(event.part?.of??1,parts);
   successfulParts++;
   stations.set(tileKey(state),{x:state.x,y:state.y});
   if(!event.part||event.part.n===event.part.of)items++;
  }
  if(bulk&&items===bulkItems)break;
 }
 assert.equal(items,bulk?bulkItems:itemsPerRefill*refillCycles,'Did not complete the requested sample.');
 assert.equal(successfulParts,items*parts);
 assert.equal(supply.length,bulk?0:refillCycles);
 assert.ok(supply.every(refill=>refill.items===itemsPerRefill));
 assert.ok(!everyAttemptLands||feedTicks===successfulParts);
 const logisticsTicks=elapsed-feedTicks;
 assert.ok(logisticsTicks>=moveTicks);
 if(bulk)assert.equal(logisticsTicks,0);
 return {seed,everyAttemptLands,initialChance,items,successfulParts,elapsed,feedTicks,moveTicks,logisticsTicks,
  stations:[...stations.values()],supply,feedSecondsPerItem:feedTicks*tickSeconds/items,
  logisticsSecondsPerItem:logisticsTicks*tickSeconds/items};
}

const mean=values=>values.reduce((sum,value)=>sum+value,0)/values.length;
const summaries=[];
for(const boss of native.bosses)for(const category of boss.classes){
 const preferred=preferredItems[category.cls],usesPreferred=preferred&&category.items.includes(preferred[0]);
 const baseItemId=usesPreferred?preferred[0]:category.items[0],tier=usesPreferred?preferred[1]:0;
 const itemId=tier===0?baseItemId:gameFile.withRarity(baseItemId,tier);
 const options=optionsFor(boss,category,itemId);
 const model=engine.estimateBossFeedRate(options);
 assert.equal(model.status,'ok',boss.key+'/'+category.cls+': '+model.reason);
 const routes=routesFor(boss,category,model.route.stations);
 assert.equal(routes.filter(route=>route.primary).length,1,'Representative route missing: '+boss.key+'/'+category.cls);
 const expectedRouteCount=model.secondsPerItemRange?.knownRoutes??1;
 assert.equal(routes.length,expectedRouteCount,'Route count differs for '+boss.key+'/'+category.cls);
 const parts=gameFile.bossFeedParts(itemId);
 const {capacity}=options.character.movement;
 const itemsPerRefill=native.item(itemId).stackable&&capacity>1?null:capacity;
 assert.equal(model.route.itemsPerRefill,itemsPerRefill);
 const samples=routes.map(route=>{
  const input={boss,category,baseItemId,itemId,tier,route,itemsPerRefill,parts};
  const fixed=simulate({...input,seed:startSeed,everyAttemptLands:true});
  const trials=seeds.map(seed=>simulate({...input,seed,everyAttemptLands:false}));
  const nativeFeedSecondsPerItem=parts*tickSeconds/fixed.initialChance;
  for(const trial of trials){
   assert.equal(trial.initialChance,fixed.initialChance);
   assert.equal(trial.logisticsTicks,fixed.logisticsTicks);
   assert.equal(trial.moveTicks,fixed.moveTicks);
  }
  return {route,fixed,trials,nativeFeedSecondsPerItem,nativeLogisticsSecondsPerItem:fixed.logisticsSecondsPerItem,
   nativeSecondsPerItem:nativeFeedSecondsPerItem+fixed.logisticsSecondsPerItem,
   sampledFeedSecondsPerItem:mean(trials.map(trial=>trial.feedSecondsPerItem))};
 });
 const primary=samples.find(sample=>sample.route.primary);
 const differences={
  feedSecondsPerItem:model.feedSecondsPerItem-primary.nativeFeedSecondsPerItem,
  sampledFeedSecondsPerItem:model.feedSecondsPerItem-primary.sampledFeedSecondsPerItem,
  logisticsSecondsPerItem:model.logisticsSecondsPerItem-primary.nativeLogisticsSecondsPerItem,
  secondsPerItem:model.secondsPerItem-primary.nativeSecondsPerItem,
 };
 if(model.secondsPerItemRange){
  const measured=samples.map(sample=>sample.nativeSecondsPerItem);
  differences.rangeMin=model.secondsPerItemRange.min-Math.min(...measured);
  differences.rangeMax=model.secondsPerItemRange.max-Math.max(...measured);
 }
 summaries.push({bossId:boss.id,boss:boss.key,category:category.cls,itemId,baseItemId,tier,parts,options,model,differences,samples});
}
assert.equal(digest(readFileSync(modelPath)),modelSha256);
const sourceInfo={sourceVersion,sourceUrl,sha256,modelSha256,tickSeconds,clock,actorId,level,startSeed,seeds,refillCycles,bulkItems,
 nativeDeclarations:declarationCount,conditions:'Single stocked item and quality, fixed boss phase and skill XP, no boosts, initial approach excluded.'};
mkdirSync(path.dirname(outputPath),{recursive:true});
checkOutputPath();
writeFileSync(outputPath,JSON.stringify({sourceInfo,summaries},null,2)+'\n');
const routeCount=summaries.reduce((sum,summary)=>sum+summary.samples.length,0);
console.log(`Game ${sourceVersion} · ${summaries.length} boss categories · ${routeCount} routes · ${routeCount*seeds.length} seeded runs · ${outputPath}`);
for(const key of ['feedSecondsPerItem','sampledFeedSecondsPerItem','logisticsSecondsPerItem','secondsPerItem','rangeMin','rangeMax']){
 const differences=summaries.flatMap(summary=>key in summary.differences?[Math.abs(summary.differences[key])]:[]);
 console.log(`${key} max absolute difference ${Math.max(...differences).toPrecision(5)} s`);
}
