import {el,button} from './dom';
import {effortLabel} from './model-options';
import {permissionModes,permissionIcon,type PermissionMode} from './permissions';
export type ModelInfo={model:string;displayName?:string;defaultReasoningEffort?:string;supportedReasoningEfforts?:{reasoningEffort:string}[]};
export class ComposerPopover {
  readonly element=el('div','la-popover');closed=false;
  private observer?:ResizeObserver;
  constructor(readonly anchor:HTMLElement,label:string,private onClose:()=>void=()=>{}){
    this.element.setAttribute('role','dialog');this.element.setAttribute('aria-label',label);
    this.element.addEventListener('click',e=>e.stopPropagation());
    this.element.addEventListener('keydown',this.keydown);document.body.append(this.element);
    anchor.setAttribute('aria-expanded','true');document.addEventListener('pointerdown',this.outside,true);window.addEventListener('resize',this.position);
    if(typeof ResizeObserver!=='undefined'){this.observer=new ResizeObserver(this.position);this.observer.observe(this.element);this.observer.observe(anchor);}
    this.position();
  }
  private outside=(e:Event)=>{if(!this.element.contains(e.target as Node)&&!this.anchor.contains(e.target as Node))this.close(false);};
  private keydown=(e:KeyboardEvent)=>{
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();this.close();return;}
    if((e.target as HTMLElement).tagName==='INPUT'&&e.key!=='Tab')return;
    const items=Array.from(this.element.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),summary,a[href]')).filter(item=>{
      if(item.closest('[hidden]'))return false;
      for(let parent=item.parentElement;parent&&parent!==this.element;parent=parent.parentElement)if(parent.tagName==='DETAILS'&&!parent.hasAttribute('open')&&!(item.tagName==='SUMMARY'&&item.parentElement===parent))return false;
      return true;
    });const index=items.indexOf(document.activeElement as HTMLElement);
    let next:number|undefined;
    if(e.key==='ArrowDown')next=(index+1)%items.length;if(e.key==='ArrowUp')next=(index-1+items.length)%items.length;
    if(e.key==='Tab')next=(index+(e.shiftKey?-1:1)+items.length)%items.length;
    if(next!==undefined&&items.length){e.preventDefault();items[next].focus();}
  };
  position=()=>{if(this.closed)return;const a=(this.anchor.closest('.la-model-group')||this.anchor).getBoundingClientRect();const gap=8,w=window.innerWidth,h=window.innerHeight;const below=!!this.anchor.closest('.la-head');const panel=this.anchor.closest('.la-panel')?.getBoundingClientRect();if(below&&panel&&this.element.classList.contains('la-workspace-popover'))this.element.style.width=Math.min(320,panel.width-gap*2)+'px';this.element.style.maxHeight=Math.max(100,below?h-a.bottom-gap*2:h-16)+'px';const r=this.element.getBoundingClientRect();const left=this.anchor.closest('.la-model-group')?a.right-r.width:panel?Math.max(panel.left+gap,a.right-r.width):a.right-r.width;this.element.style.left=Math.max(gap,Math.min(left,w-r.width-gap))+'px';this.element.style.top=Math.max(gap,Math.min(below?a.bottom+gap:a.top-r.height-gap,h-r.height-gap))+'px';};
  replace(...nodes:Node[]){if(this.closed)return;this.element.replaceChildren(...nodes);this.position();}
  focus(){this.element.querySelector<HTMLElement>('button:not(:disabled),input:not(:disabled)')?.focus();}
  close(restoreFocus=true){if(this.closed)return;this.closed=true;this.observer?.disconnect();document.removeEventListener('pointerdown',this.outside,true);window.removeEventListener('resize',this.position);this.element.remove();this.anchor.setAttribute('aria-expanded','false');this.onClose();if(restoreFocus&&this.anchor.isConnected)this.anchor.focus();}
}
export function permissionPanel(pop:ComposerPopover,selected:PermissionMode|''|undefined,choose:(mode:PermissionMode)=>Promise<void>){
  const title=el('div','la-popover-title','如何批准 Agent 操作？');const rows=permissionModes.map(mode=>{
    const row=button('',()=>{void save(row,()=>choose(mode.value),()=>pop.close());},'la-choice'+(mode.value==='full'?' la-danger':''));row.setAttribute('role','menuitemradio');row.setAttribute('aria-checked',String(mode.value===(selected||'ask')));
    const icon=el('span','la-choice-icon');icon.innerHTML=permissionIcon(mode.value);const text=el('span','la-choice-copy');text.append(el('span','',mode.label),el('small','',mode.description));row.append(icon,text,el('span','la-choice-check',mode.value===(selected||'ask')?'✓':''));return row;
  });const menu=el('div');menu.setAttribute('role','menu');menu.append(...rows);pop.replace(title,menu);pop.focus();
}
async function save(row:HTMLButtonElement,action:()=>Promise<void>,done:()=>void){
  const pop=row.closest('.la-popover'),items=Array.from(pop?.querySelectorAll<HTMLButtonElement>('.la-choice')||[row]);
  if(items.some(item=>item.disabled))return;
  pop?.querySelector('.la-save-error')?.remove();items.forEach(item=>item.disabled=true);
  try{await action();done();}catch(e){const error=el('p','la-popover-note la-save-error','切换失败：'+(e as Error).message);error.setAttribute('role','alert');pop?.append(error);}finally{items.forEach(item=>item.disabled=false);}
}
export function modelPanel(pop:ComposerPopover,models:ModelInfo[],selected:string,choose:(model:ModelInfo)=>Promise<void>){
  const list=el('div','la-model-list');list.setAttribute('role','menu');
  for(const model of models){const row=button('',()=>{void save(row,()=>choose(model),()=>{});},'la-choice'+(selected===model.model?' la-choice-selected':''));row.setAttribute('role','menuitemradio');row.setAttribute('aria-checked',String(selected===model.model));row.append(el('span','la-choice-copy',model.displayName||model.model),el('span','la-choice-check',selected===model.model?'✓':''));list.append(row);}
  if(!models.length)list.append(el('p','la-popover-note','CLI 未返回可选模型。'));
  pop.replace(el('div','la-popover-title','选择模型'),el('div','la-popover-section','可用模型'),list);pop.focus();
}
export function effortPanel(pop:ComposerPopover,model:ModelInfo,current:string,choose:(effort:string)=>Promise<void>,back:()=>void,fast?:{enabled:boolean;set:(enabled:boolean)=>Promise<void>;reset:()=>Promise<void>}){
  const efforts=model.supportedReasoningEfforts?.map(e=>e.reasoningEffort)||[];
  const title=el('div','la-effort-heading');const label=el('strong','',effortLabel(current||model.defaultReasoningEffort||''));
  let fastEnabled=fast?.enabled||false;
  const reset=button('',()=>{void resetDefaults();},'la-popover-reset');reset.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8a8 8 0 1 1-1 7M4 3v5h5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';reset.setAttribute('aria-label','恢复默认');reset.title='恢复模型默认强度并关闭快速模式';
  const lightning=button('',()=>{void toggleFast();},'la-popover-fast');lightning.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13 2-9 12h7l-1 8 10-13h-7l1-7Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';lightning.setAttribute('aria-label','快速模式');lightning.title='快速模式（用量消耗更高）';lightning.disabled=!fast;
  const paintFast=()=>{lightning.setAttribute('aria-pressed',String(fastEnabled));};paintFast();
  const modelButton=button('',back,'la-effort-model');modelButton.setAttribute('aria-label','选择模型');modelButton.append(label,el('span','',(model.displayName||model.model)+' ›'));
  title.append(lightning,modelButton,reset);
  const slider=el('input','b3-slider la-effort-slider');slider.type='range';slider.min='0';slider.max=String(Math.max(0,efforts.length-1));slider.step='1';slider.setAttribute('aria-label','思考强度');slider.disabled=efforts.length<2;slider.value=String(Math.max(0,efforts.indexOf(current||model.defaultReasoningEffort||'')));
  const track=el('div','la-effort-track');track.append(slider);
  const paint=()=>{const value=efforts[Number(slider.value)]||'';label.textContent=effortLabel(value);slider.setAttribute('aria-valuetext',effortLabel(value));};paint();
  const status=el('div','la-popover-note la-effort-status');status.setAttribute('role','status');
  async function toggleFast(){if(!fast)return;lightning.disabled=true;reset.disabled=true;slider.disabled=true;try{await fast.set(!fastEnabled);fastEnabled=!fastEnabled;paintFast();status.textContent=fastEnabled?'快速模式已开启':'快速模式已关闭';}catch(e){status.classList.add('la-effort-error');status.textContent=(e as Error).message;}finally{lightning.disabled=false;reset.disabled=false;slider.disabled=efforts.length<2;}}
  async function resetDefaults(){if(!fast){await commit(model.defaultReasoningEffort||'');return;}lightning.disabled=true;reset.disabled=true;slider.disabled=true;try{await fast.reset();fastEnabled=false;paintFast();slider.value=String(Math.max(0,efforts.indexOf(model.defaultReasoningEffort||'')));paint();status.textContent='已恢复默认';}catch(e){status.classList.add('la-effort-error');status.textContent=(e as Error).message;}finally{lightning.disabled=false;reset.disabled=false;slider.disabled=efforts.length<2;}}
  async function commit(value:string){slider.disabled=true;reset.disabled=true;lightning.disabled=true;status.textContent='保存中…';try{await choose(value);slider.value=String(Math.max(0,efforts.indexOf(value)));paint();status.textContent='已保存';}catch(e){status.classList.add('la-effort-error');status.textContent=(e as Error).message;}finally{slider.disabled=efforts.length<2;reset.disabled=false;lightning.disabled=!fast;}}
  slider.oninput=paint;slider.onchange=()=>{void commit(efforts[Number(slider.value)]);};
  
  pop.replace(title,...(efforts.length?[track,status]:[el('p','la-popover-note','此模型未提供可调节的思考强度。'),status]));pop.focus();
}
