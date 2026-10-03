import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CodexClient,defaults,launchConfig,validateSettings,threadOptions} from '../src/codex';
import {ChatSession,newSession} from '../src/session';
import {currentActivityPrompt} from '../src/activity';
import {contextPrompt,resolveReferences} from '../src/context';
import {siyuanToolGuide} from '../src/prompts';
import {sideConversationPrefix} from '../src/prompts';
import {join} from 'node:path';
const settings={...defaults,binary:join(process.cwd(),'tests','fake-codex.cjs'),cwd:process.cwd()};
test('RPC handles split lines, errors, timeout, requests and shutdown',async()=>{
 const c=new CodexClient(1500);await c.start(settings);
 assert.deepEqual(await c.request('echo',{text:'中文\n`$(touch never)`'}),{text:'中文\n`$(touch never)`'});
 await assert.rejects(c.request('test/error',{}),/fixture error/);

 const approval=new Promise<void>(resolve=>{c.onEvent=m=>{assert.equal(m.id,'server-1');c.respond(m.id!,{decision:'decline'});resolve();};});
 await c.request('test/approval',{});await approval;
 const pending=c.request('test/timeout',{});c.dispose();await assert.rejects(pending,/关闭/);
});
test('timeout closes the transport to prevent unobserved work',async()=>{const c=new CodexClient(500);await c.start(settings);await assert.rejects(c.request('test/timeout',{}),/超时/);assert.equal(c.alive,false);});
test('process crash and executable failure reject pending work',async()=>{
 const c=new CodexClient();await c.start(settings);await assert.rejects(c.request('test/exit',{}),/退出/);c.dispose();
 const bad=new CodexClient();await assert.rejects(bad.start({...settings,binary:'/nonexistent/codex'}),/无法启动/);bad.dispose();
});
test('directories and MCP transport validated; config never contains token',()=>{
 assert.throws(()=>validateSettings({...settings,cwd:'relative'}));
 assert.throws(()=>validateSettings({...settings,mcpEnabled:true,mcpUrl:'http://public.example/mcp'}));
 assert.throws(()=>validateSettings({...settings,mcpEnabled:true,mcpUrl:'https://user:pass@example.com/mcp'}));
 assert.equal(threadOptions(settings).sandbox,'read-only');
 assert.equal(threadOptions(settings).ephemeral,false);
 assert.equal((launchConfig({...settings,mcpEnabled:true,mcpUrl:'https://localhost/mcp'}) as any)['mcp_servers.siyuan_local_agent_workspace'].bearer_token_env_var,'SIYUAN_LOCAL_AGENT_TOKEN');
});
function fixture(){
 const c:any={alive:false,onEvent:()=>{},onExit:()=>{},start:async()=>{c.alive=true;},dispose:()=>{c.alive=false;},reject:()=>{},respond:(id:any,value:any)=>{c.last={id,value};},request:async(method:string)=>{
 if(method==='thread/start'||method==='thread/resume')return {thread:{id:'thread-1'}};
 if(method==='turn/start'){c.onEvent({method:'turn/started',params:{threadId:'thread-1',turn:{id:'turn-1'}}});return {turn:{id:'turn-1'}};}return {};
 }};
 const chat=new ChatSession(newSession(settings.cwd),settings,()=>'', '',()=>c);
 return {c,chat};
}
test('streamed answer reconciles completed item and approvals expire at turn end',async()=>{
 const {c,chat}=fixture();await chat.send('hello');assert.equal(chat.busy,true);
 c.onEvent({method:'item/agentMessage/delta',params:{threadId:'other',itemId:'wrong',delta:'ignored'}});
 c.onEvent({method:'item/agentMessage/delta',params:{threadId:'thread-1',itemId:'a',delta:'你好'}});
 c.onEvent({method:'item/completed',params:{threadId:'thread-1',item:{id:'a',type:'agentMessage',text:'你好世界'}}});
 c.onEvent({id:7,method:'item/fileChange/requestApproval',params:{threadId:'thread-1'}});assert.equal(chat.requests.size,1);
 chat.answer('7',{decision:'decline'});assert.deepEqual(c.last,{id:7,value:{decision:'decline'}});
 c.onEvent({id:8,method:'item/fileChange/requestApproval',params:{threadId:'thread-1'}});
 c.onEvent({method:'turn/completed',params:{threadId:'thread-1',turn:{status:'completed'}}});
 assert.equal(chat.busy,false);assert.equal(chat.requests.size,0);assert.equal(chat.session.messages.length,2);assert.equal(chat.session.messages[1].text,'你好世界');
});
test('stop during startup never submits a turn',async()=>{
 const {c,chat}=fixture();let release!:()=>void;let turns=0;
 c.start=()=>new Promise<void>(r=>{release=()=>{c.alive=true;r();};});
 c.request=async(method:string)=>{if(method==='turn/start')turns++;return {thread:{id:'x'}};};
 const pending=chat.send('hello');await chat.interrupt();release();await pending;assert.equal(turns,0);assert.equal(chat.busy,false);
});
test('completion before interrupt response keeps terminal status',async()=>{
 const {c,chat}=fixture();await chat.send('hello');const original=c.request;
 c.request=async(method:string)=>{if(method==='turn/interrupt'){c.onEvent({method:'turn/completed',params:{threadId:'thread-1',turn:{status:'interrupted'}}});return {};}return original(method);};
 await chat.interrupt();assert.equal(chat.busy,false);assert.equal(chat.status,'已停止');
});

