import fs from 'node:fs';
import crypto from 'node:crypto';
import {parse} from 'acorn';
import {analyze} from 'eslint-scope';

const sourceVersion='1.0.1214';
const reviewedHash='cb67b9c88201f9768b3ec90ffdbeb0ccf7d33b897649c019f13b95c6f0785dc5';
const initialTick=1000000;
const roots={create:'dko',context:'Q$',world:'U',recipes:'Qo',item:'Do',baseItemId:'no',
 start:'On',tick:'yZ',advance:'oA',predict:'tg',countTicks:'l0',stop:'ma',path:'k1',
 atEntrance:'Ht',job:'Oc',workChance:'T_',inventoryCapacity:'Sa',output:'Kh',inputs:'wa',
 withdraw:'q_',allSkills:'Ie',levelXp:'ht',tickMs:'uo',supportsRarity:'Xh',bankDistance:'w2',
 mountStride:'IM',brewStrength:'ja',swiftSpeedBonus:'MK',masteryMultiplier:'za'};
const allowed=new Set(['WeakSet','WeakMap','Uint8Array','Uint16Array','Uint32Array','Int16Array','Int32Array',
 'Float64Array','Math','Map','Set','Number','Object','Array','String','Error','Date','Boolean','Infinity',
 'undefined','JSON','RegExp','parseInt','parseFloat','BigInt','NaN','console','structuredClone']);
let cached;

function oracleError(code,details){
 const error=new Error(`${code}${details?`: ${details}`:''}`);error.code=code;return error;
}

// This dependency closure is independent of generated upstream.js and batch-time.js.
// Evaluate original declarations in memory; do not check a second huge bundle into Git.
function originalGame(){
 const source=fs.readFileSync(new URL('../../vendor/game-original.js',import.meta.url),'utf8');
 const manifest=JSON.parse(fs.readFileSync(new URL('../../vendor/manifest.json',import.meta.url),'utf8'));
 const sha256=crypto.createHash('sha256').update(source).digest('hex');
 if(sha256!==reviewedHash||manifest.sha256!==reviewedHash||manifest.changelogVersion!==sourceVersion)
  throw oracleError('unreviewedOracleSource',`${manifest.changelogVersion}/${sha256}`);
 const ast=parse(source,{ecmaVersion:'latest',sourceType:'module',ranges:true}),declarations=new Map();
 const names=(node,result=[])=>{
  if(!node)return result;
  if(node.type==='Identifier')result.push(node.name);
  else if(node.type==='ObjectPattern')node.properties.forEach(p=>names(p.value,result));
  else if(node.type==='ArrayPattern')node.elements.forEach(n=>names(n,result));
  return result;
 };
 for(const node of ast.body){
  if(node.type==='FunctionDeclaration')declarations.set(node.id.name,{start:node.start,text:source.slice(node.start,node.end)});
  if(node.type==='VariableDeclaration')for(const declaration of node.declarations){
   const entry={start:declaration.start,text:`${node.kind} ${source.slice(declaration.start,declaration.end)};`};
   names(declaration.id).forEach(name=>declarations.set(name,entry));
  }
 }
 const selected=new Set();
 function collect(name){
  const declaration=declarations.get(name);
  if(!declaration)throw oracleError('missingOracleDependency',name);
  if(selected.has(declaration))return;
  selected.add(declaration);
  const ast=parse(declaration.text,{ecmaVersion:'latest',sourceType:'module',ranges:true});
  const references=analyze(ast,{ecmaVersion:2024,sourceType:'module'}).globalScope.through;
  for(const name of new Set(references.map(r=>r.identifier.name)))if(!allowed.has(name))collect(name);
 }
 Object.values(roots).forEach(collect);
 const declarationsText=[...selected].sort((a,b)=>a.start-b.start).map(d=>d.text).join('\n');
 const exportsText=Object.entries(roots).map(([name,symbol])=>`${name}:${symbol}`).join(',');
 const game=new Function(`${declarationsText}\nreturn {${exportsText}};`)();
 return {game,metadata:{sourceVersion,sha256,declarations:selected.size,initialTick,tickMs:game.tickMs}};
}

