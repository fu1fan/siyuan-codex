import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore
import {JSDOM} from 'jsdom';
import {searchCodexHistory,readCodexThread,importedSession,pluginHistory,mergeHistory} from '../src/codex-history';
import {ChatSession,newSession} from '../src/session';
import {defaults} from '../src/codex';
import {developerInstructions,integrationStart,integrationEnd} from '../src/prompts';
import {ChatView} from '../src/ui';
import {sessionSummary} from '../src/session-state';
const thread={id:'external',name:'外部研究对话',cwd:process.cwd(),model:'original-model',modelProvider:'original-provider',reasoningEffort:'high',status:{type:'notLoaded'},updatedAt:12};
const turns=[{id:'old-turn',status:'completed',items:[{type:'userMessage',id:'original-user',content:[{type:'text',text:'原问题'}]},{type:'agentMessage',id:'original-answer',text:'原答案',phase:'final_answer'}]}];
const tick=()=>new Promise(r=>setTimeout(r,0));

test('all-history queries include every source/provider and page active and archived threads',async()=>{
 const calls:any[]=[];const client={async request(method:string,p:any){calls.push({method,p});return {data:[{...thread,id:p.archived?'archived':'active'}],nextCursor:p.cursor||p.archived?null:'next'};}};
 const first=await searchCodexHistory(client,'研究');const next=await searchCodexHistory(client,'研究',first.nextCursor);const archives=await searchCodexHistory(client,'研究',next.nextCursor);
 assert.deepEqual([first.data[0].threadId,next.data[0].threadId,archives.data[0].threadId],['active','active','archived']);assert.equal(archives.nextCursor,undefined);assert.equal(archives.data[0].archived,true);
 assert.deepEqual(calls[0].p.modelProviders,[]);assert.ok(calls[0].p.sourceKinds.includes('appServer'));assert.ok(calls[0].p.sourceKinds.includes('subAgent'));assert.equal(calls[0].p.cwd,undefined);assert.equal(calls[0].p.searchTerm,'研究');assert.equal(calls[0].p.useStateDbOnly,true);
 assert.ok(calls.every(c=>c.method==='thread/list'));
 const empty={async request(_m:string,p:any){return {data:p.archived?[thread]:[],nextCursor:null};}};assert.equal((await searchCodexHistory(empty,'')).data.length,1);
});

test('reading full paginated history never resumes, imports only visible items and preserves identity',async()=>{
 const calls:any[]=[];const client={async request(method:string,p:any){calls.push({method,p});if(method==='thread/read')return {thread};return p.cursor?{data:[{id:'last',status:'completed',items:[{type:'commandExecution',id:'tool',command:'pwd',status:'completed',aggregatedOutput:'result'},{type:'reasoning',id:'private',content:['PRIVATE']},{type:'agentMessage',id:'final',text:'最新结果',phase:'final_answer'}]}]}:{data:turns,nextCursor:'older'};}};
 const result=await readCodexThread(client,'external');assert.deepEqual(result.messages.map(m=>m.id),['original-user','original-answer','tool','final']);assert.equal(result.messages[2].tool!.output,'result');assert.equal(result.messages[0].turnId,'old-turn');assert.ok(!JSON.stringify(result.messages).includes('PRIVATE'));
 assert.deepEqual(calls.map(c=>c.method),['thread/read','thread/turns/list','thread/turns/list']);assert.equal(calls[1].p.itemsView,'full');assert.equal(calls[1].p.sortDirection,'asc');
 const session=importedSession(result.thread,result.messages);assert.equal(pluginHistory(session),false);assert.equal(session.workspaceLocked,true);assert.equal(session.cwd,thread.cwd);assert.equal(session.modelProvider,'original-provider');assert.equal(session.modelSelection!.model,'original-model');
});

test('legacy history fallback is limited to unsupported methods, never hides read errors or repeated cursors',async()=>{
 const legacy={async request(method:string,p:any){if(method==='thread/turns/list')throw Object.assign(Error('method not found'),{code:-32601});return {thread:{...thread,...(p.includeTurns?{turns}:{})}};}};
 assert.equal((await readCodexThread(legacy,'external')).messages.length,2);
 const broken={async request(method:string){if(method==='thread/read')return {thread};throw Error('permission denied');}};await assert.rejects(readCodexThread(broken,'external'),/permission denied/);
 const repeated={async request(method:string){return method==='thread/read'?{thread}:{data:[],nextCursor:'repeat'};}};await assert.rejects(readCodexThread(repeated,'external'),/分页重复/);
});