test('selected reasoning effort reaches thread config and turn request',async()=>{
 const {c,chat}=fixture();chat.settings={...settings,reasoningEffort:'high'};
 const original=c.request;let turn:any;
 c.request=async(method:string,params:any)=>{if(method==='turn/start')turn=params;return original(method);};
 await chat.send('reason carefully');assert.equal(turn.effort,'high');
 assert.equal(threadOptions(chat.settings).config.model_reasoning_effort,'high');chat.disconnect();
 assert.equal('model_reasoning_effort' in launchConfig(settings),false);
});

test('CLI configured model wins over catalog default without pinning user settings',async()=>{
 const {c,chat}=fixture();c.request=async(method:string)=>method==='config/read'?{config:{model:'custom-model',model_reasoning_effort:'high'}}:{data:[{model:'catalog-default',isDefault:true,defaultReasoningEffort:'medium'}]};
 await chat.resolveModel();assert.equal(chat.resolvedModel,'custom-model');assert.equal(chat.resolvedEffort,'high');assert.equal(chat.settings.model,'');
 c.request=async()=>({thread:{id:'resumed'},model:'actual-resumed',reasoningEffort:'low'});
 await chat.connect();assert.equal(chat.resolvedModel,'actual-resumed');assert.equal(chat.resolvedEffort,'low');chat.disconnect();
});
test('model discovery falls back to catalog and ignores results after disconnect',async()=>{
 const {c,chat}=fixture();c.request=async(method:string)=>method==='config/read'?{config:{}}:{data:[{model:'default-model',isDefault:true,defaultReasoningEffort:'medium'}]};
 await chat.resolveModel();assert.equal(chat.resolvedModel,'default-model');assert.equal(chat.resolvedEffort,'medium');
 let release!:()=>void;c.start=()=>new Promise<void>(r=>{release=r;});const pending=chat.resolveModel();chat.disconnect();release();await pending;assert.equal(chat.resolvedModel,'default-model');
});

