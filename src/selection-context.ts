import {validID,type Attachment} from './context';
import {el,button,iconButton} from './dom';

/** Captures text only from one note editor or one assistant reply. */
export class SelectionContext {
  readonly element=el('div','la-selection-context');
  private key='';private last='';private session='';private open:''|'manual'|'latest'='';
  constructor(private root:HTMLElement,private get:()=>Attachment[],private change:(items:Attachment[])=>void,private error:(message:string)=>void,private notes=true){
    document.addEventListener('mouseup',this.capture);document.addEventListener('keyup',this.capture);
    document.addEventListener('pointerdown',this.outside);document.addEventListener('scroll',this.hideToolbar,true);document.addEventListener('keydown',this.escape);window.addEventListener('resize',this.hideToolbar);
  }
  private outside=(event:Event)=>{if(!this.toolbar.contains(event.target as Node))this.hideToolbar();if(!this.element.contains(event.target as Node)&&this.open){this.open='';this.key='';this.update(this.session);}};
  private toolbar=el('div','la-selection-toolbar');
  private escape=(event:KeyboardEvent)=>{if(event.key==='Escape')this.hideToolbar();};
  private async copy(text:string){try{await navigator.clipboard.writeText(text);}catch{this.error('复制失败，请使用系统复制。');}this.hideToolbar();}
  private hideToolbar=()=>{this.toolbar.remove();};
  private read(range:Range):Attachment|undefined{
    if(range.collapsed)return;
    const parent=range.startContainer.nodeType===1?range.startContainer as Element:range.startContainer.parentElement;
    const reply=parent?.closest('.la-assistant .la-body, .la-user .la-body');
    const note=parent?.closest('.protyle-wysiwyg');
    const source=reply&&this.root.contains(reply)?reply:this.notes&&note&&!note.closest('.la-panel')?note:undefined;
    if(!source||!source.contains(range.endContainer))return;
    const raw=range.toString(),text=raw.trim();if(!text)return;
    if(text.length>60000){this.error('选文超过 60,000 字符，请缩小选区。');return;}
    const origin=reply?(reply.closest('.la-assistant')?'AI 回复':'用户消息'):'思源笔记';
    const before=range.cloneRange();before.selectNodeContents(source);before.setEnd(range.startContainer,range.startOffset);
    const after=range.cloneRange();after.selectNodeContents(source);after.setStart(range.endContainer,range.endOffset);
    const block=(node:Node)=>{const element=node.nodeType===1?node as Element:node.parentElement;const id=element?.closest('[data-node-id]')?.getAttribute('data-node-id');return validID(id)?id:undefined;};
    const startOffset=before.toString().length;
    return {title:'所选文本 · '+origin,text,selection:{source:origin,originalText:raw,startOffset,endOffset:startOffset+raw.length,contextBefore:before.toString().slice(-200),contextAfter:after.toString().slice(0,200),...(reply?{conversationId:this.session,messageId:reply.closest<HTMLElement>('[data-message-id]')?.dataset.messageId}:{startBlockId:block(range.startContainer),endBlockId:block(range.endContainer)})}};
  }
  private add(item:Attachment,latest=false){
    const items=this.get().filter(a=>!latest||a.selectionMode!=='latest');
    if(!latest&&items.some(a=>a.selectionMode!=='latest'&&JSON.stringify(a.selection)===JSON.stringify(item.selection)))return;
    if(items.length>=20||items.reduce((n,a)=>n+a.text.length,0)+item.text.length>120000){this.error('引用数量或长度已达上限，请先移除部分资料。');return;}
    this.change([...items,{...item,selectionMode:latest?'latest':'manual'}]);
  }
  /** Snapshot the host menu range before menu clicks move focus or collapse it. */
  addNoteMenu(menu:{addItem:(item:{label:string;click:()=>void})=>unknown},range:Range){
    const item=this.read(range);if(!item||item.selection?.source!=='思源笔记')return;
    const session=this.session;
    menu.addItem({label:'添加到 Codex',click:()=>{if(session!==this.session)return;this.add(item);}});
  }
  private capture=(event:Event)=>{
    if(this.toolbar.contains(event.target as Node)||this.element.contains(event.target as Node))return;
    if(event.type==='keyup'&&(event as KeyboardEvent).shiftKey)return;
    if(event.type==='mouseup'&&(event as MouseEvent).button===2)return;
    const selection=window.getSelection();if(!selection?.rangeCount||selection.isCollapsed){this.hideToolbar();return;}
    const range=selection.getRangeAt(0),item=this.read(range);if(!item){this.hideToolbar();return;}
    if(item.selection!.source==='思源笔记'){
      this.hideToolbar();const signature=this.session+JSON.stringify(item.selection);if(signature===this.last)return;this.last=signature;this.add(item,true);return;
    }
    const session=this.session;
    this.toolbar.replaceChildren(button('复制',()=>{void this.copy(item.text);},'la-selection-action'),button('添加到对话',()=>{if(session===this.session)this.add(item);this.hideToolbar();},'la-selection-action'));
    this.toolbar.setAttribute('role','toolbar');this.toolbar.setAttribute('aria-label','选文操作');this.toolbar.onpointerdown=e=>e.preventDefault();
    document.body.append(this.toolbar);
    const rect=range.getBoundingClientRect?.()||this.root.getBoundingClientRect();
    const box=this.toolbar.getBoundingClientRect();this.toolbar.style.left=Math.max(8,Math.min(rect.left+(rect.width-box.width)/2,window.innerWidth-box.width-8))+'px';
    this.toolbar.style.top=Math.max(8,rect.top>=box.height+12?rect.top-box.height-8:Math.min(rect.bottom+8,window.innerHeight-box.height-8))+'px';
  };
  update(session:string){
    if(session!==this.session){this.hideToolbar();this.session=session;this.last='';this.open='';this.key='';}
    const items=this.get().filter(a=>a.selection);const key=JSON.stringify([session,items,this.open]);if(key===this.key)return;this.key=key;
    this.element.replaceChildren();this.element.hidden=!items.length;if(!items.length)return;
    for(const kind of ['manual','latest'] as const){
      const group=items.filter(a=>(a.selectionMode==='latest')===(kind==='latest'));if(!group.length)continue;
      const chip=el('div','la-context-chip');chip.dataset.selectionKind=kind;
      const toggle=button(kind==='latest'?'最新选区':`${group.length} 条注释`,()=>{this.open=this.open===kind?'':kind;this.key='';this.update(session);},'la-context-name');toggle.setAttribute('aria-expanded',String(this.open===kind));toggle.setAttribute('aria-label',kind==='latest'?'查看最新选区':'查看所选文本');
      chip.append(toggle,iconButton(kind==='latest'?'移除最新选区':'移除全部选文','iconClose',()=>this.change(this.get().filter(a=>!group.includes(a)))));this.element.append(chip);
    }
    if(!this.open)return;
    const panel=el('div','la-selection-popover'),scroll=el('div','la-selection-scroll');panel.append(scroll);panel.setAttribute('role','region');panel.setAttribute('aria-label','所选文本');
    panel.onkeydown=e=>{if(e.key==='Escape'){this.open='';this.key='';this.update(session);this.element.querySelector<HTMLButtonElement>('button')?.focus();}};
    items.filter(a=>(a.selectionMode==='latest')===(this.open==='latest')).forEach((item,index)=>{
      const row=el('div','la-selection-row'),copy=el('div','la-selection-copy'),tools=el('div','la-selection-tools');
      copy.append(el('div','la-selection-label','所选文本：'),el('div','la-selection-text',item.text));
      if(item.annotation)copy.append(el('div','la-selection-comment',item.annotation));
      const remove=()=>this.change(this.get().filter(a=>a!==item));
      tools.append(iconButton('编辑选文 '+(index+1),'iconEdit',()=>{
        const input=el('textarea','b3-text-field la-selection-editor');input.value=item.text;input.maxLength=60000;input.setAttribute('aria-label','编辑所选文本');
        const comment=el('textarea','b3-text-field la-selection-comment-editor');comment.value=item.annotation||'';comment.placeholder='可选评论';comment.maxLength=6000;comment.setAttribute('aria-label','可选评论');
        row.classList.add('la-selection-editing');const controls=el('div','la-selection-edit-actions');copy.replaceChildren(el('div','la-selection-label','所选文本'),input,comment,controls);tools.replaceChildren();controls.append(button('保存',()=>{const text=input.value.trim();if(!text){remove();return;}if(this.get().reduce((n,a)=>n+(a===item?text.length:a.text.length),0)>120000){this.error('上下文超过 120,000 字符。');return;}this.change(this.get().map(a=>a===item?{...a,text,annotation:comment.value.trim()||undefined}:a));}),button('取消',()=>{this.key='';this.update(session);}));input.focus();
      }),iconButton('删除选文 '+(index+1),'iconTrashcan',remove));
      row.append(el('span','la-selection-number',`${index+1}.`),copy,tools);scroll.append(row);
    });this.element.append(panel);
  }
  destroy(){document.removeEventListener('mouseup',this.capture);document.removeEventListener('keyup',this.capture);document.removeEventListener('pointerdown',this.outside);document.removeEventListener('scroll',this.hideToolbar,true);document.removeEventListener('keydown',this.escape);window.removeEventListener('resize',this.hideToolbar);this.hideToolbar();}
}
