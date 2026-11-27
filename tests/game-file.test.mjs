import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const compiler=await import('../src/game-file.js').catch(error=>{
 if(error.code==='ERR_MODULE_NOT_FOUND')return {};
 throw error;
});

async function loadCompiled(code){
 const directory=await mkdtemp(path.join(tmpdir(),'dvi-game-file-'));
 try{
  const file=path.join(directory,'rules.mjs');
  await writeFile(file,code);
  return await import(pathToFileURL(file).href);
 }finally{await rm(directory,{recursive:true,force:true});}
}

test('compiler is a callable Node build entry',()=>{
 assert.equal(typeof compiler.compileGameFile,'function');
});

test('semantic exports win over baseline symbols and unrelated client code is omitted',async()=>{
 const source=`const uo=999; const gameFile=600; const __dviCompiledGameFile=gameFile; const ms=__dviCompiledGameFile; const input=[{itemId:1,qty:2}];
 const recipes=[{id:1,inputs:input,output:{itemId:2,qty:1}}];
 function inputs(job){return job.inputs;}
 export {ms as tickMs,recipes,inputs as recipeInputs};
 throw new Error('CLIENT_EXECUTED');`;
 const result=compiler.compileGameFile(source,{sourceVersion:'future',sourceUrl:'https://example.test/game.js'});
 assert.equal(result.features.tickMs,true);
 assert.equal(result.features.world,false);
 assert.ok(!result.code.includes('CLIENT_EXECUTED'));
 assert.equal(result.source.sourceVersion,'future');
 assert.equal(result.source.sourceUrl,'https://example.test/game.js');
 assert.equal(result.source.sha256,createHash('sha256').update(source).digest('hex'));
 const module=await loadCompiled(result.code);
 assert.equal(module.gameFile,module.default);
 assert.equal(module.gameFile.tickMs,600);
 assert.equal(module.gameFile.recipeInputs(module.gameFile.recipes[0])[0].qty,2);
 assert.deepEqual(module.gameFile.source,result.source);
});

test('each root isolates rejected external closures without poisoning shared valid declarations',async()=>{
 const result=compiler.compileGameFile(`const shared=600;
 export const tickMs=shared;
 export const recipes=fetch('/private');
 export const item=id=>document.items[id];
 export const upgradeBaseTicks=shared/10;`);
 assert.equal(result.features.tickMs,true);
 assert.equal(result.features.upgradeBaseTicks,true);
 assert.equal(result.features.recipes,false);
 assert.equal(result.features.item,false);
 assert.ok(result.diagnostics.some(d=>d.feature==='recipes'&&d.dependency==='fetch'));
 assert.ok(result.diagnostics.some(d=>d.feature==='item'&&d.dependency==='document'));
 const {gameFile}=await loadCompiled(result.code);
 assert.equal(gameFile.tickMs,600);
 assert.equal(gameFile.upgradeBaseTicks,60);
 assert.equal('recipes' in gameFile,false);
});

test('preserves destructuring, declaration order, closures and reviewed builtins',async()=>{
 const result=compiler.compileGameFile(`const config={speedPerLevelAboveRequirement:.007};
 const {speedPerLevelAboveRequirement:renamed}=config;
 const rows=[{id:2}];
 const lookup=new Map(rows.map(row=>[row.id,row]));
 function decode(id){return lookup.get(Math.trunc(id));}
 export {decode as item};`);
 const {gameFile}=await loadCompiled(result.code);
 assert.equal(gameFile.levelSpeedCoefficient,.007);
 assert.deepEqual(gameFile.item(2),{id:2});
});

test('explicit symbol overrides support a changed minified mapping without version gates',async()=>{
 for(const sourceVersion of [undefined,'1.0.1214','arbitrary-new-release']){
  const result=compiler.compileGameFile('const nextTick=450; const nextUpgrade=17;',{
   symbols:{tickMs:'nextTick',upgradeBaseTicks:'nextUpgrade'},sourceVersion,
  });
  const {gameFile}=await loadCompiled(result.code);
  assert.equal(gameFile.tickMs,450);
  assert.equal(gameFile.upgradeBaseTicks,17);
  assert.equal(result.diagnostics.some(d=>d.feature==='tickMs'),false);
 }
});

