import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,existsSync,mkdirSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
// @ts-ignore
import {JSDOM} from 'jsdom';
import {codexProjectlessRoot,sessionStandaloneDirectory,isStandaloneDirectory,prepareStandalone,matchingBinding,readBindings,standaloneDirectory,workspaceLocked} from '../src/workspaces';
import {newSession} from '../src/session';
const parent='20261001120000-parent1',child='20261001120100-child01',other='20261001120200-other01';
const tick=()=>new Promise(r=>setTimeout(r,0));
let dir:string,fixture:any;
before(async()=>{
 dir=mkdtempSync(join(tmpdir(),'local-agent-workspaces-'));
 const result=await build({stdin:{contents:"export {default as LocalAgent} from './src/index';export {Host} from 'siyuan';export {CodexClient} from './src/codex';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false,external:['electron'],loader:{'.css':'empty'},plugins:[{name:'workspace-host',setup(b){
  b.onResolve({filter:/^siyuan$/},()=>({path:'host',namespace:'fixture'}));
  b.onResolve({filter:/\/codex$/},()=>({path:'codex',namespace:'fixture'}));
  b.onResolve({filter:/^node:os$/},()=>({path:'os',namespace:'fixture'}));
  b.onResolve({filter:/\/native-composer$/},()=>({path:'native',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='host'?`
   export class Host{static active;static notices=[];}
   export class Plugin{data={};eventBus={on(){},off(){}};loadData(n){return Promise.resolve(structuredClone(this.data[n]));}async saveData(n,d){this.data[n]=structuredClone(d);}}
   export class Dialog{};export class Protyle{};export class ProtyleMethod{static highlightRender(){}};export const openTab=()=>{};
   export const showMessage=m=>Host.notices.push(m),getActiveEditor=()=>Host.active?{protyle:{block:{rootID:Host.active}}}:undefined,getActiveTab=()=>undefined;
  `:args.path==='os'?`export const homedir=()=>${JSON.stringify(dir)};`:args.path==='native'?`import {textareaComposer} from ${JSON.stringify(join(process.cwd(),'src/composer.ts'))};export const nativeComposer=()=>textareaComposer;`: `
   export const expandPath=v=>v;export const defaults={cwd:'',model:'',sandbox:'read-only',mcpEnabled:false},resolveBinary=()=>'',validateSettings=s=>s.cwd,threadOptions=s=>({cwd:s.cwd});
   export class CodexClient{alive=false;static calls=[];static desktop={};static turnGate;async start(s){this.alive=true;CodexClient.calls.push(s.cwd);}async request(method,p){if(method==='config/read')return{config:{model:'fixture-model',desktop:CodexClient.desktop}};if(method==='model/list')return{data:[]};if(method.startsWith('thread/'))return{thread:{id:'fixture-thread'},model:'fixture-model'};if(method==='turn/start'){await CodexClient.turnGate;return{turn:{id:'fixture-turn'}};}return{};}dispose(){this.alive=false;}}
  `,resolveDir:process.cwd()}));
 }}]});const file=join(dir,'plugin.cjs');writeFileSync(file,result.outputFiles[0].contents);fixture=createRequire(import.meta.url)(file);
});
after(()=>rmSync(dir,{recursive:true,force:true}));
function setup(){
 const dom=new JSDOM('<div id=app></div><button id=anchor></button>',{url:'https://localhost'});
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,location:dom.window.location,Element:dom.window.Element});window.siyuan={};fixture.Host.active=undefined;fixture.Host.notices=[];fixture.CodexClient.desktop={};fixture.CodexClient.turnGate=undefined;
 const plugin=new fixture.LocalAgent();plugin.chat=plugin.makeChat(newSession(''));plugin.data['settings.json']={cwd:process.cwd(),mcpEnabled:false};
 globalThis.fetch=async(_path,options)=>{const{id}=JSON.parse(options!.body as string);return new Response(JSON.stringify({code:0,data:{rootID:id,rootTitle:id===parent?'父文档':'子文档',path:(id===child?'/'+parent:'')+'/'+id+'.sy'}}));};
 return{plugin,dom,close(){plugin.disposed=true;plugin.chat.disconnect();plugin.popover?.close(false);if(plugin.saveTimer)clearTimeout(plugin.saveTimer);dom.window.close();}};
}
function editBinding(){
 document.querySelector<HTMLButtonElement>('.la-workspace-binding-actions button:last-child')!.click();
 return document.querySelector<HTMLInputElement>('[aria-label="文档绑定目录路径"]')!;
}
function fill(input:HTMLInputElement,value:string){input.value=value;input.dispatchEvent(new window.Event('input',{bubbles:true}));}
test('nearest document binding wins; malformed bindings are filtered and lock survives serialization',()=>{
 const bindings=[{docID:parent,title:'Parent',cwd:'/parent'},{docID:child,title:'Child',cwd:'/child'}];
 assert.equal(matchingBinding({id:child,title:'',ancestors:[parent,child]},bindings)?.cwd,'/child');
 assert.equal(matchingBinding({id:child,title:'',ancestors:[parent,child]},bindings.slice(0,1))?.cwd,'/parent');
 assert.equal(matchingBinding({id:other,title:'',ancestors:[other]},bindings),undefined);
 assert.equal(readBindings({bindings:[...bindings,{docID:'bad',title:'Bad',cwd:'/bad'}]}).length,2);
 const session=newSession('/tmp');assert.equal(workspaceLocked(session),false);assert.equal(workspaceLocked(session,true),true);
 session.workspaceLocked=true;assert.equal(workspaceLocked(JSON.parse(JSON.stringify(session))),true);
 assert.throws(()=>standaloneDirectory('../bad',dir));
});
test('new chats use Codex projectless folders; legacy chat keeps its directory',async()=>{
 const s=setup();try{await s.plugin.load();assert.deepEqual(fixture.Host.notices,[]);const first=s.plugin.chat.session;assert.equal(first.workspaceMode,'auto');assert.ok(first.cwd.startsWith(join(dir,'Documents','Codex')));assert.notEqual(first.cwd,process.cwd());assert.ok(existsSync(first.cwd));
 await s.plugin.fresh();assert.equal(s.plugin.chat.session.id,first.id);await s.plugin.chat.send('first question');s.plugin.chat.disconnect();
 await s.plugin.fresh();assert.notEqual(s.plugin.chat.session.cwd,first.cwd);assert.equal(s.plugin.data['settings.json'].cwd,process.cwd());
 const old=newSession(process.cwd());old.messages=[{id:'u',role:'user',text:'old'}];s.plugin.data['sessions.json']={active:old.id,sessions:[old]};await s.plugin.load();assert.equal(s.plugin.chat.session.cwd,process.cwd());assert.equal(s.plugin.chat.session.workspaceLocked,true);
 }finally{s.close();}
});
test('desktop preference chooses the root; local date and saved allocation survive reload and branches',()=>{
 const root=join(dir,'custom-codex');
 assert.equal(codexProjectlessRoot(undefined,dir),join(dir,'Documents','Codex'));
 assert.equal(codexProjectlessRoot({desktop:{projectlessWorkspaceRoot:root}},dir),root);
 assert.throws(()=>codexProjectlessRoot({desktop:{projectlessWorkspaceRoot:'relative'}},dir),/绝对路径/);
 assert.throws(()=>codexProjectlessRoot({desktop:{projectlessWorkspaceRoot:7}},dir),/绝对路径/);
 const cwd=standaloneDirectory('allocation',root,new Date(2026,9,2,0,1));assert.equal(cwd,join(root,'2026-10-02','siyuan-allocation'));
 const session=newSession(cwd);session.standalone={cwd,root};assert.equal(sessionStandaloneDirectory(JSON.parse(JSON.stringify(session)),root),cwd);
 const branch={...session,id:'new-branch-id'};prepareStandalone(branch);assert.ok(existsSync(cwd));
 assert.equal(isStandaloneDirectory(cwd,root),true);assert.equal(isStandaloneDirectory(root,root),false);assert.equal(isStandaloneDirectory(join(root,'..','elsewhere'),root),false);
});
test('projectless preparation refuses links and invalid allocation paths without creating outside the root',()=>{
 const root=join(dir,'directory-safety'),outside=join(dir,'not-created');mkdirSync(root);
 const invalid=newSession(outside);invalid.standalone={root,cwd:outside};assert.throws(()=>prepareStandalone(invalid),/无效/);assert.equal(existsSync(outside),false);
 const link=join(dir,'linked-root');symlinkSync(root,link,process.platform==='win32'?'junction':'dir');const session=newSession(standaloneDirectory('linked',link));session.standalone={root:link,cwd:session.cwd};assert.throws(()=>prepareStandalone(session),/符号链接/);
 assert.equal(existsSync(join(root,session.cwd.split(/[\\/]/).at(-2)!)),false);
});
test('custom desktop root refreshes before sending; default folders are not offered as document bindings',async()=>{
 const s=setup();try{
  fixture.CodexClient.desktop={projectlessWorkspaceRoot:join(dir,'custom-root')};await s.plugin.load();const first=s.plugin.chat.session;
  assert.equal(first.standalone.root,join(dir,'custom-root'));assert.ok(first.cwd.startsWith(first.standalone.root));
  fixture.Host.active=child;await s.plugin.workspaceMenu(document.getElementById('anchor')!);assert.match(document.querySelector('.la-workspace-session strong')!.textContent!,/Codex 无项目/);assert.equal(editBinding().value,'');
  const starts=fixture.CodexClient.calls.filter((cwd:string)=>cwd===dir).length;
  const secondRoot=join(dir,'changed-root');fixture.CodexClient.desktop={projectlessWorkspaceRoot:secondRoot};await s.plugin.followWorkspace(other,true);
  assert.equal(fixture.CodexClient.calls.filter((cwd:string)=>cwd===dir).length,starts,'config refresh must reuse the metadata process');
  assert.equal(first.standalone.root,secondRoot);assert.ok(existsSync(first.cwd));assert.equal(s.plugin.chat.settings.cwd,first.cwd);
  await s.plugin.chat.send('start');s.plugin.chat.busy=false;const pinned=first.cwd;fixture.CodexClient.desktop={projectlessWorkspaceRoot:join(dir,'later-root')};await s.plugin.followWorkspace(other,true);assert.equal(first.cwd,pinned);
  const client=s.plugin.standaloneProbe.client;s.plugin.onunload();assert.equal(client.alive,false);
 }finally{s.close();}
});
test('unstarted legacy auto chat adopts Codex folder but started legacy and manual chats stay pinned',async()=>{
 const s=setup();try{
  const blank=newSession(join(dir,'.siyuan-local-agent','workspaces','old-blank'));blank.workspaceMode='auto';blank.draft='keep draft';
  s.plugin.data['sessions.json']={active:blank.id,sessions:[blank]};await s.plugin.load();assert.ok(s.plugin.chat.session.cwd.startsWith(join(dir,'Documents','Codex')));assert.equal(s.plugin.chat.session.draft,'keep draft');
  const old=newSession(join(dir,'.siyuan-local-agent','workspaces','old-started'));old.workspaceMode='auto';old.threadId='old-thread';old.messages=[{id:'u',role:'user',text:'old'}];
  const manual=newSession(dir);manual.workspaceMode='manual';s.plugin.data['sessions.json']={active:old.id,sessions:[old,manual]};await s.plugin.load();assert.equal(s.plugin.chat.session.cwd,old.cwd);assert.equal(s.plugin.sessions.find((x:any)=>x.id===manual.id).cwd,dir);
 }finally{s.close();}
});
test('empty auto chat follows parent, closest override, unbound documents and manual selection; first send pins it',async()=>{
 const s=setup();try{await s.plugin.load();const standalone=s.plugin.chat.session.cwd;s.plugin.workspaceBindings=[{docID:parent,title:'Parent',cwd:dir}];
 fixture.Host.active=child;await s.plugin.followWorkspace(child);assert.equal(s.plugin.chat.settings.cwd,dir);assert.equal(s.plugin.chat.session.workspaceBinding,'Parent');
 s.plugin.workspaceBindings.push({docID:child,title:'Child',cwd:process.cwd()});await s.plugin.followWorkspace(child);assert.equal(s.plugin.chat.settings.cwd,process.cwd());
 await s.plugin.followWorkspace(other);assert.equal(s.plugin.chat.settings.cwd,standalone);
 s.plugin.setWorkspace(dir,'manual');await s.plugin.followWorkspace(child);assert.equal(s.plugin.chat.settings.cwd,dir);
 s.plugin.chat.session.workspaceMode='auto';await s.plugin.followWorkspace(child);assert.equal(s.plugin.chat.settings.cwd,process.cwd());
 assert.equal(await s.plugin.chat.send('hello'),true);assert.equal(s.plugin.chat.session.workspaceLocked,true);s.plugin.chat.busy=false;
 await s.plugin.followWorkspace(other);assert.equal(s.plugin.chat.settings.cwd,process.cwd());assert.throws(()=>s.plugin.setWorkspace(dir,'manual'),/固定/);
 s.plugin.persist();await s.plugin.saveQueue;const persisted=s.plugin.data['sessions.json'];s.plugin.data['sessions.json']=persisted;await s.plugin.load();await s.plugin.followWorkspace(other);assert.equal(s.plugin.chat.settings.cwd,process.cwd());
 }finally{s.close();}
});
test('late document lookup cannot override newer document, manual directory or sending chat',async()=>{
 const s=setup();try{await s.plugin.load();s.plugin.workspaceBindings=[{docID:parent,title:'Parent',cwd:dir}];const standalone=s.plugin.chat.session.cwd;
 let resolve!:(r:Response)=>void;globalThis.fetch=(_p,options)=>{const{id}=JSON.parse(options!.body as string);if(id===child)return new Promise(r=>resolve=r);return Promise.resolve(new Response(JSON.stringify({code:0,data:{rootID:id,path:'/'+id+'.sy'}})));};
 const slow=s.plugin.followWorkspace(child);await s.plugin.followWorkspace(other);resolve(new Response(JSON.stringify({code:0,data:{rootID:child,path:'/'+parent+'/'+child+'.sy'}})));await slow;assert.equal(s.plugin.chat.settings.cwd,standalone);
 const late=s.plugin.followWorkspace(child);s.plugin.workspaceEpoch++;s.plugin.setWorkspace(process.cwd(),'manual');resolve(new Response(JSON.stringify({code:0,data:{rootID:child,path:'/'+parent+'/'+child+'.sy'}})));await late;assert.equal(s.plugin.chat.settings.cwd,process.cwd());
 s.plugin.chat.session.workspaceMode='auto';const sending=s.plugin.followWorkspace(child);s.plugin.chat.busy=true;resolve(new Response(JSON.stringify({code:0,data:{rootID:child,path:'/'+parent+'/'+child+'.sy'}})));await sending;assert.equal(s.plugin.chat.settings.cwd,process.cwd());
 }finally{s.close();}
});
test('header menu persists document binding and removal; locked chats allow binding but reject directory switches',async()=>{
 const s=setup();try{await s.plugin.load();fixture.Host.active=child;const anchor=document.getElementById('anchor')!;await s.plugin.workspaceMenu(anchor);fill(editBinding(),dir);
 const bind=[...document.querySelectorAll<HTMLButtonElement>('.la-workspace-binding button')].find(b=>b.textContent==='绑定当前文档')!;bind.click();await tick();assert.equal(s.plugin.data['workspaces.json'].bindings[0].docID,child);assert.equal(s.plugin.chat.settings.cwd,dir);
 s.plugin.chat.session.workspaceLocked=true;await s.plugin.workspaceMenu(anchor);assert.equal(document.querySelector('[aria-label=工作目录路径]'),null);assert.equal(document.querySelector('.la-workspace-follow'),null);assert.equal(document.querySelector<HTMLButtonElement>('.la-workspace-binding-actions button:last-child')!.disabled,false);
 [...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='解除绑定')!.click();await tick();assert.equal(s.plugin.data['workspaces.json'].bindings.length,0);assert.equal(s.plugin.chat.settings.cwd,dir);
 }finally{s.close();}
});
test('sending refreshes the active document, blocks broken bindings and holds the directory during submission',async()=>{
 const s=setup();try{await s.plugin.load();s.plugin.app={};s.plugin.mount(document.getElementById('app')!);fixture.Host.active=child;
 s.plugin.workspaceBindings=[{docID:parent,title:'Parent',cwd:join(dir,'missing')}];
 await assert.rejects(s.plugin.view.actions.send('hello'),/自动选择失败/);assert.equal(s.plugin.chat.session.messages.length,0);assert.equal(s.plugin.workspacePreparing,false);
 s.plugin.workspaceBindings=[{docID:parent,title:'Parent',cwd:dir}];
 let release!:()=>void;fixture.CodexClient.turnGate=new Promise<void>(r=>release=r);
 globalThis.fetch=async(_path,options)=>{const{id}=JSON.parse(options!.body as string);return new Response(JSON.stringify({code:0,data:{rootID:id,path:'/'+parent+'/'+id+'.sy',rootTitle:'Child'}}));};
 const pending=s.plugin.view.actions.send('hello',[{id:child,title:'Child'}]);await tick();assert.equal(s.plugin.chat.settings.cwd,dir);assert.equal(s.plugin.workspacePreparing,true);
 fixture.Host.active=other;s.plugin.editorListener({detail:{protyle:{block:{rootID:other}}}});await tick();assert.equal(s.plugin.chat.settings.cwd,dir);
 release();assert.equal(await pending,true);assert.equal(s.plugin.chat.session.workspaceLocked,true);assert.equal(s.plugin.workspacePreparing,false);
 s.plugin.view.destroy();
 }finally{s.close();}
});
test('binding save rejection keeps the menu open, reports the error and preserves the previous binding',async()=>{
 const s=setup();try{await s.plugin.load();fixture.Host.active=child;s.plugin.saveData=async(name:string)=>name==='workspaces.json'?{code:-1,msg:'Binding storage rejected'}:undefined;
 await s.plugin.workspaceMenu(document.getElementById('anchor')!);fill(editBinding(),dir);const save=[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='绑定当前文档')!;save.click();await tick();assert.match(document.querySelector('[role=alert]')!.textContent!,/Binding storage rejected/);assert.equal(s.plugin.workspaceBindings.length,0);assert.equal(save.disabled,false);assert.equal(s.plugin.chat.session.workspaceBinding,undefined);
 }finally{s.close();}
});
test('binding draft is independent from the session picker; empty standalone bindings cannot be saved',async()=>{
 const s=setup();try{await s.plugin.load();fixture.Host.active=child;await s.plugin.workspaceMenu(document.getElementById('anchor')!);
 const sessionPath=document.querySelector<HTMLInputElement>('[aria-label=工作目录路径]')!;fill(sessionPath,dir);
 const input=editBinding();assert.equal(input.value,'');const save=[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='绑定当前文档')!;assert.equal(save.disabled,true);
 fill(input,process.cwd());input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));await tick();assert.equal(s.plugin.workspaceBindings.length,0);
 input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await tick();assert.equal(s.plugin.workspaceBindings[0].cwd,process.cwd());assert.equal(s.plugin.chat.settings.cwd,process.cwd());
 }finally{s.close();}
});
test('removing a direct binding restores parent inheritance and keyboard focus skips collapsed fields',async()=>{
 const s=setup();try{await s.plugin.load();fixture.Host.active=child;s.plugin.workspaceBindings=[{docID:parent,title:'父项目',cwd:dir},{docID:child,title:'子项目',cwd:process.cwd()}];await s.plugin.followWorkspace(child);
 const anchor=document.getElementById('anchor')!;await s.plugin.workspaceMenu(anchor);const unbind=[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='解除绑定')!;assert.match(unbind.title,/父项目/);unbind.click();await tick();assert.equal(s.plugin.chat.settings.cwd,dir);
 s.plugin.chat.session.workspaceLocked=true;await s.plugin.workspaceMenu(anchor);assert.match(document.querySelector('.la-workspace-document')!.textContent!,/继承绑定/);assert.match(document.querySelector('.la-workspace-binding')!.textContent!,/来自「父项目」/);assert.equal([...document.querySelectorAll('button')].some(b=>b.textContent==='解除绑定'),false);
 const input=editBinding();assert.equal(input.value,dir);input.focus();input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));assert.equal(document.activeElement?.getAttribute('aria-label'),'浏览文档绑定目录');
 [...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='取消')!.click();assert.equal(document.activeElement?.textContent,'单独绑定…');
 document.activeElement!.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));assert.equal(document.activeElement?.tagName,'SUMMARY');
 }finally{s.close();}
});

