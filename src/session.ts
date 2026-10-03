import type {ModelSelection} from './session-model';
import {contextPrompt,resolveReferences,type Attachment} from './context';
import {attachmentInput} from './media';
import {CodexClient,threadOptions,type Rpc,type Settings} from './codex';
import {toolRecord,toolStatus,type ToolRecord} from './tool-record';
import {inspectWorkspaceMcp,siyuanWorkspacePrompt,type WorkspaceMcpState} from './siyuan-context';
import type {NoteAssetOptions} from './note-assets';
import {readCodexThread,mergeHistory} from './codex-history';
export type Message={tool?:ToolRecord;promptPrefix?:string;id:string;role:'user'|'assistant'|'tool'|'error';text:string;turnId?:string;phase?:'commentary'|'final_answer';startedAt?:number;elapsedMs?:number;status?:string;displayText?:string;attachment?:Attachment;attachments?:Attachment[]};
export type QueuedMessage={promptPrefix?:string;id:string;text:string;displayText:string;attachments?:Attachment[];error?:string};
export type SessionOutcome='completed'|'stopped'|'error';
export type Session={codex?:{adopted:boolean;archived?:boolean};modelProvider?:string;standalone?:{root:string;cwd:string};draft?:string;draftAttachments?:Attachment[];unread?:boolean;lastOutcome?:SessionOutcome;workspaceMode?:'auto'|'manual';workspaceLocked?:boolean;workspaceBinding?:string;queue?:QueuedMessage[];queuePaused?:boolean;id:string;title:string;threadId?:string;modelSelection?:ModelSelection;cwd:string;messages:Message[];updated:number};
export class ChatSession {
  client?:CodexClient;
  busy=false;
  workStartedAt?:number;
  turnId?:string;
  requests=new Map<string,Rpc>();
  status='尚未连接';
  resolvedModel='';resolvedEffort='';resolvedFastMode=false;modelState:'loading'|'ready'|'unavailable'='loading';
  tokenUsage?:{last:{totalTokens:number;inputTokens:number;outputTokens:number};modelContextWindow?:number|null};
  rateLimits?:Record<string,{primary?:{usedPercent:number;windowDurationMins?:number|null}|null;secondary?:{usedPercent:number;windowDurationMins?:number|null}|null}>;
  private modelProbe?:CodexClient;
  private starting?:Promise<void>;
  private epoch=0;
  private stopping=false;
  private inheritedInstructions='';
  queuePending?:string;
  private draining=false;
  onChange:()=>void=()=>{};
  currentActivity:()=>string=()=>'';
  noteAssetOptions:()=>NoteAssetOptions|undefined=()=>undefined;
  workspaceMcpState:WorkspaceMcpState={status:'configured'};
  private workspaceContext(){return siyuanWorkspacePrompt(this.noteAssetOptions()?.workspace,this.settings.mcpUrl,this.settings.mcpEnabled?this.workspaceMcpState:{status:'disabled'});}
  constructor(public session:Session,public settings:Settings,private token:()=>string,private caPath='',private factory=()=>new CodexClient()){if(session.queue?.length)session.queuePaused=true;}
  contextUsageLabel(){const usage=this.tokenUsage;if(!usage)return '尚未收到上下文用量';const current=usage.last.totalTokens;return usage.modelContextWindow?`${current.toLocaleString()} / ${usage.modelContextWindow.toLocaleString()} tokens（${Math.round(current/usage.modelContextWindow*100)}%）`:`${current.toLocaleString()} tokens`;}
  rateLimitLabel(){if(!this.rateLimits)return '尚未读取';return Object.entries(this.rateLimits).flatMap(([name,limit])=>[limit.primary,limit.secondary].filter((w):w is NonNullable<typeof w>=>!!w).map(w=>`${name} · ${w.windowDurationMins? w.windowDurationMins+' 分钟':'额度'}：剩余 ${Math.max(0,100-w.usedPercent)}%`)).join('\n')||'CLI 未提供额度信息';}
  async refreshRateLimits(){
    const client=this.client?.alive?this.client:this.factory(),temporary=client!==this.client,epoch=this.epoch;
    try{if(temporary)await client.start({...this.settings,mcpEnabled:false});const result=await client.request('account/rateLimits/read',{});if(epoch!==this.epoch)return;this.rateLimits=result.rateLimitsByLimitId||(result.rateLimits?{codex:result.rateLimits}:{});this.onChange();}
    finally{if(temporary)client.dispose();}
  }
  async resolveModel(){
    const epoch=this.epoch,probe=this.factory();this.modelProbe?.dispose();this.modelProbe=probe;
    try{
      await probe.start({...this.settings,mcpEnabled:false});
      const [configResult,models]=await Promise.all([probe.request('config/read',{cwd:this.settings.cwd,includeLayers:false}),probe.request('model/list',{})]);
      if(epoch!==this.epoch||this.modelProbe!==probe||this.client?.alive)return;
      const config=configResult.config||{},catalog=models.data||[];
      const model=this.settings.model||config.model||catalog.find((m:any)=>m.isDefault)?.model;
      const info=catalog.find((m:any)=>m.model===model);
      this.resolvedModel=model||'';this.resolvedFastMode=this.settings.fastMode??(config.service_tier==='fast');
      this.resolvedEffort=this.settings.reasoningEffort||config.model_reasoning_effort||info?.defaultReasoningEffort||'';
      this.modelState=model?'ready':'unavailable';this.onChange();
    }catch{if(epoch===this.epoch&&this.modelProbe===probe&&!this.client?.alive){this.modelState='unavailable';this.onChange();}}
    finally{probe.dispose();if(this.modelProbe===probe)this.modelProbe=undefined;}
  }
  async connect(){
    if(this.starting)return this.starting;
    if(this.client?.alive)return;
    const epoch=this.epoch;
    const client=this.factory();this.client=client;
    client.onEvent=m=>{if(this.client===client)this.handle(m);};
    client.onExit=error=>{if(this.client===client){this.finishWork('interrupted');this.session.queuePaused=true;this.busy=false;this.requests.clear();this.session.lastOutcome='error';this.status=error.message;this.onChange();}};
    this.status='连接 Codex…';this.onChange();
    const task=(async()=>{
      try{
        await client.start(this.settings,this.token(),this.caPath);
        // developerInstructions overrides the CLI config field, so preserve the
        // effective user/project value before adding the integration rules.
        const config=await client.request('config/read',{cwd:this.settings.cwd,includeLayers:false});
        this.inheritedInstructions=typeof config.config?.developer_instructions==='string'?config.config.developer_instructions:'';
        if(this.session.codex&&this.session.threadId){
          const history=await readCodexThread(client,this.session.threadId);
          if(epoch!==this.epoch)throw new Error('连接已取消。');
          if(history.thread.status?.type==='active')throw Error('此会话正在 Codex 中运行，请等待回复结束后继续。');
          this.session.messages=mergeHistory(history.messages,this.session.messages);
          if(this.session.codex.archived){await client.request('thread/unarchive',{threadId:this.session.threadId});this.session.codex.archived=false;}
        }
        // Resume keeps historical developer messages and the original base
        // instructions. Add current integration rules without replaying history.
        const opts={...threadOptions(this.settings,this.inheritedInstructions),...(this.session.modelProvider?{modelProvider:this.session.modelProvider}:{})};
        const response=await client.request(this.session.threadId?'thread/resume':'thread/start',this.session.threadId?{...opts,threadId:this.session.threadId,excludeTurns:true}:opts);
        const mcpState=this.settings.mcpEnabled?await inspectWorkspaceMcp(client,response.thread.id):{status:'disabled' as const};
        if(epoch!==this.epoch)throw new Error('连接已取消。');
        if(!client.alive)throw new Error('Codex 连接已关闭，请重新连接。');
        this.workspaceMcpState=mcpState;
        this.resolvedFastMode=response.serviceTier==='fast';this.resolvedModel=response.model||this.settings.model||'';this.resolvedEffort=response.reasoningEffort||'';this.modelState=this.resolvedModel?'ready':'unavailable';
        this.session.threadId=response.thread.id;this.session.cwd=this.settings.cwd;
        this.status='已连接 · '+(response.model||'Codex');this.onChange();
      }catch(e){if(this.client===client){this.client=undefined;client.dispose();this.status=(e as Error).message;this.onChange();}throw e;}
    })();
    this.starting=task;try{await task;}finally{if(this.starting===task)this.starting=undefined;}
  }
  enqueue(text:string,displayText=text,attachments?:Attachment[]){
    if(!this.session.queue?.length&&this.busy)this.session.queuePaused=false;
    (this.session.queue??=[]).push({id:crypto.randomUUID(),text,displayText,attachments:structuredClone(attachments)});this.onChange();return true;
  }
  removeQueued(id:string){if(this.queuePending===id)return;this.session.queue=this.session.queue?.filter(q=>q.id!==id);this.onChange();}
  pauseQueue(paused=true){this.session.queuePaused=paused;this.onChange();if(!paused)void this.drainQueue();}
  editQueued(id:string,text:string){const q=this.session.queue?.find(q=>q.id===id);if(!q||this.queuePending===id||!text.trim())return;const prefix=q.promptPrefix||'';const body=q.text.slice(prefix.length);const context=body.startsWith(q.displayText)?body.slice(q.displayText.length):'';q.displayText=text;q.text=prefix+text+context;q.error=undefined;this.onChange();}
  async steerQueued(id:string){
    const q=this.session.queue?.find(q=>q.id===id);if(!q||this.queuePending)return;
    if(!this.busy||!this.turnId||!this.client?.alive)throw new Error('当前没有可引导的回复，请等待连接或继续排队。');
    const turnId=this.turnId;this.queuePending=id;q.error=undefined;this.onChange();
    try{
      await this.client.request('turn/steer',{threadId:this.session.threadId,expectedTurnId:turnId,input:attachmentInput(q.text+this.workspaceContext()+this.currentActivity(),q.attachments)});
      this.session.messages.push({...(q.promptPrefix?{promptPrefix:q.promptPrefix}:{}),id:q.id,role:'user',text:q.text,displayText:q.displayText,attachments:q.attachments,turnId,status:'steered'});
      this.session.queue=this.session.queue?.filter(x=>x.id!==id);
    }catch(e){q.error='引导失败：'+(e as Error).message;this.session.queuePaused=true;}
    finally{this.queuePending=undefined;this.onChange();if(!this.busy)void this.drainQueue();}
  }
  private async drainQueue(){
    if(this.busy||this.draining||this.queuePending||this.session.queuePaused)return;
    const q=this.session.queue?.[0];if(!q)return;this.draining=true;this.queuePending=q.id;this.onChange();
    try{const accepted=await this.send(q.text,q.displayText,undefined,q.attachments,q.promptPrefix);if(accepted)this.session.queue=this.session.queue?.filter(x=>x.id!==q.id);else{q.error='发送未成功，已暂停。请检查连接后继续。';this.session.queuePaused=true;}}
    finally{this.draining=false;this.queuePending=undefined;this.onChange();if(!this.busy&&!this.session.queuePaused)queueMicrotask(()=>void this.drainQueue());}
  }
  async send(text:string,displayText=text,attachment?:Attachment,attachments?:Attachment[],promptPrefix?:string){
    if(this.busy||!text.trim())return false;
    this.busy=true;this.workStartedAt=Date.now();this.stopping=false;this.turnId=undefined;this.session.lastOutcome=undefined;this.onChange();
    try{
      await this.connect();
      if(this.stopping)return false;
      const inputText=text+this.workspaceContext()+this.currentActivity();
      this.session.workspaceLocked=true;
      const submitted:Message={...(promptPrefix?{promptPrefix}:{}),id:crypto.randomUUID(),role:'user',text,displayText,attachment,attachments,startedAt:this.workStartedAt};
      this.session.messages.push(submitted);this.onChange();
      const result=await this.client!.request('turn/start',{threadId:this.session.threadId,clientUserMessageId:submitted.id,...(this.settings.fastMode!==undefined?{serviceTierForTurn:this.settings.fastMode?'fast':'default'}:{}),...(this.settings.reasoningEffort?{effort:this.settings.reasoningEffort}:{}),input:attachmentInput(inputText,attachments||(attachment?[attachment]:[]))});
      // Notifications may arrive before the response, including turn/completed.
      if(this.busy)this.turnId=result.turn.id;const user=[...this.session.messages].reverse().find(x=>x.role==='user');if(user&&!user.turnId)user.turnId=result.turn.id;
      if(this.session.codex&&!this.session.codex.adopted){this.session.codex.adopted=true;this.onChange();}
      if(this.stopping&&this.turnId)await this.interrupt();
      return true;
    }catch(e){if(this.stopping){this.status='已停止';this.session.lastOutcome='stopped';}else this.error((e as Error).message);this.busy=false;this.onChange();return false;}
  }
  private handle(m:Rpc){
    const p=m.params||{};
    if(p.threadId&&this.session.threadId&&p.threadId!==this.session.threadId)return;
    if(m.method==='thread/tokenUsage/updated')this.tokenUsage=p.tokenUsage;
    if(m.method==='account/rateLimits/updated'&&p.rateLimits){const id=p.rateLimits.limitId||'codex';this.rateLimits={...this.rateLimits,[id]:{...this.rateLimits?.[id],...Object.fromEntries(Object.entries(p.rateLimits).filter(([,value])=>value!==null))}};}
    if(m.id!==undefined&&m.method){
      if(['item/commandExecution/requestApproval','item/fileChange/requestApproval','item/tool/requestUserInput','item/permissions/requestApproval','mcpServer/elicitation/request'].includes(m.method))this.requests.set(String(m.id),m);
      else this.client?.reject(m.id);
      this.onChange();return;
    }
    if(m.method==='turn/started'){this.turnId=p.turn.id;const user=[...this.session.messages].reverse().find(x=>x.role==='user');if(user)user.turnId=p.turn.id;this.status='正在思考…';}
    if(m.method==='item/agentMessage/delta')this.upsert(p.itemId,'assistant',p.delta,true,undefined,p.turnId);
    if(m.method==='item/plan/delta'){this.upsert(p.itemId,'assistant',p.delta,true,undefined,p.turnId);this.session.messages.find(x=>x.id===p.itemId)!.phase='commentary';}
    if(m.method==='item/commandExecution/outputDelta'||m.method==='item/fileChange/outputDelta'){
      this.upsert(p.itemId,'tool',p.delta,true,undefined,p.turnId);const item=this.session.messages.find(x=>x.id===p.itemId)!;
      if(item.tool)item.tool.output=((item.tool.output||'')+p.delta).slice(-200000);
    }
    if(m.method==='item/started'||m.method==='item/completed'){
      const i=p.item;
      const completed=m.method==='item/completed';
      if(i.type==='agentMessage'||i.type==='plan'){this.upsert(i.id,'assistant',i.text||'',false,i.status||(completed?'completed':'inProgress'),p.turnId);const item=this.session.messages.find(x=>x.id===i.id)!;if(i.phase)item.phase=i.phase;else if(i.type==='plan')item.phase='commentary';}
      else {
        const record=toolRecord(i,this.session.messages.find(x=>x.id===i.id)?.tool);
        if(record){this.upsert(i.id,'tool',[record.input,record.output,record.error].filter(Boolean).join('\n'),false,i.status||(completed?'completed':'inProgress'),p.turnId);this.session.messages.find(x=>x.id===i.id)!.tool=record;}
      }
    }
    if(m.method==='serverRequest/resolved')this.requests.delete(String(p.requestId));
    if(m.method==='error'){if(!p.willRetry)this.error(p.error?.message||'Codex 出错');else this.status='连接重试中…';}
    if(m.method==='turn/completed'){
      this.finishWork(p.turn.status==='completed'?'completed':'interrupted',p.turn.id);
      this.busy=false;this.turnId=undefined;this.requests.clear();this.status=p.turn.status==='completed'?'已完成':p.turn.status==='interrupted'?'已停止':'发生错误';
      this.session.lastOutcome=p.turn.status==='completed'?'completed':p.turn.status==='interrupted'?'stopped':'error';
      if(p.turn.error)this.error(p.turn.error.message);
      if(p.turn.status!=='completed'||this.stopping)this.session.queuePaused=true;
      else queueMicrotask(()=>void this.drainQueue());
    }
    this.session.updated=Date.now();this.onChange();
  }
  private upsert(id:string,role:Message['role'],text:string,append=false,status?:string,turnId?:string){
    let item=this.session.messages.find(x=>x.id===id);
    if(!item){item={id,role,text:'',turnId:turnId||this.turnId};this.session.messages.push(item);}
    item.text=(append?item.text+text:text).slice(-200000);if(status)item.status=status;if(turnId)item.turnId=turnId;
  }
  private finishWork(status:string,turnId=this.turnId){
    const user=[...this.session.messages].reverse().find(x=>x.role==='user'&&x.status!=='steered'&&x.startedAt&&(!turnId||!x.turnId||x.turnId===turnId));
    if(user?.startedAt&&user.elapsedMs===undefined)user.elapsedMs=Date.now()-user.startedAt;
    for(const item of this.session.messages)if(item.role==='tool'&&item.turnId===turnId&&toolStatus(item)==='进行中')item.status=status;
  }
  async forkAt(messageId:string):Promise<{session:Session;draft?:Message}>{
    if(this.busy)throw new Error('请先等待当前回复完成或停止生成。');
    const index=this.session.messages.findIndex(m=>m.id===messageId),message=this.session.messages[index];
    if(!message||!['user','assistant'].includes(message.role))throw new Error('不能从此消息创建分支。');
    if(!this.session.threadId)throw new Error('此旧会话没有 CLI 线程记录，无法创建分支。');
    this.busy=true;this.workStartedAt=Date.now();this.onChange();
    try{
      await this.connect();let turnId=message.turnId;
      if(!turnId){const result=await this.client!.request('thread/read',{threadId:this.session.threadId,includeTurns:true});const userIndex=this.session.messages.slice(0,index+1).filter(m=>m.role==='user').length-1;turnId=result.thread?.turns?.[userIndex]?.id;}
      if(!turnId)throw new Error('无法定位此消息对应的 CLI 回合。');
      const response=await this.client!.request('thread/fork',{...threadOptions(this.settings,this.inheritedInstructions),...(this.session.modelProvider?{modelProvider:this.session.modelProvider}:{}),excludeTurns:true,deferGoalContinuation:true,threadId:this.session.threadId,...(message.role==='user'?{beforeTurnId:turnId}:{lastTurnId:turnId})});
      if(!response.thread?.id||response.thread.id===this.session.threadId)throw new Error('CLI 未返回独立分支。');
      const session=newSession(this.session.cwd,{...this.session.modelSelection,model:this.settings.model,modelName:this.settings.modelName,reasoningEffort:this.settings.reasoningEffort,fastMode:this.settings.fastMode});
      session.workspaceLocked=true;session.workspaceMode=this.session.workspaceMode;session.workspaceBinding=this.session.workspaceBinding;session.standalone=structuredClone(this.session.standalone);
      session.modelProvider=this.session.modelProvider;
      session.title=this.session.title+' · 分支';session.threadId=response.thread.id;session.messages=structuredClone(this.session.messages.slice(0,message.role==='user'?index:index+1));
      return {session,draft:message.role==='user'?structuredClone(message):undefined};
    }finally{this.busy=false;this.onChange();}
  }
  async editAndRegenerate(messageId:string,text:string){
    if(this.busy)throw new Error('请等待当前回复结束后再编辑。');
    if(!text.trim())throw new Error('消息不能为空。');
    const message=this.session.messages.find(m=>m.id===messageId&&m.role==='user');if(!message)throw new Error('找不到原消息。');
    const original={threadId:this.session.threadId,messages:this.session.messages};
    const fork=await this.forkAt(messageId);
    const attachments=await resolveReferences([],structuredClone(message.attachments||(message.attachment?[message.attachment]:[])),this.noteAssetOptions());
    this.disconnect();this.session.threadId=fork.session.threadId;this.session.messages=fork.session.messages;this.session.queuePaused=true;
    const prefix=message.promptPrefix||'';
    const accepted=await this.send(prefix+text+contextPrompt(attachments),text,undefined,attachments,prefix);
    if(!accepted){this.disconnect();this.session.threadId=original.threadId;this.session.messages=original.messages;this.onChange();throw new Error('重新发送失败，原对话已保留，请重试。');}
    this.onChange();
  }
  error(text:string){this.session.messages.push({id:crypto.randomUUID(),role:'error',text});this.session.lastOutcome='error';this.status='发生错误';}
  answer(id:string,result:any){const req=this.requests.get(id);if(req?.id!==undefined){this.client?.respond(req.id,result);this.requests.delete(id);this.onChange();}}
  async interrupt(){
    this.session.queuePaused=true;this.stopping=true;
    if(this.turnId&&this.client?.alive){await this.client.request('turn/interrupt',{threadId:this.session.threadId,turnId:this.turnId});if(this.busy)this.status='正在停止…';}
    else {this.disconnect();this.status='已停止';this.session.lastOutcome='stopped';}
    this.onChange();
  }
  disconnect(){if(this.busy)this.finishWork('interrupted');this.session.queuePaused=true;this.epoch++;this.modelProbe?.dispose();this.modelProbe=undefined;const c=this.client;this.client=undefined;c?.dispose();this.busy=false;this.turnId=undefined;this.requests.clear();this.starting=undefined;this.status='已断开';}
}
export function newSession(cwd:string,modelSelection?:ModelSelection):Session{return {modelSelection,id:crypto.randomUUID(),title:'新对话',cwd,messages:[],updated:Date.now()};}