function importedChat(){
 const session=importedSession(thread,[]),calls:any[]=[];
 const client:any={alive:false,onEvent:()=>{},start:async()=>{client.alive=true;},dispose:()=>{client.alive=false;},reject:()=>{},async request(method:string,p:any){
  calls.push({method,p});if(method==='config/read')return {config:{developer_instructions:'PROJECT_PREFERENCE'}};
  if(method==='thread/read')return {thread};if(method==='thread/turns/list')return {data:turns};
  if(method==='thread/resume')return {thread,model:'original-model',reasoningEffort:'high'};
  if(method==='turn/start')return {turn:{id:'new-turn'}};return {};
 }};
 const chat=new ChatSession(session,{...defaults,...session.modelSelection,cwd:thread.cwd,mcpEnabled:true,mcpUrl:'https://localhost/mcp',instructions:'PLUGIN_PREFERENCE'},()=>'', '',()=>client);
 return {session,chat,client,calls};
}

test('external thread joins plugin history only after an acknowledged send with merged integration rules',async()=>{
 const {chat,session,client,calls}=importedChat();assert.equal(pluginHistory(session),false);
 chat.enqueue('queued');assert.equal(pluginHistory(session),false);session.queue=[];
 const original=client.request;client.request=async(method:string,p:any)=>{if(method==='turn/start')throw Error('rejected');return original(method,p);};
 assert.equal(await chat.send('failed'),false);assert.equal(pluginHistory(session),false);chat.disconnect();
 client.request=original;assert.equal(await chat.send('继续研究'),true);assert.equal(pluginHistory(session),true);assert.equal(session.threadId,'external');assert.equal(session.messages[0].text,'原问题');
 const resume=calls.find(c=>c.method==='thread/resume').p;assert.equal(resume.threadId,'external');assert.equal(resume.cwd,thread.cwd);assert.equal(resume.modelProvider,thread.modelProvider);assert.equal(resume.excludeTurns,true);assert.equal('baseInstructions' in resume,false);assert.equal('history' in resume,false);
 assert.ok(resume.developerInstructions.startsWith('PROJECT_PREFERENCE'));assert.match(resume.developerInstructions,/PLUGIN_PREFERENCE/);assert.match(resume.developerInstructions,/Past client UI/);assert.match(resume.developerInstructions,/use only the MCP server siyuan_local_agent_workspace/);
 assert.equal(calls.some(c=>c.method==='thread/start'),false);const sent=calls.filter(c=>c.method==='turn/start').at(-1).p;assert.equal(sent.input[0].text,'继续研究');assert.equal(sent.clientUserMessageId,session.messages.at(-1)!.id);chat.disconnect();
});

test('interrupted startup and threads active elsewhere do not adopt or send; archives restore only on continuation',async()=>{
 const active=importedChat();const request=active.client.request;active.client.request=(method:string,p:any)=>method==='thread/read'?Promise.resolve({thread:{...thread,status:{type:'active'}}}):request(method,p);
 assert.equal(await active.chat.send('continue'),false);assert.equal(pluginHistory(active.session),false);assert.equal(active.calls.some(c=>c.method==='thread/resume'||c.method==='turn/start'),false);active.chat.disconnect();
 const interrupted=importedChat();let release!:()=>void;interrupted.client.start=()=>new Promise<void>(r=>release=r);const pending=interrupted.chat.send('hello');await interrupted.chat.interrupt();release();assert.equal(await pending,false);assert.equal(pluginHistory(interrupted.session),false);assert.equal(interrupted.calls.some(c=>c.method==='turn/start'),false);
 const archived=importedChat();archived.session.codex!.archived=true;assert.equal(await archived.chat.send('continue'),true);assert.equal(archived.calls.filter(c=>c.method==='thread/unarchive').length,1);assert.equal(archived.session.codex!.archived,false);archived.chat.disconnect();
});

