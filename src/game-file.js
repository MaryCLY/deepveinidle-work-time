import {createHash} from 'node:crypto';
import {parse} from 'acorn';
import {analyze} from 'eslint-scope';

// Reviewed baseline names are a fallback, never a version or digest allowlist.
const baselineSymbols=Object.freeze({
 tickMs:'uo',recipes:'Qo',upgradeRecipes:'vs',items:'Ws',item:'Do',
 recipeInputs:'wa',recipeOutput:'Kh',itemSupportsRarity:'Xh',
 rarityThresholds:'yl',levelSpeedCoefficient:'kuo',upgradeBaseTicks:'MF',
 hotRarityMultiplier:'pK',world:'U',siteEntrance:'Ht',walkPath:'k1',
 bonusMinimumUncommon:'cO',withRarity:'Jc',baseItemId:'no',itemTier:'_o',
 upgradeMaterials:'lm',upgradeResult:'kr',
});
const optionalSymbols=Object.freeze({
 bosses:undefined,bossUnlockLevel:undefined,bossFeedRecipe:undefined,bossFeedParts:undefined,
 bossUsesFarmingSpeed:undefined,bossHeartLayout:undefined,bossKrakenLayout:undefined,
 bossColonyLayout:undefined,bossBlightLayout:undefined,bossSiegeLayout:undefined,
});
const featureSymbols=Object.freeze({...baselineSymbols,...optionalSymbols});
const reviewedGlobals=new Set([
 'WeakSet','WeakMap','Uint8Array','Uint16Array','Uint32Array','Int16Array','Int32Array',
 'Float64Array','Math','Map','Set','Number','Object','Array','String','Error',
 'Date','Boolean','Infinity','undefined','NaN','JSON','RegExp','parseInt','parseFloat',
]);
const parseOptions={ecmaVersion:'latest',sourceType:'module',ranges:true};

function invalid(part,message,cause){
 return new Error(`invalidGameFile: ${part}: ${message}`,cause?{cause}:undefined);
}

function bindingNames(pattern,names=[]){
 if(!pattern)return names;
 if(pattern.type==='Identifier')names.push(pattern.name);
 else if(pattern.type==='ObjectPattern')for(const property of pattern.properties){
  bindingNames(property.type==='RestElement'?property.argument:property.value,names);
 }
 else if(pattern.type==='ArrayPattern')for(const element of pattern.elements)bindingNames(element,names);
 else if(pattern.type==='AssignmentPattern')bindingNames(pattern.left,names);
 else if(pattern.type==='RestElement')bindingNames(pattern.argument,names);
 return names;
}

function visit(node,callback){
 if(!node||typeof node!=='object')return;
 if(typeof node.type==='string')callback(node);
 for(const [key,value] of Object.entries(node)){
  if(key==='range'||key==='loc')continue;
  if(Array.isArray(value))for(const child of value)visit(child,callback);
  else if(value&&typeof value==='object')visit(value,callback);
 }
}

function indexDeclarations(ast,source){
 const declarations=new Map(),semanticExports=new Map(),speedAnchors=new Set(),owners=new WeakMap();
 function register(name,entry){
  if(!declarations.has(name))declarations.set(name,[]);
  declarations.get(name).push(entry);
 }
 function add(node){
  if(node.type==='VariableDeclaration')for(const declarator of node.declarations){
   const names=bindingNames(declarator.id);
   const entry={node:declarator,start:declarator.start,text:`${node.kind} ${source.slice(declarator.start,declarator.end)};`};
   owners.set(declarator,entry);
   for(const name of names)register(name,entry);
   visit(declarator.id,pattern=>{
    if(pattern.type!=='ObjectPattern')return;
    for(const property of pattern.properties){
     if(property.type==='Property'&&!property.computed&&
      (property.key.name??property.key.value)==='speedPerLevelAboveRequirement'){
      const name=property.value.type==='Identifier'?property.value.name:
       property.value.type==='AssignmentPattern'?property.value.left.name:undefined;
      if(name)speedAnchors.add(name);
     }
    }
   });
  }
  else if((node.type==='FunctionDeclaration'||node.type==='ClassDeclaration')&&node.id){
   const entry={node,start:node.start,text:source.slice(node.start,node.end)};
   owners.set(node,entry);register(node.id.name,entry);
  }
 }
 for(const node of ast.body){
  if(node.type==='ExportNamedDeclaration'){
   if(node.declaration){
    add(node.declaration);
    const names=node.declaration.type==='VariableDeclaration'?
     node.declaration.declarations.flatMap(d=>bindingNames(d.id)):[node.declaration.id?.name];
    for(const name of names)if(name)semanticExports.set(name,name);
   }
   if(!node.source)for(const specifier of node.specifiers){
    semanticExports.set(specifier.exported.name??specifier.exported.value,specifier.local.name);
   }
  }else if(node.type==='ExportDefaultDeclaration'){
   if(node.declaration.type==='FunctionDeclaration'||node.declaration.type==='ClassDeclaration')add(node.declaration);
  }else add(node);
 }
 return {declarations,semanticExports,speedAnchors,owners};
}

