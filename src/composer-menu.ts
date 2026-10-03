import type {Composer} from './composer';
import type {Reference} from './context';
import type {ModelInfo} from './popover';
import type {ChatSession} from './session';
import {effortLabel} from './model-options';
import {menuTrigger,menuMatches,type MenuTrigger} from './composer-trigger';
import {el,button} from './ui';
export interface ComposerMenuActions {
  models?:()=>Promise<ModelInfo[]>;
  quickSetting?:(patch:{model?:string;modelName?:string;reasoningEffort?:string;fastMode?:boolean})=>Promise<void>;
  activeTabContext?:()=>boolean;
  setActiveTabContext?:(enabled:boolean)=>Promise<void>;
  searchNotes?:(query:string)=>Promise<Reference[]>;
  referenceConversation?:(id:string)=>Promise<void>;
  list:()=>{id:string;title:string;preview?:boolean}[];
  attach:()=>void|Reference[]|Promise<void|Reference[]>;
  drop?:(ids:string[])=>Promise<void|Reference[]>;
  error?:(message:string)=>void;
  changed?:()=>void;
}
type Scope='root'|'model'|'effort'|'fast'|'status'|'notes'|'chats';
type Item={id:string;label:string;description?:string;icon:string;aliases?:string[];selected?:boolean;disabled?:boolean;next?:Scope;run?:()=>Promise<void|Reference[]>|void|Reference[]};
const icons:Record<string,string>={status:'M4 17a9 9 0 1 1 16 0M12 13l4-4M8 20h8',fast:'m13 2-9 12h7l-1 8 10-13h-7l1-7Z',effort:'M9 4a3 3 0 0 0-5 3 4 4 0 0 0-1 7 4 4 0 0 0 6 5m6-15a3 3 0 0 1 5 3 4 4 0 0 1 1 7 4 4 0 0 1-6 5M9 4v16m6-16v16',model:'m12 3 9 5v9l-9 5-9-5V8l9-5Zm-9 5 9 5 9-5m-9 5v9',note:'M14 3H5v18h14V8l-5-5Zm0 0v5h5',chat:'M4 4h16v13H10l-6 4V4Zm4 5h8m-8 4h5',active:'M4 4h16v16H4V4Zm4 6 3 3 5-5'};
const effortAliases:Record<string,string[]>={none:['wu','w'],minimal:['zuidi','zd'],low:['di','d'],medium:['zhong','z'],high:['gao','g'],xhigh:['jigao','jg'],max:['zuida','zd'],ultra:['chaogao','cg']};
let serial=0;
export class ComposerMenu {
  readonly element=el('div','la-command-menu');
  private trigger?:MenuTrigger;private plus=false;private scope:Scope='root';private query='';private dismissed='';private signature='';
  private items:Item[]=[];private selected=0;private composing=false;private searchComposing=false;private saving=false;private disposed=false;private version=0;
  private catalog:ModelInfo[]=[];private modelError='';private statusError='';private modelsLoading=false;private modelRequested=false;
  private modelGeneration=0;
  private notes:Reference[]=[];private noteError='';private notesLoading=false;private noteKey='';private noteTimer?:ReturnType<typeof setTimeout>;
  private observer?:ResizeObserver;private search?:HTMLInputElement;
  private restoreInput?:()=>boolean;
  constructor(private anchor:HTMLElement,private input:Composer,private chat:()=>ChatSession,private actions:ComposerMenuActions){
    this.element.hidden=true;this.element.id='la-command-menu-'+ ++serial;this.element.setAttribute('role','dialog');
    this.element.addEventListener('pointerdown',e=>{if(!(e.target instanceof window.HTMLInputElement))e.preventDefault();});
    this.element.addEventListener('click',e=>e.stopPropagation());this.element.addEventListener('keydown',e=>this.keydown(e));document.body.append(this.element);
    document.addEventListener('pointerdown',this.outside,true);document.addEventListener('selectionchange',this.selection);window.addEventListener('resize',this.position);window.addEventListener('scroll',this.position,true);
    if(typeof ResizeObserver!=='undefined'){this.observer=new ResizeObserver(this.position);this.observer.observe(anchor);this.observer.observe(this.element);}
  }
  private selection=()=>{if(this.input.element.contains(document.activeElement))this.update();};
  private outside=(e:Event)=>{const target=e.target as HTMLElement;if(!this.element.contains(target)&&!target.closest?.('.la-composer-host,.la-add'))this.close();};
  get visible(){return !this.element.hidden;}
  composition(active:boolean){this.composing=active;if(active)this.hide();else this.update();}
  update(){
    if(this.disposed||this.composing||this.saving||this.plus)return;
    const cursor=this.input.cursor(),next=cursor&&menuTrigger(cursor.text,cursor.offset);
    const signature=next?`${next.kind}:${next.start}:${next.end}:${cursor!.text}`:'';
    if(!next){this.trigger=undefined;this.signature='';this.dismissed='';this.hide();return;}
    if(signature===this.dismissed)return;
    if(signature===this.signature&&this.visible)return;
    if(!this.trigger||next.kind!==this.trigger.kind||next.start!==this.trigger.start){this.scope='root';this.noteKey='';this.modelRequested=false;this.catalog=[];this.modelError='';this.modelGeneration++;}
    this.trigger=next;this.signature=signature;this.query=next.query;this.selected=0;this.show();
  }
  openAdd(){if(this.visible&&this.plus){this.close();return;}const restore=this.input.bookmark?.();this.close();this.restoreInput=restore;this.plus=true;this.scope='root';this.query='';this.trigger=undefined;this.selected=0;this.show();this.search?.focus();}
  private show(){this.element.hidden=false;this.input.element.setAttribute('aria-controls',this.element.id);this.input.element.setAttribute('aria-expanded','true');this.anchor.querySelector('.la-add')?.setAttribute('aria-expanded',String(this.plus));this.render();}
  private hide(){this.element.hidden=true;this.input.element.setAttribute('aria-expanded','false');this.input.element.removeAttribute('aria-activedescendant');this.anchor.querySelector('.la-add')?.setAttribute('aria-expanded','false');this.version++;if(this.noteTimer)clearTimeout(this.noteTimer);this.noteKey='';}
  close(){this.dismissed=this.signature;this.plus=false;this.searchComposing=false;this.modelGeneration++;this.modelRequested=false;this.modelsLoading=false;this.catalog=[];this.hide();}
  private kind(){return this.plus?'add':this.trigger?.kind||'add';}
  keydown(e:KeyboardEvent){
    if(e.isComposing||this.composing||this.searchComposing)return false;
    if(e.key==='Enter'&&e.shiftKey)return false;
    if(!this.visible){if(e.key==='@'||e.key==='/')e.stopPropagation();return false;}
    if(['ArrowDown','ArrowUp','Enter','Tab','Escape'].includes(e.key)){
      e.preventDefault();e.stopImmediatePropagation();
      if(e.key==='Escape'){this.close();this.input.focus();return true;}
      if(e.key==='Enter'||(e.key==='Tab'&&!e.shiftKey)){const item=this.items[this.selected];if(item&&!item.disabled)void this.choose(item);return true;}
      if(this.items.length){const step=e.key==='ArrowUp'||e.shiftKey?-1:1;this.selected=(this.selected+step+this.items.length)%this.items.length;this.paintSelection();}return true;
    }
    return false;
  }
  private async loadModels(){
    if(this.modelRequested||!this.actions.models)return;this.modelRequested=true;this.modelsLoading=true;const generation=this.modelGeneration;
    try{const catalog=await this.actions.models();if(this.disposed||generation!==this.modelGeneration)return;this.catalog=catalog;this.modelError='';}catch(e){if(generation===this.modelGeneration)this.modelError=(e as Error).message;}finally{if(generation===this.modelGeneration){this.modelsLoading=false;if(this.visible&&!this.disposed)this.render();}}
  }
  private searchNotes(){
    if(!this.actions.searchNotes||this.scope==='chats'||(!this.query&&this.scope!=='notes')){if(this.noteKey){this.version++;if(this.noteTimer)clearTimeout(this.noteTimer);this.noteKey='';this.notes=[];this.noteError='';this.notesLoading=false;}return;}
    const key=this.scope+':'+this.query;if(this.noteKey===key)return;this.noteKey=key;this.notes=[];this.noteError='';this.notesLoading=true;
    const version=++this.version,query=this.query;if(this.noteTimer)clearTimeout(this.noteTimer);
    this.noteTimer=setTimeout(async()=>{try{const notes=await this.actions.searchNotes!(query);if(version!==this.version||this.disposed)return;this.notes=notes;}catch(e){if(version!==this.version||this.disposed)return;this.noteError=(e as Error).message;}finally{if(version===this.version&&!this.disposed){this.notesLoading=false;this.selected=0;this.render();}}},150);
  }
  private roots():Item[]{
    const chat=this.chat(),activity=this.actions.activeTabContext?.()??false;
    if(this.kind()==='function')return [
      {id:'status',label:'状态',description:'聊天 ID、上下文用量和速率限制',icon:'status',aliases:['zhuangtai','zt','status'],next:'status'},
      {id:'fast',label:'快速',description:(chat.settings.fastMode??chat.resolvedFastMode)?'已开启 · 用量消耗更高':'已关闭',icon:'fast',aliases:['kuaisu','ks','fast'],next:'fast'},
      {id:'effort',label:'推理',description:effortLabel(chat.settings.reasoningEffort||chat.resolvedEffort),icon:'effort',aliases:['tuili','tl','reasoning'],next:'effort'},
      {id:'model',label:'模型',description:chat.settings.modelName||chat.settings.model||chat.resolvedModel||'CLI 默认',icon:'model',aliases:['moxing','mx','model'],next:'model'},
      {id:'activity',label:'为模型提供当前活动',description:activity?'已开启':'已关闭',icon:'active',aliases:['weimoxing tigong dangqian huodong','wmxtgdqhd','dangqianhuodong','dqhd','activity'],selected:activity,disabled:!this.actions.setActiveTabContext,run:()=>this.actions.setActiveTabContext?.(!activity)}
    ];
    return [
      {id:'active',label:'当前激活的笔记文件',description:'添加当前打开的笔记',icon:'active',run:()=>this.actions.attach()},
      {id:'notes',label:'按标题引用笔记文件',description:'搜索思源笔记',icon:'note',next:'notes'},
      {id:'chats',label:'按标题引用其他对话',description:'搜索历史对话',icon:'chat',next:'chats'}
    ];
  }
  private choices():Item[]{
    const chat=this.chat(),selected=chat.settings.model||chat.resolvedModel,model=this.catalog.find(m=>m.model===selected);
    const disabled=chat.busy||!this.actions.quickSetting;
    const efforts=model?.supportedReasoningEfforts?.map(e=>e.reasoningEffort)||[];
    const effortItems:Item[]=efforts.map(e=>({id:'effort-'+e,label:effortLabel(e),description:'推理',aliases:[e,...(effortAliases[e]||[]), 'tuili'+(effortAliases[e]?.[0]||e),'tl'+(effortAliases[e]?.[1]||e),'推理'+effortLabel(e)],icon:'effort',selected:e===(chat.settings.reasoningEffort||chat.resolvedEffort),disabled,run:()=>this.actions.quickSetting?.({reasoningEffort:e})}));
    const fastItems:Item[]=[true,false].map(enabled=>({id:'fast-'+enabled,label:enabled?'开启快速模式':'关闭快速模式',description:enabled?'用量消耗更高':'标准速度',aliases:enabled?['kaiqi','kq','kuaisukaiqi','kskq','kaiqikuaisumoshi','kqksms','faston']:['guanbi','gb','kuaisuguanbi','ksgb','guanbikuaisumoshi','gbksms','fastoff'],icon:'fast',selected:enabled===(chat.settings.fastMode??chat.resolvedFastMode),disabled,run:()=>this.actions.quickSetting?.({fastMode:enabled})}));
    const modelItems:Item[]=this.catalog.map(m=>({id:'model-'+m.model,label:m.displayName||m.model,description:'模型',aliases:[m.model,'moxing'+m.model,'mx'+m.model],icon:'model',selected:m.model===selected,disabled,run:()=>this.actions.quickSetting?.({model:m.model,modelName:m.displayName||m.model,reasoningEffort:m.defaultReasoningEffort||''})}));
    if(this.scope==='model')return modelItems;if(this.scope==='effort')return effortItems;if(this.scope==='fast')return fastItems;
    return [...effortItems,...fastItems,...modelItems];
  }
  private references():Item[]{
    const notes:Item[]=this.scope==='chats'?[]:this.notes.map(ref=>({id:'note-'+ref.id,label:ref.title,description:'笔记',icon:'note',disabled:!this.actions.drop,run:()=>this.actions.drop?.([ref.id])}));
    const chats:Item[]=this.scope==='notes'?[]:this.actions.list().filter(s=>!s.preview&&s.id!==this.chat().session.id&&menuMatches(this.query,s.title)).slice(0,30).map(s=>({id:'chat-'+s.id,label:s.title,description:'历史对话',icon:'chat',disabled:!this.actions.referenceConversation,run:()=>this.actions.referenceConversation?.(s.id)}));
    return [...notes,...chats];
  }
  private render(){
    if(this.disposed||!this.visible||this.searchComposing)return;
    if(this.kind()==='function'&&this.scope!=='status')void this.loadModels();
    if(this.kind()==='add')this.searchNotes();
    const roots=this.roots(),isRoot=this.scope==='root';
    let items=isRoot&&!this.query?roots:this.kind()==='function'?(isRoot?[...roots,...this.choices()]:this.choices()):this.references();
    if(this.kind()==='function'&&this.query){const match=(item:Item)=>menuMatches(this.query,item.label,...(item.aliases||[]));const matchedRoots=isRoot?roots.filter(match):[];items=matchedRoots.length?matchedRoots:items.filter(match);}
    this.items=items;this.selected=Math.min(this.selected,Math.max(0,items.length-1));
    const keepSearch=this.plus&&this.search&&this.element.contains(this.search);
    if(keepSearch)Array.from(this.element.childNodes).forEach(node=>{if(node!==this.search)node.remove();});else this.element.replaceChildren();
    this.element.setAttribute('aria-label',this.kind()==='function'?'功能菜单':'添加菜单');
    if(this.kind()==='add'||!isRoot){
      const heading=el('div','la-command-heading');
      if(!isRoot){const back=button('',()=>this.go('root'),'la-command-back');back.setAttribute('aria-label','返回菜单');back.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 4-8 8 8 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';heading.append(back);}
      heading.append(el('span','',isRoot?'添加':({model:'模型',effort:'推理',fast:'快速',status:'状态',notes:'引用笔记文件',chats:'引用其他对话'} as Record<string,string>)[this.scope]));this.element.insertBefore(heading,this.element.firstChild);
    }
    if(this.plus){
      if(!keepSearch){this.search=el('input','la-command-search b3-text-field');this.search.type='search';this.search.placeholder='搜索笔记和历史对话';this.search.setAttribute('aria-label','搜索笔记和历史对话');
        this.search.oninput=()=>{this.query=this.search!.value;this.selected=0;this.render();};
        this.search.addEventListener('compositionstart',()=>{this.searchComposing=true;});this.search.addEventListener('compositionend',()=>{this.searchComposing=false;this.query=this.search!.value;this.selected=0;this.render();});this.element.append(this.search);
      }
      if(this.search!.value!==this.query)this.search!.value=this.query;
    }
    if(this.scope==='status'){this.renderStatus();this.position();return;}
    const list=el('div','la-command-list');list.setAttribute('role','listbox');list.setAttribute('aria-label',this.kind()==='function'?'功能选项':'引用选项');
    for(const item of items){const row=button('',()=>{void this.choose(item);},'la-command-item');row.id=this.element.id+'-'+item.id;row.tabIndex=-1;row.setAttribute('role','option');row.disabled=this.saving||!!item.disabled;
      const icon=el('span','la-command-icon');icon.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[item.icon]}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      row.append(icon,el('span','la-command-label',item.label));if(item.description)row.append(el('span','la-command-description',item.description));row.append(el('span','la-command-tail',item.next?'›':item.selected?'✓':''));
      row.onpointermove=()=>{this.selected=items.indexOf(item);this.paintSelection(false);};list.append(row);
    }this.element.append(list);
    const loading=this.kind()==='function'?this.modelsLoading:this.notesLoading;
    if(!items.length)this.element.append(el('div','la-command-note',loading?'正在搜索…':'没有匹配的选项'));
    if(this.kind()==='add'&&this.notesLoading&&items.length)this.element.append(el('div','la-command-note','正在搜索笔记…'));
    const error=this.kind()==='function'?this.modelError:this.noteError;
    if(error){const note=el('div','la-command-note',error);note.setAttribute('role','alert');this.element.append(note,button('重试',()=>{if(this.kind()==='function')this.modelRequested=false;else this.noteKey='';this.render();},'la-command-back'));}
    if(this.kind()==='function'&&this.chat().busy)this.element.append(el('div','la-command-note','停止当前回复后可切换模型、推理和快速设置'));
    this.paintSelection(false);this.position();
  }
  private renderStatus(){
    const chat=this.chat();const table=el('dl','la-command-status');
    for(const [label,value]of [['连接',chat.status],['聊天 ID',chat.session.threadId||chat.session.id],['模型',chat.settings.modelName||chat.settings.model||chat.resolvedModel||'CLI 默认'],['工作目录',chat.settings.cwd],['上下文',chat.contextUsageLabel()],['速率限制',chat.rateLimitLabel()]])table.append(el('dt','',label),el('dd','',value));
    this.element.append(table);if(this.statusError)this.element.append(el('div','la-command-note',this.statusError));
  }
  private paintSelection(scroll=true){const rows=Array.from(this.element.querySelectorAll<HTMLElement>('[role=option]'));rows.forEach((row,i)=>{row.setAttribute('aria-selected',String(i===this.selected));});const row=rows[this.selected];if(row){this.input.element.setAttribute('aria-activedescendant',row.id);if(scroll)row.scrollIntoView?.({block:'nearest'});}else this.input.element.removeAttribute('aria-activedescendant');}
  private go(scope:Scope){
    this.scope=scope;this.query='';this.selected=0;
    if(this.trigger){this.input.replaceRange(this.trigger.start,this.trigger.end,this.kind()==='function'?'/':'@');const cursor=this.input.cursor();this.trigger=cursor&&menuTrigger(cursor.text,cursor.offset);this.signature=this.trigger?`${this.trigger.kind}:${this.trigger.start}:${this.trigger.end}:${cursor!.text}`:'';}
    this.render();if(!this.plus)this.input.focus();else this.search?.focus();
    if(scope==='status'){this.statusError='';const chat=this.chat();void chat.refreshRateLimits().then(()=>{if(this.visible&&this.scope==='status'&&this.chat()===chat)this.render();}).catch(e=>{if(this.visible&&this.scope==='status'&&this.chat()===chat){this.statusError=(e as Error).message;this.render();}});}
  }
  private async choose(item:Item){
    if(item.disabled||this.saving)return;if(item.next){this.go(item.next);return;}
    this.saving=true;this.render();const trigger=this.trigger,session=this.chat().session.id,cursor=this.input.cursor(),value=this.input.value,restore=this.plus?this.restoreInput:this.input.bookmark?.();
    try{const refs=await item.run?.();if(this.disposed||this.chat().session.id!==session)return;
      if(Array.isArray(refs)&&this.input.value!==value)throw Error('输入内容已变更，请重新插入引用。');
      const now=this.input.cursor();if(trigger&&cursor&&(now?.text===cursor.text||Array.isArray(refs)))this.input.replaceRange(trigger.start,trigger.end,'');else if(Array.isArray(refs))restore?.();
      if(Array.isArray(refs))for(const ref of refs)this.input.insertReference?.(ref);
      this.close();this.trigger=undefined;this.signature='';this.dismissed='';this.input.focus();this.actions.changed?.();
    }catch(e){if(!this.disposed){this.actions.error?.((e as Error).message);const note=el('div','la-command-note',(e as Error).message);note.setAttribute('role','alert');this.element.append(note);}}
    finally{this.saving=false;if(this.visible)this.element.querySelectorAll<HTMLButtonElement>('.la-command-item').forEach((row,i)=>row.disabled=!!this.items[i]?.disabled);}
  }
  position=()=>{
    if(!this.visible||this.disposed)return;const a=this.anchor.getBoundingClientRect(),panel=this.anchor.closest('.la-panel')?.getBoundingClientRect();
    const top=Math.max(8,panel?.top||0);this.element.style.width=a.width+'px';this.element.style.borderRadius=window.getComputedStyle(this.anchor).borderRadius;this.element.style.maxHeight=Math.max(0,a.top-top-8)+'px';this.element.style.left=a.left+'px';this.element.style.top=Math.max(top,a.top-this.element.getBoundingClientRect().height-8)+'px';
  };
  destroy(){this.disposed=true;this.hide();this.observer?.disconnect();document.removeEventListener('pointerdown',this.outside,true);document.removeEventListener('selectionchange',this.selection);window.removeEventListener('resize',this.position);window.removeEventListener('scroll',this.position,true);this.element.remove();this.input.element.removeAttribute('aria-controls');}
}