export function loadGameWorkOracle(){
 if(cached)return cached;
 const {game,metadata}=originalGame(),secondsPerTick=game.tickMs/1000;

 function createPlayer({id=0,level=100,patch={}}={}){
  const bank=game.world.bankById.get(1),player=game.create(id,'model-oracle',bank.x,bank.y,initialTick);
  for(const skill of game.allSkills)player.skills[skill]=game.levelXp(level);
  player.masteries.move=0;
  for(const [key,value] of Object.entries(structuredClone(patch))){
   if(value&&typeof value==='object'&&!Array.isArray(value))player[key]={...player[key],...value};
   else player[key]=value;
  }
  const capturedTick=patch.lastTick??initialTick;
  for(const brew of Object.keys(player.brews)){
   const remaining=player.brews[brew]-capturedTick;
   player.brews[brew]=remaining>0?initialTick+remaining:0;
  }
  player.homeBank=1;player.unlimitedBank=true;player.offlineCapTicks=60000;
  player.lastTick=initialTick;player.pack=[];player.route=null;player.activity='idle';
  const entrance=game.atEntrance(game.world,bank.x,bank.y,id);
  if(!entrance)throw oracleError('missingBankEntrance');
  Object.assign(player,entrance);
  return player;
 }

 function context(seed=1,everyAttemptLands=false){
  return {...game.context(game.world,seed),hypothetical:true,...everyAttemptLands?{everyAttemptLands:true}:{}};
 }

 // Use original entrance selection and actual paths, never production route estimates.
 function selectSite(jobId,player){
  let best=null;
  for(const site of game.world.sites){
   if(!site.jobIds.includes(jobId))continue;
   const entrance=game.atEntrance(game.world,site.x,site.y,player.id,player);
   if(!entrance)continue;
   const path=game.path(game.world,player.x,player.y,entrance.x,entrance.y);
   if(path!==null&&(best===null||path.length<best.distance))best={siteId:site.id,distance:path.length};
  }
  if(!best)throw oracleError('missingWorkSite',String(jobId));
  return best.siteId;
 }

 function stock(player,job,tier,count){
  for(const input of game.inputs(job,tier))player.bank[input.itemId]=input.qty*count;
 }

 function batchCapacity({jobId,tier=0,player}){
  const job=game.job(jobId),clone=structuredClone(player);
  clone.workRarity=tier;
  if(!job.inputs.length)return game.item(game.output(job,tier)).stackable?Infinity:Math.floor(game.inventoryCapacity(clone)/job.output.qty);
  // q_ withdraws every item through ut, even for stacked materials. A reservoir
  // just above the number of slots distinguishes unbounded stacks without an
  // enormous artificial withdrawal loop inside the original game function.
  const reservoir=game.inventoryCapacity(clone)+1;
  stock(clone,job,tier,reservoir);
  const result=game.withdraw(clone,job);
  return result>=reservoir?Infinity:result;
 }

 function finite({jobId,count,tier=0,player=createPlayer(),seed=1,everyAttemptLands=false,siteId,
  maxTicks=100000,trace=false}={}){
  if(!Number.isSafeInteger(count)||count<=0)throw oracleError('invalidOracleCount',String(count));
  const job=game.job(jobId);
  if(['farming','thieving','alchemy'].includes(job.skill)||job.upgrade)throw oracleError('unsupportedOracleJob',String(jobId));
  const state=structuredClone(player),ctx=context(seed,everyAttemptLands);
  siteId??=selectSite(jobId,state);
  stock(state,job,tier,Math.max(game.inventoryCapacity(state)+1,count*2));
  const startedAt=state.lastTick,initialPosition={x:state.x,y:state.y};
  const initialSkills={...state.skills};
  if(!game.start(state,ctx,siteId,jobId,'bank',count,tier))throw oracleError('oracleStartRejected',`${jobId}/${siteId}`);
  let workTicks=0,walkTicks=0,returning=false;
  const events={produced:0,quantity:0,burnt:0,bonus:0,deposited:0,dropped:0,free:0,levelUp:0},legs=[],ticks=[];
  const snapshot=()=>({activity:state.activity,phase:state.route?.phase??null,limit:state.route?.limit??null,x:state.x,y:state.y});
  for(let elapsed=1;elapsed<=maxTicks;elapsed++){
   const before=trace?snapshot():null;
   if(state.activity==='working')workTicks++;
   if(state.activity==='walking')walkTicks++;
   // User-defined final banking is appended to the game's finite task. The game
   // ordinarily stops at the station. Clearing only here prevents a new withdrawal.
   if(returning&&state.activity==='banking')state.route=null;
   const emitted=[];game.tick(state,ctx,state.lastTick+1,emitted);
   for(const event of emitted){
    if(event.kind==='produced'&&event.jobId===jobId){events.produced++;events.quantity+=event.qty??1;if(event.free)events.free++;}
    if(['burnt','bonus','deposited','dropped','levelUp'].includes(event.kind))events[event.kind]++;
    if(event.kind==='walkStarted')legs.push({from:event.from,to:event.path.at(-1),distance:event.path.length,speed:event.speed});
   }
   const tick=trace?{elapsed,before,after:snapshot(),events:emitted.map(e=>e.kind==='walkStarted'?{kind:e.kind,distance:e.path.length,speed:e.speed}:e)}:null;
   if(trace)ticks.push(tick);
   if(returning&&state.activity==='idle'&&state.route===null){
    const totalTicks=state.lastTick-startedAt;
    return {jobId,siteId,tier,count,seed,everyAttemptLands,totalTicks,seconds:totalTicks*secondsPerTick,
     workTicks,workSeconds:workTicks*secondsPerTick,overheadTicks:totalTicks-workTicks,
     overheadSeconds:(totalTicks-workTicks)*secondsPerTick,walkTicks,events,legs,initialPosition,
     finalPosition:{x:state.x,y:state.y},skillsChanged:Object.keys(initialSkills).filter(s=>initialSkills[s]!==state.skills[s]),
     ...(trace?{trace:ticks}:{})};
   }
   if(!returning&&state.route?.limit===0){
    state.route.limit=null;state.route.phase='toBank';state.activity='idle';returning=true;
    if(tick)tick.appendedFinalReturn=true;
   }
   if(!state.route&&!returning)throw oracleError('oracleStoppedEarly',JSON.stringify(state.lastStop));
  }
  throw oracleError('oracleTickLimit',`${jobId}/${count}/${maxTicks}`);
 }

 function hourly({jobId,tier=0,player=createPlayer(),seed=1,siteId,counts=[1,10,14,15,28]}={}){
  siteId??=selectSite(jobId,player);
  const ctx=context(seed),prediction=game.predict(player,ctx,p=>game.start(p,ctx,siteId,jobId,'bank',null,tier));
  if(!prediction)throw oracleError('oraclePredictionRejected',`${jobId}/${siteId}`);
  const job=game.job(jobId),outputBase=game.baseItemId(job.output.itemId);
  let quantity=0;
  for(const [id,amount] of Object.entries(prediction.itemsGained))if(game.baseItemId(Number(id))===outputBase)quantity+=amount;
  return {jobId,siteId,tier,seed,quantity,ticks:prediction.endedAfter??prediction.ticks,endedAfter:prediction.endedAfter,
   outputPerHour:quantity*6000/(prediction.endedAfter??prediction.ticks),xpPerHour:prediction.xpPerHour,
   nominalSeconds:Object.fromEntries(counts.map(count=>{const ticks=game.countTicks(prediction,outputBase,count);return [count,ticks===null?null:Math.round(ticks*secondsPerTick)];}))};
 }

 cached=Object.freeze({metadata:Object.freeze(metadata),game,createPlayer,selectSite,batchCapacity,finite,hourly,
  pureSeconds:(jobId,player)=>secondsPerTick/game.workChance(game.job(jobId),player)});
 return cached;
}
