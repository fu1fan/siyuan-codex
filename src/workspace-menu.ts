import {el,button} from './ui';
import type {ComposerPopover} from './popover';
import type {WorkspaceBinding,WorkspaceDocument} from './workspaces';

export type WorkspaceMenuState={cwd:string;standalone?:boolean;locked:boolean;automatic:boolean;document?:WorkspaceDocument;binding?:WorkspaceBinding;inherited?:WorkspaceBinding;recent:string[];error?:string};
export type WorkspaceMenuActions={choose:(cwd:string)=>Promise<void>;follow:()=>Promise<void>;bind:(doc:WorkspaceDocument,cwd:string)=>Promise<void>;unbind:(doc:WorkspaceDocument)=>Promise<void>;browse:(cwd?:string)=>Promise<string|undefined>};

const directoryName=(cwd:string)=>cwd.split(/[\\/]/).filter(Boolean).at(-1)||cwd;
const standalone=(state:WorkspaceMenuState)=>state.standalone??(/[\\/]\.siyuan-local-agent[\\/]workspaces[\\/][a-zA-Z0-9-]+[\\/]?$/.test(state.cwd));
function directoryCard(cwd:string,label=directoryName(cwd)){
  const card=el('details','la-workspace-directory');
  const summary=el('summary');summary.title=cwd;
  const icon=el('span','la-workspace-icon');icon.setAttribute('aria-hidden','true');icon.innerHTML='<svg><use href="#iconFolder"></use></svg>';
  const copy=el('span','la-workspace-directory-copy');copy.append(el('strong','',label),el('span','la-workspace-path',cwd));
  summary.append(icon,copy);card.append(summary,el('div','la-workspace-full-path',cwd));
  return card;
}

