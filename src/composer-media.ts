import DOMPurify from 'dompurify';
import {marked} from 'marked';
export type MediaSource={key:string;kind:'image'|'file';title:string;marker:string;file?:File;url?:string};
export type MediaContent={sources:MediaSource[];html?:string;markdown?:string;text:string};
const imageName=/\.(png|jpe?g|webp|gif|bmp|svg|avif)(?:[?#]|$)/i;
export function mediaSource(input:{file?:File;url?:string;title?:string;kind?:'image'|'file'},number:number):MediaSource{
  const title=input.title||input.file?.name||sourceName(input.url||'')||(input.kind==='file'?'附件':'图片');
  const kind=input.kind||(input.file?.type.startsWith('image/')||imageName.test(title)?'image':'file');
  return {...input,title,kind,key:crypto.randomUUID(),marker:`［${kind==='image'?'图片':'附件'} ${number}：${title}］`};
}
function sourceName(url:string){try{const u=new URL(url,location.href);if(['data:','blob:'].includes(u.protocol))return '';return decodeURIComponent(u.pathname.split('/').at(-1)||'');}catch{return '';}}
export function assetURL(url:string){try{const u=new URL(url,location.origin+'/');return u.origin===location.origin&&/^\/assets\//.test(u.pathname);}catch{return false;}}
// Mutate only the pasted fragment (or the composer's own media nodes), never a source note.
export function extractElementMedia(root:HTMLElement,create:(input:{url:string;title?:string;kind:'image'|'file'})=>MediaSource){
  const sources:MediaSource[]=[];const seen=new Map<string,MediaSource>();
  for(const node of Array.from(root.querySelectorAll<HTMLElement>('img:not(.emoji),audio,video,iframe[src],embed[src],a[href],[data-type~="a"][data-href]'))){
    if(!root.contains(node))continue;
    const url=node.getAttribute('src')||node.getAttribute('href')||node.dataset.href||node.querySelector('source')?.getAttribute('src')||'';
    const link=node.matches('a,[data-type~="a"]');if(link&&!assetURL(url))continue;
    const kind=node.tagName==='IMG'?'image':imageName.test(url)?'image':'file';
    if(!url)continue;
    let source=seen.get(url);if(!source){source=create({url,kind,title:node.getAttribute('alt')||node.getAttribute('title')||(link?node.textContent?.trim():undefined)||undefined});seen.set(url,source);sources.push(source);}
    const wrapper=node.closest('[data-type="img"]');
    (wrapper&&root.contains(wrapper)?wrapper:node).replaceWith(document.createTextNode(source.marker));
  }
  return sources;
}
function plainText(root:HTMLElement){const copy=root.cloneNode(true) as HTMLElement;copy.querySelectorAll('br').forEach(n=>n.replaceWith('\n'));copy.querySelectorAll('p,div,li,h1,h2,h3,h4,blockquote,tr').forEach(n=>n.append('\n'));return copy.textContent?.replace(/\n{3,}/g,'\n\n').trim()||'';}
export function mediaTransfer(data:Pick<DataTransfer,'getData'|'files'>,start=1):MediaContent|undefined{
  const files=Array.from(data.files||[]),used=new Set<File>();let number=start;
  const rawHTML=data.getData('text/html'),rawText=data.getData('text/plain');
  const uri=(data.getData('text/uri-list')||rawText).trim();
  if(!rawHTML&&!files.length&&assetURL(uri))return {sources:[mediaSource({url:uri},number)],text:''};
  const root=document.createElement('div');
  // Parse Markdown only when it actually carries media. Ordinary block-ref pastes stay native.
  const markdown=!rawHTML&&/!\[[^\]]*\]\(|\[[^\]]*\]\(\/?assets\//.test(rawText);
  root.innerHTML=rawHTML||(markdown?marked.parse(rawText,{async:false}):'');
  const textOnly=root.cloneNode(true) as HTMLElement;textOnly.querySelectorAll('[data-type="img"],img,a[href],audio,video,iframe,embed,[data-type~="a"][data-href]').forEach(node=>{if(!node.matches('a,[data-type~="a"]')||assetURL(node.getAttribute('href')||(node as HTMLElement).dataset.href||''))node.remove();});
  const hadText=!!textOnly.textContent?.trim();
  const sources=extractElementMedia(root,input=>{
    const file=files.find(f=>!used.has(f)&&(f.name===sourceName(input.url)||(input.kind==='image'&&f.type.startsWith('image/')&&files.filter(v=>v.type.startsWith('image/')).length===1)));
    if(file)used.add(file);return mediaSource({...input,file},number++);
  });
  for(const file of files){if(!used.has(file))sources.push(mediaSource({file},number++));}
  if(!sources.length)return;
  const html=hadText?DOMPurify(window).sanitize(root.innerHTML,{FORBID_TAGS:['style','iframe','embed','object','audio','video','img'],FORBID_ATTR:['style','srcset']}):'';
  root.innerHTML=html;
  return {sources,html:rawHTML||markdown?html:undefined,text:rawHTML||markdown?plainText(root):rawText};
}
