import {realpath,stat,mkdir,writeFile,copyFile} from 'node:fs/promises';
import {join,relative,isAbsolute,extname} from 'node:path';
import type {Attachment} from './context';
import type {MediaSource} from './composer-media';
const MAX_SIZE=20*1024*1024;
export async function assetPath(url:string,workspace:string,origin:string){
  const u=new URL(url,origin);
  if(u.origin!==origin||!u.pathname.startsWith('/assets/'))throw Error('附件不在当前思源资源目录。');
  const root=await realpath(join(workspace,'data','assets')),path=await realpath(join(root,decodeURIComponent(u.pathname.slice('/assets/'.length))));
  const rel=relative(root,path);if(rel.startsWith('..')||isAbsolute(rel)||!(await stat(path)).isFile())throw Error('无效的附件路径。');
  return path;
}
export async function importMedia(source:MediaSource,workspace:string,origin:string):Promise<Attachment>{
  if(!isAbsolute(workspace))throw Error('无法确定当前思源工作区，请重新打开插件后重试。');
  if(!/^[a-z0-9-]+$/i.test(source.key))throw Error('无效的附件标识。');
  const storage=join(workspace,'data','storage','petal','siyuan-codex','attachments');
  let url=source.url,size=source.file?.size,path:string;
  if(source.file||!url||new URL(url,origin).origin!==origin||!new URL(url,origin).pathname.startsWith('/assets/')){
    let blob:Blob;
    if(source.file)blob=source.file;
    else{
      if(!url||!['http:','https:','data:','blob:'].includes(new URL(url,origin).protocol))throw Error('无法读取此附件，请拖入本机文件后重试。');
      const response=await fetch(new URL(url,origin).href,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error(`下载附件失败 (${response.status})`);
      const length=Number(response.headers.get('Content-Length'));if(length>MAX_SIZE)throw Error('单个附件不能超过 20 MB。');
      blob=await response.blob();
    }
    size=blob.size;if(!size||size>MAX_SIZE)throw Error(size?'单个附件不能超过 20 MB。':'附件为空。');
    const extensions:Record<string,string>={'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','image/gif':'.gif'};
    const name=/\.[a-z0-9]{1,8}$/i.test(source.title)?source.title:source.title+(extensions[blob.type]||'');
    await mkdir(storage,{recursive:true});path=join(storage,source.key+extname(name));
    await writeFile(path,new Uint8Array(await blob.arrayBuffer()));
  }else{
    const original=await assetPath(url,workspace,origin);size=(await stat(original)).size;
    if(size>MAX_SIZE)throw Error('单个附件不能超过 20 MB。');
    await mkdir(storage,{recursive:true});path=join(storage,source.key+extname(original));await copyFile(original,path);
  }
  // CLI's vision input accepts localImage; other files are explicit tool-readable paths.
  const image=source.kind==='image'&&/\.(png|jpe?g|webp|gif)$/i.test(path);
  return {title:source.title,text:`${source.marker}\n本机附件路径：${path}\n${image?'图片已随本次请求提供。':'请根据用户请求使用文件工具读取此附件。'}`,media:{key:source.key,marker:source.marker,kind:image?'image':'file',path,size}};
}
export function attachmentInput(text:string,attachments:Attachment[]=[]){
  const media=attachments.filter(a=>a.media);
  if(media.some(a=>a.media!.status||!a.media!.path))throw Error('附件尚未准备好，请等待上传完成或重试失败项。');
  return [{type:'text',text,text_elements:[]},...media.filter(a=>a.media!.kind==='image').map(a=>({type:'localImage',path:a.media!.path!}))];
}