test('approval modes map to distinct Codex policies and preserve legacy sandbox',()=>{
 for(const [mode,sandbox,policy,reviewer] of [
  ['ask','workspace-write','on-request','user'],['auto','workspace-write','on-request','auto_review'],['full','danger-full-access','never','user']
 ] as const){const opts=threadOptions({...settings,permissionMode:mode});assert.equal(opts.sandbox,sandbox);assert.equal(opts.approvalPolicy,policy);assert.equal(opts.approvalsReviewer,reviewer);}
 assert.equal(threadOptions(settings).sandbox,'read-only');assert.equal(threadOptions(settings).approvalsReviewer,'user');
 assert.equal(threadOptions({...settings,sandbox:'workspace-write'}).sandbox,'workspace-write');
});
test('turn metadata preserves commentary/final phases and records elapsed work time',async()=>{
 const {c,chat}=fixture();await chat.send('question');
 c.onEvent({method:'item/started',params:{threadId:'thread-1',item:{id:'progress',type:'agentMessage',phase:'commentary',text:''}}});
 c.onEvent({method:'item/agentMessage/delta',params:{threadId:'thread-1',itemId:'progress',delta:'working'}});
 c.onEvent({method:'item/completed',params:{threadId:'thread-1',item:{id:'final',type:'agentMessage',phase:'final_answer',text:'done'}}});
 c.onEvent({method:'turn/completed',params:{threadId:'thread-1',turn:{status:'completed'}}});
 assert.equal(chat.session.messages[0].turnId,'turn-1');assert.ok(chat.session.messages[0].elapsedMs!>=0);assert.equal(chat.session.messages[1].phase,'commentary');assert.equal(chat.session.messages[2].phase,'final_answer');chat.disconnect();
});
test('fast mode reaches thread and turn; explicit off overrides inherited fast tier',async()=>{
 for(const enabled of [true,false]){
  const {c,chat}=fixture();chat.settings={...settings,fastMode:enabled};const original=c.request;let turn:any;
  c.request=async(method:string,params:any)=>{if(method==='turn/start')turn=params;return original(method);};
  await chat.send('hello');assert.equal(turn.serviceTierForTurn,enabled?'fast':'default');assert.equal(threadOptions(chat.settings).serviceTier,enabled?'fast':null);assert.equal(launchConfig(chat.settings).service_tier,enabled?'fast':null);chat.disconnect();
 }
 assert.equal('serviceTier' in threadOptions(settings),false);
});

test('queue sends FIFO after completion, pauses on interruption, and preserves restored items',async()=>{
 const {c,chat}=fixture();await chat.send('first');chat.enqueue('second');chat.enqueue('third');
 assert.equal(chat.session.messages.filter(m=>m.role==='user').length,1);
 c.onEvent({method:'turn/completed',params:{turn:{status:'completed'}}});await new Promise(r=>setTimeout(r,0));
 assert.equal(chat.session.messages.at(-1)?.text,'second');assert.deepEqual(chat.session.queue?.map(q=>q.text),['third']);
 c.onEvent({method:'turn/completed',params:{turn:{status:'interrupted'}}});await new Promise(r=>setTimeout(r,0));assert.equal(chat.session.queuePaused,true);assert.equal(chat.session.queue?.length,1);
 chat.pauseQueue(false);await new Promise(r=>setTimeout(r,0));assert.equal(chat.session.messages.at(-1)?.text,'third');assert.equal(chat.session.queue?.length,0);
 chat.enqueue('restored');const restored=new ChatSession(structuredClone(chat.session),settings,()=>'', '',()=>c);assert.equal(restored.session.queuePaused,true);assert.equal(restored.session.queue?.[0].text,'restored');
});
test('steering uses the active turn and only removes acknowledged messages; edits retain reference context',async()=>{
 const {c,chat}=fixture();await chat.send('first');chat.enqueue('note\n<context>','note');const q=chat.session.queue![0];chat.editQueued(q.id,'changed');assert.equal(q.text,'changed\n<context>');
 let params:any;c.request=async(method:string,p:any)=>{assert.equal(method,'turn/steer');params=p;return {};};await chat.steerQueued(q.id);assert.equal(params.expectedTurnId,'turn-1');assert.equal(params.input[0].text,'changed\n<context>');assert.equal(chat.session.queue?.length,0);assert.equal(chat.session.messages.at(-1)?.status,'steered');
 chat.enqueue('keep');c.request=async()=>{throw Error('no active turn');};await chat.steerQueued(chat.session.queue![0].id);assert.equal(chat.session.queue?.length,1);assert.equal(chat.session.queuePaused,true);assert.match(chat.session.queue![0].error!,/no active turn/);
});

test('queue refresh cannot replay an in-flight steer and rejected sends remain paused',async()=>{
 const {c,chat}=fixture();await chat.send('first');chat.enqueue('steering');chat.enqueue('next');let release!:(v:any)=>void;const original=c.request;let starts=0;
 c.request=(method:string,p:any)=>{if(method==='turn/steer')return new Promise(r=>release=r);if(method==='turn/start')starts++;return original(method,p);};
 const pending=chat.steerQueued(chat.session.queue![0].id);c.onEvent({method:'turn/completed',params:{turn:{status:'completed'}}});await new Promise(r=>setTimeout(r,0));assert.equal(starts,0);release({});await pending;await new Promise(r=>setTimeout(r,0));assert.equal(starts,1);assert.equal(chat.session.messages.at(-1)?.text,'next');
 chat.enqueue('failure');c.request=async()=>{throw Error('offline');};c.onEvent({method:'turn/completed',params:{turn:{status:'completed'}}});await new Promise(r=>setTimeout(r,0));assert.equal(chat.session.queue?.[0].text,'failure');assert.equal(chat.session.queuePaused,true);
});

