import {newSessionModel} from './session-model';
import {ComposerPopover,permissionPanel,modelPanel,effortPanel,type ModelInfo} from './popover';
import {permissionModes} from './permissions';
import {effortLabel} from './model-options';
import {Plugin,Dialog,ProtyleMethod,showMessage,getActiveEditor,getActiveTab,openTab} from 'siyuan';
import {setMarkdownHighlighter} from './render';
import {CodexClient,defaults,validateSettings,expandPath,type Settings} from './codex';
import {CliCheckView,welcomePage} from './welcome';
import {ChatSession,newSession,type Session} from './session';
import {searchCodexHistory,readCodexThread,importedSession,pluginHistory,type CodexHistoryEntry} from './codex-history';
import {sessionSummary,isUnstarted} from './session-state';
import {ChatView,el,button} from './ui';
import './style.css';
import {nativeComposer} from './native-composer';
import {referenceTitle,resolveReferences,contextPrompt,searchNoteTitles,conversationAttachment,type Attachment} from './context';
import {importMedia} from './media';
import type {MediaSource} from './composer-media';
import {currentActivityPrompt} from './activity';
import type {NoteAssetOptions} from './note-assets';
import {sideConversationPrefix} from './prompts';
import {codexProjectlessRoot,sessionStandaloneDirectory,isStandaloneDirectory,prepareStandalone,validateDirectory,workspaceLocked,followsDocument,readBindings,matchingBinding,readWorkspaceDocument,type WorkspaceBinding} from './workspaces';
import {workspacePanel} from './workspace-menu';
import {codexSymbol} from './brand';
import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';

