// @ts-ignore
import {JSDOM} from 'jsdom';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
// Exercise the real plugin methods against SiYuan's unusual Menu.isOpen contract.
test('popover models and slider save selections; closed requests and outside clicks clean up',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'local-agent-menu-'));
 try{
 const result=await build({stdin:{contents:`export {default as LocalAgent} from './src/index';export {CodexClient} from './src/codex';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false,external:['electron'],loader:{'.css':'empty'},plugins:[{name:'host-contract',setup(b){
 b.onResolve({filter:/^siyuan$/},()=>({path:'host',namespace:'fixture'}));
 b.onResolve({filter:/\/codex$/},()=>({path:'codex',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='host'?`
 export class Plugin{};export class Dialog{};export class Protyle{};export class ProtyleMethod{static highlightRender(){}};
 export const showMessage=()=>{},getActiveEditor=()=>{},getActiveTab=()=>{},openTab=()=>{};
 export class Menu {
 static latest;isOpen=false;items=[];opens=0;
 constructor(id,close){this.closeCB=close;Menu.latest=this;}
 addItem(item){this.items.push(item);}addSeparator(){}open(){this.opens++;}close(){this.closeCB?.();}
 }
 `:`
 export const expandPath=v=>v;export const defaults={},resolveBinary=()=>'',validateSettings=()=>{},threadOptions=()=>({});
 export class CodexClient {static response;static calls=0;async start(){}request(){CodexClient.calls++;return CodexClient.response;}dispose(){}}
 `}));
 }}]});
 const file=join(dir,'fixture.cjs');writeFileSync(file,result.outputFiles[0].contents);const dom=new JSDOM('<button id=anchor></button>',{url:'https://localhost'});Object.assign(globalThis,{window:dom.window,document:dom.window.document});const {LocalAgent,CodexClient}=createRequire(import.meta.url)(file);
 const plugin=new LocalAgent();plugin.chat={busy:false,resolvedModel:'actual-model'};plugin.settings={model:''};plugin.chat.settings=plugin.settings;const changes:any[]=[];plugin.applyQuickSetting=async(p:any)=>{changes.push(p);Object.assign(plugin.settings,p);};
 const anchor=document.getElementById('anchor')!;
 let resolve!:(v:any)=>void;CodexClient.response=new Promise(r=>resolve=r);
 const pending=plugin.modelMenu(anchor);await Promise.resolve();assert.match(document.body.textContent!,/正在读取/);
 resolve({data:[{model:'actual-model',displayName:'Actual Model',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'medium'}],defaultReasoningEffort:'medium'}]});await pending;
 assert.ok(document.querySelector('input[type=range]'));document.querySelector<HTMLButtonElement>('[aria-label=选择模型]')!.click();const model=document.querySelector<HTMLButtonElement>('[role=menuitemradio]')!;assert.equal(model.getAttribute('aria-checked'),'true');model.click();await new Promise(r=>setTimeout(r,0));
 assert.equal(changes[0].model,'actual-model');const slider=document.querySelector<HTMLInputElement>('input[type=range]')!;assert.ok(slider);slider.value='0';slider.dispatchEvent(new dom.window.Event('change'));await new Promise(r=>setTimeout(r,0));assert.equal(changes.at(-1).reasoningEffort,'low');document.querySelector<HTMLButtonElement>('[aria-label=快速模式]')!.click();await new Promise(r=>setTimeout(r,0));assert.equal(changes.at(-1).fastMode,true);document.querySelector<HTMLButtonElement>('[aria-label=恢复默认]')!.click();await new Promise(r=>setTimeout(r,0));assert.equal(changes.at(-1).fastMode,false);assert.equal(changes.at(-1).reasoningEffort,'medium');
 plugin.popover.close();const calls=CodexClient.calls;await plugin.modelMenu(anchor);assert.equal(CodexClient.calls,calls);assert.ok(document.querySelector('input[type=range]'));assert.doesNotMatch(document.body.textContent!,/正在读取/);plugin.popover.close();plugin.chat.settings.cwd='/different-workspace';CodexClient.response=new Promise(r=>resolve=r);const late=plugin.modelMenu(anchor);await Promise.resolve();plugin.popover.close();resolve({data:[{model:'late-model'}]});await late;assert.equal(document.querySelector('.la-popover'),null);
 plugin.permissionMenu(anchor);const modes=[...document.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]')];assert.equal(modes.length,3);assert.ok(modes[2].classList.contains('la-danger'));modes[1].click();await new Promise(r=>setTimeout(r,0));assert.equal(changes.at(-1).permissionMode,'auto');assert.equal(document.querySelector('.la-popover'),null);
 plugin.permissionMenu(anchor);document.body.dispatchEvent(new dom.window.Event('pointerdown',{bubbles:true}));assert.equal(document.querySelector('.la-popover'),null);plugin.permissionMenu(anchor);document.querySelector('.la-popover')!.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(document.querySelector('.la-popover'),null);assert.equal(document.activeElement,anchor);
 plugin.settings={permissionMode:'ask'};plugin.chat.settings={permissionMode:'full'};plugin.permissionMenu(anchor);assert.match(document.querySelector('[aria-checked=true]')!.textContent!,/完全访问权限/);plugin.applyQuickSetting=async()=>{throw Error('save failed');};document.querySelector<HTMLButtonElement>('[role=menuitemradio]')!.click();await new Promise(r=>setTimeout(r,0));assert.match(document.querySelector('[role=alert]')!.textContent!,/save failed/);assert.equal(document.querySelector<HTMLButtonElement>('[role=menuitemradio]')!.disabled,false);plugin.popover.close();dom.window.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