test('CLI disposal works with Electron renderer numeric timer handles',()=>{
 const original=globalThis.setTimeout;
 const client=new CodexClient();let ended=false,killed=false;
 (client as any).child={stdin:{end(){ended=true;}},kill(){killed=true;},exitCode:null,signalCode:null};
 try{globalThis.setTimeout=(()=>123) as any;assert.doesNotThrow(()=>client.dispose());assert.equal(ended,true);assert.equal(killed,true);}finally{globalThis.setTimeout=original;}
});

test('editing regenerates from before the selected turn, keeps attachments, and restores history on failure',async()=>{
 const {c,chat}=fixture();await chat.send('old');chat.session.messages[0].attachments=[{id:'20261001124824-pq6acxs',title:'note',text:'OLD_NOTE_BODY'},{title:'selection',text:'reference'}];chat.session.messages.push({id:'reply',role:'assistant',text:'obsolete'});chat.busy=false;
 const original=c.request;let boundary:any,input='';c.request=async(method:string,p:any)=>{if(method==='thread/fork'){boundary=p;return {thread:{id:'forked'}};}if(method==='turn/start')input=p.input[0].text;return original(method,p);};
 const id=chat.session.messages[0].id;await chat.editAndRegenerate(id,'updated');assert.equal(boundary.beforeTurnId,'turn-1');assert.match(input,/updated/);assert.match(input,/reference/);assert.doesNotMatch(input,/OLD_NOTE_BODY/);assert.doesNotMatch(JSON.stringify(chat.session.messages[0].attachments),/OLD_NOTE_BODY/);assert.equal(chat.session.messages.some(m=>m.text==='obsolete'),false);assert.equal(chat.session.messages[0].displayText,'updated');assert.equal(chat.session.queuePaused,true);
 chat.busy=false;const before=structuredClone(chat.session.messages);const request=c.request;c.request=async(method:string,p:any)=>{if(method==='thread/fork')return {thread:{id:'another-fork'}};if(method==='turn/start')throw Error('network failed');return request(method,p);};await assert.rejects(chat.editAndRegenerate(chat.session.messages[0].id,'failed edit'),/原对话已保留/);assert.deepEqual(chat.session.messages,before);
});

test('current activity refreshes at turn and steer dispatch, stays hidden, and can be switched off',async()=>{
 const {c,chat}=fixture();const original=c.request;const sent:any[]=[];let title='first-tab',enabled=true,reads=0;
 chat.currentActivity=()=>enabled?currentActivityPrompt(()=>{reads++;return {id:title,title};}):'';
 c.request=async(method:string,p:any)=>{if(method==='turn/start'||method==='turn/steer')sent.push({method,text:p.input[0].text});return original(method,p);};
 await chat.send('first');chat.enqueue('queued');assert.equal(reads,1);assert.equal(chat.session.queue![0].text,'queued');
 title='second-tab';c.onEvent({method:'turn/completed',params:{turn:{status:'completed'}}});await new Promise(r=>setTimeout(r,0));
 assert.match(sent[1].text,/second-tab/);assert.doesNotMatch(sent[1].text,/first-tab/);assert.equal(sent[1].text.startsWith('queued'),true);
 title='steer-tab';chat.enqueue('steer');await chat.steerQueued(chat.session.queue![0].id);assert.equal(sent[2].method,'turn/steer');assert.match(sent[2].text,/steer-tab/);
 assert.deepEqual(chat.session.messages.filter(m=>m.role==='user').map(m=>[m.text,m.displayText]),[['first','first'],['queued','queued'],['steer','steer']]);
 assert.doesNotMatch(JSON.stringify(chat.session),/current_activity|first-tab|second-tab|steer-tab/);
 enabled=false;chat.busy=false;await chat.send('off');assert.equal(sent[3].text,'off');assert.equal(reads,3);chat.disconnect();
});
test('startup and edited sends read current activity at dispatch, with one fresh snapshot per request',async()=>{
 const {c,chat}=fixture();const original=c.request,originalStart=c.start;const sent:string[]=[];let release!:()=>void,title='before-startup';
 chat.currentActivity=()=>currentActivityPrompt(()=>({id:title,title}));
 c.start=()=>new Promise<void>(r=>{release=()=>{c.alive=true;r();};});
 c.request=async(method:string,p:any)=>{if(method==='thread/fork')return {thread:{id:'edited-thread'}};if(method==='turn/start')sent.push(p.input[0].text);return original(method,p);};
 const pending=chat.send('original');title='after-startup';release();await pending;assert.match(sent[0],/after-startup/);assert.doesNotMatch(sent[0],/before-startup/);
 chat.busy=false;c.start=originalStart;title='edited-tab';await chat.editAndRegenerate(chat.session.messages[0].id,'edited');
 assert.match(sent[1],/edited-tab/);assert.doesNotMatch(sent[1],/after-startup/);assert.equal(sent[1].split('<current_activity>').length,2);assert.equal(chat.session.messages[0].text,'edited');chat.disconnect();
});