test('boss declarations compile on demand even with a renderer reading the layout length',async()=>{
 const source=`export const tickMs=600;
 const stages={stations:[{kind:'chute',tiles:[{x:3,y:0}]}]};
 class Renderer { frame=new Int16Array(stages.stations.length).fill(-1); }
 export const bosses=[{id:0,key:'heart'}];
 const recipe=()=>({skill:'mining',baseTicks:30});`;
 const result=compiler.compileGameFile(source,{symbols:{bossHeartLayout:'stages',bossFeedRecipe:'recipe',bossFeedParts:'missing'}});
 assert.equal(result.features.bossHeartLayout,true);
 assert.equal(result.features.bosses,true);
 assert.equal(result.features.bossFeedParts,false);
 assert.equal(result.features.tickMs,true);
 assert.ok(!result.code.includes('Renderer'));
 const {gameFile}=await loadCompiled(result.code);
 assert.equal(gameFile.bosses[0].key,'heart');
 assert.equal(gameFile.bossHeartLayout.stations[0].tiles[0].x,3);
 assert.equal(gameFile.bossFeedRecipe(1).baseTicks,30);
 assert.equal(Object.hasOwn(compiler.compileGameFile('const ke=[];').features,'bosses'),false);
});

test('gathering drop declarations compile from semantic exports or explicit mappings',async()=>{
 const source=`const ks=200;
 const key={itemId:770,chance:0.02};
 const iZ=level=>({finds:level>=10?[key]:[]});
 const jxo=(job,xp)=>job.baseTicks/xp;
 const Nxo=(key,ticks,speed)=>key.chance*ticks*Math.sqrt(speed);
 const os=level=>level*10;
 const vZ=skill=>skill==='mining'?{skill,itemId:403}:undefined;
 const QO=()=>0.001;`;
 const symbols={
  coinItemId:'ks',dungeonKeyTier:'iZ',dungeonKeyChance:'Nxo',dungeonKeyBaseTicks:'jxo',
  levelXp:'os',skillPet:'vZ',skillPetChance:'QO',
 };
 const exports=Object.entries(symbols).map(([feature,symbol])=>`${symbol} as ${feature}`).join(',');
 const variants=[
  compiler.compileGameFile(source+`export {${exports}};`),
  compiler.compileGameFile(source,{symbols}),
 ];
 for(const {code,features,diagnostics} of variants){
  for(const feature of Object.keys(symbols))assert.equal(features[feature],true,JSON.stringify(diagnostics));
  const {gameFile}=await loadCompiled(code);
  assert.equal(gameFile.coinItemId,200);
  const [key]=gameFile.dungeonKeyTier(10).finds;
  assert.equal(key.itemId,770);
  assert.equal(gameFile.dungeonKeyBaseTicks({baseTicks:200},gameFile.levelXp(10)),2);
  assert.equal(gameFile.dungeonKeyChance(key,2,4),0.08);
  assert.deepEqual(gameFile.skillPet('mining'),{skill:'mining',itemId:403});
  assert.equal(gameFile.skillPetChance('mining'),0.001);
 }
 const compiled=compiler.compileGameFile(source);
 const {gameFile}=await loadCompiled(compiled.code);
 for(const feature of Object.keys(symbols)){
  assert.equal(Object.hasOwn(compiled.features,feature),false);
  assert.equal(Object.hasOwn(gameFile,feature),false);
 }
});

test('an unavailable gathering drop declaration preserves the other selected capabilities',async()=>{
 const result=compiler.compileGameFile(`export const tickMs=600;
 export const dungeonKeyChance=()=>window.chance;
 export const skillPetChance=()=>0.001;`);
 assert.equal(result.features.dungeonKeyChance,false);
 assert.ok(result.diagnostics.some(d=>d.feature==='dungeonKeyChance'&&d.dependency==='window'));
 const {gameFile}=await loadCompiled(result.code);
 assert.equal(gameFile.tickMs,600);
 assert.equal(gameFile.skillPetChance('mining'),0.001);
 assert.equal(Object.hasOwn(gameFile,'dungeonKeyChance'),false);
});

