import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
// @ts-ignore
import {JSDOM} from 'jsdom';
test('plugin persists the activity switch and reads getActiveTab only when enabled, without reconnecting',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'local-agent-activity-'));
 const dom=new JSDOM('',{url:'https://localhost'});
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,location:dom.window.location});window.siyuan={};
 try{
 const result=await build({stdin:{contents:"export {default as LocalAgent} from './src/index';export {Host} from 'siyuan';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false,external:['electron'],loader:{'.css':'empty'},plugins:[{name:'activity-host',setup(b){
  b.onResolve({filter:/^siyuan$/},()=>({path:'host',namespace:'fixture'}));
  b.onResolve({filter:/\/codex$/},()=>({path:'codex',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='host'?`
   export class Host{static tab;static reads=[];static saveError;}
   export class Plugin{data={};loadData(n){return Promise.resolve(structuredClone(this.data[n]));}async saveData(n,d){if(Host.saveError)return {code:-1,msg:Host.saveError};this.data[n]=structuredClone(d);return {code:0};}}
   export class Dialog{};export class Protyle{};
   export const showMessage=()=>{},getActiveEditor=()=>undefined,openTab=()=>{},getActiveTab=wndActive=>{Host.reads.push(wndActive);return Host.tab;};
  `:`
   export const expandPath=v=>v,defaults={cwd:'',model:'',activeTabContext:false,sandbox:'read-only',mcpEnabled:false},resolveBinary=()=>'',validateSettings=s=>s.cwd,threadOptions=s=>({cwd:s.cwd});
   export class CodexClient{alive=false;async start(){this.alive=true;}async request(method){if(method==='config/read')return {config:{model:'fixture'}};return {data:[]};}dispose(){this.alive=false;}}
  `}));
 }}]});
 const file=join(dir,'plugin.cjs');writeFileSync(file,result.outputFiles[0].contents);const {LocalAgent,Host}=createRequire(import.meta.url)(file);
 const plugin=new LocalAgent();plugin.data['settings.json']={cwd:dir};plugin.data['sessions.json']={sessions:[{id:'manual',cwd:dir,title:'Activity test',messages:[],workspaceMode:'manual'}]};await plugin.load();
 assert.equal(plugin.chat.currentActivity(),'');assert.equal(Host.reads.length,0);
 const chat=plugin.chat;chat.busy=true;await plugin.setActiveTabContext(true);assert.equal(plugin.chat,chat);assert.equal(chat.busy,true);assert.equal(plugin.data['settings.json'].activeTabContext,true);
 Host.tab={id:'active',title:'活动笔记',model:{editor:{protyle:{block:{rootID:'document'}}}}};assert.match(chat.currentActivity(),/活动笔记/);assert.deepEqual(Host.reads,[false]);
 const restored=new LocalAgent();restored.data=structuredClone(plugin.data);await restored.load();assert.equal(restored.activityMenuActions().activeTabContext(),true);assert.match(restored.chat.currentActivity(),/document/);
 Host.saveError='保存失败';await assert.rejects(plugin.setActiveTabContext(false),/保存失败/);assert.equal(plugin.activityMenuActions().activeTabContext(),true);Host.saveError=undefined;
 await plugin.setActiveTabContext(false);const reads=Host.reads.length;assert.equal(chat.currentActivity(),'');assert.equal(Host.reads.length,reads);assert.equal(plugin.data['settings.json'].activeTabContext,false);
 plugin.disposed=restored.disposed=true;plugin.chat.disconnect();restored.chat.disconnect();
 if(plugin.saveTimer)clearTimeout(plugin.saveTimer);if(restored.saveTimer)clearTimeout(restored.saveTimer);
 }finally{dom.window.close();rmSync(dir,{recursive:true,force:true});}
});