declare global {interface Window {siyuan:any;}}
export default class SiYuanCodex extends Plugin {
  private settings:Settings={...defaults};private sessions:Session[]=[];private chat!:ChatSession;
  private chats=new Map<string,ChatSession>();
  private sideViews=new Map<string,{view:ChatView;dialog:Dialog}>();
  private view?:ChatView;private ready:Promise<void>=Promise.resolve();private saveTimer?:ReturnType<typeof setTimeout>;
  private saveQueue=Promise.resolve();private dialogs=new Set<Dialog>();private auxiliaryClients=new Set<CodexClient>();private disposed=false;private contextEpoch=0;
  private get attachments(){return this.chat.session.draftAttachments??=[];}
  private set attachments(value:Attachment[]){this.chat.session.draftAttachments=value;}
  private popover?:ComposerPopover;
  private mediaSources=new Map<string,MediaSource>();
  private mediaPreviews=new Map<string,Promise<string>>();
  private modelCache=new Map<string,{models?:ModelInfo[];updated:number;pending?:Promise<ModelInfo[]>}>();
  private workspaceBindings:WorkspaceBinding[]=[];private workspaceEpoch=0;private workspacePreparing=false;
  private workspaceError='';
  private standaloneRoot=codexProjectlessRoot();
  private standaloneProbe?:{client:CodexClient;binary:string;ready:Promise<void>;starting:boolean};
  private currentDoc?:string;
  private historyOpenEpoch=0;
  private welcomePending=false;private welcomeDialog?:Dialog;
  private editorListener=({detail,type}:any)=>{const id=detail?.protyle?.block?.rootID||getActiveEditor(false)?.protyle?.block?.rootID;if(id){if(id===this.currentDoc&&type==='click-editorcontent'&&!this.workspaceError)return;this.currentDoc=id;void this.ready.then(()=>this.followWorkspace(id)).catch(e=>showMessage(e.message));}};
  private selectionMenuListener=({detail}:any)=>{if(detail?.range&&detail?.menu)this.view?.addSelectionMenu(detail.menu,detail.range);};
  onload(){
    setMarkdownHighlighter(element=>ProtyleMethod.highlightRender(element));
    this.addIcons(codexSymbol);
    this.chat=this.makeChat(newSession(''));
    const self=this;
    this.addDock({type:'chat',config:{position:'RightBottom',size:{width:400,height:0},icon:'iconSiYuanCodex',title:'思源 Codex'},data:{},init(){self.mount(this.element as HTMLElement);}});
    this.addCommand({langKey:'openSiYuanCodex',langText:'打开思源 Codex',hotkey:'⌥⇧A',execute:()=>this.openPanel()});
    this.eventBus.on('open-menu-content',this.selectionMenuListener);
    this.eventBus.on('switch-protyle',this.editorListener);this.eventBus.on('loaded-protyle-static',this.editorListener);this.eventBus.on('click-editorcontent',this.editorListener);
    this.ready=this.load();
  }
  onLayoutReady(){void this.ready.then(()=>{if(this.welcomePending&&!this.disposed)void this.showWelcome();});}
  private async load(){
    try{
      const [settings,state,workspaces,onboarding]=await Promise.all([this.loadPluginData('settings.json'),this.loadPluginData('sessions.json'),this.loadPluginData('workspaces.json'),this.loadData('onboarding.json')]);
      this.welcomePending=!onboarding?.seen&&!Object.keys(settings||{}).length&&!state?.sessions?.length;
      this.settings={...defaults,...settings,mcpEnabled:true,mcpUrl:`${location.origin}/mcp`};
      await this.refreshStandaloneRoot();
      this.workspaceBindings=readBindings(workspaces);
      this.sessions=Array.isArray(state?.sessions)?state.sessions.filter((s:any)=>s&&typeof s.id==='string'&&Array.isArray(s.messages)):[];
      if(!this.sessions.length)this.sessions=[this.emptySession()];
      for(const session of this.sessions){
        if(session.queue?.length)session.queuePaused=true;
        if(!session.workspaceMode){session.workspaceMode='manual';session.workspaceLocked=workspaceLocked(session);}
        if(!session.cwd){session.cwd=this.settings.cwd||sessionStandaloneDirectory(session,this.standaloneRoot);if(!this.settings.cwd)session.workspaceMode='auto';}
      }
      for(const session of this.sessions)session.modelSelection??={model:this.settings.model,modelName:this.settings.modelName,reasoningEffort:this.settings.reasoningEffort,fastMode:this.settings.fastMode};
      if(this.disposed)return;
      for(const chat of this.chats.values())chat.disconnect();this.chats.clear();
      this.reuseUnstarted(state?.active);
      this.chat=this.makeChat(this.sessions.find(s=>s.id===state?.active)||this.sessions[0]);this.chat.session.unread=false;await this.followWorkspace(this.activeDocument());this.view?.update();this.persist();
    }catch(e){showMessage(`思源 Codex 数据加载失败：${(e as Error).message}`);}
  }
  private async loadPluginData(name:string){
    const current=await this.loadData(name);
    if(current!=null&&current!==''&&!(typeof current==='object'&&!Object.keys(current).length))return current;
    const workspace=window.siyuan?.config?.system?.workspaceDir;if(!workspace)return current;
    let legacy;
    try{legacy=JSON.parse(await readFile(join(workspace,'data','storage','petal','siyuan-local-agent',name),'utf8'));}
    catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return current;throw e;}
    // Keep legacy files and attachment paths intact; only fill missing new-plugin data.
    const result=await this.saveData(name,legacy);
    if(result?.code)throw Error(result.msg||'旧插件数据迁移失败。');
    return legacy;
  }
  private makeChat(session:Session){
    const existing=this.chats.get(session.id);if(existing)return existing;
    if(session.cwd)prepareStandalone(session);
    session.modelSelection??={model:this.settings.model,modelName:this.settings.modelName,reasoningEffort:this.settings.reasoningEffort,fastMode:this.settings.fastMode};
    const chat=new ChatSession(session,{...this.settings,...session.modelSelection,cwd:session.cwd||this.settings.cwd},()=>{if(chat.settings.mcpEnabled&&new URL(chat.settings.mcpUrl).origin!==location.origin)throw new Error('MCP 地址与当前思源不同源，已阻止传递 Token。');return window.siyuan?.config?.api?.token||'';},this.localCA());
    this.chats.set(session.id,chat);
    chat.currentActivity=()=>this.settings.activeTabContext===true?currentActivityPrompt(()=>getActiveTab(false)):'';
    chat.noteAssetOptions=()=>this.noteAssetOptions();
    let outcome=session.lastOutcome,requests=0;
    chat.onChange=()=>{
      if(this.disposed||this.chats.get(session.id)!==chat)return;
      if(chat!==this.chat&&!this.sideViews.has(session.id)&&((session.lastOutcome&&session.lastOutcome!==outcome)||chat.requests.size>requests))session.unread=true;
      outcome=session.lastOutcome;requests=chat.requests.size;
      this.sideViews.get(session.id)?.view.update();this.view?.update();
      if(this.saveTimer)clearTimeout(this.saveTimer);this.saveTimer=setTimeout(()=>this.persist(),400);
    };queueMicrotask(()=>{if(!this.disposed&&this.chat===chat&&chat.settings.cwd)void chat.resolveModel();});return chat;
  }
  private resetChat(chat:ChatSession){chat.disconnect();this.chats.delete(chat.session.id);const next=this.makeChat(chat.session);if(this.chat===chat)this.chat=next;return next;}
  private selectSession(id:string){
    const session=this.sessions.find(s=>s.id===id);if(!session||this.disposed)return;
    this.historyOpenEpoch++;
    if(this.chat.session.id===id){session.unread=false;this.view?.update();return;}
    const existing=this.chats.has(id);this.workspaceEpoch++;this.popover?.close(false);this.sideViews.get(id)?.dialog.destroy();
    this.chat=this.makeChat(session);session.unread=false;this.workspaceError='';this.workspacePreparing=false;this.contextEpoch++;
    this.view?.update();this.persist();void this.followWorkspace(this.activeDocument());
    if(existing&&this.chat.modelState==='loading'&&!this.chat.busy)void this.chat.resolveModel();
  }
  private deleteSession(id:string,terminate=false){
    if(!this.sessions.some(s=>s.id===id))return;
    const target=this.chats.get(id);if((target?.busy||target?.requests.size)&&!terminate){showMessage('删除此对话会终止 Agent 工作，请确认删除。');return;}
    if(target)target.onChange=()=>{};
    target?.disconnect();this.chats.delete(id);
    this.sessions=this.sessions.filter(s=>s.id!==id);
    if(this.chat.session.id===id){if(!this.sessions.length)this.sessions.push(this.emptySession());this.selectSession(this.sessions[0].id);}
    this.sideViews.get(id)?.dialog.destroy();
    this.persist();this.view?.update();
  }
  private localCA(){
    const workspace=window.siyuan?.config?.system?.workspaceDir;
    try{const u=new URL(this.settings.mcpUrl);return workspace&&u.origin===location.origin&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)?join(workspace,'conf','ca.crt'):'';}catch{return '';}
  }
  private noteAssetOptions():NoteAssetOptions|undefined{const workspace=window.siyuan?.config?.system?.workspaceDir;return typeof workspace==='string'&&workspace?{workspace,origin:location.origin}:undefined;}
  private persist(){
    if(this.disposed)return;
    const retained=this.sessions.filter(pluginHistory);
    const data=JSON.parse(JSON.stringify({active:retained.some(s=>s.id===this.chat.session.id)?this.chat.session.id:retained[0]?.id,sessions:retained}));
    this.saveQueue=this.saveQueue.then(()=>this.saveData('sessions.json',data)).catch(e=>{showMessage(`对话保存失败：${e.message}`);});
  }
  private async historyClient<T>(run:(client:CodexClient)=>Promise<T>){
    await this.ready;if(this.disposed)throw Error('插件已关闭。');
    const client=new CodexClient();this.auxiliaryClients.add(client);
    try{await client.start({...this.settings,cwd:homedir(),mcpEnabled:false});if(this.disposed)throw Error('插件已关闭。');return await run(client);}
    finally{client.dispose();this.auxiliaryClients.delete(client);}
  }
  private async openCodexHistory(entry:CodexHistoryEntry,isCurrent=()=>true){
    await this.ready;if(this.disposed||!isCurrent())return;
    const existing=this.sessions.find(s=>s.threadId===entry.threadId);
    if(existing){this.selectSession(existing.id);return;}
    const epoch=++this.historyOpenEpoch;
    const {thread,messages}=await this.historyClient(client=>readCodexThread(client,entry.threadId));
    if(this.disposed||epoch!==this.historyOpenEpoch||!isCurrent())return;
    const duplicate=this.sessions.find(s=>s.threadId===entry.threadId);
    if(duplicate){this.selectSession(duplicate.id);return;}
    const session=importedSession(thread,messages);session.codex!.archived=entry.archived;
    this.sessions.unshift(session);this.selectSession(session.id);
  }
  private mount(root:HTMLElement){this.view?.destroy();this.view=new ChatView(root,()=>this.chat,{
    send:async(text,refs=[])=>{const chat=this.chat;const epoch=this.contextEpoch;await this.ready;if(this.chat!==chat)return false;this.workspacePreparing=true;try{await this.followWorkspace(this.activeDocument(),true);
      if(this.chat!==chat||epoch!==this.contextEpoch||this.disposed)return false;
      if(this.workspaceError&&followsDocument(chat.session,chat.busy))throw Error(this.workspaceError);
      const draftAttachments=[...this.attachments];const attachments=await resolveReferences(refs,draftAttachments,this.noteAssetOptions());
      if(this.chat!==chat||epoch!==this.contextEpoch||this.disposed)return false;
      if(this.chat.session.title==='新对话')this.chat.session.title=text.slice(0,32);
      const accepted=chat.busy||chat.session.queue?.length?chat.enqueue(text+contextPrompt(attachments),text,attachments):await chat.send(text+contextPrompt(attachments),text,undefined,attachments);if(accepted){chat.session.draftAttachments=(chat.session.draftAttachments||[]).filter(a=>!draftAttachments.includes(a));if(this.chat===chat){this.contextEpoch++;this.view?.update();}}this.persist();return accepted;}finally{if(this.chat===chat)this.workspacePreparing=false;}},
    queueSide:id=>this.openQueueSide(id),
    branch:async id=>{const source=this.chat;const result=await source.forkAt(id);if(this.disposed||!this.sessions.includes(source.session))return;result.session.draftAttachments=result.draft?.attachments||(result.draft?.attachment?[result.draft.attachment]:[]);result.session.draft=result.draft?.displayText??result.draft?.text;this.sessions.unshift(result.session);if(this.chat===source)this.selectSession(result.session.id);else this.view?.update();this.persist();},
    stop:()=>{void this.chat.interrupt().catch(e=>showMessage(e.message));},settings:()=>this.openSetting(),
    newChat:()=>{void this.fresh().catch(e=>showMessage(e.message));},select:id=>this.selectSession(id),
    list:()=>this.sessions.map(s=>sessionSummary(s,this.chats.get(s.id))),draftChanged:()=>this.scheduleSave(),attach:()=>this.attach(),clear:()=>{this.attachments=[];this.contextEpoch++;this.view?.update();},context:()=>'',
    searchCodex:(query,cursor)=>this.historyClient(client=>searchCodexHistory(client,query,cursor)),openCodex:(entry,isCurrent)=>this.openCodexHistory(entry,isCurrent),
    models:()=>this.cachedModels(),quickSetting:patch=>this.applyQuickSetting(patch),searchNotes:searchNoteTitles,referenceConversation:id=>this.attachConversation(id),
    ...this.activityMenuActions(),
    composer:nativeComposer(this.app),attachments:()=>this.attachments,removeAttachment:index=>{const key=this.attachments[index]?.media?.key;if(key)this.mediaSources.delete(key);this.attachments.splice(index,1);this.contextEpoch++;this.view?.update();},
    importMedia:sources=>this.addMedia(sources),retryMedia:key=>this.retryMedia(key),
    previewMedia:attachment=>this.previewMedia(attachment),
    drop:ids=>this.attachIDs(ids),workspace:()=>window.siyuan?.config?.system?.workspaceDir||'',error:text=>showMessage(text),
    openReference:id=>{openTab({app:this.app,doc:{id}});},
    model:anchor=>{void this.modelMenu(anchor);},effort:anchor=>{void this.modelMenu(anchor,true);},permission:anchor=>this.permissionMenu(anchor),
    directory:anchor=>{void this.workspaceMenu(anchor);},
    editMessage:async(id,text)=>{await this.chat.editAndRegenerate(id,text);this.persist();},
    editAttachments:attachments=>{this.attachments=attachments.map(a=>({...a}));this.contextEpoch++;this.view?.update();},
    rename:(id,title)=>{const s=this.sessions.find(s=>s.id===id);if(s){s.title=title;this.persist();this.view?.update();}},
    delete:(id,terminate)=>this.deleteSession(id,terminate),
    close:()=>{const trigger=document.querySelector<HTMLElement>(`.dock__item[data-type="${CSS.escape(this.name+'chat')}"]`);if(trigger?.classList.contains('dock__item--active'))trigger.click();}

  });}
  private openQueueSide(id:string){
    const source=this.chat,q=source.session.queue?.find(q=>q.id===id);if(!q||source.queuePending===id)return;
    const session=newSession(source.settings.cwd,{model:source.settings.model,modelName:source.settings.modelName,reasoningEffort:source.settings.reasoningEffort,fastMode:source.settings.fastMode});session.title='侧边聊天 · '+q.displayText.slice(0,24);this.sessions.unshift(session);
    session.workspaceLocked=true;
    session.standalone=structuredClone(source.session.standalone);
    const side=this.makeChat(session);let dialog:Dialog;const root=el('div','la-side-chat');let view:ChatView;
    session.draftAttachments=[];
    const prefix=sideConversationPrefix(source.session.messages);
    const changed=()=>{if(root.isConnected)view.update();this.scheduleSave();};
    view=new ChatView(root,()=>side,{...this.activityMenuActions(),captureNoteSelections:false,editAttachments:items=>{session.draftAttachments=items;changed();},composer:nativeComposer(this.app),draftChanged:()=>this.scheduleSave(),send:async(text,inline=[])=>{const refs=[...(session.draftAttachments||[])],attached=await resolveReferences(inline,refs,this.noteAssetOptions()),prompt=text+contextPrompt(attached);if(this.disposed||this.chats.get(session.id)!==side)return false;const accepted=side.busy||side.session.queue?.length?side.enqueue(prompt,text,attached):await side.send(prompt,text,undefined,attached);if(accepted){session.draftAttachments=(session.draftAttachments||[]).filter(a=>!refs.includes(a));changed();}return accepted;},stop:()=>{void side.interrupt().catch(e=>showMessage(e.message));},settings:()=>showMessage('侧边聊天沿用打开时的模型和权限设置。'),newChat:()=>showMessage('请关闭此窗口后从主会话打开新的侧边聊天。'),select:()=>{},list:()=>[],attach:()=>this.attach(side),drop:ids=>this.attachIDs(ids,side),searchNotes:searchNoteTitles,workspace:()=>window.siyuan?.config?.system?.workspaceDir||'',clear:()=>{session.draftAttachments=[];changed();},context:()=>'',attachments:()=>session.draftAttachments||[],removeAttachment:i=>{const refs=session.draftAttachments||[];if(refs[i]?.media)this.mediaSources.delete(refs[i].media!.key);refs.splice(i,1);changed();},importMedia:sources=>this.addMedia(sources,session.draftAttachments,changed),retryMedia:key=>this.retryMedia(key,session.draftAttachments,changed),previewMedia:a=>this.previewMedia(a),close:()=>dialog.destroy(),error:message=>showMessage(message)});
    session.queue=[{...structuredClone(q),promptPrefix:prefix+(q.promptPrefix||''),text:prefix+q.text}];session.queuePaused=true;view.update();source.removeQueued(id);
    dialog=new Dialog({title:'侧边聊天 · 关闭窗口后仍可在会话条继续',content:'<div class="la-side-host"></div>',width:'480px',destroyCallback:()=>{view.destroy();this.sideViews.delete(session.id);this.persist();this.dialogs.delete(dialog);this.view?.update();}});dialog.element.querySelector('.la-side-host')!.append(root);this.sideViews.set(session.id,{view,dialog});this.dialogs.add(dialog);this.persist();this.view?.update();
  }
  private reuseUnstarted(preferredId?:string){
    const available=this.sessions.filter(s=>isUnstarted(s,this.chats.get(s.id)));
    const keep=available.find(s=>s.id===preferredId)||available.find(s=>s.draft||s.draftAttachments?.length)||available[0];
    // Consolidate old blank placeholders, retaining drafts and explicitly configured chats.
    const redundant=new Set(available.filter(s=>s!==keep&&s.title==='新对话'&&!s.draft&&!s.draftAttachments?.length&&s.workspaceMode==='auto'&&!s.workspaceLocked).map(s=>s.id));
    for(const id of redundant){const chat=this.chats.get(id);this.chats.delete(id);chat?.disconnect();}
    this.sessions=this.sessions.filter(s=>!redundant.has(s.id));return keep;
  }
  private async fresh(){await this.ready;if(this.disposed)return;let s=this.reuseUnstarted(this.chat.session.id);if(!s){s=this.emptySession();this.sessions.unshift(s);}this.selectSession(s.id);this.persist();}
  private scheduleSave(){if(this.disposed)return;if(this.saveTimer)clearTimeout(this.saveTimer);this.saveTimer=setTimeout(()=>this.persist(),400);}
  private async refreshStandaloneRoot(){
    const binary=this.settings.binary||'';
    if(!this.standaloneProbe||this.standaloneProbe.binary!==binary||(!this.standaloneProbe.starting&&!this.standaloneProbe.client.alive)){
      if(this.standaloneProbe){this.standaloneProbe.client.dispose();this.auxiliaryClients.delete(this.standaloneProbe.client);}
      const client=new CodexClient(5000);this.auxiliaryClients.add(client);
      const probe={client,binary,ready:Promise.resolve(),starting:true};this.standaloneProbe=probe;
      probe.ready=client.start({...this.settings,cwd:homedir(),mcpEnabled:false}).finally(()=>{probe.starting=false;});
    }
    const probe=this.standaloneProbe,client=probe.client;
    let config:unknown;
    try{
      // Read user configuration outside any project; don't inherit its desktop
      // overrides or initialize a stored thread merely to discover the folder.
      // Reuse the metadata connection opened during load. A config/read RPC
      // still honors changed user preferences without another process startup.
      await probe.ready;
      config=(await client.request('config/read',{cwd:homedir(),includeLayers:false})).config;
    }catch{client.dispose();this.auxiliaryClients.delete(client);if(this.standaloneProbe===probe)this.standaloneProbe=undefined;return;}
    if(this.disposed||this.standaloneProbe!==probe)return;
    this.standaloneRoot=codexProjectlessRoot(config);
  }
  private emptySession(){const s=newSession('',newSessionModel(this.settings));s.workspaceMode='auto';s.cwd=sessionStandaloneDirectory(s,this.standaloneRoot);return s;}
  private activeDocument(){return getActiveEditor(false)?.protyle?.block?.rootID||this.currentDoc;}
  private setWorkspace(cwd:string,mode:'auto'|'manual',binding?:string){
    if(workspaceLocked(this.chat.session,this.chat.busy))throw Error('本会话已固定工作目录，请新建对话后选择。');
    const chat=this.chat;const changed=chat.settings.cwd!==cwd;
    prepareStandalone({...chat.session,cwd});
    if(!changed&&chat.session.workspaceMode===mode&&chat.session.workspaceBinding===binding&&!this.workspaceError)return;
    if(changed)chat.disconnect();
    Object.assign(chat.session,{cwd,workspaceMode:mode,workspaceBinding:binding});chat.settings={...chat.settings,cwd};
    this.workspaceError='';this.view?.update();this.persist();if(changed)void chat.resolveModel();
  }
  private async followWorkspace(id?:string,preparing=false){
    if(this.disposed||(!preparing&&this.workspacePreparing)||!followsDocument(this.chat.session,this.chat.busy))return;
    const epoch=++this.workspaceEpoch,chat=this.chat;
    try{
      const doc=id&&this.workspaceBindings.length?await readWorkspaceDocument(id):undefined;
      if(this.disposed||epoch!==this.workspaceEpoch||chat!==this.chat||!followsDocument(chat.session,chat.busy)||(!preparing&&this.workspacePreparing))return;
      const binding=doc?matchingBinding(doc,this.workspaceBindings):undefined;
      if(!binding&&preparing){await this.refreshStandaloneRoot();if(this.disposed||epoch!==this.workspaceEpoch||chat!==this.chat||!followsDocument(chat.session,chat.busy))return;}
      const cwd=binding?validateDirectory(binding.cwd):sessionStandaloneDirectory(chat.session,this.standaloneRoot);
      this.setWorkspace(cwd,'auto',binding?.title);
    }catch(e){if(!this.disposed&&epoch===this.workspaceEpoch&&chat===this.chat&&followsDocument(chat.session,chat.busy)){this.workspaceError=`工作目录自动选择失败：${(e as Error).message}。请在顶栏重新选择目录或修复绑定。`;this.view?.update();showMessage(this.workspaceError);}}
  }
  private async workspaceMenu(anchor:HTMLElement){
    await this.ready;const pop=this.openPopover(anchor,'工作目录');if(!pop)return;const chat=this.chat;
    pop.element.classList.add('la-workspace-popover');pop.replace(el('div','la-popover-title','工作目录'),el('p','la-popover-note','正在读取当前文档…'));
    let doc:Awaited<ReturnType<typeof readWorkspaceDocument>>|undefined;let error=this.workspaceError;
    try{await this.refreshStandaloneRoot();const id=this.activeDocument();if(id)doc=await readWorkspaceDocument(id);}catch(e){error=(e as Error).message;}
    if(pop.closed||this.disposed||chat!==this.chat||!anchor.isConnected){pop.close(false);return;}
    const ensureCurrent=()=>{if(this.disposed||chat!==this.chat||this.workspacePreparing)throw Error('会话已变更，请重新打开目录菜单。');};
    const saveBinding=async(entries:WorkspaceBinding[])=>{const result=await this.saveData('workspaces.json',{bindings:entries});if(result&&typeof result.code==='number'&&result.code!==0)throw Error(result.msg||'保存文档绑定失败。');this.workspaceBindings=entries;await this.followWorkspace(this.activeDocument());};
    workspacePanel(pop,{cwd:chat.settings.cwd,standalone:isStandaloneDirectory(chat.settings.cwd,chat.session.standalone?.root||this.standaloneRoot),locked:workspaceLocked(chat.session,chat.busy)||this.workspacePreparing,automatic:chat.session.workspaceMode==='auto',document:doc,binding:doc&&this.workspaceBindings.find(b=>b.docID===doc.id),inherited:doc&&matchingBinding(doc,this.workspaceBindings.filter(b=>b.docID!==doc.id)),recent:[...new Set([...this.workspaceBindings.map(b=>b.cwd),...this.sessions.filter(s=>s.workspaceMode==='manual').map(s=>s.cwd)])],error},{
      choose:async value=>{ensureCurrent();const cwd=validateDirectory(value);this.workspaceEpoch++;this.setWorkspace(cwd,'manual');},
      follow:async()=>{ensureCurrent();if(workspaceLocked(chat.session,chat.busy))throw Error('本会话已固定目录。');chat.session.workspaceMode='auto';await this.followWorkspace(this.activeDocument());if(this.workspaceError)throw Error(this.workspaceError);},
      bind:async(document,value)=>{ensureCurrent();const cwd=validateDirectory(value);await saveBinding([...this.workspaceBindings.filter(b=>b.docID!==document.id),{docID:document.id,title:document.title,cwd}]);},
      unbind:async document=>{ensureCurrent();await saveBinding(this.workspaceBindings.filter(b=>b.docID!==document.id));},
      browse:async value=>{const {ipcRenderer}=require('electron');const result=await ipcRenderer.invoke('siyuan-get',{cmd:'showOpenDialog',title:'选择工作目录',defaultPath:value?.trim()?expandPath(value.trim()):chat.settings.cwd,properties:['openDirectory','createDirectory']});return result.canceled?undefined:result.filePaths?.[0];}
    });
  }
  private openPanel(){
    const type=this.name+'chat';
    const trigger=document.querySelector<HTMLElement>(`.dock__item[data-type="${CSS.escape(type)}"]`);
    const layout=window.siyuan?.layout;
    const dock=[layout?.leftDock,layout?.rightDock,layout?.bottomDock].find(d=>d?.elements?.some((e:Element)=>!!trigger&&e.contains(trigger)));
    if(dock?.toggleModel)dock.toggleModel(type,true);
    else if(trigger&&!trigger.classList.contains('dock__item--active'))trigger.click();
  }
  private async attachIDs(ids:string[],chat=this.chat){
    const epoch=this.contextEpoch;const main=chat===this.chat;
    const refs=[];
    for(const id of [...new Set(ids)]){
      const ref=await referenceTitle(id);
      if(this.disposed||this.chats.get(chat.session.id)!==chat||(main&&(epoch!==this.contextEpoch||chat!==this.chat)))throw new Error('输入上下文已变更，请重新添加笔记。');
      refs.push(ref);
    }
    return refs;
  }
  private async attach(chat=this.chat){
    await this.ready;
    const active=getActiveEditor(false)?.protyle?.block?.rootID;const id=active||this.currentDoc;if(!id)throw new Error('请先打开笔记，或将文档树中的笔记拖到侧栏。');return this.attachIDs([id],chat);
  }
  private async addMedia(sources:MediaSource[],target=this.attachments,changed=()=>this.view?.update()){
    const fresh=sources.filter(s=>!target.some(a=>a.media?.key===s.key));
    if(target.length+fresh.length>20)throw Error('一次最多附加 20 项，请移除部分附件后重试。');
    const entries=fresh.map(s=>({title:s.title,text:'',media:{key:s.key,kind:s.kind,marker:s.marker,status:'loading' as const}}));
    target.push(...entries);if(target===this.attachments)this.contextEpoch++;changed();
    await this.ready;
    for(let i=0;i<fresh.length;i++){if(!target.includes(entries[i]))continue;await this.prepareMedia(fresh[i],entries[i],changed);if(!target.includes(entries[i]))this.mediaSources.delete(fresh[i].key);}
  }
  private async prepareMedia(source:MediaSource,entry:Attachment,changed=()=>this.view?.update()){
    this.mediaSources.set(source.key,source);
    entry.media!.status='loading';entry.media!.error=undefined;changed();
    try{const result=await importMedia(source,window.siyuan?.config?.system?.workspaceDir||'',location.origin);Object.assign(entry,result);this.mediaSources.delete(source.key);}
    catch(e){entry.media!.status='error';entry.media!.error=(e as Error).message;}
    if(!this.disposed)changed();
  }
  private async retryMedia(key:string,target=this.attachments,changed=()=>this.view?.update()){const source=this.mediaSources.get(key),entry=target.find(a=>a.media?.key===key);if(source&&entry)await this.prepareMedia(source,entry,changed);}
  private previewMedia(attachment:Attachment){
    const path=attachment.media?.path;if(!path)return Promise.resolve('');
    let pending=this.mediaPreviews.get(path);if(!pending){pending=readFile(path).then(bytes=>{
      if(this.disposed)return '';const types:Record<string,string>={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif'};
      return URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:types[path.split('.').at(-1)!.toLowerCase()]||'application/octet-stream'}));
    }).catch(()=>{this.mediaPreviews.delete(path);return '';});this.mediaPreviews.set(path,pending);}return pending;
  }
  private async attachConversation(id:string){
    await this.ready;const session=this.sessions.find(s=>s.id===id);if(!session||session.id===this.chat.session.id)throw new Error('请选择其他历史对话。');
    if(this.attachments.some(a=>a.conversationId===id))return;
    if(this.attachments.length>=20)throw new Error('一次最多附加 20 项。');const attachment=conversationAttachment(session);
    if(this.attachments.reduce((n,a)=>n+a.text.length,0)+attachment.text.length>120000)throw new Error('上下文超过 120,000 字符，请选择更短的对话。');
    this.attachments.push(attachment);this.contextEpoch++;this.view?.update();
  }
  private async applyQuickSetting(patch:Partial<Settings>){
    const chat=this.chat;if(chat.busy)throw new Error('请先停止当前对话。');
    const modelChange='model' in patch||'reasoningEffort' in patch||'fastMode' in patch;
    const settings={...this.settings,...(modelChange?chat.session.modelSelection:{}),...patch};await this.saveData('settings.json',settings);this.settings=settings;
    if(this.disposed||this.chats.get(chat.session.id)!==chat)return;
    if(chat.busy)throw new Error('此对话已开始运行，新设置将在下次连接时应用。');
    if(modelChange){chat.session.modelSelection={model:settings.model,modelName:settings.modelName,reasoningEffort:settings.reasoningEffort,fastMode:settings.fastMode};this.persist();}
    this.resetChat(chat);this.view?.update();
  }
  private async setActiveTabContext(enabled:boolean){
    await this.ready;
    const settings={...this.settings,activeTabContext:enabled};
    const saved=await this.saveData('settings.json',settings);
    if(saved&&typeof saved==='object'&&typeof saved.code==='number'&&saved.code!==0)throw Error(saved.msg||'保存当前活动设置失败。');
    this.settings=settings;for(const chat of this.chats.values())chat.settings.activeTabContext=enabled;this.view?.update();
  }
  private activityMenuActions(){return {activeTabContext:()=>this.settings.activeTabContext===true,setActiveTabContext:(enabled:boolean)=>this.setActiveTabContext(enabled)};}
  private openPopover(anchor:HTMLElement,title:string){
    if(this.popover?.anchor===anchor&&!this.popover.closed){this.popover.close();return;}
    this.popover?.close(false);const pop=new ComposerPopover(anchor,title);this.popover=pop;return pop;
  }
  private permissionMenu(anchor:HTMLElement){
    if(this.chat.busy){showMessage('请先停止当前对话。');return;}
    const pop=this.openPopover(anchor,'审批方式');if(!pop)return;
    permissionPanel(pop,this.chat.settings.permissionMode,mode=>this.applyQuickSetting({permissionMode:mode}));
  }
  private cachedModels():Promise<ModelInfo[]> {
    const settings={...this.chat.settings,mcpEnabled:false};
    const key=JSON.stringify([settings.binary,settings.cwd]);
    let entry=this.modelCache.get(key);
    if(!entry){entry={updated:0};this.modelCache.set(key,entry);}
    const cached=entry;
    if(!cached.pending&&(!cached.models||Date.now()-cached.updated>300000)){
      const client=new CodexClient(15000);this.auxiliaryClients.add(client);
      cached.pending=(async()=>{
        try{
          await client.start(settings);
          const models:ModelInfo[]=[];let cursor:string|null=null;
          do{const result=await client.request('model/list',cursor?{cursor}:{});models.push(...(result.data||[]).filter((m:any)=>typeof m.model==='string'));cursor=result.nextCursor||null;}while(cursor&&!this.disposed);
          if(!this.disposed){cached.models=models;cached.updated=Date.now();}return models;
        }finally{client.dispose();this.auxiliaryClients.delete(client);cached.pending=undefined;}
      })();
      // Keep stale data available while refreshing; a failed refresh can be retried.
      void cached.pending.catch(()=>{});
    }
    return cached.models?Promise.resolve(cached.models):cached.pending!;
  }
  private async modelMenu(anchor:HTMLElement,showEffort=true){
    if(this.chat.busy){showMessage('请先停止当前对话。');return;}
    const chat=this.chat;const pop=this.openPopover(anchor,'模型与思考强度');if(!pop)return;
    const cacheKey=JSON.stringify([this.chat.settings.binary,this.chat.settings.cwd]);
    if(!this.modelCache.get(cacheKey)?.models)pop.replace(el('div','la-popover-title','选择模型'),el('p','la-popover-note','正在读取可用模型…'));
    try{
      const models=await this.cachedModels();
      if(this.disposed||pop.closed||chat!==this.chat||!anchor.isConnected)return;
      const pickEffort=(model:ModelInfo)=>effortPanel(pop,model,this.chat.resolvedEffort||this.chat.settings.reasoningEffort||model.defaultReasoningEffort||'',async reasoningEffort=>{await this.applyQuickSetting({model:model.model,modelName:model.displayName||model.model,reasoningEffort});},renderModels,{enabled:this.chat.settings.fastMode??this.chat.resolvedFastMode,set:async enabled=>{await this.applyQuickSetting({model:model.model,modelName:model.displayName||model.model,reasoningEffort:this.chat.settings.reasoningEffort||this.chat.resolvedEffort||model.defaultReasoningEffort||'',fastMode:enabled});},reset:async()=>{await this.applyQuickSetting({model:model.model,modelName:model.displayName||model.model,reasoningEffort:model.defaultReasoningEffort||'',fastMode:false});}});
      const renderModels=()=>modelPanel(pop,models,this.chat.settings.model||this.chat.resolvedModel,async model=>{await this.applyQuickSetting({model:model.model,modelName:model.displayName||model.model,reasoningEffort:model.defaultReasoningEffort||''});pickEffort(model);});
      const selected=models.find(m=>m.model===(this.chat.settings.model||this.chat.resolvedModel));
      if(showEffort){const current=selected||{model:this.chat.settings.model||this.chat.resolvedModel||'CLI 默认模型'};pickEffort(current);}else renderModels();
    }catch(e){if(!pop.closed){pop.replace(el('div','la-popover-title','读取模型列表失败'),el('p','la-popover-note',(e as Error).message),button('重试',()=>{pop.close(false);void this.modelMenu(anchor,showEffort);},'la-choice'));pop.focus();}}
  }
  private async browseCli(value:string){
    const {ipcRenderer}=require('electron');
    const result=await ipcRenderer.invoke('siyuan-get',{cmd:'showOpenDialog',title:'选择 Codex 可执行文件',...(value.trim()?{defaultPath:expandPath(value)}:{}),properties:['openFile']});
    return result.canceled?undefined:result.filePaths?.[0];
  }
  private async showWelcome(){
    await this.ready;if(this.disposed||this.welcomeDialog)return;
    let dialog:Dialog;
    const page=welcomePage({binary:this.settings.binary,shortcut:process.platform==='darwin'?'⌥⇧A':'Alt+Shift+A',browse:value=>this.browseCli(value),later:()=>dialog.destroy(),finish:async binary=>{
      if(this.disposed)return;
      if(binary!==this.settings.binary){
        if([...this.chats.values()].some(chat=>chat.busy||chat.requests.size)||this.workspacePreparing)throw Error('请先停止正在运行的会话，再保存新的 CLI 路径。');
        const settings={...this.settings,binary};const saved=await this.saveData('settings.json',settings);
        if(saved?.code)throw Error(saved.msg||'保存 CLI 路径失败。');
        if(this.disposed)return;
        this.settings=settings;this.modelCache.clear();
        for(const chat of [...this.chats.values()])if(!chat.busy&&!chat.requests.size&&!this.workspacePreparing&&!this.sideViews.has(chat.session.id))this.resetChat(chat);
      }
      dialog.destroy();this.openPanel();
    }});
    dialog=new Dialog({title:'思源 Codex · 欢迎',content:'<div class="la-welcome-host"></div>',width:'600px',destroyCallback:()=>{page.destroy();this.dialogs.delete(dialog);if(this.welcomeDialog===dialog)this.welcomeDialog=undefined;}});
    dialog.element.querySelector('.la-welcome-host')!.append(page.element);this.welcomeDialog=dialog;this.dialogs.add(dialog);this.welcomePending=false;
    void this.saveData('onboarding.json',{seen:true,version:1}).then(result=>{if(result?.code)throw Error(result.msg||'保存失败');}).catch(error=>showMessage(`欢迎页状态保存失败：${error.message}`));
    void page.check.run();
  }
  openSetting(){void this.showSettings();}
  private async showSettings(){
    await this.ready;const root=el('div','la-settings');const draft={...this.settings};const fields=new Map<keyof Settings,HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>();
    const field=(key:keyof Settings,title:string,description:string,options?:[string,string][])=>{
      const row=el('label','b3-label');row.append(el('div','',title),el('div','b3-label__text',description));let input:HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement;
      if(options){input=el('select','b3-select');for(const [value,label]of options){const o=el('option','',label);o.value=value;input.append(o);}}
      else input=key==='instructions'?el('textarea','b3-text-field'):el('input','b3-text-field');
      input.value=String(draft[key]??'');input.setAttribute('aria-label',title);row.append(input);root.append(row);fields.set(key,input);
    };
    field('binary','Codex 可执行文件','留空自动发现；找不到时填写 codex 的完整路径。');
    root.append(el('p','la-hint','新会话默认使用独立目录。可在聊天顶栏选择工作目录、绑定当前文档；首次发送后会话目录固定。'));
    field('newSessionModelMode','新会话模型设置','仅影响新会话的模型和思考强度；没有上次设置时读取 CLI 默认配置。',[['last','沿用上次设置'],['cli','始终使用 CLI 默认配置']]);
    field('permissionMode','审批方式','请求批准：由你审批；帮我批准：由 Codex 审查；完全访问权限：取消文件沙箱和操作审批。',[['','保留原有文件权限'],...permissionModes.map(m=>[m.value,m.label] as [string,string])]);
    field('instructions','额外指令','补充长期偏好或记忆文件路径。CLI 自己的 AGENTS.md / skills / MCP 仍由 CLI 加载。');
    const check=new CliCheckView(fields.get('binary') as HTMLInputElement);root.append(check.element);
    const status=el('p','la-hint');root.append(status);
    const read=()=>{const s={...draft,mcpEnabled:true,mcpUrl:`${location.origin}/mcp`};for(const [key,input]of fields)(s as any)[key]=input.value.trim();if(s.model!==draft.model){s.modelName='';s.reasoningEffort='';}validateSettings({...s,cwd:this.chat.settings.cwd});return s;};
    let dialog:Dialog;
    const actions=el('div','la-settings-actions');actions.append(button('保存',()=>{void(async()=>{try{const chat=this.chat;if(chat.busy||this.workspacePreparing)throw new Error('请先停止当前对话。');const s=read();const saved=await this.saveData('settings.json',s);if(saved?.code)throw Error(saved.msg||'保存设置失败。');this.settings=s;if(!this.disposed&&!chat.busy&&this.chats.get(chat.session.id)===chat)this.resetChat(chat);this.persist();this.view?.update();dialog.destroy();}catch(e){status.textContent=(e as Error).message;}})();},'b3-button'),button('打开欢迎页',()=>{dialog.destroy();void this.showWelcome();}));root.append(actions);
    dialog=new Dialog({title:'思源 Codex · 设置',content:'<div class="la-settings-host"></div>',width:'640px',destroyCallback:()=>{check.destroy();this.dialogs.delete(dialog);}});dialog.element.querySelector('.la-settings-host')!.append(root);this.dialogs.add(dialog);
  }
  onunload(){
    setMarkdownHighlighter();
    this.popover?.close(false);
    this.view?.destroy();this.view=undefined;for(const dialog of this.dialogs)dialog.destroy();
    for(const chat of this.chats.values()){chat.onChange=()=>{};if(chat.busy)chat.session.lastOutcome='stopped';chat.disconnect();}
    if(this.saveTimer)clearTimeout(this.saveTimer);this.persist();this.disposed=true;this.chats.clear();this.sideViews.clear();
    this.eventBus.off('open-menu-content',this.selectionMenuListener);
    this.eventBus.off('switch-protyle',this.editorListener);this.eventBus.off('loaded-protyle-static',this.editorListener);this.eventBus.off('click-editorcontent',this.editorListener);
    for(const client of this.auxiliaryClients)client.dispose();this.auxiliaryClients.clear();
    for(const preview of this.mediaPreviews.values())void preview.then(url=>{if(url)URL.revokeObjectURL(url);});this.mediaPreviews.clear();this.mediaSources.clear();
    for(const dialog of this.dialogs)dialog.destroy();
  }
}