test('integration block is replaced across reconnections without duplicating preferences or retaining old workspace rules',()=>{
 const inherited='PROJECT: existing preference';const old=developerInstructions({...defaults,mcpEnabled:true,instructions:'OLD_EXTRA'},inherited);
 const next=developerInstructions({...defaults,mcpEnabled:false,instructions:'NEW_EXTRA'},old);assert.equal(next.split(integrationStart).length,2);assert.equal(next.split(integrationEnd).length,2);assert.equal(next.split(inherited).length,2);assert.doesNotMatch(next,/OLD_EXTRA|SiYuan MCP quick guide/);assert.match(next,/NEW_EXTRA/);assert.equal(developerInstructions({...defaults,mcpEnabled:false,instructions:'NEW_EXTRA'},next),next);
 const local={...newSession(thread.cwd),messages:[{id:'client-id',role:'user' as const,text:'request with context',displayText:'request',turnId:'turn',attachments:[{title:'note',text:'snapshot'}]}]};
 const remote=[{id:'client-id',role:'user' as const,text:'remote expanded context',turnId:'turn'}];assert.equal(mergeHistory(remote,local.messages)[0].displayText,'request');assert.equal(mergeHistory(remote,local.messages)[0].attachments!.length,1);
 const steered=[...remote,{id:'steer-server-id',role:'user' as const,text:'steered text',turnId:'turn'}];assert.equal(mergeHistory(steered,local.messages)[1].text,'steered text');assert.equal(mergeHistory(steered,local.messages)[1].id,'steer-server-id');
});

function uiSetup(search:(q:string,c?:string)=>Promise<any>,open:(entry:any,current?:()=>boolean)=>Promise<void>=async()=>{}){
 const dom=new JSDOM('<div id="root"></div>',{url:'https://localhost'});Object.assign(globalThis,{window:dom.window,document:dom.window.document,Element:dom.window.Element,HTMLInputElement:dom.window.HTMLInputElement});
 const own=newSession(thread.cwd);own.title='插件已有对话';const preview=importedSession(thread,[]);const chat=new ChatSession(own,{...defaults,cwd:thread.cwd},()=> '');
 const view=new ChatView(document.getElementById('root')!,()=>chat,{send:async()=>true,stop(){},settings(){},newChat(){},select(){},list:()=>[sessionSummary(own),sessionSummary(preview)],clear(){},attach(){},context:()=>'',searchCodex:search,openCodex:open});
 const scope=()=>document.querySelector<HTMLSelectElement>('[aria-label="历史搜索范围"]')!;
 const show=()=>document.querySelector<HTMLButtonElement>('.la-history-trigger')!.click();
 const change=(value:string)=>{scope().value=value;scope().dispatchEvent(new dom.window.Event('change'));};
 return {dom,view,scope,show,change,close(){view.destroy();dom.window.close();}};
}

test('history defaults to plugin chats, excludes previews, and loads all history only when selected',async()=>{
 let searches=0;const s=uiSetup(async()=>{searches++;return {data:[{threadId:'external',title:'外部研究对话',cwd:thread.cwd,archived:false}],nextCursor:'more'};});
 try{s.show();assert.equal(s.scope().value,'plugin');assert.equal(searches,0);assert.match(document.querySelector('.la-history-list')!.textContent!,/插件已有对话/);assert.doesNotMatch(document.querySelector('.la-history-list')!.textContent!,/外部研究对话/);s.change('codex');await tick();assert.equal(searches,1);assert.match(document.querySelector('.la-history-list')!.textContent!,/外部研究对话/);assert.ok(document.querySelector('.la-history-more'));s.change('plugin');assert.equal(searches,1);}finally{s.close();}
});

test('stale searches and closed-history selections cannot replace the current view; errors allow retry',async()=>{
 let resolve!:(page:any)=>void;let cancelled=false;const s=uiSetup(()=>new Promise(r=>resolve=r),async(_entry,current)=>{await tick();cancelled=!current?.();});
 try{s.show();s.change('codex');s.change('plugin');resolve({data:[{threadId:'external',title:'STALE'}]});await tick();assert.doesNotMatch(document.querySelector('.la-history-list')!.textContent!,/STALE/);
 s.change('codex');resolve({data:[{threadId:'external',title:'OPEN',cwd:thread.cwd,archived:false}]});await tick();document.querySelector<HTMLButtonElement>('.la-codex-history-select')!.click();s.show();await tick();assert.equal(cancelled,true);
 }finally{s.close();}
 const error=uiSetup(async()=>{throw Error('CLI unavailable');});try{error.show();error.change('codex');await tick();assert.match(document.querySelector('[role="alert"]')!.textContent!,/CLI unavailable/);assert.ok([...document.querySelectorAll('button')].some(b=>b.textContent==='重试'));}finally{error.close();}
});