test('imports, eval and ambient environment dependencies are diagnosed and never loaded',async()=>{
 const source=`import remote from 'not-installed-client';
 export const tickMs=600;
 export const recipes=remote;
 export const item=id=>eval(id);
 export const world=import('not-installed-client');`;
 const result=compiler.compileGameFile(source);
 assert.equal(result.features.tickMs,true);
 for(const feature of ['recipes','item','world'])assert.equal(result.features[feature],false);
 assert.ok(!result.code.includes('not-installed-client'));
 assert.ok(!result.code.includes('eval('));
 assert.equal((await loadCompiled(result.code)).gameFile.tickMs,600);
});

test('invalid syntax and unsupported compiler options fail explicitly',()=>{
 assert.throws(()=>compiler.compileGameFile('const = broken'),/invalidGameFile.*parse/i);
 assert.throws(()=>compiler.compileGameFile(null),/invalidGameFile.*source/i);
 assert.throws(()=>compiler.compileGameFile('',{symbols:{unknownFeature:'x'}}),/invalidGameFile.*symbols/i);
});

test('retained real game declarations compile and import independently of adjacent projects',async()=>{
 const source=await readFile(new URL('./fixtures/work-time-baseline/buddy/src/engine/upstream.js',import.meta.url),'utf8');
 const result=compiler.compileGameFile(source,{sourceVersion:'fixture-not-a-version-gate'});
 const {gameFile}=await loadCompiled(result.code);
 for(const feature of ['tickMs','recipes','upgradeRecipes','items','item','recipeInputs','recipeOutput','itemSupportsRarity','rarityThresholds','levelSpeedCoefficient','upgradeBaseTicks','hotRarityMultiplier','world','siteEntrance','walkPath']){
  assert.equal(result.features[feature],true,JSON.stringify(result.diagnostics.filter(d=>d.feature===feature)));
 }
 assert.equal(result.features.bonusMinimumUncommon,false);
 assert.equal(gameFile.tickMs,600);
 assert.equal(gameFile.levelSpeedCoefficient,.005);
 // Magic shortbow has baseTicks=5; the original upgrade multiplier is 1.5.
 assert.equal(gameFile.upgradeBaseTicks(gameFile.upgradeRecipes[0]),8);
 assert.equal(gameFile.recipes[0].id,1);
 assert.equal(gameFile.item(1).id,1);
 assert.ok(gameFile.world.bankById.get(1));
 assert.equal(typeof gameFile.walkPath,'function');
});


test('selected initializers are emitted without being executed by the compiler',()=>{
 const result=compiler.compileGameFile(`export const tickMs=(()=>{throw new Error('SELECTED_INITIALIZER');})();`);
 assert.equal(result.features.tickMs,true);
 assert.ok(result.code.includes('SELECTED_INITIALIZER'));
});

test('rarity encoding and upgrade declarations preserve real game selection and material rules',async()=>{
 const source=await readFile(new URL('./fixtures/work-time-baseline/buddy/src/engine/upstream.js',import.meta.url),'utf8');
 const result=compiler.compileGameFile(source);
 for(const feature of ['withRarity','baseItemId','itemTier','upgradeMaterials','upgradeResult']){
  assert.equal(result.features[feature],true,feature);
 }
 const {gameFile}=await loadCompiled(result.code);
 assert.equal(gameFile.withRarity(145,2),2145);
 assert.equal(gameFile.baseItemId(2145),145);
 assert.equal(gameFile.itemTier(2145),2);
 const upgrade=gameFile.upgradeRecipes[0];
 assert.equal(gameFile.upgradeResult(upgrade,2145),2629);
 assert.equal(gameFile.upgradeResult(upgrade,1),null);
 assert.deepEqual(gameFile.upgradeMaterials(upgrade,2145),{named:[{itemId:2251,qty:1}]});
});


test('omitted eager writes reject only affected closures, including initialization in another declaration',async()=>{
 for(const source of [
  `export let tickMs=1; tickMs=600; export const recipes=[{id:1}];`,
  `export const tickMs=600; export const recipes=[]; recipes.push({id:1});`,
  `export const tickMs=600; export const recipes=[]; const init=recipes.push({id:1});`,
  `export const tickMs=600; export const recipes=[]; function init(){recipes.push({id:1});} init();`,
  `export const tickMs=600; export const recipes=[]; const alias=recipes; alias[0]={id:1};`,
  `export const tickMs=600; export const recipes=[]; function init(rows){rows.push({id:1});} init(recipes);`,
  `export const tickMs=600; export const recipes=[]; class Init{constructor(rows){rows.push({id:1});}} new Init(recipes);`,
  `export const tickMs=600; export const recipes=[{id:1}]; recipes.forEach(row=>{row.id=2;});`,
 ]){
  const result=compiler.compileGameFile(source);
  const affected=source.includes('tickMs=1')?'tickMs':'recipes';
  const intact=affected==='tickMs'?'recipes':'tickMs';
  assert.equal(result.features[affected],false,source);
  assert.ok(result.diagnostics.some(d=>d.feature===affected&&d.code==='externalInitialization'),source);
  assert.equal(result.features[intact],true,source);
  const {gameFile}=await loadCompiled(result.code);
  assert.equal(affected in gameFile,false);
 }
});