// Operations whose receiver is read without being changed. Inline iteration
// callbacks are inspected separately, since they may still mutate their elements.
const readMethods=new Set([
 'at','concat','entries','every','filter','find','findIndex','findLast','findLastIndex',
 'flat','flatMap','forEach','get','has','includes','indexOf','join','keys','lastIndexOf',
 'map','reduce','reduceRight','slice','some','toLocaleString','toReversed','toSorted',
 'toSpliced','toString','values','with','charAt','charCodeAt','codePointAt','endsWith',
 'match','matchAll','normalize','padEnd','padStart','repeat','replace','replaceAll',
 'search','split','startsWith','substring','toLowerCase','toUpperCase','trim',
 'trimEnd','trimStart','test','exec',
]);
const mutatingMethods=new Set(['add','clear','copyWithin','delete','fill','pop','push','reverse','set','shift','sort','splice','unshift']);
const iterationMethods=new Set(['every','filter','find','findIndex','findLast','findLastIndex',
 'flatMap','forEach','map','reduce','reduceRight','some']);

function initializationEffects(ast,declarations,owners){
 const scope=analyze(ast,{ecmaVersion:2024,sourceType:'module'});
 const moduleScope=scope.scopes.find(candidate=>candidate.type==='module');
 const moduleVariables=new Set(moduleScope.variables),variables=new WeakMap(),effects=[],assignedAliases=new Map();
 let executingFunction;
 for(const current of scope.scopes)for(const variable of current.variables){
  for(const identifier of variable.identifiers)variables.set(identifier,variable);
  for(const reference of variable.references)variables.set(reference.identifier,variable);
 }
 function roots(node,environment,seen=new Set()){
  if(!node)return new Set();
  if(node.type==='MemberExpression'||node.type==='ChainExpression')return roots(node.object??node.expression,environment,seen);
  if(node.type==='Identifier'){
   const variable=variables.get(node);
   if(!variable||seen.has(variable))return new Set();
   if(environment.has(variable))return environment.get(variable);
   seen.add(variable);
   const result=new Set(moduleVariables.has(variable)?[variable.name]:[]);
   for(const name of assignedAliases.get(variable)??[])result.add(name);
   for(const definition of variable.defs){
    const init=definition.node.type==='VariableDeclarator'?definition.node.init:undefined;
    if(init&&['Identifier','MemberExpression','ObjectExpression','ArrayExpression','ConditionalExpression','LogicalExpression'].includes(init.type)){
     for(const name of roots(init,environment,seen))result.add(name);
    }
   }
   return result;
  }
  const result=new Set();
  if(['ObjectExpression','ArrayExpression','Property','SpreadElement','ConditionalExpression','LogicalExpression'].includes(node.type)){
   for(const child of children(node))for(const name of roots(child,environment,new Set(seen)))result.add(name);
  }
  return result;
 }
 function children(node){
  return Object.entries(node).flatMap(([key,value])=>{
   if(key==='range'||key==='loc')return [];
   return Array.isArray(value)?value.filter(child=>child&&typeof child.type==='string'):
    value&&typeof value.type==='string'?[value]:[];
  });
 }
 function record(names,owner,node){
  for(const name of names)if(declarations.has(name))effects.push({name,owner,node,fn:executingFunction,start:node.start});
 }
 function assignment(node,owner,environment){
  if(node.type==='Identifier'){
   const variable=variables.get(node);
   if(moduleVariables.has(variable))record([variable.name],owner,node);
  }else if(node.type==='MemberExpression')record(roots(node.object,environment),owner,node);
  else for(const child of children(node))assignment(child,owner,environment);
 }
 function callable(node){
  if(!node)return undefined;
  if(node.type==='FunctionExpression'||node.type==='ArrowFunctionExpression')return node;
  if(node.type!=='Identifier')return undefined;
  for(const definition of variables.get(node)?.defs??[]){
   if(definition.node.type==='FunctionDeclaration')return definition.node;
   if(definition.node.type==='ClassDeclaration'||definition.node.type==='ClassExpression'){
    return definition.node.body.body.find(method=>method.kind==='constructor')?.value;
   }
   const init=definition.node.init;
   if(init?.type==='FunctionExpression'||init?.type==='ArrowFunctionExpression')return init;
  }
 }
 function inspectFunction(fn,args,owner,environment,stack){
  if(stack.has(fn))return;
  const nextStack=new Set(stack).add(fn),local=new Map(environment);
  function bind(parameter,names){
   if(!parameter)return;
   if(parameter.type==='Identifier')local.set(variables.get(parameter),names);
   else if(parameter.type==='AssignmentPattern'){
    bind(parameter.left,new Set([...names,...roots(parameter.right,environment)]));
    scan(parameter.right,owner,environment,nextStack);
   }else if(parameter.type==='RestElement')bind(parameter.argument,names);
   else if(parameter.type==='ObjectPattern')for(const property of parameter.properties){
    bind(property.type==='RestElement'?property.argument:property.value,names);
   }else if(parameter.type==='ArrayPattern')for(const element of parameter.elements)bind(element,names);
  }
  // Conservatively share argument roots across destructured bindings. This
  // tracks possible mutation targets without interpreting property values.
  fn.params.forEach((parameter,index)=>bind(parameter,args[index]??new Set()));
  const previous=executingFunction;executingFunction=fn;
  try{scan(fn.body,owner,local,nextStack);}finally{executingFunction=previous;}
 }
 function mutable(name){
  return declarations.get(name).some(entry=>entry.node.type==='VariableDeclarator'&&
   entry.node.init?.type!=='Literal'&&entry.node.init?.type!=='ArrowFunctionExpression'&&entry.node.init?.type!=='FunctionExpression');
 }
 function scan(node,owner,environment=new Map(),stack=new Set()){
  if(!node)return;
  if(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(node.type))return;
  if(node.type==='AssignmentExpression'){
   assignment(node.left,owner,environment);
   if(node.left.type==='Identifier'){
    const variable=variables.get(node.left),names=roots(node.right,environment);
    if(moduleVariables.has(variable)){
     const previous=assignedAliases.get(variable)??new Set();
     assignedAliases.set(variable,new Set([...previous,...names]));
    }else if(variable)environment.set(variable,names);
   }
  }
  if(node.type==='UpdateExpression'||node.type==='UnaryExpression'&&node.operator==='delete')assignment(node.argument,owner,environment);
  if(node.type==='CallExpression'||node.type==='NewExpression'){
   const fn=callable(node.callee);
   if(fn)inspectFunction(fn,node.arguments.map(argument=>roots(argument,environment)),owner,environment,stack);
   else if(node.callee.type==='MemberExpression'){
    const member=node.callee,method=member.computed?member.property.value:member.property.name;
    const receiver=roots(member.object,environment);
    if(!readMethods.has(method))record([...receiver].filter(mutable),owner,node);
    if(iterationMethods.has(method))for(const argument of node.arguments){
     const callback=callable(argument);
     if(callback)inspectFunction(callback,[receiver],owner,environment,stack);
    }
    // Static Object operations may write their first argument; other reviewed
    // builtins consume values without transferring control to client code.
    const builtin=member.object.type==='Identifier'&&!variables.has(member.object)?member.object.name:undefined;
    if(builtin==='Object'&&['assign','defineProperty','defineProperties','setPrototypeOf','freeze','seal','preventExtensions'].includes(method)){
     record(roots(node.arguments[0],environment),owner,node);
    }else if(!builtin&&!readMethods.has(method)&&!mutatingMethods.has(method)){
     for(const argument of node.arguments)record([...roots(argument,environment)].filter(mutable),owner,node);
    }
   }else{
    const builtin=node.callee.type==='Identifier'&&!variables.has(node.callee)&&reviewedGlobals.has(node.callee.name);
    if(!builtin)for(const argument of node.arguments)record([...roots(argument,environment)].filter(mutable),owner,node);
   }
  }
  for(const child of children(node))scan(child,owner,environment,stack);
 }
 for(const statement of ast.body){
  const node=statement.type==='ExportNamedDeclaration'||statement.type==='ExportDefaultDeclaration'?statement.declaration:statement;
  if(!node)continue;
  if(node.type==='VariableDeclaration')for(const declarator of node.declarations){
   scan(declarator.init,owners.get(declarator));
   // Computed destructuring keys/defaults can also run initialization code.
   scan(declarator.id,owners.get(declarator));
  }else if(node.type!=='FunctionDeclaration')scan(node,owners.get(node));
 }
 return effects;
}

