import {realpath,stat} from 'node:fs/promises';
import {isAbsolute,join,relative,extname,basename} from 'node:path';

export type NoteAssetOptions={workspace:string;origin:string};
export type NoteAsset={path:string;name:string;mimeType:string;localStatus:'available'|'unavailable';localPath?:string;size?:number;modifiedAt?:string};
export type NoteAssetManifest={source:'siyuan.getDocAssets';scope:'containing-document';status:'available'|'unavailable';observedAt:string;total?:number;truncated?:boolean;items:NoteAsset[]};
const mimeTypes:Record<string,string>={'.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml','.txt':'text/plain','.md':'text/markdown','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
// Normalize paths returned by the metadata API, without opening any file body.
export function noteAssetPath(value:unknown){
  if(typeof value!=='string'||value.length>1024)return;
  let path:string;try{path=decodeURIComponent(value.split(/[?#]/)[0]);}catch{return;}
  if(!path.startsWith('assets/')||/[\\\u0000-\u001f\u007f]/.test(path))return;
  if(path.split('/').some(p=>!p||p==='.'||p==='..'))return;
  return path;
}
export async function noteAssetManifest(id:string,options:NoteAssetOptions,readPaths:(id:string)=>Promise<unknown>,limit=20):Promise<NoteAssetManifest>{
  const base={source:'siyuan.getDocAssets' as const,scope:'containing-document' as const,observedAt:new Date().toISOString()};
  let raw:unknown;try{raw=await readPaths(id);}catch{return {...base,status:'unavailable',items:[]};}
  // A successful getDocAssets response encodes Go's nil slice as JSON null.
  if(raw===null)raw=[];
  if(!Array.isArray(raw))return {...base,status:'unavailable',items:[]};
  const paths=[...new Set(raw.map(noteAssetPath).filter((p):p is string=>!!p))];
  let local=false;try{local=isAbsolute(options.workspace)&&['localhost','127.0.0.1','[::1]'].includes(new URL(options.origin).hostname);}catch{}
  let root:string|undefined;if(local){try{root=await realpath(join(options.workspace,'data','assets'));}catch{}}
  const items=await Promise.all(paths.slice(0,Math.max(0,limit)).map(async path=>{
    const asset:NoteAsset={path,name:basename(path),mimeType:mimeTypes[extname(path).toLowerCase()]||'application/octet-stream',localStatus:'unavailable'};
    if(root){try{
      const file=await realpath(join(root,path.slice('assets/'.length))),rel=relative(root,file),info=await stat(file);
      if(rel&&rel!=='..'&&!rel.startsWith('../')&&!rel.startsWith('..\\')&&!isAbsolute(rel)&&info.isFile())Object.assign(asset,{localStatus:'available',localPath:file,size:info.size,modifiedAt:info.mtime.toISOString()});
    }catch{}}
    return asset;
  }));
  return {...base,status:'available',total:paths.length,truncated:items.length<paths.length,items};
}