test('repeated var declarations cannot overwrite an earlier initializer during extraction',async()=>{
 for(const source of [
  'var ms=600;var ms;export {ms as tickMs};',
  'var ms;var ms=600;export {ms as tickMs};',
  'var ms=1;var ms=600;export {ms as tickMs};',
 ]){
  const result=compiler.compileGameFile(source);
  assert.equal(result.features.tickMs,true);
  assert.equal((await loadCompiled(result.code)).gameFile.tickMs,600);
 }
});

test('closed initialization is preserved while uncalled mutation functions and eager reads remain harmless',async()=>{
 const source=`const build=()=>{const rows=[];rows.push({id:1});return rows;};
 export const recipes=build();
 function unused(){recipes.push({id:2});}
 const ignored=recipes.map(row=>row.id);
 function observe(rows){return rows.length;}
 const observation=observe(recipes);
 function localOnly(){const recipes=[];recipes.push({id:9});} localOnly();
 export const tickMs=600;`;
 const result=compiler.compileGameFile(source);
 assert.equal(result.features.recipes,true,JSON.stringify(result.diagnostics));
 assert.deepEqual((await loadCompiled(result.code)).gameFile.recipes,[{id:1}]);
});

test('recognizes closed lazy get-hit-set caches without accepting unrelated cache seeding',async()=>{
 const declarations=`const cache=new Map();
 function lookup(id){const hit=cache.get(id);if(hit)return hit;const value={id};return cache.set(id,value),value;}
 export {lookup as item};`;
 const warmed=compiler.compileGameFile(declarations+' const initial=lookup(1);');
 assert.equal(warmed.features.item,true,JSON.stringify(warmed.diagnostics));
 assert.deepEqual((await loadCompiled(warmed.code)).gameFile.item(1),{id:1});
 const seeded=compiler.compileGameFile(declarations+' cache.set(1,{id:99});');
 assert.equal(seeded.features.item,false);
 assert.ok(seeded.diagnostics.some(d=>d.feature==='item'&&d.code==='externalInitialization'));
});

test('assignment-created aliases and destructured initializer parameters reject omitted recipe mutation',async t=>{
 for(const source of [
  `export const tickMs=600; export const recipes=[];let alias;alias=recipes;alias.push({id:1});`,
  `export const tickMs=600; export const recipes=[];function init({rows}){rows.push({id:1});}init({rows:recipes});`,
  `export const tickMs=600; export const recipes=[];function init([rows]){rows.push({id:1});}init([recipes]);`,
 ]){
  await t.test(source,async()=>{
   const result=compiler.compileGameFile(source);
   assert.equal(result.features.recipes,false,source);
   assert.ok(result.diagnostics.some(d=>d.feature==='recipes'&&d.code==='externalInitialization'),source);
   assert.equal(result.features.tickMs,true);
   assert.equal('recipes' in (await loadCompiled(result.code)).gameFile,false);
  });
 }
});

test('reduce accumulators built in a fresh array do not mutate the selected source',async()=>{
 for(const method of ['reduce','reduceRight']){
  const source=`export const recipes=[{id:1},{id:2}];
  const derived=recipes.${method}((acc,row)=>{acc.push({id:row.id});return acc;},[]);`;
  const result=compiler.compileGameFile(source);
  assert.equal(result.features.recipes,true,JSON.stringify(result.diagnostics));
  assert.deepEqual((await loadCompiled(result.code)).gameFile.recipes,[{id:1},{id:2}]);
 }
});

