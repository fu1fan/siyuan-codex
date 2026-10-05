import {SelectionContext} from './selection-context';
import {conversationRows,workDuration} from './conversation';
import {mcpApprovalDescription} from './approval';
import {permissionLabel,permissionIcon} from './permissions';
import {effortLabel} from './model-options';
import {renderMarkdown,enhanceMarkdown} from './render';
import {toolStatus} from './tool-record';
import type {ChatSession} from './session';
import {sessionStateLabel,type SessionSummary} from './session-state';
import {textareaComposer,InputHistory,type Composer,type ComposerFactory} from './composer';
import {canDrop,droppedIDs,type Reference,type Attachment} from './context';
import {ComposerMenu,type ComposerMenuActions} from './composer-menu';
import {mediaTransfer,type MediaSource,type MediaContent} from './composer-media';
import {HorizontalScrollbar} from './horizontal-scrollbar';
import {codexLogo} from './brand';
import type {CodexHistoryEntry,CodexHistoryPage} from './codex-history';
import {el,button,setButtonHint,iconButton} from './dom';
export {el,button,setButtonHint,iconButton} from './dom';
interface Actions extends ComposerMenuActions {
  send:(text:string,refs?:Reference[])=>Promise<boolean|void>;stop:()=>void;settings:()=>void;newChat:()=>void;select:(id:string)=>void;
  list:()=>SessionSummary[];clear:()=>void;context:()=>string;
  draftChanged?:()=>void;captureNoteSelections?:boolean;
  composer?:ComposerFactory;attachments?:()=>Attachment[];removeAttachment?:(index:number)=>void;
  importMedia?:(sources:MediaSource[])=>Promise<void>;retryMedia?:(key:string)=>Promise<void>;
  previewMedia?:(attachment:Attachment)=>Promise<string>;
  workspace?:()=>string;openReference?:(id:string)=>void;rename?:(id:string,title:string)=>void;delete?:(id:string,terminate?:boolean)=>void;
  branch?:(messageId:string)=>Promise<void>;model?:(anchor:HTMLElement)=>void;effort?:(anchor:HTMLElement)=>void;permission?:(anchor:HTMLElement)=>void;
  queueSide?:(id:string)=>void;
  directory?:(anchor:HTMLElement)=>void;
  searchCodex?:(query:string,cursor?:string)=>Promise<CodexHistoryPage>;openCodex?:(entry:CodexHistoryEntry,isCurrent?:()=>boolean)=>Promise<void>;
  editMessage?:(id:string,text:string)=>Promise<void>;
  editAttachments?:(attachments:Attachment[])=>void;close?:()=>void;error?:(text:string)=>void;
}
export class ChatView {
  private log=el('div','la-log');private scroll=el('div','la-messages-scroll');private approvals=el('div','la-approvals');private status=el('div','la-status');
  readonly input:Composer;
  private queue=el('div','la-queue');private messageEdit?:{id:string;text:string;pending:boolean;error?:string};private queueKey='';private queueEdits=new Map<string,string>();
  private messageEdits=new Map<string,NonNullable<ChatView['messageEdit']>>();private scrollPositions=new Map<string,number>();
  private send:HTMLButtonElement;private stop:HTMLButtonElement;private title=el('div','block__logo la-title');
  private history=el('section','la-history-panel');private historySearch=el('input','b3-text-field');private historyList=el('div','la-history-list');
  private historyScope=el('select','b3-select la-history-scope');private historyEpoch=0;private historyTimer?:ReturnType<typeof setTimeout>;
  private codexRows:CodexHistoryEntry[]=[];private codexCursor?:string;private codexLoading=false;private codexError='';private codexOpening=false;
  private sessions=el('nav','la-session-strip');private sessionKey='';private historyKey='';
  private sessionSwitcher=el('div','la-session-switcher');private sessionScrollbar=new HorizontalScrollbar(this.sessions,this.sessionSwitcher);
  private sessionResize?:ResizeObserver;
  private sessionDelete?:string;private sessionDeletePrompt=el('div','la-session-delete-confirm');
  private historyButton:HTMLButtonElement;
  private context=el('div','la-context');private rendered='';private approvalKey='';private contextKey='';private sessionID='';
  private inputHistory=new InputHistory();private submissions=new Set<string>();private drops=new Map<string,number>();private dragDepth=0;
  private get submitting(){return this.submissions.has(this.chat().session.id);}
  private get pendingDrops(){return this.drops.get(this.chat().session.id)||0;}
  private bottom:HTMLButtonElement;private model:HTMLButtonElement;private effort:HTMLButtonElement;private permission:HTMLButtonElement;
  private followLatest=true;
  private displayedChat?:ChatSession;private restoringDraft=false;private disposed=false;
  private menu?:ComposerMenu;private selections?:SelectionContext;
  private directory?:HTMLButtonElement;
  private workStates=new Map<string,boolean>();
  private workTimer?:ReturnType<typeof setInterval>;private runningSince=new Map<string,number>();
  private bodies=new Map<string,{key:string;element:HTMLElement}>();
  private mediaNumber=1;private collectingMedia=false;
  constructor(public root:HTMLElement,private chat:()=>ChatSession,private actions:Actions){
    root.classList.add('la-panel');
    const head=el('div','block__icons la-head');
    head.append(this.title);
    if(actions.directory){this.directory=iconButton('工作目录','iconFolder',()=>actions.directory!(this.directory!),'block__icon la-directory');this.directory.append(el('span','la-directory-label'));this.directory.setAttribute('aria-haspopup','dialog');this.directory.addEventListener('click',e=>e.stopPropagation());head.append(this.directory);}
    this.historyButton=iconButton('对话历史','iconFolderClock',()=>{this.history.hidden=!this.history.hidden;this.cancelCodexSearch();if(!this.history.hidden){this.historyScope.value='plugin';this.historySearch.placeholder='搜索插件对话';this.renderHistory();this.historySearch.focus();}},'block__icon la-history-trigger');
    head.append(iconButton('新对话','iconAdd',actions.newChat),this.historyButton,iconButton('设置','iconSettings',actions.settings),iconButton('收起','iconMin',()=>actions.close?.()));
    this.history.hidden=true;this.history.setAttribute('aria-label','对话历史');this.historySearch.type='search';this.historySearch.placeholder='搜索插件对话';this.historySearch.setAttribute('aria-label','搜索对话');
    this.historyScope.setAttribute('aria-label','历史搜索范围');for(const [value,label]of [['plugin','插件历史'],['codex','全部 Codex']]){const option=el('option','',label);option.value=value;this.historyScope.append(option);}this.historyScope.value='plugin';this.historyScope.hidden=!actions.searchCodex;
    this.historySearch.oninput=()=>{if(this.historyScope.value==='codex')this.scheduleCodexSearch();else this.renderHistory();};
    this.historyScope.onchange=()=>{this.cancelCodexSearch();this.historySearch.placeholder=this.historyScope.value==='codex'?'按标题搜索 Codex 会话':'搜索插件对话';this.codexRows=[];this.codexCursor=undefined;this.codexError='';this.renderHistory();if(this.historyScope.value==='codex')void this.loadCodexHistory();};
    const historyControls=el('div','la-history-controls');historyControls.append(this.historySearch,this.historyScope);this.history.append(historyControls,this.historyList);
    this.log.setAttribute('role','log');this.log.setAttribute('aria-label','聊天记录');
    const wrap=el('div','la-messages-wrap');this.bottom=iconButton('回到最新消息','iconArrowDown',()=>{this.scroll.scrollTop=this.scroll.scrollHeight;},'b3-button b3-button--cancel la-scroll-bottom');this.bottom.hidden=true;this.scroll.append(this.log,this.approvals);wrap.append(this.scroll,this.bottom);
    this.scroll.onscroll=()=>this.updateScrollButton();
    const composer=el('div','la-composer'),host=el('div','la-composer-host'),row=el('div','la-composer-buttons');
    this.send=iconButton('发送 · Enter','iconUp',()=>{void this.submit();},'la-send la-control');
    this.send.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m-7 7 7-7 7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    this.stop=iconButton('停止生成','iconSquareStop',actions.stop,'la-send la-control');
    this.model=iconButton('模型与思考强度','iconBrain',()=>actions.model?actions.model(this.model):actions.settings(),'la-control la-model');
    this.model.append(el('span','la-model-name'));this.effort=button('',()=>actions.effort?actions.effort(this.effort):actions.model?.(this.effort),'la-control la-effort-control');this.effort.append(el('span','la-effort'));this.effort.setAttribute('aria-haspopup','dialog');
    const chevron=document.createElementNS('http://www.w3.org/2000/svg','svg');chevron.classList.add('la-chevron');chevron.setAttribute('aria-hidden','true');chevron.innerHTML='<use href="#iconDown"></use>';this.effort.append(chevron);this.model.setAttribute('aria-haspopup','dialog');
    this.permission=iconButton('文件权限','iconShieldCheck',()=>actions.permission?actions.permission(this.permission):actions.settings(),'la-control la-permission');this.permission.append(el('span','la-permission-label'));this.permission.setAttribute('aria-haspopup','dialog');
    // Keep the opening click away from the host's outside-menu dismissal handlers.
    for(const trigger of [this.model,this.effort,this.permission])trigger.addEventListener('click',event=>event.stopPropagation());
    const add=iconButton('添加笔记或对话','iconAdd',()=>this.menu?.openAdd(),'la-control la-add');add.setAttribute('aria-haspopup','dialog');add.addEventListener('click',e=>e.stopPropagation());
    const group=el('div','la-model-group');group.append(this.model,this.effort);
    row.append(add,this.permission,el('span','la-composer-spacer'),group,this.send,this.stop);composer.append(this.context,host,row);
    this.sessions.setAttribute('aria-label','会话切换');
    this.sessionSwitcher.append(this.sessions,this.sessionScrollbar.element);
    this.sessionDeletePrompt.hidden=true;this.sessionDeletePrompt.setAttribute('role','dialog');this.sessionDeletePrompt.setAttribute('aria-label','删除对话确认');this.sessionDeletePrompt.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();this.cancelSessionDelete();}};
    root.replaceChildren(head,this.sessionSwitcher,this.sessionDeletePrompt,this.history,wrap,this.queue,composer,this.status);
    if(typeof ResizeObserver!=='undefined'){this.sessionResize=new ResizeObserver(()=>{this.revealActiveSession();this.sessionScrollbar.update();if(this.followLatest)this.scroll.scrollTop=this.scroll.scrollHeight;this.updateScrollButton();});this.sessionResize.observe(this.sessions);this.sessionResize.observe(this.scroll);}
    this.input=(actions.composer||textareaComposer)(host,()=>{void this.submit();},()=>{if(this.input){this.collectMedia();if(!this.restoringDraft&&this.displayedChat){this.displayedChat.session.draft=this.input.value;actions.draftChanged?.();}this.updateSend();this.menu?.update();}});
    this.menu=new ComposerMenu(composer,this.input,chat,{...actions,changed:()=>this.update(),attach:()=>this.addContext(()=>actions.attach()),drop:actions.drop?ids=>this.addContext(()=>actions.drop!(ids)):undefined,referenceConversation:actions.referenceConversation?id=>this.addContext(()=>actions.referenceConversation!(id)):undefined});
    host.addEventListener('compositionstart',()=>this.menu?.composition(true),true);host.addEventListener('compositionend',()=>this.menu?.composition(false),true);
    host.addEventListener('keydown',e=>{
      if(this.menu?.keydown(e))return;
      if(e.isComposing||e.shiftKey)return;
      if(document.querySelector('.la-native-hint:not(.fn__none)'))return;
      let value:string|undefined;
      if(e.key==='ArrowUp')value=this.inputHistory.up(this.input.value);
      if(e.key==='ArrowDown')value=this.inputHistory.down();
      if(value!==undefined){e.preventDefault();e.stopImmediatePropagation();this.input.value=value;this.input.focus();}
      else if(e.key.length===1)this.inputHistory.reset();
    },true);
    const accepts=(e:DragEvent)=>!!e.dataTransfer&&canDrop(Array.from(e.dataTransfer.types));
    host.addEventListener('paste',e=>{if(!e.clipboardData||!actions.importMedia)return;const content=mediaTransfer(e.clipboardData,this.mediaNumber);if(content){e.preventDefault();e.stopImmediatePropagation();this.acceptMedia(content);}},true);
    root.addEventListener('dragenter',e=>{if(accepts(e)){e.preventDefault();this.dragDepth++;root.classList.add('la-dragover');}},true);
    root.addEventListener('dragleave',()=>{if(--this.dragDepth<=0){this.dragDepth=0;root.classList.remove('la-dragover');}},true);
    root.addEventListener('dragover',e=>{if(accepts(e)){e.preventDefault();e.stopPropagation();e.dataTransfer!.dropEffect='copy';}},true);
    root.addEventListener('drop',e=>{
      this.dragDepth=0;root.classList.remove('la-dragover');if(!e.dataTransfer)return;
      try{const content=actions.importMedia&&mediaTransfer(e.dataTransfer,this.mediaNumber);if(content){e.preventDefault();e.stopImmediatePropagation();this.dropCaret(e,host);this.acceptMedia(content);return;}
      const ids=droppedIDs(e.dataTransfer,actions.workspace?.()||'');if(ids.length&&actions.drop){e.preventDefault();e.stopImmediatePropagation();this.dropCaret(e,host);const restore=this.input.bookmark?.(),value=this.input.value,session=this.chat().session.id;void this.addContext(async()=>{const refs=await actions.drop!(ids);if(this.disposed||session!==this.chat().session.id)return;if(Array.isArray(refs)){if(this.input.value!==value)throw Error('输入内容已变更，请重新拖入引用。');restore?.();for(const ref of refs)this.input.insertReference?.(ref);}}).catch(error=>actions.error?.(error.message));}else if(!host.contains(e.target as Node)){e.preventDefault();}}
      catch(error){e.preventDefault();e.stopImmediatePropagation();actions.error?.((error as Error).message);}
    },true);
    if(actions.editAttachments){this.selections=new SelectionContext(root,()=>actions.attachments?.()||[],items=>{actions.editAttachments!(items);actions.draftChanged?.();this.update();},message=>actions.error?.(message),actions.captureNoteSelections!==false);composer.insertBefore(this.selections.element,this.context);}
    this.update();
  }
  addSelectionMenu(menu:Parameters<SelectionContext['addNoteMenu']>[0],range:Range){this.selections?.addNoteMenu(menu,range);}
  destroy(){if(this.displayedChat)this.displayedChat.session.draft=this.input.value;this.disposed=true;this.cancelCodexSearch();this.sessionResize?.disconnect();this.sessionScrollbar.destroy();if(this.workTimer!==undefined)clearInterval(this.workTimer);this.workTimer=undefined;this.menu?.destroy();this.selections?.destroy();this.input.destroy();this.bodies.clear();this.workStates.clear();this.runningSince.clear();this.root.classList.remove('la-dragover');}
  private tickWorkTimer(){
    const now=Date.now();for(const summary of this.log.querySelectorAll<HTMLElement>('.la-work[data-running=true]>summary')){
      const label=workDuration(now-Number(summary.dataset.startedAt),true);if(summary.textContent!==label)summary.textContent=label;
    }
  }
  private syncWorkTimer(){
    this.tickWorkTimer();
    if(this.log.querySelector('.la-work[data-running=true]')){
      if(this.workTimer===undefined){this.workTimer=setInterval(()=>this.tickWorkTimer(),1000);if(typeof this.workTimer==='object')this.workTimer.unref?.();}
    }else if(this.workTimer!==undefined){clearInterval(this.workTimer);this.workTimer=undefined;}
  }
  private async addContext<T>(action:()=>T|Promise<T>){const id=this.chat().session.id;this.drops.set(id,(this.drops.get(id)||0)+1);this.updateSend();try{return await action();}finally{const count=(this.drops.get(id)||1)-1;if(count)this.drops.set(id,count);else this.drops.delete(id);if(!this.disposed)this.update();}}
  private dropCaret(e:DragEvent,host:HTMLElement){
    if(!host.contains(e.target as Node))return;
    const doc=document as Document&{caretRangeFromPoint?:(x:number,y:number)=>Range|null};const range=doc.caretRangeFromPoint?.(e.clientX,e.clientY);
    if(range&&this.input.element.contains(range.startContainer)){const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(range);}
  }
  private collectMedia(){if(this.collectingMedia||!this.actions.importMedia)return;this.collectingMedia=true;try{const sources=this.input.extractMedia?.(this.mediaNumber,Math.max(0,20-(this.actions.attachments?.().length||0)))||[];if(sources.length)this.acceptMedia({sources,text:''});}finally{this.collectingMedia=false;}}
  private acceptMedia(content:MediaContent){
    if(!this.actions.importMedia)return;
    if((this.actions.attachments?.().length||0)+content.sources.length>20){this.actions.error?.('一次最多附加 20 项，请移除部分附件后重试。');return;}
    this.mediaNumber+=content.sources.length;
    if(content.text||content.html){this.input.insertContent?.(content);}
    void this.actions.importMedia(content.sources).catch(e=>this.actions.error?.(e.message)).finally(()=>{if(!this.disposed)this.update();});
  }
  private updateSend(){let value='';try{value=this.input.value;}catch{value='image';}const attachments=this.actions.attachments?.()||[];this.send.disabled=this.submitting||this.pendingDrops>0||attachments.some(a=>a.media?.status)||(!value.trim()&&!attachments.length);this.send.hidden=!this.submitting&&this.chat().busy&&!value.trim()&&!attachments.length;setButtonHint(this.send,this.submitting?'正在发送…':this.chat().busy?'加入队列 · Enter':'发送 · Enter');this.stop.hidden=!this.chat().busy;}
  private mediaCard(a:Attachment,index?:number){
    const media=a.media!,card=el('div','la-media-card');card.dataset.attachmentKey=media.key;
    if(media.kind==='image'&&!media.status){const img=el('img','la-media-preview');img.alt=a.title;img.loading='lazy';if(media.url)img.src=media.url;else if(this.actions.previewMedia)void this.actions.previewMedia(a).then(url=>{if(url&&img.isConnected)img.src=url;});card.append(img);}
    else{const icon=el('div','la-media-file-icon',media.status==='loading'?'…':a.title.split('.').at(-1)?.toUpperCase().slice(0,6)||'FILE');card.append(icon);}
    const label=el('div','la-media-label');label.append(el('span','la-media-title',a.title));label.title=a.title;
    label.append(el('small','',media.status==='loading'?'正在添加…':media.status==='error'?'添加失败':`${media.kind==='image'?'图片':'附件'}${media.size?' · '+(media.size<1024*1024?Math.ceil(media.size/1024)+' KB':(media.size/(1024*1024)).toFixed(1)+' MB'):''}`));card.append(label);
    if(media.error){card.classList.add('la-media-error');card.title=media.error;const error=el('small','la-media-error-text',media.error);error.setAttribute('role','alert');card.append(error);if(index!==undefined&&this.actions.retryMedia)card.append(button('重试',()=>{void this.addContext(()=>this.actions.retryMedia!(media.key)).catch(e=>this.actions.error?.(e.message));},'la-media-retry'));}
    if(index!==undefined)card.append(iconButton('移除 '+a.title,'iconClose',()=>{
      const restore=this.input.bookmark?.();restore?.();let cursor=this.input.cursor();
      while(cursor?.text.includes(media.marker)){const start=cursor.text.indexOf(media.marker);this.input.replaceRange(start,start+media.marker.length,`［已移除：${a.title}］`);cursor=this.input.cursor();}
      this.actions.removeAttachment?.(index);
    },'block__icon la-media-remove'));
    return card;
  }
  private async submit(){
    this.collectMedia();if(this.submitting||this.pendingDrops)return;
    if(this.actions.attachments?.().some(a=>a.media?.status)){this.actions.error?.('请等待附件准备完成，或重试／移除失败项。');return;}
    let draft:string,value:string;try{this.input.validate?.();draft=this.input.value;value=draft.trim();}catch(e){this.actions.error?.((e as Error).message);return;}
    const refs=this.input.references();if(!value&&!this.actions.attachments?.().length)return;
    const chat=this.chat();this.submissions.add(chat.session.id);
    // Acknowledge Enter before waiting for directory lookup, CLI startup or RPC.
    // The captured draft remains available for rollback if the send fails.
    chat.session.draft='';this.input.value='';this.menu?.close();this.actions.draftChanged?.();this.update();
    let accepted=false;
    try{accepted=(await this.actions.send(value||'请阅读附加的资料。',refs))!==false;if(accepted&&!this.disposed&&this.chat()===chat)this.inputHistory.push(value);
    }catch(e){this.actions.error?.((e as Error).message);}finally{
      this.submissions.delete(chat.session.id);
      if(!accepted){
        const next=!this.disposed&&this.chat()===chat?this.input.value:chat.session.draft||'';
        chat.session.draft=draft+(next?'\n\n'+next:'');
        if(!this.disposed&&this.chat()===chat)this.input.value=chat.session.draft;
      }
      this.actions.draftChanged?.();if(!this.disposed)this.update();
    }
  }
  private renderQueue(){
    const chat=this.chat(),items=chat.session.queue||[];
    const key=JSON.stringify([items,chat.session.queuePaused,chat.busy,chat.turnId,chat.queuePending]);if(key===this.queueKey)return;this.queueKey=key;this.queue.replaceChildren();this.queue.hidden=!items.length;
    if(!items.length)return;
    const header=el('div','la-queue-header');header.append(el('span','',`${chat.session.queuePaused?'排队已暂停':'等待发送'} · ${items.length}`),button(chat.session.queuePaused?'继续排队':'暂停排队',()=>chat.pauseQueue(!chat.session.queuePaused),'la-queue-action'));this.queue.append(header);
    this.queue.append(el('div','la-queue-help',chat.session.queuePaused?'消息已保留，点击继续排队后按顺序发送。':'当前回复结束后按顺序发送；“引导”将消息补充到当前回复。'));
    for(const q of items){
      const row=el('div','la-queue-row'),copy=el('div','la-queue-copy');copy.append(el('div','la-queue-text',q.displayText));if(q.attachments?.length)copy.append(el('small','',q.attachments.map(a=>a.title).join(' · ')));row.dataset.queueId=q.id;row.append(el('span','la-queue-mark','↳'),copy);
      const pending=chat.queuePending===q.id;
      const steer=button(pending?'发送中…':'↪ 引导',()=>{void chat.steerQueued(q.id).catch(e=>this.actions.error?.(e.message));},'la-queue-action');steer.disabled=!!chat.queuePending||!chat.busy||!chat.turnId;steer.title='立即补充到当前回复，不等待下一轮';
      const remove=iconButton('删除排队消息','iconTrashcan',()=>chat.removeQueued(q.id),'block__icon block__icon--show');remove.disabled=pending;
      const more=el('details','la-queue-more'),summary=el('summary','','•••');summary.setAttribute('aria-label','排队消息更多操作');more.append(summary);
      const editKey=chat.session.id+':'+q.id;
      const menu=el('div','la-queue-menu');const edit=button('编辑消息',()=>{this.queueEdits.set(editKey,q.displayText);chat.pauseQueue();this.queueKey='';this.renderQueue();this.queue.querySelector<HTMLTextAreaElement>('[aria-label=编辑排队消息]')?.focus();},'la-queue-action');edit.disabled=pending;menu.append(edit,button(chat.session.queuePaused?'继续排队':'关闭排队（保留消息）',()=>chat.pauseQueue(!chat.session.queuePaused),'la-queue-action'));if(this.actions.queueSide){const side=button('在侧边聊天中打开',()=>this.actions.queueSide!(q.id),'la-queue-action');side.disabled=pending;menu.append(side);}more.append(menu);row.append(steer,remove,more);
      if(this.queueEdits.has(editKey)){const input=el('textarea','b3-text-field');input.value=this.queueEdits.get(editKey)!;input.setAttribute('aria-label','编辑排队消息');input.oninput=()=>this.queueEdits.set(editKey,input.value);const controls=el('div','la-queue-edit');controls.append(input,button('保存',()=>{if(!input.value.trim())return;this.queueEdits.delete(editKey);chat.editQueued(q.id,input.value);this.queueKey='';this.renderQueue();}),button('取消',()=>{this.queueEdits.delete(editKey);this.queueKey='';this.renderQueue();}));copy.replaceChildren(controls);steer.disabled=true;}
      this.queue.append(row);if(q.error)this.queue.append(el('div','la-queue-error',q.error));
    }
  }
  private renderSessions(){
    const list=this.actions.list(),active=this.chat().session.id;
    const key=JSON.stringify([active,list,this.sessionDelete]);if(key===this.sessionKey)return;this.sessionKey=key;
    const activeChanged=this.sessions.dataset.active!==active,previousScroll=this.sessions.scrollLeft;this.sessions.dataset.active=active;
    const waiting=list.filter(s=>s.state==='waiting').length,unread=list.filter(s=>s.unread).length;
    this.historyButton.dataset.attention=waiting?'waiting':unread?'unread':'';
    setButtonHint(this.historyButton,`对话历史${waiting?' · '+waiting+' 待确认':''}${unread?' · '+unread+' 未读':''}`);
    const ids=new Set([active,...list.slice(0,3).map(s=>s.id),...list.filter(s=>s.state==='running'||s.state==='waiting'||s.unread).map(s=>s.id)]);
    this.sessionSwitcher.hidden=this.sessions.hidden=!list.length;this.sessions.replaceChildren();
    const running=list.filter(s=>s.state==='running'||s.state==='waiting').length;
    if(running){const count=el('span','la-session-count',`${running} 运行`);count.title=`${running} 个会话正在运行或等待确认`;this.sessions.append(count);}
    for(const session of list.filter(s=>ids.has(s.id))){
      const state=session.state||'idle',label=sessionStateLabel[state];
      const item=el('div','la-session-item');item.dataset.sessionId=session.id;item.dataset.active=String(session.id===active);item.dataset.state=state;
      const select=button('',()=>this.actions.select(session.id),'la-session-tab');select.dataset.sessionId=session.id;select.dataset.state=state;select.dataset.unread=String(!!session.unread);select.setAttribute('aria-current',String(session.id===active));
      const status=el('span','la-session-dot');status.setAttribute('aria-hidden','true');
      select.append(status,el('span','la-session-name',session.title));
      setButtonHint(select,`${session.title} · ${label}${session.unread?' · 未读':''}${session.queueCount?' · 排队 '+session.queueCount:''}`);item.append(select);
      if(this.actions.delete)item.append(iconButton('删除对话：'+session.title,'iconClose',()=>this.requestSessionDelete(session.id),'la-session-remove'));
      this.sessions.append(item);
    }
    const pending=list.find(s=>s.id===this.sessionDelete);this.sessionDeletePrompt.hidden=!pending;this.sessionDeletePrompt.replaceChildren();
    if(pending){const confirm=button('终止并删除',()=>{const id=pending.id;this.sessionDelete=undefined;this.actions.delete?.(id,true);this.renderSessions();if(!this.history.hidden)this.renderHistory();},'b3-button b3-button--cancel');this.sessionDeletePrompt.append(el('span','',`删除「${pending.title}」后会终止 Agent 工作。`),confirm,button('取消',()=>this.cancelSessionDelete(),'b3-button b3-button--cancel la-session-delete-cancel'));}else this.sessionDelete=undefined;
    if(activeChanged)this.revealActiveSession();else this.sessions.scrollLeft=previousScroll;this.sessionScrollbar.update();
  }
  private revealActiveSession(){if(!this.disposed)this.sessions.querySelector<HTMLElement>('.la-session-item[data-active=true]')?.scrollIntoView?.({block:'nearest',inline:'nearest'});}
  private requestSessionDelete(id:string){
    const current=this.actions.list().find(s=>s.id===id);if(!current)return;
    if(current.state==='running'||current.state==='waiting'){
      this.sessionDelete=id;this.renderSessions();this.sessionDeletePrompt.querySelector<HTMLButtonElement>('.la-session-delete-cancel')?.focus();
    }else{
      this.sessionDelete=undefined;this.actions.delete?.(id);this.renderSessions();if(!this.history.hidden)this.renderHistory();
    }
  }
  private updateScrollButton(){if(!this.disposed){const remaining=this.scroll.scrollHeight-this.scroll.scrollTop-this.scroll.clientHeight;this.followLatest=remaining<80;this.bottom.hidden=remaining<100;}}
  private cancelSessionDelete(){const id=this.sessionDelete;this.sessionDelete=undefined;this.renderSessions();Array.from(this.sessions.querySelectorAll<HTMLElement>('.la-session-item')).find(item=>item.dataset.sessionId===id)?.querySelector<HTMLElement>('.la-session-remove')?.focus();}
  private cancelCodexSearch(){this.historyEpoch++;if(this.historyTimer)clearTimeout(this.historyTimer);this.historyTimer=undefined;this.codexLoading=false;this.codexOpening=false;}
  private scheduleCodexSearch(){
    this.cancelCodexSearch();this.codexRows=[];this.codexCursor=undefined;this.codexError='';this.codexLoading=true;this.renderHistory();
    this.historyTimer=setTimeout(()=>{this.historyTimer=undefined;void this.loadCodexHistory();},200);
  }
  private async loadCodexHistory(more=false){
    if(!this.actions.searchCodex||this.disposed||this.history.hidden||this.historyScope.value!=='codex')return;
    const epoch=++this.historyEpoch,query=this.historySearch.value;
    this.codexLoading=true;this.codexError='';if(!more){this.codexRows=[];this.codexCursor=undefined;}this.renderHistory();
    try{
      const page=await this.actions.searchCodex(query,more?this.codexCursor:undefined);
      if(this.disposed||epoch!==this.historyEpoch)return;
      this.codexRows=[...new Map([...this.codexRows,...page.data].map(row=>[row.threadId,row])).values()];this.codexCursor=page.nextCursor;
    }catch(error){if(!this.disposed&&epoch===this.historyEpoch)this.codexError=(error as Error).message;}
    finally{if(!this.disposed&&epoch===this.historyEpoch){this.codexLoading=false;this.renderHistory();}}
  }
  private renderCodexHistory(force:boolean){
    const key=JSON.stringify(['codex',this.codexRows,this.codexCursor,this.codexLoading,this.codexError,this.codexOpening,this.chat().session.threadId]);
    if(!force&&key===this.historyKey)return;this.historyKey=key;this.historyList.replaceChildren();
    for(const entry of this.codexRows){
      const row=el('div','la-history-row'),select=button('',()=>{void this.openCodexEntry(entry);},'b3-list-item la-history-select la-codex-history-select');
      select.disabled=this.codexOpening;select.dataset.threadId=entry.threadId;select.title=entry.cwd;
      const label=el('div','la-codex-history-label');label.append(el('span','la-history-title',entry.title),el('small','la-codex-history-cwd',entry.cwd));select.append(label);
      if(entry.archived)select.append(el('small','la-history-state','已归档'));
      if(entry.threadId===this.chat().session.threadId)select.classList.add('b3-list-item--focus');row.append(select);this.historyList.append(row);
    }
    if(this.codexError){const error=el('p','la-hint la-history-error',this.codexError);error.setAttribute('role','alert');this.historyList.append(error,button('重试',()=>{void this.loadCodexHistory(!!this.codexRows.length);},'b3-button b3-button--cancel'));}
    else if(this.codexLoading||this.codexOpening)this.historyList.append(el('p','la-hint',this.codexOpening?'正在打开会话…':'正在搜索…'));
    else if(this.codexCursor)this.historyList.append(button('加载更多',()=>{void this.loadCodexHistory(true);},'b3-button b3-button--cancel la-history-more'));
    if(!this.codexRows.length&&!this.codexLoading&&!this.codexError)this.historyList.append(el('p','la-hint','没有匹配的 Codex 会话'));
  }
  private async openCodexEntry(entry:CodexHistoryEntry){
    if(!this.actions.openCodex||this.codexOpening)return;
    const epoch=++this.historyEpoch;this.codexOpening=true;this.codexError='';this.renderHistory();
    const isCurrent=()=>!this.disposed&&epoch===this.historyEpoch&&!this.history.hidden;
    try{
      await this.actions.openCodex(entry,isCurrent);if(!isCurrent())return;
      this.history.hidden=true;this.historyScope.value='plugin';this.historySearch.placeholder='搜索插件对话';this.cancelCodexSearch();
    }catch(error){if(isCurrent())this.codexError=(error as Error).message;}
    finally{if(isCurrent()){this.codexOpening=false;this.renderHistory();}}
  }
  private renderHistory(force=true){
    if(this.historyScope.value==='codex'){this.renderCodexHistory(force);return;}
    const list=this.actions.list(),query=this.historySearch.value.toLowerCase(),key=JSON.stringify([list,query,this.chat().session.id]);
    if(!force&&key===this.historyKey)return;this.historyKey=key;
    // Preserve a rename field while other chats update.
    if(!force&&this.historyList.querySelector('input'))return;
    this.historyList.replaceChildren();
    for(const session of list.filter(s=>!s.preview&&s.title.toLowerCase().includes(query))){
      const row=el('div','la-history-row');row.dataset.sessionId=session.id;const select=button('',()=>{this.actions.select(session.id);this.history.hidden=true;},'b3-list-item la-history-select');select.append(el('span','la-history-title',session.title));
      if(session.state&&session.state!=='idle'){const badge=el('small','la-history-state',sessionStateLabel[session.state]);badge.dataset.state=session.state;select.append(badge);}
      if(session.unread)select.append(el('span','la-session-unread','新'));if(session.queueCount)select.append(el('small','la-history-state',`排队 ${session.queueCount}`));
      if(session.id===this.chat().session.id)select.classList.add('b3-list-item--focus');row.append(select);
      if(this.actions.rename)row.append(iconButton('重命名','iconEdit',()=>{const field=el('input','b3-text-field');field.value=session.title;row.replaceChildren(field);field.focus();field.select();const save=()=>{if(field.value.trim())this.actions.rename?.(session.id,field.value.trim());this.renderHistory();};field.onkeydown=e=>{if(e.key==='Enter')save();if(e.key==='Escape')this.renderHistory();};field.onblur=save;}));
      if(this.actions.delete)row.append(iconButton('删除对话','iconTrashcan',()=>this.requestSessionDelete(session.id)));
      this.historyList.append(row);
    }
    if(!this.historyList.children.length)this.historyList.append(el('p','la-hint','没有匹配的对话'));
  }
  update(){
    if(this.disposed)return;
    const chat=this.chat();
    if(chat.busy&&!this.runningSince.has(chat.session.id))this.runningSince.set(chat.session.id,Date.now());else if(!chat.busy)this.runningSince.delete(chat.session.id);
    const switching=this.sessionID!==chat.session.id;
    if(switching){this.menu?.close();if(this.displayedChat){this.displayedChat.session.draft=this.input.value;this.scrollPositions.set(this.sessionID,this.scroll.scrollTop);if(this.messageEdit)this.messageEdits.set(this.sessionID,this.messageEdit);else this.messageEdits.delete(this.sessionID);}this.sessionID=chat.session.id;this.displayedChat=chat;this.restoringDraft=true;try{this.input.value=chat.session.draft||'';}finally{this.restoringDraft=false;}this.messageEdit=this.messageEdits.get(this.sessionID);this.inputHistory=new InputHistory();for(const m of chat.session.messages)if(m.role==='user')this.inputHistory.push(m.displayText??m.text);this.rendered='';this.approvalKey='';this.queueKey='';this.bodies.clear();this.workStates.clear();}
    else this.displayedChat=chat;
    this.renderSessions();if(!this.history.hidden)this.renderHistory(false);
    this.title.textContent='Codex';this.title.title=chat.session.title;
    if(this.directory){const label=chat.session.workspaceMode==='auto'&&!chat.session.workspaceBinding?'无项目':chat.settings.cwd.split(/[\\/]/).filter(Boolean).at(-1)||chat.settings.cwd;this.directory.querySelector('span')!.textContent=label;setButtonHint(this.directory,`工作目录：${chat.settings.cwd}${chat.session.workspaceBinding?' · 绑定：'+chat.session.workspaceBinding:''}`);}
    this.status.textContent=this.pendingDrops?'正在整理引用和附件…':chat.requests.size?'等待你的确认':this.submitting?'正在发送…':chat.status;this.status.title=chat.settings.cwd;
    const model=(chat.resolvedModel===chat.settings.model?chat.settings.modelName:'')||chat.resolvedModel||chat.settings.modelName||chat.settings.model||(chat.modelState==='unavailable'?'模型未读取':'读取模型…'),effort=effortLabel(chat.resolvedEffort||chat.settings.reasoningEffort||'');
    this.model.querySelector('.la-model-name')!.textContent=model;this.effort.querySelector('.la-effort')!.textContent=effort;
    setButtonHint(this.effort,`思考强度：${effort}`);
    setButtonHint(this.model,`模型：${model} · 思考强度：${effort}`);
    const permission=permissionLabel(chat.settings);this.permission.classList.toggle('la-permission-full',chat.settings.permissionMode==='full');this.permission.querySelector('svg')!.outerHTML=permissionIcon(chat.settings.permissionMode);this.permission.querySelector('span')!.textContent=chat.settings.permissionMode==='full'?'完全访问':permission;setButtonHint(this.permission,`审批方式：${permission}`);this.updateSend();this.renderQueue();
    this.selections?.update(chat.session.id);
    const attachments=this.actions.attachments?.()||[];const contextKey=JSON.stringify(attachments.map(a=>({id:a.id,title:a.title,media:a.media})))+this.actions.context();
    if(contextKey!==this.contextKey){this.contextKey=contextKey;this.context.replaceChildren();
      if(attachments.length)attachments.forEach((a,i)=>{if(a.selection)return;if(a.media){this.context.append(this.mediaCard(a,i));return;}const chip=el('span','la-context-chip');const name=button(a.title,()=>{if(a.id)this.actions.openReference?.(a.id);},'la-context-name');name.title=a.title;chip.append(name,iconButton('移除 '+a.title,'iconClose',()=>this.actions.removeAttachment?.(i)));this.context.append(chip);});
      else if(this.actions.context())this.context.append(el('span','',this.actions.context()),button('移除',this.actions.clear));
    }
    const key=JSON.stringify([chat.session.messages,chat.busy,this.messageEdit,chat.session.codex?.adopted]);
    if(key!==this.rendered){
      const atBottom=switching?!this.scrollPositions.has(this.sessionID):this.scroll.scrollHeight-this.scroll.scrollTop-this.scroll.clientHeight<80;const open=switching?new Set<string>():new Set(Array.from(this.log.querySelectorAll<HTMLDetailsElement>('details[open]')).map(e=>e.dataset.messageId));
      const positions=new Map((switching?[]:Array.from(this.log.querySelectorAll<HTMLElement>('[data-scroll-id]'))).map(e=>[e.dataset.scrollId,{top:e.scrollTop,left:e.scrollLeft}]));
      this.rendered=key;this.log.replaceChildren();
      if(chat.session.codex&&!chat.session.codex.adopted)this.log.append(el('p','la-hint la-codex-preview','Codex 会话预览 · 发送消息后加入插件历史'));
      if(!chat.session.messages.length&&!chat.busy){const empty=el('div','la-empty'),logo=el('div','la-welcome-icon');logo.innerHTML=codexLogo;logo.setAttribute('aria-hidden','true');empty.append(logo,el('h3','','Codex'),el('p','','在笔记里，继续使用你的 Codex。'),el('p','la-hint','拖入文档或内容块，输入 [[ 搜索引用。'));
        for(const text of ['总结附加笔记的要点','对比这些笔记，整理共同结论','结合工作目录，帮我制定下一步计划'])empty.append(button(text,()=>{this.input.value=text;this.input.focus();},'b3-button b3-button--cancel la-example'));this.log.append(empty);}
      const renderCard=(m:typeof chat.session.messages[number],actions=true)=>{
        const card=el(m.role==='tool'?'details':'article',`la-message la-${m.role}`);card.dataset.messageId=m.id;if(m.role==='tool')(card as HTMLDetailsElement).open=open.has(m.id);
        const toolLabel=toolStatus(m);
        if(m.role==='tool'){
          card.dataset.status=toolLabel;const summary=el('summary','la-role');
          const icon=m.tool?.type==='commandExecution'?'iconTerminal':m.tool?.type==='imageView'?'iconImage':m.tool?.type==='webSearch'?'iconSearch':'iconFile';
          summary.innerHTML=`<svg aria-hidden="true"><use href="#${icon}"></use></svg>`;
          summary.append(el('span','la-tool-title',m.tool?.title||m.text.split('\n')[0].slice(0,80)),el('span','la-tool-status',toolLabel));card.append(summary);
        }else if(m.role==='error')card.append(el('div','la-role','错误'));
        const streaming=chat.busy&&m.status!=='completed';const bodyKey=JSON.stringify([m.text,m.attachments,m.attachment,streaming]);
        const cached=m.role==='assistant'?this.bodies.get(m.id):undefined;
        const body=cached?.key===bodyKey?cached.element:el('div','la-body b3-typography');
        if(m.role==='assistant'){
          if(cached?.key!==bodyKey){renderMarkdown(body,m.text,streaming);this.bodies.set(m.id,{key:bodyKey,element:body});}
        }else if(m.role==='tool'&&m.tool){
          const record=m.tool;const section=(label:string,value?:string)=>{if(!value)return;const wrap=el('section','la-tool-section'),pre=el('pre'),code=el('code','',value);pre.dataset.scrollId=m.id+':'+label;pre.append(code);wrap.append(el('div','la-tool-section-label',label),pre);body.append(wrap);};
          if(record.cwd)body.append(el('div','la-tool-meta',record.cwd));
          section(record.type==='commandExecution'?'Shell':'参数',record.input);section('输出',record.output);section('错误',record.error);
          const meta=[record.exitCode!==undefined?'退出码 '+record.exitCode:'',record.durationMs!==undefined?workDuration(record.durationMs):''].filter(Boolean).join(' · ');if(meta)body.append(el('div','la-tool-meta',meta));
        }else body.textContent=m.displayText??m.text;
        if(cached?.key!==bodyKey){const media=el('div','la-sent-media');
        for(const [index,attachment] of (m.attachments||(m.attachment?[m.attachment]:[])).entries()){if(attachment.media){media.append(this.mediaCard(attachment));continue;}const details=el('details','la-attachment');details.dataset.messageId=m.id+':attachment:'+index;details.open=open.has(details.dataset.messageId);details.append(el('summary','',attachment.title),el('div','la-attachment-body',attachment.text));if(attachment.id)details.append(button('打开笔记',()=>this.actions.openReference?.(attachment.id!),'b3-button b3-button--cancel'));body.append(details);}
        if(media.childElementCount)body.prepend(media);}
        card.append(body);
        if(m.role==='user'){const bubble=el('div','la-message-bubble');bubble.append(...Array.from(card.childNodes));card.append(bubble);}
        if(actions&&(m.role==='assistant'||m.role==='user')){card.tabIndex=0;const tools=el('div','la-message-actions');tools.append(iconButton('复制','iconCopy',()=>{void navigator.clipboard.writeText(m.displayText??m.text).catch(e=>this.actions.error?.(e.message));}));
          if(m.role==='user'&&!chat.busy&&this.actions.editMessage)tools.append(iconButton('编辑','iconEdit',()=>{this.messageEdit={id:m.id,text:m.displayText??m.text,pending:false};this.update();this.log.querySelector<HTMLTextAreaElement>('.la-message-editor textarea')?.focus();}));
          else if(m.role==='assistant'&&this.actions.branch){const branch=iconButton('分支','iconSplitLR',()=>{void this.actions.branch!(m.id).catch(e=>this.actions.error?.(e.message));});branch.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" class="la-branch-icon"><path d="M3 12h6l11-9m-7 0h7v7M12 15l8 6m-7 0h7v-7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';branch.disabled=chat.busy;tools.append(branch);}card.append(tools);}
        if(m.role==='user'&&this.messageEdit?.id===m.id){
          const draft=this.messageEdit;card.classList.add('la-editing');const editor=el('div','la-message-editor'),input=el('textarea','b3-text-field');input.value=draft.text;input.setAttribute('aria-label','编辑消息内容');input.disabled=draft.pending;input.oninput=()=>{draft.text=input.value;};
          const controls=el('div','la-message-edit-actions'),cancel=button('取消',()=>{this.messageEdit=undefined;this.messageEdits.delete(chat.session.id);this.update();},'b3-button b3-button--cancel'),send=button(draft.pending?'发送中…':'发送',()=>{if(!input.value.trim()||draft.pending||chat.busy)return;draft.text=input.value;draft.pending=true;draft.error=undefined;this.update();void this.actions.editMessage!(m.id,draft.text).then(()=>{this.messageEdits.delete(chat.session.id);if(this.chat()===chat&&this.messageEdit===draft)this.messageEdit=undefined;if(!this.disposed)this.update();}).catch(e=>{draft.pending=false;draft.error=e.message;if(!this.disposed)this.update();});},'b3-button');cancel.disabled=draft.pending;send.disabled=draft.pending||chat.busy;controls.append(cancel,send);editor.append(input,controls);if(draft.error)editor.append(el('div','la-queue-error',draft.error));card.querySelector('.la-message-actions')?.remove();const bubble=card.querySelector('.la-message-bubble')!;const attachments=Array.from(bubble.querySelectorAll('.la-attachment,.la-sent-media'));bubble.replaceChildren(...attachments,editor);
        }
        return card;
      };
      for(const row of conversationRows(chat.session.messages,chat.busy)){
        if(row.kind==='message'){this.log.append(renderCard(row.message));continue;}
        const work=el('details','la-work');work.dataset.messageId=row.id;work.dataset.running=String(row.running);
        work.open=row.running?(this.workStates.get(row.id)===true?open.has(row.id):true):(this.workStates.get(row.id)===true?false:open.has(row.id));
        this.workStates.set(row.id,row.running);
        const startedAt=chat.workStartedAt??row.startedAt??this.runningSince.get(chat.session.id)??Date.now();
        const summary=el('summary','',workDuration(row.running?Date.now()-startedAt:row.elapsedMs,row.running));if(row.running)summary.dataset.startedAt=String(startedAt);work.append(summary);
        if(row.messages.length){const content=el('div','la-work-content');for(const message of row.messages)content.append(renderCard(message,false));work.append(content);}this.log.append(work);
      }

      const ids=new Set(chat.session.messages.map(m=>m.id));for(const id of this.bodies.keys())if(!ids.has(id))this.bodies.delete(id);
      this.log.querySelectorAll<HTMLDetailsElement>('.la-work,.la-tool').forEach(details=>details.addEventListener('toggle',()=>{if(details.open)void enhanceMarkdown(details);}));
      for(const node of this.log.querySelectorAll<HTMLElement>('[data-scroll-id]')){const position=positions.get(node.dataset.scrollId);if(position){node.scrollTop=position.top;node.scrollLeft=position.left;}}
      if(switching&&this.scrollPositions.has(this.sessionID))this.scroll.scrollTop=this.scrollPositions.get(this.sessionID)!;else if(atBottom)this.scroll.scrollTop=this.scroll.scrollHeight;
      const followFrom=this.scroll.scrollTop;void enhanceMarkdown(this.log).then(()=>{if(!this.disposed&&this.rendered===key&&atBottom&&this.scroll.scrollTop>=followFrom-2)this.scroll.scrollTop=this.scroll.scrollHeight;});
    }
    this.syncWorkTimer();
    const reqKey=JSON.stringify([...chat.requests].map(([id,req])=>[id,req,req.method==='mcpServer/elicitation/request'?mcpApprovalDescription(req.params,chat.session.messages):undefined]));if(reqKey!==this.approvalKey){const atBottom=this.scroll.scrollHeight-this.scroll.scrollTop-this.scroll.clientHeight<80;this.approvalKey=reqKey;this.renderApprovals();if(atBottom)this.scroll.scrollTop=this.scroll.scrollHeight;}
    this.updateScrollButton();
  }
  private renderApprovals(){
    this.approvals.replaceChildren();
    const chat=this.chat();for(const [id,req] of chat.requests){
      const p=req.params,card=el('section','la-approval');card.dataset.requestId=id;
      const heading=el('strong','la-approval-title','需要你的确认');card.append(heading);
      const actions=el('div','la-approval-actions');
      const detail=(label:string,value:unknown)=>{if(value===undefined||value===null||value==='')return;const details=el('details','la-approval-detail');details.append(el('summary','',label),el('pre','',typeof value==='string'?value:JSON.stringify(value,null,2)));card.append(details);};
      const info=(label:string,value:string)=>{const row=el('div','la-approval-info');row.append(el('span','la-approval-label',label),el('span','',value));card.append(row);};
      const answer=(v:any)=>chat.answer(id,v);
      if(req.method==='item/tool/requestUserInput'){
        heading.textContent='智能体需要补充信息';
        const fields:(()=>[string,{answers:string[]}])[]=[];
        for(const q of p.questions){card.append(el('p','',q.question));
          const input=el('input','b3-text-field');input.type=q.isSecret?'password':'text';input.placeholder='输入回答';input.setAttribute('aria-label',q.question);
          if(q.options?.length){const opts=el('div','la-options');for(const o of q.options)opts.append(button(o.label,()=>{input.value=o.label;input.focus();}));card.append(opts);}
          card.append(input);fields.push(()=>[q.id,{answers:input.value?[input.value]:[]}]);
        }
        actions.append(button('提交回答',()=>answer({answers:Object.fromEntries(fields.map(f=>f()))})));
      }else if(req.method==='mcpServer/elicitation/request'){
        const description=mcpApprovalDescription(p,chat.session.messages);heading.textContent=description.title;card.append(el('p','la-approval-summary',description.summary));info('服务',description.server);if(description.tool)info('工具',description.tool);if(description.operation)info('操作',description.operation);
        if(description.args)detail('查看调用参数',description.args);
        if(description.original){if(description.recognized)detail('查看原始请求',description.original);else card.append(el('p','la-approval-source',description.original));}
        const schema=p.requestedSchema;
        const properties=Object.entries(schema?.properties||{}) as [string,any][];
        const supported=p.mode!=='url'&&schema&&(!schema.type||schema.type==='object')&&properties.every(([,s])=>['string','number','integer','boolean'].includes(s.type)&&(!s.enum||s.enum.every((v:any)=>['string','number','boolean'].includes(typeof v))));
        if(supported){
          const form=el('form','la-mcp-form');const values:(()=>[string,unknown]|undefined)[]=[];
          for(const [key,s]of properties){
            const label=el('label','la-mcp-field',s.title||key);if(s.description)label.append(el('small','la-hint',s.description));
            const input=s.enum?el('select','b3-select'):el('input','b3-text-field');
            if(s.enum){const blank=el('option','','请选择');blank.value='';input.append(blank);s.enum.forEach((v:any,i:number)=>{const opt=el('option','',String(v));opt.value=String(i);input.append(opt);});}
            else if(input instanceof HTMLInputElement){input.type=s.type==='boolean'?'checkbox':s.type==='string'?(s.format==='password'?'password':'text'):'number';if(s.type==='integer')input.step='1';else if(s.type==='number')input.step='any';if(s.minimum!==undefined)input.min=String(s.minimum);if(s.maximum!==undefined)input.max=String(s.maximum);if(s.minLength!==undefined)input.minLength=s.minLength;if(s.maxLength!==undefined)input.maxLength=s.maxLength;}
            input.setAttribute('aria-label',s.title||key);input.required=(schema.required||[]).includes(key)&&s.type!=='boolean';
            label.append(input);form.append(label);
            values.push(()=>{if(s.type==='boolean'&&!s.enum)return[key,(input as HTMLInputElement).checked];if(input.value==='')return undefined;return[key,s.enum?s.enum[Number(input.value)]:s.type==='string'?input.value:Number(input.value)];});
          }
          const submit=button(properties.length?'提交并继续':'允许本次',()=>{},'b3-button');submit.type='submit';
          form.onsubmit=e=>{e.preventDefault();if(form.reportValidity())answer({action:'accept',content:Object.fromEntries(values.map(f=>f()).filter((x):x is [string,unknown]=>!!x))});};
          actions.append(submit,button('拒绝',()=>answer({action:'decline',content:null}),'b3-button b3-button--cancel'));form.append(actions);card.append(form);
        }else card.append(el('p','la-hint',p.mode==='url'?`需要外部授权：${p.url||''}。请在 CLI 中完成后重试。`:'该 MCP 请求包含暂不支持的复杂表单，可拒绝后继续。'));
        if(!supported)actions.append(button('拒绝',()=>answer({action:'decline',content:null}),'b3-button b3-button--cancel'));

      }else{
        const item=chat.session.messages.find(m=>m.id===p.itemId);
        const permissions=req.method==='item/permissions/requestApproval';
        heading.textContent=permissions?'允许申请这些权限？':req.method==='item/fileChange/requestApproval'?'允许修改文件？':'允许执行本机命令？';
        card.append(el('p','la-approval-summary',permissions?'智能体请求在当前回合使用以下权限。':req.method==='item/fileChange/requestApproval'?'智能体准备修改以下文件。':'智能体准备在本机运行以下命令。'));
        if(permissions){const fs=p.permissions?.fileSystem;if(fs?.read?.length)info('读取路径',fs.read.join('、'));if(fs?.write?.length)info('写入路径',fs.write.join('、'));if(p.permissions?.network?.enabled===true)info('网络','允许网络访问');detail('查看完整权限',p.permissions);}
        else card.append(el('pre','la-approval-command',p.command||item?.tool?.input||item?.text||'请求中未提供具体内容'));
        if(p.cwd)info('工作目录',p.cwd);if(p.grantRoot)info('写入范围',p.grantRoot);if(p.networkApprovalContext?.host)info('网络目标',p.networkApprovalContext.host);if(p.reason)detail('请求原因',p.reason);
        actions.append(button('允许本次',()=>answer(permissions?{permissions:p.permissions,scope:'turn'}:{decision:'accept'}),'b3-button'),button('拒绝',()=>answer(permissions?{permissions:{},scope:'turn'}:{decision:'decline'}),'b3-button b3-button--cancel'));
      }
      if(!card.contains(actions))card.append(actions);
      card.setAttribute('aria-label',heading.textContent||'权限请求');
      this.approvals.append(card);
    }
  }
}