test('effective CLI developer instructions survive start, resume and fork without replacing the base prompt',async()=>{
 const {c,chat}=fixture();const original=c.request;const requests:{method:string;params:any}[]=[];
 chat.settings={...settings,instructions:'PLUGIN_USER_PREFERENCE',mcpEnabled:true,mcpUrl:'https://localhost/mcp'};
 c.request=async(method:string,params:any)=>{
  requests.push({method,params});
  if(method==='config/read')return {config:{developer_instructions:'EFFECTIVE_CLI_PREFERENCE'}};
  if(method==='thread/fork')return {thread:{id:'forked'}};
  return original(method,params);
 };
 await chat.send('first');chat.busy=false;await chat.forkAt(chat.session.messages[0].id);
 chat.disconnect();await chat.connect();
 const threadRequests=requests.filter(r=>['thread/start','thread/resume','thread/fork'].includes(r.method));
 assert.deepEqual(threadRequests.map(r=>r.method),['thread/start','thread/fork','thread/resume']);
 for(const r of threadRequests){assert.ok(r.params.developerInstructions.startsWith('EFFECTIVE_CLI_PREFERENCE'));assert.match(r.params.developerInstructions,/PLUGIN_USER_PREFERENCE/);assert.ok(r.params.developerInstructions.includes(siyuanToolGuide));assert.equal('baseInstructions' in r.params,false);}
 assert.deepEqual(requests.find(r=>r.method==='config/read')!.params,{cwd:settings.cwd,includeLayers:false});chat.disconnect();
});

test('failure to read effective instructions cannot silently start a thread with lost preferences',async()=>{
 const {c,chat}=fixture();let threadRequests=0;
 c.request=async(method:string)=>{if(method==='config/read')throw Error('config unavailable');if(method.startsWith('thread/'))threadRequests++;return {};};
 assert.equal(await chat.send('hello'),false);assert.equal(threadRequests,0);assert.equal(chat.busy,false);assert.match(chat.session.messages.at(-1)!.text,/config unavailable/);chat.disconnect();
});

test('side background and attachments survive queue edits, dispatch, steering and message regeneration',async()=>{
 const {c,chat}=fixture();const original=c.request;const sent:string[]=[];
 c.request=async(method:string,p:any)=>{if(method==='thread/fork')return {thread:{id:'edited-side'}};if(method==='turn/start'||method==='turn/steer')sent.push(p.input[0].text);return original(method,p);};
 const prefix=sideConversationPrefix([{role:'user',text:'source question'},{role:'assistant',text:'source answer'}]);
 const attachments=await resolveReferences([{id:'20261001124824-pq6acxs',title:'NOTE_REFERENCE'}],[{title:'conversation',text:'EXPLICIT_CONVERSATION'}]);
 chat.enqueue(prefix+'original'+contextPrompt(attachments),'original',attachments);chat.session.queue![0].promptPrefix=prefix;
 chat.editQueued(chat.session.queue![0].id,'queued edit');chat.pauseQueue(false);await new Promise(r=>setTimeout(r,0));
 assert.equal(sent[0],prefix+'queued edit'+contextPrompt(attachments));assert.equal(chat.session.messages[0].promptPrefix,prefix);
 chat.busy=false;await chat.editAndRegenerate(chat.session.messages[0].id,'regenerated');
 assert.equal(sent[1],prefix+'regenerated'+contextPrompt(attachments));assert.equal(chat.session.messages[0].displayText,'regenerated');assert.equal(chat.session.messages[0].promptPrefix,prefix);
 chat.enqueue(prefix+'steer'+contextPrompt(attachments),'steer',attachments);chat.session.queue![0].promptPrefix=prefix;
 await chat.steerQueued(chat.session.queue![0].id);assert.equal(chat.session.messages.at(-1)!.promptPrefix,prefix);assert.equal(sent[2],prefix+'steer'+contextPrompt(attachments));chat.disconnect();
});

