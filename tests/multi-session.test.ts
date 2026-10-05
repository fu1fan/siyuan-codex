import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,mkdirSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
// @ts-ignore
import {JSDOM} from 'jsdom';
import {newSession} from '../src/session';
import {sessionSummary,isUnstarted} from '../src/session-state';
const tick=()=>new Promise(r=>setTimeout(r,0));
let dir:string,fixture:any;
before(async()=>{
 dir=mkdtempSync(join(tmpdir(),'local-agent-multi-session-'));
 const result=await build({stdin:{contents:"export {default as LocalAgent} from './src/index';export {Host} from 'siyuan';export {CodexClient} from './src/codex';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false,external:['electron'],loader:{'.css':'empty'},plugins:[{name:'multi-session-host',setup(b){
  b.onResolve({filter:/^siyuan$/},()=>({path:'host',namespace:'fixture'}));
  b.onResolve({filter:/\/codex$/},()=>({path:'codex',namespace:'fixture'}));
  b.onResolve({filter:/\/cli-diagnostics$/},()=>({path:'diagnostics',namespace:'fixture'}));
  b.onResolve({filter:/^node:os$/},()=>({path:'os',namespace:'fixture'}));
  b.onResolve({filter:/\/native-composer$/},()=>({path:'native',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='host'?`
   export class Host{static notices=[];static topBars=[];static docks=[];static commands=[];static checks=[];}
   export class Plugin{data={};eventBus={on(){},off(){}};addIcons(){}addDock(o){Host.docks.push(o);}addTopBar(o){Host.topBars.push(o);}addCommand(o){Host.commands.push(o);}loadData(n){return Promise.resolve(structuredClone(this.data[n]??''));}async saveData(n,d){this.data[n]=structuredClone(d);}}
   export class Dialog{constructor(o){this.options=o;this.element=document.createElement('div');this.element.innerHTML=o.content;document.body.append(this.element);}destroy(){if(this.closed)return;this.closed=true;this.options.destroyCallback?.();this.element.remove();}}
   export class Protyle{};export class ProtyleMethod{static highlightRender(){}};export const openTab=()=>{},showMessage=m=>Host.notices.push(m),getActiveEditor=()=>undefined,getActiveTab=()=>undefined;
  `:args.path==='diagnostics'?`
   import {Host} from 'siyuan';
   export const initialChecks=()=>['path','version','connection','account'].map(id=>({id,state:'waiting',detail:'等待检测'}));
   export async function detectCli(value){Host.checks.push(value);return{binary:value||'/fixture/codex',connected:true,checks:initialChecks().map(c=>({...c,state:'success',detail:'fixture'}))};}
  `:args.path==='os'?`export const homedir=()=>${JSON.stringify(dir)};`:args.path==='native'?`import {textareaComposer} from ${JSON.stringify(join(process.cwd(),'src/composer.ts'))};export const nativeComposer=()=>textareaComposer;`: `
   export const expandPath=v=>v,defaults={cwd:'',model:'',sandbox:'read-only',mcpEnabled:false},resolveBinary=()=>'',validateSettings=s=>s.cwd,threadOptions=s=>({cwd:s.cwd});
   export class CodexClient{
    static seq=0;static history=[];static requests=[];static readDelay;static failTurn=false;id=++CodexClient.seq;alive=false;calls=[];responses=[];disposals=0;turns=0;
    async start(s){this.alive=true;this.settings=structuredClone(s);}
    async request(method,p){this.calls.push({method,p});CodexClient.requests.push({method,p});if(this.delay&&method==='turn/start')await this.delay;
     if(method==='thread/list')return{data:CodexClient.history.filter(t=>!!t.archived===!!p.archived&&(!p.searchTerm||t.name.includes(p.searchTerm))),nextCursor:null};
     if(method==='thread/read'){if(CodexClient.readDelay)await CodexClient.readDelay;return{thread:CodexClient.history.find(t=>t.id===p.threadId)};}
     if(method==='thread/turns/list')return{data:CodexClient.history.find(t=>t.id===p.threadId)?.turns||[],nextCursor:null};
     if(method==='turn/start'&&CodexClient.failTurn)throw Error('send rejected');
     if(method==='config/read')return{config:{model:'fixture'}};if(method==='model/list')return{data:[]};
     if(method==='thread/start'||method==='thread/resume')return{thread:{id:p.threadId||'thread-'+this.id},model:this.settings.model||'fixture'};
     if(method==='thread/fork')return{thread:{id:'fork-'+this.id}};
     if(method==='turn/start'){const id='turn-'+(++this.turns);this.onEvent?.({method:'turn/started',params:{turn:{id}}});return{turn:{id}};}
     if(method==='turn/interrupt'){this.onEvent?.({method:'turn/completed',params:{turn:{id:'turn-'+this.turns,status:'interrupted'}}});}return{};
    }
    respond(id,result){this.responses.push({id,result});}reject(){}
    dispose(){this.disposals++;this.alive=false;}emit(method,params,id){this.onEvent({method,params,...(id===undefined?{}:{id})});}
   }
  `,resolveDir:process.cwd()}));
 }}]});const file=join(dir,'plugin.cjs');writeFileSync(file,result.outputFiles[0].contents);fixture=createRequire(import.meta.url)(file);
});
after(()=>rmSync(dir,{recursive:true,force:true}));
async function setup(){
 const dom=new JSDOM('<div id="app"></div>',{url:'https://localhost'});Object.assign(globalThis,{window:dom.window,document:dom.window.document,location:dom.window.location,Element:dom.window.Element,HTMLInputElement:dom.window.HTMLInputElement});window.siyuan={};fixture.Host.notices=[];
 const plugin=new fixture.LocalAgent();plugin.app={};plugin.data['settings.json']={cwd:dir,mcpEnabled:false};
 const a=newSession(dir,{model:'model-a'}),b=newSession(dir,{model:'model-b'});a.title='会话 A';b.title='会话 B';a.workspaceMode=b.workspaceMode='manual';
 plugin.data['sessions.json']={active:a.id,sessions:[a,b]};await plugin.load();plugin.mount(document.getElementById('app')!);await tick();
 return{plugin,dom,a:plugin.chat,b:plugin.sessions[1],close(){plugin.onunload();dom.window.close();}};
}
test('switching and creating chats keep concurrent transports, queues and approvals independent; background outcomes persist',async()=>{
 const s=await setup();const {plugin,a,b}=s;
 try{
  const view=plugin.view;view.input.value='A 草稿';plugin.attachments=[{title:'A 附件',text:'attachment-a'}];await a.send('A 第一问');a.enqueue('A 排队');const ca=a.client;
  document.querySelector<HTMLButtonElement>(`.la-session-tab[data-session-id="${b.id}"]`)!.click();const chatB=plugin.chat;view.input.value='B 草稿';plugin.attachments=[{title:'B 附件',text:'attachment-b'}];await chatB.send('B 第一问');const cb=chatB.client;
  assert.notEqual(ca,cb);assert.equal(ca.alive,true);assert.equal(ca.disposals,0);assert.equal(a.busy,true);assert.equal(chatB.busy,true);assert.equal(chatB.resolvedModel,'model-b');
  plugin.selectSession(a.session.id);assert.equal(plugin.chat,a);assert.equal(view.input.value,'A 草稿');assert.equal(plugin.attachments[0].title,'A 附件');assert.equal(a.session.queue.length,1);
  plugin.selectSession(b.id);assert.equal(plugin.chat,chatB);assert.equal(view.input.value,'B 草稿');assert.equal(plugin.attachments[0].title,'B 附件');
  const approval={threadId:a.session.threadId,command:'approval-a'};ca.emit('item/commandExecution/requestApproval',approval,7);cb.emit('item/commandExecution/requestApproval',{threadId:b.threadId,command:'approval-b'},7);
  assert.equal(a.session.unread,true);assert.match(document.querySelector('.la-approvals')!.textContent!,/approval-b/);assert.match(document.querySelector(`.la-session-tab[data-session-id="${a.session.id}"]`)!.getAttribute('aria-label')!,/待确认/);
  plugin.selectSession(a.session.id);assert.equal(a.session.unread,false);assert.match(document.querySelector('.la-approvals')!.textContent!,/approval-a/);
  [...document.querySelectorAll<HTMLButtonElement>('.la-approvals button')].find(b=>b.textContent==='拒绝')!.click();assert.deepEqual(ca.responses,[{id:7,result:{decision:'decline'}}]);assert.equal(cb.responses.length,0);
  plugin.selectSession(b.id);await plugin.fresh();const fresh=plugin.chat;assert.notEqual(fresh,a);assert.notEqual(fresh,chatB);assert.equal(ca.alive,true);assert.equal(cb.alive,true);
  ca.emit('item/agentMessage/delta',{threadId:a.session.threadId,itemId:'same',delta:'answer-a'});cb.emit('item/agentMessage/delta',{threadId:b.threadId,itemId:'same',delta:'answer-b'});
  assert.equal(a.session.messages.find((m:any)=>m.id==='same').text,'answer-a');assert.equal(b.messages.find((m:any)=>m.id==='same').text,'answer-b');assert.equal(fresh.session.messages.length,0);
  ca.emit('turn/completed',{turn:{id:a.turnId,status:'completed'}});await tick();assert.equal(a.session.messages.at(-1).text,'A 排队');assert.equal(a.busy,true);assert.equal(a.session.queue.length,0);
  plugin.selectSession(b.id);document.querySelector<HTMLButtonElement>('[aria-label="停止生成"]')!.click();await tick();assert.equal(chatB.busy,false);assert.equal(a.busy,true);assert.equal(ca.alive,true);assert.equal(b.lastOutcome,'stopped');
  plugin.deleteSession(a.session.id);assert.ok(plugin.sessions.includes(a.session));assert.match(fixture.Host.notices.at(-1),/终止 Agent/);
  // Deleting an idle chat must remain available while a different chat runs.
  plugin.selectSession(a.session.id);plugin.deleteSession(fresh.session.id);assert.equal(plugin.sessions.includes(fresh.session),false);assert.equal(a.busy,true);
  plugin.selectSession(b.id);ca.emit('turn/completed',{turn:{id:a.turnId,status:'completed'}});assert.equal(a.session.unread,true);
  const completedTab=document.querySelector<HTMLButtonElement>(`.la-session-tab[data-session-id="${a.session.id}"]`)!;assert.equal(completedTab.textContent,a.session.title);assert.equal(completedTab.children.length,2);assert.equal(completedTab.firstElementChild!.className,'la-session-dot');assert.equal(completedTab.dataset.state,'completed');assert.equal(completedTab.dataset.unread,'true');assert.match(completedTab.getAttribute('aria-label')!,/已完成.*未读/);
  plugin.persist();await plugin.saveQueue;const stored=plugin.data['sessions.json'].sessions.find((x:any)=>x.id===a.session.id);assert.equal(stored.unread,true);assert.equal(stored.draft,'A 草稿');assert.equal(stored.draftAttachments[0].title,'A 附件');
  const restored=new fixture.LocalAgent();restored.data=structuredClone(plugin.data);await restored.load();assert.equal(restored.sessions.find((x:any)=>x.id===a.session.id).unread,true);assert.equal(restored.chat.busy,false);restored.onunload();
  plugin.selectSession(a.session.id);assert.equal(a.session.unread,false);assert.equal(document.querySelector<HTMLButtonElement>(`.la-session-tab[data-session-id="${a.session.id}"]`)!.dataset.unread,'false');plugin.onunload();assert.equal(ca.alive,false);assert.equal(cb.alive,false);
 }finally{if(!plugin.disposed)s.close();else s.dom.window.close();}
});
test('late sends cannot clear another chat with identical draft text; side windows reuse their running chat after closing',async()=>{
 const s=await setup();const {plugin,a,b}=s;try{
  await a.connect();let release!:()=>void;a.client.delay=new Promise<void>(r=>release=r);plugin.view.input.value='相同草稿';document.querySelector<HTMLButtonElement>('[aria-label="发送 · Enter"]')!.click();await tick();
  plugin.selectSession(b.id);plugin.view.input.value='相同草稿';const send=document.querySelector<HTMLButtonElement>('[aria-label="发送 · Enter"]')!;assert.equal(send.disabled,false);release();await tick();assert.equal(plugin.view.input.value,'相同草稿');assert.equal(a.session.draft,'');assert.equal(b.messages.length,0);
  a.enqueue('侧边问答');plugin.selectSession(a.session.id);plugin.openQueueSide(a.session.queue[0].id);const sideID=plugin.sessions[0].id,side=plugin.chats.get(sideID),dialog=plugin.sideViews.get(sideID).dialog;
  side.pauseQueue(false);await tick();assert.equal(side.busy,true);const client=side.client;plugin.sideViews.get(sideID).view.input.value='侧边草稿';dialog.destroy();assert.equal(client.alive,true);assert.equal(side.busy,true);
  plugin.selectSession(sideID);assert.equal(plugin.chat,side);assert.equal(plugin.view.input.value,'侧边草稿');assert.equal(plugin.chats.get(sideID),side);assert.equal(client.disposals,0);
  // A model change in an idle chat never disconnects either background turn.
  plugin.selectSession(b.id);await plugin.applyQuickSetting({model:'new-b'});assert.equal(client.alive,true);assert.equal(a.client.alive,true);assert.equal(plugin.chat.settings.model,'new-b');
 }finally{s.close();}
});
test('summary prioritizes approval, execution, errors and paused queues without reviving jobs on reload',()=>{
 const session=newSession('/tmp');session.lastOutcome='completed';session.unread=true;assert.equal(sessionSummary(session).state,'completed');
 session.queue=[{id:'q',text:'q',displayText:'q'}];assert.equal(sessionSummary(session).state,'queued');session.lastOutcome='error';assert.equal(sessionSummary(session).state,'error');
 const chat:any={busy:true,requests:new Map()};assert.equal(sessionSummary(session,chat).state,'running');chat.requests.set('1',{});assert.equal(sessionSummary(session,chat).state,'waiting');assert.equal(sessionSummary(session,chat).queueCount,1);
 const blank=newSession('/tmp'),idle:any={busy:false,requests:new Map()};blank.draft='draft';blank.draftAttachments=[{title:'note',text:'content'}];assert.equal(isUnstarted(blank,idle),true);
 idle.busy=true;assert.equal(isUnstarted(blank,idle),false);idle.busy=false;idle.requests.set('1',{});assert.equal(isUnstarted(blank,idle),false);idle.requests.clear();
 blank.queue=[{id:'q',text:'q',displayText:'q'}];assert.equal(isUnstarted(blank,idle),false);blank.queue=[];blank.threadId='existing-thread';assert.equal(isUnstarted(blank,idle),false);blank.threadId=undefined;blank.messages.push({id:'u',role:'user',text:'sent'});assert.equal(isUnstarted(blank,idle),false);
});