test('selected note text reaches the send prompt, survives rejection, and clears after acceptance',async()=>{
 const env=setup(),{plugin}=env;try{
  await plugin.load();plugin.ready=Promise.resolve();plugin.mount(document.getElementById('app'));
  const note=document.createElement('div');note.className='protyle-wysiwyg';note.textContent='所选笔记正文 <reference>';document.body.append(note);
  const range=document.createRange();range.selectNodeContents(note);window.getSelection()!.removeAllRanges();window.getSelection()!.addRange(range);document.dispatchEvent(new window.Event('mouseup'));
  assert.equal(plugin.attachments.length,1);let accepted=false,prompt='';plugin.chat.send=async(text:string)=>{prompt=text;return accepted;};
  plugin.view.input.value='解释选文';await plugin.view.submit();assert.ok(prompt.includes('所选笔记正文 \\u003creference\\u003e'));assert.equal(plugin.attachments.length,1);assert.equal(plugin.view.input.value,'解释选文');
  accepted=true;await plugin.view.submit();assert.equal(plugin.attachments.length,0);assert.equal(plugin.view.input.value,'');assert.equal(document.querySelector<HTMLElement>('.la-selection-context')!.hidden,true);
 }finally{plugin.view?.destroy();env.close();}
});

test('host content menu snapshots a note selection and adds it only on explicit click',async()=>{
 const env=setup(),{plugin}=env;try{
  await plugin.load();plugin.ready=Promise.resolve();plugin.mount(document.getElementById('app'));
  const note=document.createElement('div');note.className='protyle-wysiwyg';note.textContent='手动引用的原文';document.body.append(note);
  const range=document.createRange();range.selectNodeContents(note);let entry:any;
  plugin.selectionMenuListener({detail:{range,menu:{addItem:(item:any)=>{entry=item;}}}});
  assert.equal(entry.label,'添加到 Codex');assert.equal(plugin.attachments.length,0);
  window.getSelection()!.removeAllRanges();entry.click();assert.equal(plugin.attachments.length,1);assert.equal(plugin.attachments[0].selectionMode,'manual');assert.equal(plugin.attachments[0].text,'手动引用的原文');
  entry.click();assert.equal(plugin.attachments.length,1);
 }finally{plugin.view?.destroy();env.close();}
});