test('tool events preserve arguments, final output, failures and turn identity across deltas',()=>{
 const session=newSession('/tmp');session.threadId='thread-1';session.messages=[{id:'u',role:'user',text:'q'}];const chat=new ChatSession(session,{...defaults,cwd:'/tmp'},()=> '');
 const event=(method:string,item:any)=> (chat as any).handle({method,params:{threadId:'thread-1',turnId:'t',...item}});
 event('turn/started',{turn:{id:'t'}});event('item/started',{item:{id:'shell',type:'commandExecution',command:'echo hi',cwd:'/tmp',status:'inProgress'}});event('item/commandExecution/outputDelta',{itemId:'shell',delta:'hi'});
 assert.equal(session.messages[1].status,'inProgress');assert.equal(session.messages[1].tool!.input,'echo hi');assert.equal(session.messages[1].tool!.output,'hi');
 event('item/completed',{item:{id:'shell',type:'commandExecution',command:'echo hi',cwd:'/tmp',status:'completed',aggregatedOutput:'hi\n',exitCode:0,durationMs:20}});assert.equal(session.messages[1].tool!.output,'hi\n');
 event('item/completed',{item:{id:'mcp',type:'mcpToolCall',server:'notes',tool:'read',arguments:{id:'note'},result:{content:[{type:'text',text:'result'}]},status:'completed'}});assert.match(session.messages[2].tool!.output!,/result/);assert.match(session.messages[2].tool!.input!,/note/);
 event('item/completed',{item:{id:'search',type:'webSearch',query:'test',results:[{title:'result'}]}});assert.equal(session.messages[3].status,'completed');assert.equal(session.messages[3].turnId,'t');
 event('item/completed',{item:{id:'failed',type:'dynamicToolCall',tool:'test',arguments:{},contentItems:[],success:false,status:'completed'}});assert.equal(session.messages[4].tool!.error,'工具执行失败');
 const restored=JSON.parse(JSON.stringify(session));assert.deepEqual(restored.messages[2].tool,JSON.parse(JSON.stringify(session.messages[2].tool)));
});

test('vision attachments reach send, queue, steer and regeneration as localImage inputs',async()=>{
 const {c,chat}=fixture();const original=c.request;const requests:{method:string;input:any[]}[]=[];
 c.request=async(method:string,params:any)=>{if(method==='thread/fork')return {thread:{id:'media-fork'}};if(method==='turn/start'||method==='turn/steer')requests.push({method,input:params.input});return original(method,params);};
 const attachment={title:'图.png',text:'图片附件',media:{key:'image-key',kind:'image' as const,marker:'［图片 1：图.png］',path:'/tmp/fixture-image.png'}};
 await chat.send('查看图片','查看图片',undefined,[attachment]);assert.deepEqual(requests[0].input[1],{type:'localImage',path:attachment.media.path});
 chat.enqueue('引导','引导',[attachment]);await chat.steerQueued(chat.session.queue![0].id);assert.deepEqual(requests.at(-1)!.input[1],requests[0].input[1]);
 chat.enqueue('排队','排队',[attachment]);c.onEvent({method:'turn/completed',params:{threadId:'thread-1',turn:{status:'completed'}}});await new Promise(r=>setTimeout(r,0));assert.equal(requests.at(-1)!.input[0].text,'排队');assert.deepEqual(requests.at(-1)!.input[1],requests[0].input[1]);
 chat.busy=false;const message=chat.session.messages.find(m=>m.displayText==='排队')!;await chat.editAndRegenerate(message.id,'重新查看');assert.deepEqual(requests.at(-1)!.input[1],requests[0].input[1]);chat.disconnect();
});