test('repeated new-chat clicks reuse the unsent draft and attachments without stopping background turns',async()=>{
 const s=await setup();const {plugin,a,b}=s;try{
  await a.send('A 运行中');b.messages.push({id:'b-user',role:'user',text:'B 已开始'});plugin.view.update();const client=a.client,count=plugin.sessions.length;
  await Promise.all([plugin.fresh(),plugin.fresh(),plugin.fresh()]);const blank=plugin.chat;assert.equal(plugin.sessions.length,count+1);assert.equal(isUnstarted(blank.session,blank),true);
  plugin.view.input.value='尚未发送的草稿';plugin.attachments=[{title:'未发送附件',text:'attachment'}];plugin.selectSession(a.session.id);
  const create=document.querySelector<HTMLButtonElement>('.la-head [aria-label="新对话"]')!;create.click();create.click();create.click();await tick();
  assert.equal(plugin.chat,blank);assert.equal(plugin.view.input.value,'尚未发送的草稿');assert.equal(plugin.attachments[0].title,'未发送附件');assert.equal(plugin.sessions.length,count+1);assert.equal(a.busy,true);assert.equal(client.alive,true);
  assert.equal(await blank.send('新会话的第一问'),true);await plugin.fresh();assert.notEqual(plugin.chat,blank);assert.equal(blank.busy,true);assert.equal(blank.client.alive,true);assert.equal(plugin.sessions.filter((session:any)=>isUnstarted(session,plugin.chats.get(session.id))).length,1);
  plugin.persist();await plugin.saveQueue;assert.equal(plugin.data['sessions.json'].active,plugin.chat.session.id);
 }finally{s.close();}
});