test('reduce tracks writes through external accumulators, source elements and the source array',()=>{
 for(const method of ['reduce','reduceRight'])for(const initialization of [
  `const rows=[{id:2}];const alias=recipes;rows.${method}((acc,row)=>{acc.push(row);return acc;},alias);`,
  `recipes.${method}((acc,row)=>{row.id=2;return acc;},[]);`,
  `recipes.${method}((acc,row,index,rows)=>{rows.push({id:2});return acc;},[]);`,
  `recipes.${method}((acc,row)=>{acc.id=2;return acc;});`,
 ]){
  const source=`export const tickMs=600;export const recipes=[{id:1},{id:2}];${initialization}`;
  const result=compiler.compileGameFile(source);
  assert.equal(result.features.recipes,false,source);
  assert.ok(result.diagnostics.some(d=>d.feature==='recipes'&&d.code==='externalInitialization'),source);
  assert.equal(result.features.tickMs,true);
 }
});

test('object literal methods are inspected before classifying their arguments as mutation targets',async()=>{
 const declarations=`const config={id:1};export const recipes=[{id:config.id}];
 const methods={label:value=>String(value),touch:value=>{value.id=2;}};`;
 const read=compiler.compileGameFile(declarations+'const label=methods.label(config.id);');
 assert.equal(read.features.recipes,true,JSON.stringify(read.diagnostics));
 assert.deepEqual((await loadCompiled(read.code)).gameFile.recipes,[{id:1}]);
 for(const call of ['methods.touch(config);','const unknown={};unknown.touch(config);']){
  const write=compiler.compileGameFile(declarations+call);
  assert.equal(write.features.recipes,false,call);
  assert.ok(write.diagnostics.some(d=>d.feature==='recipes'&&d.code==='externalInitialization'));
 }
});

test('conditional lazy caches can clear at a size bound while external cache seeding remains rejected',async()=>{
 const declarations=`const plain=new Map(),special=new Map();
 function lookup(id){const useSpecial=id>100,hit=useSpecial?special.get(id):plain.get(id);if(hit)return hit;
 const value={id};if(useSpecial){const entry={...value};return special.size>=2&&special.clear(),special.set(id,entry),entry;}
 return plain.set(id,value),value;}
 export {lookup as item};`;
 const cold=compiler.compileGameFile(declarations+'const warm=lookup(1);');
 assert.equal(cold.features.item,true,JSON.stringify(cold.diagnostics));
 const {gameFile}=await loadCompiled(cold.code);
 for(const id of [1,101,102,103,101])assert.deepEqual(gameFile.item(id),{id});
 for(const seed of ['plain.set(1,{id:99});','special.set(101,{id:99});']){
  const seeded=compiler.compileGameFile(declarations+seed);
  assert.equal(seeded.features.item,false,seed);
  assert.ok(seeded.diagnostics.some(d=>d.feature==='item'&&d.code==='externalInitialization'));
 }
});

test('object methods bind receiver this and preserve lexical this inside nested arrows',()=>{
 for(const body of ['this[1]={name:"after"};','const run=()=>{this[1]={name:"after"};};run();']){
  const source=`export const items={1:{name:'before'},hydrate(){${body}}};items.hydrate();`;
  const result=compiler.compileGameFile(source);
  assert.equal(result.features.items,false,source);
  assert.ok(result.diagnostics.some(d=>d.feature==='items'&&d.code==='externalInitialization'));
 }
});

test('overwritten object methods keep conservative mutation checks',()=>{
 const result=compiler.compileGameFile(`export const recipes=[{id:1},{id:2}];
 const methods={mutate:value=>{}};methods.mutate=value=>{value.id=9};methods.mutate(recipes[0]);`);
 assert.equal(result.features.recipes,false);
 assert.ok(result.diagnostics.some(d=>d.feature==='recipes'&&d.code==='externalInitialization'));
});

test('reduce callbacks that replace their accumulator retain source aliases in later iterations',()=>{
 for(const method of ['reduce','reduceRight'])for(const change of ['if(index===0)return row;','if(index===0)acc=row;']){
  const source=`export const recipes=[{id:1},{id:2}];
  recipes.${method}((acc,row,index)=>{${change}acc.id=99;return acc;},{});`;
  const result=compiler.compileGameFile(source);
  assert.equal(result.features.recipes,false,source);
  assert.ok(result.diagnostics.some(d=>d.feature==='recipes'&&d.code==='externalInitialization'));
 }
});