export function workspacePanel(pop:ComposerPopover,state:WorkspaceMenuState,actions:WorkspaceMenuActions){
  pop.element.classList.add('la-workspace-popover');
  const heading=el('div','la-workspace-heading');
  heading.append(el('strong','','工作目录'),el('span','la-workspace-badge',state.locked?'会话已固定':state.automatic?'自动跟随':'手动选择'));
  const error=el('p','la-workspace-error',state.error||'');error.setAttribute('role','alert');error.hidden=!state.error;
  const status=el('div','la-workspace-status');status.setAttribute('role','status');
  const controls:{button:HTMLButtonElement;unavailable:()=>boolean}[]=[];
  const inputs:HTMLInputElement[]=[];
  let saving=false;let focusAfter:HTMLInputElement|undefined;
  const sync=()=>{controls.forEach(c=>c.button.disabled=saving||c.unavailable());inputs.forEach(input=>input.disabled=saving);pop.element.setAttribute('aria-busy',String(saving));};
  const run=async(action:()=>Promise<void>,close=false)=>{
    if(saving||pop.closed)return;
    saving=true;error.hidden=true;status.textContent='处理中…';sync();
    try{await action();if(close)pop.close();}
    catch(e){if(!pop.closed){error.textContent=(e as Error).message;error.hidden=false;}}
    finally{saving=false;status.textContent='';sync();if(!pop.closed){pop.position();focusAfter?.focus();}focusAfter=undefined;}
  };
  const action=(label:string,fn:()=>Promise<void>,unavailable=()=>false,close=false,cls='b3-button b3-button--cancel')=>{
    const b=button(label,()=>{void run(fn,close);},cls);controls.push({button:b,unavailable});return b;
  };
  const pathField=(label:string,value:string)=>{
    const row=el('div','la-workspace-path-field');
    const input=el('input','b3-text-field');input.value=value;input.placeholder='粘贴绝对路径，或浏览文件夹';input.setAttribute('aria-label',label);input.spellcheck=false;inputs.push(input);
    const browse=action('浏览…',async()=>{const cwd=await actions.browse(input.value);if(cwd&&!pop.closed){input.value=cwd;error.hidden=true;focusAfter=input;input.setSelectionRange(0,0);}});
    browse.setAttribute('aria-label',`浏览${label==='工作目录路径'?'会话工作目录':'文档绑定目录'}`);
    row.append(input,browse);input.oninput=()=>{error.hidden=true;sync();};return {row,input};
  };
  const session=el('section','la-workspace-session');session.setAttribute('aria-label','本次会话目录');
  const legacy=/[\\/]\.siyuan-local-agent[\\/]workspaces[\\/]/.test(state.cwd);
  session.append(directoryCard(state.cwd,standalone(state)?legacy?'独立会话目录（旧）':'Codex 无项目会话目录':undefined));
  if(state.locked){
    session.append(el('p','la-workspace-note','首次发送后目录固定；新对话可使用文档绑定。'));
  }else{
    const follow=action('跟随文档绑定',actions.follow,()=>false,true,'la-workspace-follow');follow.setAttribute('aria-pressed',String(state.automatic));
    follow.prepend(el('span','la-workspace-check',state.automatic?'✓':'○'));
    session.append(follow,el('p','la-workspace-note',state.automatic?'未绑定文档时，使用 Codex 无项目任务文件夹中的独立目录。':'手动目录仅用于本会话。'));
    const {row,input}=pathField('工作目录路径',state.cwd);
    const choose=action('使用此目录',()=>actions.choose(input.value),()=>!input.value.trim()||(!state.automatic&&input.value.trim()===state.cwd),true,'b3-button');
    const apply=el('div','la-workspace-actions');apply.append(choose);session.append(row,apply);
    input.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();if(!choose.disabled)choose.click();}};
    const recentPaths=[...new Set(state.recent)].filter(cwd=>cwd!==state.cwd).slice(0,5);
    if(recentPaths.length){
      const recent=el('details','la-workspace-recent');recent.append(el('summary','',`最近使用 · ${recentPaths.length}`));
      for(const cwd of recentPaths){const b=action('',()=>actions.choose(cwd),()=>false,true,'la-workspace-recent-item');b.title=cwd;b.append(el('strong','',directoryName(cwd)),el('span','la-workspace-path',cwd));recent.append(b);}
      session.append(recent);
    }
  }
  const binding=el('section','la-workspace-binding');binding.setAttribute('aria-label','文档目录绑定');
  binding.append(el('div','la-workspace-section-title','文档绑定'));
  const doc=state.document;
  if(!doc){binding.append(el('p','la-workspace-note','打开一篇文档，即可绑定它和子文档的工作目录。'));}
  else{
    const docRow=el('div','la-workspace-document');const title=el('strong','',doc.title);title.title=doc.title;
    docRow.append(title,el('span','la-workspace-badge',state.binding?'已绑定':state.inherited?'继承绑定':'未绑定'));binding.append(docRow);
    if(state.binding)binding.append(directoryCard(state.binding.cwd));
    else if(state.inherited){const source=el('p','la-workspace-note la-workspace-source',`来自「${state.inherited.title}」`);source.title=source.textContent||'';binding.append(source,directoryCard(state.inherited.cwd));}
    binding.append(el('p','la-workspace-note','适用于当前文档及子文档，子文档自己的绑定优先。'));
    const editor=el('div','la-workspace-binding-editor');editor.hidden=true;
    const initial=state.binding?.cwd||state.inherited?.cwd||(!standalone(state)?state.cwd:'');
    const {row,input}=pathField('文档绑定目录路径',initial);
    const save=action(state.binding?'保存绑定':'绑定当前文档',()=>actions.bind(doc,input.value),()=>!input.value.trim()||input.value.trim()===state.binding?.cwd,true,'b3-button');
    const edit=button(state.binding?'更改…':state.inherited?'单独绑定…':'绑定目录…',()=>{editor.hidden=false;editRow.hidden=true;error.hidden=true;sync();pop.position();input.focus();input.select();},'b3-button b3-button--outline');
    controls.push({button:edit,unavailable:()=>false});
    const cancel=button('取消',()=>{input.value=initial;editor.hidden=true;editRow.hidden=false;error.hidden=true;sync();pop.position();edit.focus();},'b3-button b3-button--cancel');controls.push({button:cancel,unavailable:()=>false});
    const apply=el('div','la-workspace-actions');apply.append(cancel,save);
    const effect=state.locked?'保存后供新对话使用，本会话目录保持固定。':state.automatic?'保存后，本会话会自动使用此目录。':'保存后，自动跟随文档的新对话会使用此目录。';
    editor.append(el('div','la-workspace-field-label','文档绑定目录'),row,el('p','la-workspace-note',effect),apply);
    input.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();if(!save.disabled)save.click();}};
    const editRow=el('div','la-workspace-actions la-workspace-binding-actions');editRow.append(edit);
    if(state.binding){const unbind=action('解除绑定',()=>actions.unbind(doc),()=>false,true);unbind.title=state.inherited?`解除后继承「${state.inherited.title}」的目录`:'解除当前文档的目录绑定';editRow.prepend(unbind);}
    binding.append(editRow,editor);
  }
  pop.replace(heading,session,binding,error,status);sync();pop.position();
  // Keep the directory readable on open; select the path only when editing is requested.
  if(state.locked)(binding.querySelector<HTMLElement>('.la-workspace-binding-actions button:last-child')||session.querySelector<HTMLElement>('summary'))?.focus();else pop.focus();
}