test('loading old blank placeholders keeps the active slot while preserving drafts, configured chats and history',async()=>{
 const s=await setup();const {plugin}=s;try{
  const first=plugin.emptySession(),second=plugin.emptySession(),active=plugin.emptySession(),draft=plugin.emptySession(),manual=plugin.emptySession(),started=plugin.emptySession();
  active.draft='当前草稿';active.draftAttachments=[{title:'当前附件',text:'content'}];draft.draft='旧草稿';manual.workspaceMode='manual';manual.cwd=dir;started.messages=[{id:'u',role:'user',text:'历史'}];
  plugin.data['sessions.json']={active:active.id,sessions:[first,second,active,draft,manual,started]};await plugin.load();await plugin.saveQueue;
  assert.equal(plugin.chat.session.id,active.id);assert.deepEqual(plugin.sessions.map((session:any)=>session.id),[active.id,draft.id,manual.id,started.id]);assert.equal(plugin.view.input.value,'当前草稿');assert.equal(plugin.attachments[0].title,'当前附件');assert.equal(plugin.sessions.find((session:any)=>session.id===draft.id).draft,'旧草稿');assert.equal(plugin.sessions.find((session:any)=>session.id===manual.id).cwd,dir);
  const stored=plugin.data['sessions.json'];assert.equal(stored.sessions.length,4);await plugin.fresh();assert.equal(plugin.chat.session.id,active.id);assert.equal(plugin.sessions.length,4);
 }finally{s.close();}
});

