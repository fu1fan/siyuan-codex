import {Protyle,type App} from 'siyuan';
import type {ComposerFactory} from './composer';
import {editorCursor,selectEditorRange} from './composer-cursor';
import {menuTrigger} from './composer-trigger';
import {extractElementMedia,mediaSource} from './composer-media';
// 使用公开的 Protyle lite 模式，与内置 AgentComposer 的编辑器基础一致。
export function nativeComposer(app:App):ComposerFactory{return(host,onSend,onChange)=>{
  host.classList.add('protyle-lite-fragment');
  const editor=new Protyle(app,host,{lite:true,blockId:'',render:{gutter:false,breadcrumb:false,scroll:false,background:false,title:false}});
  const p=editor.protyle,wysiwyg=p.wysiwyg!.element;
  const hint=p.hint?.element;
  if(p.hint){
    p.hint.enableSlash=false;
    const render=p.hint.render.bind(p.hint);
    p.hint.render=protyle=>{const cursor=editorCursor(wysiwyg);if(cursor&&menuTrigger(cursor.text,cursor.offset)){clearTimeout(p.hint!.timeId);hint?.classList.add('fn__none');return;}render(protyle);};
  }
  if(hint){document.body.append(hint);hint.classList.add('la-native-hint');}
  wysiwyg.setAttribute('data-readonly','false');
  const set=(value:string)=>{
    const selection=window.getSelection(),restoreCaret=!!selection?.rangeCount&&wysiwyg.contains(selection.getRangeAt(0).startContainer);
    wysiwyg.innerHTML=p.lute!.Md2BlockDOM(value||'');
    if(!wysiwyg.querySelector('[contenteditable]')){
      const block=document.createElement('div');block.dataset.nodeId=window.Lute?.NewNodeID?.()||`${Date.now()}`;block.dataset.type='NodeParagraph';block.className='p';
      const content=document.createElement('div');content.contentEditable='true';block.append(content);wysiwyg.replaceChildren(block);
    }
    const first=wysiwyg.querySelector<HTMLElement>('[contenteditable]');
    if(first&&!value){first.classList.add('protyle-wysiwyg--empty');first.setAttribute('placeholder','随心输入');}
    editor.clearStack();
    // Replacing the DOM collapses Chromium's selection onto the 60px editor
    // container. Keep it inside the paragraph so native and themed carets use
    // the text line rather than the height of the whole composer.
    if(restoreCaret){const last=Array.from(wysiwyg.querySelectorAll<HTMLElement>('[contenteditable="true"]')).at(-1);if(last){const range=document.createRange();range.selectNodeContents(last);range.collapse(false);selection!.removeAllRanges();selection!.addRange(range);}}
    onChange();
  };
  set('');host.querySelector('.protyle-content')?.classList.remove('fn__none');host.setAttribute('data-loading','finished');host.querySelectorAll('.wysiwygLoading').forEach(e=>e.remove());
  const fixEmptyCaret=()=>{const selection=window.getSelection();if(!wysiwyg.textContent&&selection?.isCollapsed&&selection.rangeCount&&wysiwyg.contains(selection.getRangeAt(0).startContainer))selectEditorRange(wysiwyg,0,0);};
  wysiwyg.addEventListener('mouseup',fixEmptyCaret);
  const observer=new MutationObserver(onChange);observer.observe(wysiwyg,{subtree:true,childList:true,characterData:true});
  wysiwyg.addEventListener('keydown',e=>{
    if(e.isComposing)return;
    if(hint&&!hint.classList.contains('fn__none'))return;
    if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();e.stopImmediatePropagation();onSend();}
  },true);
  let mediaNumber=1,mediaOverflow=false;
  return {element:wysiwyg,validate(){if(mediaOverflow)throw Error('一次最多附加 20 项，请移除部分附件后重试。');if(wysiwyg.querySelector('img:not(.emoji)'))throw new Error('图片正在整理，请稍后发送。');},get value(){return p.lute!.BlockDOM2StdMd(wysiwyg.innerHTML).trim();},set value(v){set(v);},
    references:()=>Array.from(wysiwyg.querySelectorAll<HTMLElement>('[data-type~="block-ref"]')).map(e=>({id:e.dataset.id||'',title:e.textContent||''})),
    focus:()=>{editor.focus();fixEmptyCaret();},destroy:()=>{observer.disconnect();wysiwyg.removeEventListener('mouseup',fixEmptyCaret);editor.destroy();hint?.remove();},
    insertReference:ref=>{const span=document.createElement('span');span.dataset.type='block-ref';span.dataset.id=ref.id;span.dataset.subtype='d';span.textContent=ref.title;editor.insert(span.outerHTML+'\u200b ');onChange();},
    insertContent:content=>{const html=content.html!==undefined?p.lute!.HTML2BlockDOM(content.html):p.lute!.Md2BlockDOM(content.markdown??content.text);if(html)editor.insert(html,true,false);onChange();},
    bookmark(){const selection=window.getSelection(),range=selection?.rangeCount?selection.getRangeAt(0).cloneRange():undefined;return()=>{if(range&&wysiwyg.contains(range.startContainer)&&wysiwyg.contains(range.endContainer)){selection!.removeAllRanges();selection!.addRange(range);return true;}const last=Array.from(wysiwyg.querySelectorAll<HTMLElement>('[contenteditable="true"]')).at(-1);if(last){const end=document.createRange();end.selectNodeContents(last);end.collapse(false);selection?.removeAllRanges();selection?.addRange(end);return true;}return false;};},
    extractMedia:(start=mediaNumber,capacity=20)=>{const probe=wysiwyg.cloneNode(true) as HTMLElement;const count=extractElementMedia(probe,input=>({...input,key:'probe',title:input.title||'',marker:''})).length;mediaOverflow=count>capacity;if(mediaOverflow)return [];mediaNumber=Math.max(start,mediaNumber);return extractElementMedia(wysiwyg,input=>mediaSource(input,mediaNumber++));}
    ,cursor:()=>editorCursor(wysiwyg),replaceRange(start,end,text){selectEditorRange(wysiwyg,start,end);const span=document.createElement('span');span.textContent=text;editor.insert(span.innerHTML||'\u200b',false,false);onChange();}
  };
};}