// Recognize the game's cold-recomputable memoization structure, rather than
// treating a client-side cache warmup as a separate game-data initializer.
// An unrelated external set/delete never qualifies for this exception.
function lazyMemoWrite(effect,closure,declarations,owners){
 const {fn,node,name}=effect;
 if(!fn||!closure.has(owners.get(fn))||fn.body.type!=='BlockStatement')return false;
 const cacheEntries=declarations.get(name);
 if(cacheEntries.length!==1)return false;
 const init=cacheEntries[0].node.init;
 if(init?.type!=='NewExpression'||!['Map','WeakMap'].includes(init.callee.name)||init.arguments.length)return false;
 const statements=fn.body.body,first=statements[0],check=statements[1],last=statements.at(-1);
 const hit=first?.type==='VariableDeclaration'&&first.declarations.length===1?first.declarations[0]:undefined;
 const get=hit?.init;
 if(hit?.id.type!=='Identifier'||get?.type!=='CallExpression'||get.callee.type!=='MemberExpression'||
  get.callee.object.name!==name||get.callee.property.name!=='get'||get.arguments.length!==1||get.arguments[0].type!=='Identifier')return false;
 const returned=check?.consequent?.type==='BlockStatement'?check.consequent.body[0]:check?.consequent;
 if(check?.type!=='IfStatement'||check.test.name!==hit.id.name||returned?.type!=='ReturnStatement'||returned.argument?.name!==hit.id.name)return false;
 const sequence=last?.type==='ReturnStatement'?last.argument:undefined;
 if(sequence?.type!=='SequenceExpression'||sequence.expressions.length!==2||sequence.expressions[0]!==node)return false;
 if(node.type!=='CallExpression'||node.callee.type!=='MemberExpression'||node.callee.object.name!==name||
  node.callee.property.name!=='set'||node.arguments.length!==2||node.arguments[0].name!==get.arguments[0].name||
  node.arguments[1].type!=='Identifier'||sequence.expressions[1].name!==node.arguments[1].name)return false;
 return true;
}