test('idle tabs with history or drafts delete immediately, including the final connected chat',async()=>{
 const s=await setup();const {plugin,a,b}=s;try{
  a.session.messages.push({id:'u',role:'user',text:'已完成记录'});await a.connect();const client=a.client;b.draft='未发送草稿';plugin.view.update();
  const remove=(id:string)=>document.querySelector<HTMLButtonElement>(`.la-session-item[data-session-id="${id}"] .la-session-remove`)!;
  assert.equal(document.querySelector('.la-session-strip button button'),null);
  remove(b.id).click();assert.equal(plugin.chat,a);assert.equal(plugin.sessions.length,1);assert.equal(client.alive,true);assert.equal(document.querySelector<HTMLElement>('.la-session-delete-confirm')!.hidden,true);
  remove(a.session.id).click();assert.equal(plugin.sessions.length,1);assert.notEqual(plugin.chat,a);assert.equal(isUnstarted(plugin.chat.session,plugin.chat),true);assert.equal(client.alive,false);assert.equal(plugin.chats.has(a.session.id),false);assert.equal(document.querySelectorAll('.la-session-item').length,1);
  await plugin.saveQueue;assert.equal(plugin.data['sessions.json'].active,plugin.chat.session.id);assert.equal(plugin.data['sessions.json'].sessions.length,1);
 }finally{s.close();}
});
test('running and waiting tabs confirm termination, cancellation preserves work, and deletion isolates other agents',async()=>{
 const s=await setup();const {plugin,a,b}=s;try{
  await a.send('运行 A');a.enqueue('A 待发送');const ca=a.client;plugin.selectSession(b.id);const chatB=plugin.chat;await chatB.send('运行 B');const cb=chatB.client;
  cb.emit('item/commandExecution/requestApproval',{threadId:b.threadId,command:'B 确认'},7);
  const remove=(id:string)=>document.querySelector<HTMLButtonElement>(`.la-session-item[data-session-id="${id}"] .la-session-remove`)!;
  const prompt=()=>document.querySelector<HTMLElement>('.la-session-delete-confirm')!;
  assert.equal(remove(a.session.id).disabled,false);remove(a.session.id).click();assert.equal(prompt().hidden,false);assert.match(prompt().textContent!,/删除.*会终止 Agent 工作/);assert.equal(plugin.chat,chatB);assert.equal(ca.alive,true);
  document.querySelector<HTMLButtonElement>('.la-session-delete-cancel')!.click();assert.equal(prompt().hidden,true);assert.equal(document.activeElement,remove(a.session.id));assert.equal(a.busy,true);assert.equal(ca.alive,true);
  remove(a.session.id).click();document.querySelector<HTMLButtonElement>('.la-session-delete-confirm button')!.click();assert.equal(ca.alive,false);assert.equal(a.busy,false);assert.equal(a.session.queuePaused,true);assert.equal(plugin.chats.has(a.session.id),false);assert.equal(cb.alive,true);assert.equal(chatB.busy,true);assert.equal(chatB.requests.size,1);
  ca.emit('turn/completed',{turn:{id:'late',status:'completed'}});await tick();assert.equal(ca.calls.filter((call:any)=>call.method==='turn/start').length,1);
  assert.equal(remove(b.id).disabled,false);remove(b.id).click();assert.match(prompt().textContent!,/会终止 Agent 工作/);document.querySelector<HTMLButtonElement>('.la-session-delete-confirm button')!.click();assert.equal(cb.alive,false);assert.equal(chatB.requests.size,0);assert.equal(plugin.sessions.length,1);assert.notEqual(plugin.chat,chatB);
 }finally{s.close();}
});
test('history deletion uses the same idle and running rules as tabs',async()=>{
 const s=await setup();const {plugin,a,b}=s;try{
  a.session.messages.push({id:'u',role:'user',text:'历史记录'});await a.send('后台运行');plugin.selectSession(b.id);plugin.view.update();
  document.querySelector<HTMLButtonElement>('.la-history-trigger')!.click();
  document.querySelector<HTMLButtonElement>(`.la-history-row[data-session-id="${a.session.id}"] [aria-label="删除对话"]`)!.click();assert.equal(document.querySelector<HTMLElement>('.la-session-delete-confirm')!.hidden,false);document.querySelector<HTMLButtonElement>('.la-session-delete-cancel')!.click();assert.equal(a.busy,true);
  document.querySelector<HTMLButtonElement>(`.la-history-row[data-session-id="${b.id}"] [aria-label="删除对话"]`)!.click();assert.equal(plugin.sessions.length,1);assert.equal(plugin.chat,a);assert.equal(a.busy,true);assert.equal(document.querySelector<HTMLElement>('.la-session-delete-confirm')!.hidden,true);
 }finally{s.close();}
});
test('rebranded plugin migrates missing legacy data, enforces the current kernel, and keeps existing new data',async()=>{
 const s=await setup();const workspace=mkdtempSync(join(dir,'legacy-workspace-'));try{
  const storage=join(workspace,'data/storage/petal/siyuan-local-agent');mkdirSync(storage,{recursive:true});
  const files={
   'settings.json':{cwd:dir,binary:'/explicit/codex',mcpEnabled:false,mcpUrl:'https://other-workspace/mcp',newSessionModelMode:'cli',instructions:'保留偏好'},
   'sessions.json':{active:'legacy',sessions:[{id:'legacy',title:'旧对话',cwd:dir,workspaceMode:'manual',threadId:'saved-thread',draft:'旧草稿',messages:[{id:'u',role:'user',text:'旧记录',attachments:[{title:'旧附件',text:'',media:{key:'old',kind:'file',marker:'旧附件',path:join(storage,'attachments/old.pdf')}}]}]}]},
   'workspaces.json':{bindings:[{docID:'20261001000000-abcdefg',title:'绑定',cwd:dir}]}
  };for(const [name,data]of Object.entries(files))writeFileSync(join(storage,name),JSON.stringify(data));
  window.siyuan={config:{system:{workspaceDir:workspace}}};
  const plugin=new fixture.LocalAgent();plugin.app={};await plugin.load();
  assert.equal(plugin.settings.binary,'/explicit/codex');assert.equal(plugin.settings.instructions,'保留偏好');assert.equal(plugin.settings.mcpEnabled,true);assert.equal(plugin.settings.mcpUrl,'https://localhost/mcp');assert.equal(plugin.chat.settings.mcpEnabled,true);assert.equal(plugin.chat.session.threadId,'saved-thread');assert.equal(plugin.chat.session.draft,'旧草稿');assert.equal(plugin.chat.session.messages[0].attachments[0].media.path,join(storage,'attachments/old.pdf'));assert.equal(plugin.workspaceBindings.length,1);
  for(const [name,data]of Object.entries(files)){assert.deepEqual(JSON.parse(readFileSync(join(storage,name),'utf8')),data);assert.ok(plugin.data[name]);}
  plugin.data['settings.json']={cwd:dir,instructions:'新偏好'};plugin.data['sessions.json']={sessions:[]};await plugin.load();assert.equal(plugin.settings.instructions,'新偏好');assert.notEqual(plugin.chat.session.id,'legacy');
  await plugin.showSettings();assert.equal(document.querySelector('[aria-label="思源 MCP"]'),null);assert.equal(document.querySelector('[aria-label="思源 MCP 地址"]'),null);assert.equal(document.querySelectorAll('.la-settings-actions button').length,2);
  if(process.env.SIYUAN_CODEX_SETTINGS_PREVIEW==='1')writeFileSync('artifacts/settings-preview.html','<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/host.css"><link rel="stylesheet" href="/style.css"><style>:root{--b3-theme-background:#fff;--b3-theme-on-background:#222;--b3-theme-on-surface:#666;--b3-theme-surface:#f5f5f5;--b3-border-color:#e5e5e5;--b3-theme-primary:#3578e5;--b3-theme-on-primary:#fff;--b3-font-family:system-ui;--b3-border-radius:4px;--b3-font-size:14px}body{margin:20px;background:#eceef1;font-family:system-ui}.la-settings{width:600px;margin:auto;background:white;border-radius:8px}</style>'+document.querySelector('.la-settings')!.outerHTML);
  plugin.onunload();
 }finally{window.siyuan={};s.close();rmSync(workspace,{recursive:true,force:true});}
});
test('plugin exposes the Codex dock and command without registering a top bar button',async()=>{
 const s=await setup();try{
  fixture.Host.topBars=[];fixture.Host.docks=[];fixture.Host.commands=[];const plugin=new fixture.LocalAgent();plugin.app={};plugin.data=structuredClone(s.plugin.data);plugin.onload();await plugin.ready;
  assert.equal(fixture.Host.topBars.length,0);assert.equal(fixture.Host.docks[0].config.title,'思源 Codex');assert.equal(fixture.Host.docks[0].config.icon,'iconSiYuanCodex');assert.equal(fixture.Host.commands[0].langText,'打开思源 Codex');plugin.onunload();
  assert.equal(document.querySelector('[aria-label="导出对话"]'),null);assert.equal(document.querySelector('.la-title')!.textContent,'Codex');
 }finally{s.close();}
});
test('first use opens welcome after layout, checks CLI automatically, and remembers dismissal across reloads',async()=>{
 const s=await setup();const plugin=new fixture.LocalAgent();plugin.app={};fixture.Host.checks=[];
 try{
  plugin.onload();await plugin.ready;assert.equal(document.querySelector('.la-welcome'),null);
  plugin.onLayoutReady();await tick();assert.ok(document.querySelector('.la-welcome'));assert.deepEqual(fixture.Host.checks,['']);assert.equal(plugin.data['onboarding.json'].seen,true);
  [...document.querySelectorAll<HTMLButtonElement>('.la-welcome button')].find(b=>b.textContent==='稍后设置')!.click();assert.equal(document.querySelector('.la-welcome'),null);
  const restored=new fixture.LocalAgent();restored.app={};restored.data=structuredClone(plugin.data);restored.onload();await restored.ready;restored.onLayoutReady();await tick();assert.equal(document.querySelector('.la-welcome'),null);
  await restored.showSettings();[...document.querySelectorAll<HTMLButtonElement>('.la-settings-actions button')].find(b=>b.textContent==='打开欢迎页')!.click();await tick();assert.ok(document.querySelector('.la-welcome'));restored.onunload();
 }finally{plugin.onunload();s.close();}
});
test('upgrade preserves an explicit CLI path without an automatic welcome; reopening saves a checked replacement',async()=>{
 const s=await setup();const plugin=new fixture.LocalAgent();plugin.app={};plugin.data['settings.json']={cwd:dir,binary:'/explicit/codex',instructions:'keep'};fixture.Host.checks=[];
 try{
  plugin.onload();await plugin.ready;plugin.onLayoutReady();await tick();assert.equal(document.querySelector('.la-welcome'),null);
  await plugin.showWelcome();await tick();await plugin.showWelcome();assert.equal(document.querySelectorAll('.la-welcome').length,1);assert.deepEqual(fixture.Host.checks,['/explicit/codex']);
  const input=document.querySelector<HTMLInputElement>('.la-welcome input')!;input.value='/new/codex';input.dispatchEvent(new window.Event('input'));
  [...document.querySelectorAll<HTMLButtonElement>('.la-cli-check button')].find(b=>b.textContent==='检测 Codex CLI')!.click();await tick();
  [...document.querySelectorAll<HTMLButtonElement>('.la-welcome button')].find(b=>b.textContent==='开始使用')!.click();await tick();assert.equal(plugin.settings.binary,'/new/codex');assert.equal(plugin.chat.settings.binary,'/new/codex');assert.equal(plugin.data['settings.json'].instructions,'keep');assert.equal(document.querySelector('.la-welcome'),null);
 }finally{plugin.onunload();s.close();}
});

