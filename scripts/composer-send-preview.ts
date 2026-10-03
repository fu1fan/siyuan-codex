// DOM fixture: production ChatView/nativeComposer, a minimal Protyle shell,
// the installed Lute engine and Savor caret code; no notes or model calls.
import {ChatView} from '../src/ui';
import {nativeComposer} from '../src/native-composer';
const chat:any={busy:false,status:'本地回归夹具',settings:{cwd:'/tmp',model:'fixture'},session:{id:'send-preview',title:'发送回归',messages:[]},requests:new Map()};
let view:ChatView;
view=new ChatView(document.getElementById('app')!,()=>chat,{composer:nativeComposer({} as any),send:async text=>{await new Promise(r=>setTimeout(r,1500));if((document.getElementById('fail') as HTMLInputElement).checked)return false;chat.session.messages.push({id:crypto.randomUUID(),role:'user',text});view.update();return true;},stop:()=>{},settings:()=>{},newChat:()=>{},select:()=>{},list:()=>[],attach:()=>{},clear:()=>{},context:()=>''});
view.input.element.setAttribute('aria-label','原生输入框回归');
const snapshot=()=>{const root=view.input.element,selection=window.getSelection(),node=selection?.anchorNode;return{value:view.input.value,caretInRoot:node===root,caretInParagraph:!!node&&!!(node.nodeType===1?node as Element:node.parentElement)?.closest('[data-type="NodeParagraph"]'),lineHeight:getComputedStyle(root).lineHeight,editorHeight:root.getBoundingClientRect().height,savorCaret:(window as any).savorCaretMeasurement?.()?.rect?.height};};
(window as any).composerRegression={snapshot};
document.getElementById('old')!.onclick=()=>{document.getElementById('fixed-css')!.setAttribute('media','not all');const root=view.input.element;root.innerHTML='<div data-node-id="old" data-type="NodeParagraph" class="p"><div contenteditable="true" class="protyle-wysiwyg--empty" placeholder="随心输入"></div></div>';root.focus();const r=document.createRange();r.selectNodeContents(root);r.collapse(false);const s=window.getSelection()!;s.removeAllRanges();s.addRange(r);};
document.getElementById('fixed')!.onclick=()=>{document.getElementById('fixed-css')!.removeAttribute('media');view.input.focus();view.input.value='';};
document.getElementById('smooth')!.onclick=()=>{(window as any).enableSmoothCaret();view.input.focus();};