function declarationDependencies(entry){
 if(entry.dependencies)return entry.dependencies;
 const ast=parse(entry.text,parseOptions);
 // Imports and ambient browser/process APIs are not part of the reviewed closure.
 // This is deliberately a source extractor, not an arbitrary JavaScript sandbox.
 visit(ast,node=>{
  if(node.type==='ImportExpression'||node.type==='MetaProperty'){
   const error=new Error(`unsupported ${node.type} in selected declaration`);
   error.code='unsupportedSyntax';error.dependency=node.type;
   throw error;
  }
 });
 const scope=analyze(ast,{ecmaVersion:2024,sourceType:'module'});
 entry.dependencies=[...new Set(scope.globalScope.through.map(reference=>reference.identifier.name))];
 return entry.dependencies;
}

/**
 * Compile trusted published game JavaScript into a minimal ESM declaration closure.
 * Does not execute input, load imports, write files, or make network requests.
 * Generated code contains original trusted declarations and is not sandboxed.
 */
export function compileGameFile(source,options={}){
 if(typeof source!=='string')throw invalid('source','expected JavaScript text');
 if(!options||typeof options!=='object'||Array.isArray(options))throw invalid('options','expected an object');
 const {symbols={},sourceVersion,sourceUrl}=options;
 if(!symbols||typeof symbols!=='object'||Array.isArray(symbols))throw invalid('symbols','expected an object');
 for(const [feature,symbol] of Object.entries(symbols)){
  if(!Object.hasOwn(featureSymbols,feature)||typeof symbol!=='string'||symbol.length===0){
   throw invalid('symbols',`unsupported feature or symbol ${feature}`);
  }
 }
 for(const [name,value] of Object.entries({sourceVersion,sourceUrl})){
  if(value!==undefined&&typeof value!=='string')throw invalid(name,'expected a string');
 }
 let ast;
 try{ast=parse(source,parseOptions);}catch(error){throw invalid('parse',error.message,error);}
 const {declarations,semanticExports,speedAnchors,owners}=indexDeclarations(ast,source);
 const effects=initializationEffects(ast,declarations,owners);
 const selected=new Set(),features={},diagnostics=[],resolved=[];
 for(const [feature,baseline] of Object.entries(featureSymbols)){
  const anchor=feature==='levelSpeedCoefficient'&&speedAnchors.size===1?[...speedAnchors][0]:undefined;
  const symbol=semanticExports.get(feature)??symbols[feature]??anchor??baseline;
  if(symbol===undefined)continue;
  // Collect independently: a failed root must not leak a partial closure into output.
  const closure=new Set();
  function collect(name){
   const entries=declarations.get(name);
   if(!entries){
    const error=new Error(`missing declaration ${name}`);
    error.code='missingDeclaration';error.dependency=name;throw error;
   }
   for(const entry of entries){
   if(closure.has(entry))continue;
   closure.add(entry);
   for(const dependency of declarationDependencies(entry)){
    if(declarations.has(dependency))collect(dependency);
    else if(!reviewedGlobals.has(dependency)){
     const error=new Error(`unreviewed external dependency ${dependency} in ${name}`);
     error.code='externalDependency';error.dependency=dependency;throw error;
    }
   }
   }
  }
  try{
   collect(symbol);
   for(const effect of effects){
    if(declarations.get(effect.name).some(entry=>closure.has(entry))&&!closure.has(effect.owner)&&
     !lazyMemoWrite(effect,closure,declarations,owners)){
     const error=new Error(`omitted initialization writes ${effect.name} at ${effect.start} (initializer ${effect.owner?.start??'statement'})`);
     error.code='externalInitialization';error.dependency=effect.name;throw error;
    }
   }
   for(const entry of closure)selected.add(entry);
   features[feature]=true;resolved.push([feature,symbol]);
  }catch(error){
   features[feature]=false;
   diagnostics.push({feature,symbol,code:error.code??'unsupportedDeclaration',message:error.message,
    ...(error.dependency?{dependency:error.dependency}:{})});
  }
 }
 const metadata={...(sourceVersion===undefined?{}:{sourceVersion}),...(sourceUrl===undefined?{}:{sourceUrl}),
  sha256:createHash('sha256').update(source).digest('hex')};
 let outputName='__dviCompiledGameFile';
 while(declarations.has(outputName))outputName+='_';
 const ordered=[...selected].sort((left,right)=>left.start-right.start);
 const members=resolved.map(([feature,symbol])=>`${JSON.stringify(feature)}: ${symbol}`);
 members.push(`source: ${JSON.stringify(metadata)}`);
 const code='// Generated from trusted game declarations; not a JavaScript sandbox.\n'+
  ordered.map(entry=>entry.text).join('\n')+`\nconst ${outputName} = {\n${members.join(',\n')}\n};\n`+
  `export { ${outputName} as gameFile };\nexport default ${outputName};\n`;
 return {code,features,diagnostics,source:metadata};
}