test('external previews stay outside plugin history and persistence until a successful send, then survive reload and deduplicate',async()=>{
 const s=await setup();const {plugin}=s;const source={id:'desktop-external',name:'桌面对话',cwd:dir,model:'source-model',modelProvider:'source-provider',reasoningEffort:'high',updatedAt:10,turns:[{id:'source-turn',status:'completed',items:[{type:'userMessage',id:'source-user',content:[{type:'text',text:'原提问'}]},{type:'agentMessage',id:'source-answer',text:'原回答',phase:'final_answer'}]}]};
 fixture.CodexClient.history=[source];fixture.CodexClient.requests=[];
 try{
  const show=()=>document.querySelector<HTMLButtonElement>('.la-history-trigger')!.click();const scope=()=>document.querySelector<HTMLSelectElement>('[aria-label="历史搜索范围"]')!;
  show();assert.equal(scope().value,'plugin');assert.equal(fixture.CodexClient.requests.some((c:any)=>c.method==='thread/list'),false);
  scope().value='codex';scope().dispatchEvent(new s.dom.window.Event('change'));await tick();document.querySelector<HTMLButtonElement>(`.la-codex-history-select[data-thread-id="${source.id}"]`)!.click();await tick();
  const preview=plugin.chat;assert.equal(preview.session.threadId,source.id);assert.equal(preview.session.cwd,dir);assert.equal(preview.session.workspaceMode,'manual');assert.equal(preview.session.workspaceLocked,true);assert.equal(preview.session.messages[0].text,'原提问');assert.equal(preview.session.codex.adopted,false);
  assert.ok(document.querySelector('.la-codex-preview'));assert.equal(fixture.CodexClient.requests.some((c:any)=>c.method==='thread/resume'||c.method==='turn/start'),false);
  plugin.persist();await plugin.saveQueue;assert.ok(!plugin.data['sessions.json'].sessions.some((s:any)=>s.threadId===source.id));
  show();assert.equal(scope().value,'plugin');assert.doesNotMatch(document.querySelector('.la-history-list')!.textContent!,/桌面对话/);show();
  await plugin.openCodexHistory({threadId:source.id,title:source.name,cwd:dir,updated:10,archived:false});assert.equal(plugin.chat,preview);assert.equal(plugin.sessions.filter((s:any)=>s.threadId===source.id).length,1);
  fixture.CodexClient.failTurn=true;assert.equal(await preview.send('失败的继续'),false);plugin.persist();await plugin.saveQueue;assert.ok(!plugin.data['sessions.json'].sessions.some((s:any)=>s.threadId===source.id));
  fixture.CodexClient.failTurn=false;assert.equal(await preview.send('成功的继续'),true);assert.equal(preview.session.codex.adopted,true);assert.equal(document.querySelector('.la-codex-preview'),null);
  plugin.persist();await plugin.saveQueue;assert.equal(plugin.data['sessions.json'].sessions.find((s:any)=>s.threadId===source.id).modelProvider,'source-provider');
  preview.client.emit('turn/completed',{turn:{id:preview.turnId,status:'completed'}});plugin.persist();await plugin.saveQueue;
  const restored=new fixture.LocalAgent();restored.data=structuredClone(plugin.data);restored.app={};await restored.load();restored.mount(document.getElementById('app')!);
  assert.equal(restored.chat.session.threadId,source.id);assert.equal(restored.chat.session.codex.adopted,true);assert.equal(restored.sessions.filter((s:any)=>s.threadId===source.id).length,1);show();assert.equal(scope().value,'plugin');assert.match(document.querySelector('.la-history-list')!.textContent!,/桌面对话/);restored.onunload();
 }finally{fixture.CodexClient.history=[];fixture.CodexClient.failTurn=false;s.close();}
});

test('an external history read finishing after closing the panel cannot import or switch chats',async()=>{
 const s=await setup();const {plugin}=s;fixture.CodexClient.history=[{id:'late-desktop',name:'迟到会话',cwd:dir}];let release!:()=>void;fixture.CodexClient.readDelay=new Promise<void>(r=>release=r);
 try{
  const show=()=>document.querySelector<HTMLButtonElement>('.la-history-trigger')!.click();show();const scope=document.querySelector<HTMLSelectElement>('[aria-label="历史搜索范围"]')!;scope.value='codex';scope.dispatchEvent(new s.dom.window.Event('change'));await tick();
  document.querySelector<HTMLButtonElement>('.la-codex-history-select')!.click();await tick();show();release();await tick();
  assert.equal(plugin.chat,s.a);assert.equal(plugin.sessions.some((s:any)=>s.threadId==='late-desktop'),false);
 }finally{fixture.CodexClient.history=[];fixture.CodexClient.readDelay=undefined;s.close();}
});
