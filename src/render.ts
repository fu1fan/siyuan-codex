import {Marked,type TokenizerExtension,type Tokens} from 'marked';
import createDOMPurify from 'dompurify';
const purifiers=new WeakMap<Window,ReturnType<typeof createDOMPurify>>();
function purify(){let value=purifiers.get(window);if(!value){value=createDOMPurify(window as any);purifiers.set(window,value);}return value;}

const escapeHTML=(text:string)=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function codeBlock(text:string,language:string){
 // SiYuan's typography renderer reads the language from the code block parent.
 // The hljs class also excludes block code from the host's inline-code styles.
 return `<pre${text.length<=50000?' class="code-block"':''} data-language="${escapeHTML(language||'plaintext')}"><code class="hljs">${escapeHTML(text)}</code></pre>`;
}
type HighlightRenderer=(element:Element)=>void;
let highlightRenderer:HighlightRenderer|undefined;
export function setMarkdownHighlighter(renderer?:HighlightRenderer){highlightRenderer=renderer;}
const highlighted=new WeakSet<HTMLElement>();
type RichToken=Tokens.Generic&{text:string;display?:boolean};
type Slot={kind:'math'|'mermaid';source:string;display?:boolean};
const libraries=new WeakMap<Window,Map<string,Promise<any>>>();
let diagramID=0;
function library(name:'katex'|'mermaid'):Promise<any>{
 const win=window as any;if(win[name])return Promise.resolve(win[name]);
 let cache=libraries.get(window);if(!cache){cache=new Map();libraries.set(window,cache);}
 if(cache.has(name))return cache.get(name)!;
 const path=name==='katex'?'katex/katex.min.js':'mermaid/mermaid.min.js';
 const task=new Promise((resolve,reject)=>{
  const script=document.createElement('script');script.src=new URL('/stage/protyle/js/'+path,document.baseURI).href;
  const timeout=setTimeout(()=>{script.remove();reject(new Error('渲染资源加载超时'));},15000);
  script.onload=()=>{clearTimeout(timeout);if(win[name])resolve(win[name]);else reject(new Error('渲染资源不可用'));};
  script.onerror=()=>{clearTimeout(timeout);script.remove();reject(new Error('无法加载本机渲染资源'));};document.head.append(script);
 });
 cache.set(name,task);void task.catch(()=>cache!.delete(name));return task;
}
function mathStyle(){
 if(document.querySelector('link[data-la-katex]'))return;
 const link=document.createElement('link');link.rel='stylesheet';link.dataset.laKatex='true';link.href=new URL('/stage/protyle/js/katex/katex.min.css',document.baseURI).href;document.head.append(link);
}
function visible(node:HTMLElement){
 for(let parent=node.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS'&&!(parent as HTMLDetailsElement).open)return false;
 return node.isConnected;
}
const pending=new WeakMap<HTMLElement,{slot:Slot;running:boolean}>();
const diagramCache=new Map<string,Promise<string>>();
let diagramQueue:Promise<unknown>=Promise.resolve();
async function diagram(source:string):Promise<string>{
 const dark=window.siyuan?.config?.appearance?.mode===1||document.documentElement.dataset.themeMode==='dark';
 const key=(dark?'dark:':'light:')+source;const cached=diagramCache.get(key);if(cached)return cached;
 const task=diagramQueue.catch(()=>{}).then(async()=>{
  const mermaid=await library('mermaid');
  mermaid.initialize({startOnLoad:false,securityLevel:'strict',htmlLabels:false,theme:dark?'dark':'default',suppressErrorRendering:true,flowchart:{htmlLabels:false},maxTextSize:100000,secure:['securityLevel','htmlLabels','flowchart','startOnLoad','maxTextSize','themeCSS']});
  const {svg}=await mermaid.render('la-diagram-'+(++diagramID),source);
  const safe=purify().sanitize(svg,{USE_PROFILES:{svg:true,svgFilters:true},FORBID_TAGS:['foreignObject','script','image','a'],FORBID_ATTR:['onload','onclick']});
  const template=document.createElement('template');template.innerHTML=safe;
  const cleanCSS=(value:string)=>value.replace(/@import[^;]*;?/gi,'').replace(/url\(([^)]*)\)/gi,(whole,ref:string)=>ref.trim().replace(/^["']|["']$/g,'').startsWith('#')?whole:'none');
  template.content.querySelectorAll('style').forEach(style=>{style.textContent=cleanCSS(style.textContent||'');});
  template.content.querySelectorAll('[style]').forEach(element=>element.setAttribute('style',cleanCSS(element.getAttribute('style')||'')));
  return template.innerHTML;
 });
 diagramQueue=task;diagramCache.set(key,task);if(diagramCache.size>80)diagramCache.delete(diagramCache.keys().next().value!);
 void task.catch(()=>diagramCache.delete(key));return task;
}
/** Markdown is parsed once, then trusted local renderers fill isolated math/diagram slots. */
export function renderMarkdown(target:HTMLElement,source:string,streaming=false){
 target.classList.add('b3-typography');
 const slots:Slot[]=[];const nonce=crypto.randomUUID();
 const placeholder=(slot:Slot)=>{const index=slots.push(slot)-1;return `<${slot.display?'div':'span'} class="la-rich-slot" data-la-slot="${nonce}-${index}">${escapeHTML(slot.source)}</${slot.display?'div':'span'}>`;};
 const blockMath:TokenizerExtension={name:'laBlockMath',level:'block',start:src=>src.search(/(?:^|\n) {0,3}(?:\$\$|\\\[)/),tokenizer(src){
  const match=/^ {0,3}(?:\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\])[ \t]*(?:\n|$)/.exec(src);
  if(!match)return;
  return {type:'laBlockMath',raw:match[0],text:(match[1]??match[2]).trim(),display:true};
 }};
 const inlineMath:TokenizerExtension={name:'laInlineMath',level:'inline',start:src=>src.search(/\\\(|\\\[|\$(?=[^\s$])/),tokenizer(src){
  let match=/^\\\(([\s\S]*?)\\\)/.exec(src);if(match)return {type:'laInlineMath',raw:match[0],text:match[1],display:false};
  match=/^\\\[([\s\S]*?)\\\]/.exec(src);if(match)return {type:'laInlineMath',raw:match[0],text:match[1],display:true};
  match=/^\$\$([\s\S]*?)\$\$/.exec(src);if(match)return {type:'laInlineMath',raw:match[0],text:match[1],display:true};
  // A closing dollar followed by a digit is usually the next currency amount.
  match=/^\$(?![\s$])([^\n]*?[^\s\\])\$(?!\d)/.exec(src);if(match)return {type:'laInlineMath',raw:match[0],text:match[1],display:false};
 }};
 const cjkStrong:TokenizerExtension={name:'laCjkStrong',level:'inline',start:src=>src.indexOf('**'),tokenizer(src){
  const match=/^\*\*(?!\*)(\S(?:[^\n]*?\S)?)\*\*(?!\*)/.exec(src);
  if(match&&/[\u3400-\u9fff]/.test(match[1]))return {type:'laCjkStrong',raw:match[0],tokens:this.lexer.inlineTokens(match[1])};
 }};
 const parser=new Marked({gfm:true,breaks:false,extensions:[
  {...blockMath,renderer:t=>placeholder({kind:'math',source:(t as RichToken).text,display:true})},
  {...inlineMath,renderer:t=>placeholder({kind:'math',source:(t as RichToken).text,display:(t as RichToken).display})},
  {...cjkStrong,renderer:function(t){return '<strong>'+this.parser.parseInline(t.tokens!)+'</strong>';}}
 ],renderer:{code(token){
  const language=token.lang?.trim().split(/\s/)[0].toLowerCase()||'';
  const fence=/^ {0,3}(`{3,}|~{3,})/.exec(token.raw);
  const closing=token.raw.trimEnd().split('\n').at(-1)?.trim()||'';
  if(streaming&&fence&&!(closing.length>=fence[1].length&&Array.from(closing).every(c=>c===fence[1][0])))return codeBlock(token.text,language);
  if(language.toLowerCase()==='mermaid')return placeholder({kind:'mermaid',source:token.text,display:true});
  if(['math','latex','tex'].includes(language.toLowerCase()))return placeholder({kind:'math',source:token.text,display:true});
  return codeBlock(token.text,language);
 }}});
 target.innerHTML=purify().sanitize(parser.parse(source,{async:false}) as string,{FORBID_TAGS:['img','svg','math','style','input','form','iframe','script'],FORBID_ATTR:['style']});
 target.querySelectorAll<HTMLAnchorElement>('a').forEach(a=>{a.rel='noopener noreferrer';a.target='_blank';});
 for(const [index,slot] of slots.entries()){
  const node=target.querySelector<HTMLElement>(`[data-la-slot="${nonce}-${index}"]`);if(!node)continue;node.removeAttribute('data-la-slot');
  node.className=slot.kind==='mermaid'?'la-mermaid':'la-math'+(slot.display?' la-math-display':'');
  if(slot.kind==='mermaid'){
   const output=document.createElement('div');output.className='la-mermaid-output';output.textContent='正在绘制图表…';
   const details=document.createElement('details');details.className='la-render-source';const summary=document.createElement('summary');summary.textContent='Mermaid 源码';
   const pre=document.createElement('pre');const code=document.createElement('code');code.textContent=slot.source;pre.append(code);details.append(summary,pre);node.replaceChildren(output,details);
  }
  pending.set(node,{slot,running:false});
 }
 for(const pre of target.querySelectorAll<HTMLElement>('pre')){
  const original=pre.querySelector('code')?.textContent||'';
  const copy=document.createElement('button');copy.type='button';copy.className='b3-button b3-button--cancel la-code-copy';copy.textContent='复制';copy.setAttribute('aria-label','复制代码');
  // The host renderer appends a newline; copying must preserve the original source.
  copy.onclick=()=>{void navigator.clipboard.writeText(original).then(()=>{copy.textContent='已复制';}).catch(()=>{copy.textContent='复制失败';});};pre.append(copy);
 }
}
export async function enhanceMarkdown(target:HTMLElement){
 if(highlightRenderer){
  const bodies=[...(target.matches('.b3-typography')?[target]:[]),...target.querySelectorAll<HTMLElement>('.b3-typography')];
  for(const body of bodies){
   if(!visible(body))continue;
   const codes=Array.from(body.querySelectorAll<HTMLElement>('.code-block code')).filter(code=>!highlighted.has(code));
   if(!codes.length)continue;
   try{highlightRenderer(body);codes.forEach(code=>highlighted.add(code));}catch{/* Keep source readable; allow a later enhancement to retry. */}
  }
 }
 const tasks=Array.from(target.querySelectorAll<HTMLElement>('.la-math,.la-mermaid')).map(async node=>{
  const state=pending.get(node);if(!state||state.running||!visible(node))return;state.running=true;
  try{
   if(state.slot.kind==='math'){
    mathStyle();const katex=await library('katex');if(!node.isConnected)return;
    katex.render(state.slot.source,node,{displayMode:!!state.slot.display,throwOnError:true,trust:false,strict:'ignore',maxExpand:1000,maxSize:20,output:'htmlAndMathml'});
   }else{
    const svg=await diagram(state.slot.source);if(!node.isConnected)return;
    const original=/\bid="(la-diagram-\d+)"/.exec(svg)?.[1];
    const output=node.querySelector('.la-mermaid-output')!;output.innerHTML=original?svg.replaceAll(original,'la-diagram-view-'+(++diagramID)):svg;
    const graphic=output.querySelector('svg');const width=graphic?.viewBox?.baseVal.width;
    if(graphic&&width)graphic.style.minWidth=Math.min(width,600)+'px';
   }
   pending.delete(node);
  }catch(error){
   if(!node.isConnected)return;node.classList.add('la-render-error');
   if(state.slot.kind==='math'){node.textContent=state.slot.source;node.title='公式渲染失败：'+(error as Error).message;}
   else {node.querySelector('.la-mermaid-output')!.textContent='图表暂未渲染：'+(error as Error).message;node.querySelector('details')!.open=true;}
   pending.delete(node);
  }
 });
 await Promise.allSettled(tasks);
}
