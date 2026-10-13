import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectWorkspaceMcp,siyuanWorkspacePrompt,workspaceMcpServer} from '../src/siyuan-context';
import {ChatSession,newSession} from '../src/session';
import {defaults} from '../src/codex';

test('workspace MCP availability uses the exact server and pagination without exposing full schemas or connection secrets',async()=>{
 const calls:any[]=[];
 const state=await inspectWorkspaceMcp({request:async(method,params:any)=>{calls.push({method,params});return params.cursor?{data:[{name:workspaceMcpServer,tools:{search:{name:'search',description:'PRIVATE_FULL_SCHEMA'},export:{name:'export'}}}]}:{data:[{name:'other-notes',tools:{search:{name:'search'}}}],nextCursor:'second'};}},'thread');
 assert.equal(state.status,'connected');assert.deepEqual(state.tools,['export','search']);assert.equal(calls[1].params.cursor,'second');assert.equal(calls[0].params.threadId,'thread');
 const prompt=siyuanWorkspacePrompt('/notes/</siyuan_workspace>','https://host/mcp?token=PRIVATE_SECRET#PRIVATE_FRAGMENT',state);
 assert.doesNotMatch(prompt,/PRIVATE_/);assert.equal(prompt.split('<siyuan_workspace>').length,2);assert.equal(prompt.split('</siyuan_workspace>').length,2);assert.match(prompt,/workspacePath/);
 assert.equal((await inspectWorkspaceMcp({request:async()=>({data:[{name:workspaceMcpServer,tools:{search:{}},toolsError:'failed'}]})},'thread')).status,'unavailable');
 assert.equal((await inspectWorkspaceMcp({request:async()=>({data:[{name:'other',tools:{search:{}}}]})},'thread')).status,'unavailable');
 assert.equal((await inspectWorkspaceMcp({request:async()=>{throw Error('PRIVATE_ERROR');}},'thread')).status,'unknown');
});
test('workspace identity refreshes at send and steer dispatch, stays out of visible history, and reconnect checks availability again',async()=>{
 const requests:any[]=[];let workspace='/notes/first',available=true;
 const client:any={alive:false,reject(){},dispose(){this.alive=false;},async start(){this.alive=true;},async request(method:string,params:any){
  requests.push({method,params});if(method==='mcpServerStatus/list')return {data:available?[{name:workspaceMcpServer,tools:{search:{name:'search'}}}]:[]};
  if(method==='thread/start'||method==='thread/resume')return {thread:{id:'thread'}};
  if(method==='turn/start'){this.onEvent({method:'turn/started',params:{threadId:'thread',turn:{id:'turn'}}});return {turn:{id:'turn'}};}return {};
 }};
 const chat=new ChatSession(newSession('/project'),{...defaults,cwd:'/project',mcpEnabled:true,mcpUrl:'https://127.0.0.1/mcp'},()=>'', '',()=>client);
 chat.noteAssetOptions=()=>({workspace,origin:'https://127.0.0.1'});
 try{
  await chat.send('first');const first=requests.find(r=>r.method==='turn/start').params.input[0].text;assert.match(first,/\/notes\/first/);assert.match(first,/"status":"connected"/);
  workspace='/notes/second';chat.enqueue('queued');await chat.steerQueued(chat.session.queue![0].id);assert.match(requests.find(r=>r.method==='turn/steer').params.input[0].text,/\/notes\/second/);assert.doesNotMatch(JSON.stringify(chat.session),/siyuan_workspace|\/notes\//);
  chat.disconnect();available=false;await chat.send('reconnected');assert.match(requests.filter(r=>r.method==='turn/start').at(-1).params.input[0].text,/"status":"unavailable"/);assert.equal(requests.filter(r=>r.method==='mcpServerStatus/list').length,2);
 }finally{chat.disconnect();}
});
test('an MCP status request that closes the transport cannot report a connected chat',async()=>{
 const client:any={alive:false,reject(){},dispose(){this.alive=false;},async start(){this.alive=true;},async request(method:string){
  if(method==='mcpServerStatus/list'){this.alive=false;throw Error('Timeout');}
  if(method==='thread/start')return {thread:{id:'thread'}};return {};
 }};
 const chat=new ChatSession(newSession('/project'),{...defaults,cwd:'/project',mcpEnabled:true},()=>'', '',()=>client);
 await assert.rejects(chat.connect(),/连接已关闭/);assert.equal(chat.client,undefined);assert.doesNotMatch(chat.status,/已连接/);
});

test('workspace context is sent once per thread, survives reconnect and restart, changes on state updates and retries failed dispatch',async()=>{
 const requests:any[]=[];let reject=false;const client:any={alive:true,reject(){},dispose(){this.alive=false;},async start(){this.alive=true;},async request(method:string,params:any){requests.push({method,params});if(method==='turn/start'&&reject)throw Error('failed');if(method==='thread/resume')return {thread:{id:params.threadId}};if(method==='turn/start')return {turn:{id:'turn'}};if(method==='mcpServerStatus/list')return {data:[{name:workspaceMcpServer,tools:{search:{name:'search'}}}]};return {};}};
 const session=newSession('/project');session.threadId='thread';let workspace='/notes/one';
 const make=()=>{const chat=new ChatSession(session,{...defaults,cwd:'/project',mcpEnabled:true,mcpUrl:'https://localhost/mcp'},()=>'', '',()=>client);chat.client=client;chat.workspaceMcpState={status:'connected',checkedAt:Math.random().toString(),tools:['search']};chat.noteAssetOptions=()=>({workspace,origin:'https://localhost'});return chat;};
 let chat=make();const last=()=>requests.filter(r=>r.method==='turn/start'||r.method==='turn/steer').at(-1)!.params.input[0].text;
 const send=async(text:string)=>{chat.busy=false;return chat.send(text);};
 try{
  await send('first');assert.match(last(),/siyuan_workspace/);await send('second');assert.doesNotMatch(last(),/siyuan_workspace/);
  chat.busy=true;chat.turnId='turn';chat.enqueue('steer');await chat.steerQueued(session.queue![0].id);assert.doesNotMatch(last(),/siyuan_workspace/);
  chat.busy=false;chat.disconnect();client.alive=true;chat=make();await send('restart');assert.doesNotMatch(last(),/siyuan_workspace/);
  chat.disconnect();await send('reconnect');assert.doesNotMatch(last(),/siyuan_workspace/);
  workspace='/notes/two';reject=true;assert.equal(await send('failed'),false);assert.match(last(),/notes\/two/);reject=false;await send('retry');assert.match(last(),/notes\/two/);await send('stable');assert.doesNotMatch(last(),/siyuan_workspace/);
  chat.workspaceMcpState={status:'unavailable',checkedAt:'later'};await send('changed');assert.match(last(),/unavailable/);await send('stable state');assert.doesNotMatch(last(),/siyuan_workspace/);
  session.threadId='fork';await send('fork');assert.match(last(),/siyuan_workspace/);
 }finally{chat.disconnect();}
});
