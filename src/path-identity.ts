/** Workspace identity is lexical; paths received from drag payloads are never opened. */
export function sameLocalPath(a:string,b:string,platform=typeof process==='object'?process.platform:'linux'){
  if(!a||!b)return a===b;
  const windows=platform==='win32';
  const normalize=(value:string)=>{
    const path=windows?value.replace(/\\/g,'/').toLowerCase():value;
    const drive=windows&&/^[a-z]:\//.test(path)?path.slice(0,3):'';
    const prefix=drive||(path.startsWith('//')&&windows?'//':path.startsWith('/')?'/':'');
    const parts:string[]=[];
    for(const part of (drive?path.slice(3):path).split('/')){
      if(!part||part==='.')continue;
      if(part==='..'&&parts.length&&parts.at(-1)!=='..'&&!/^[a-z]:$/.test(parts.at(-1)!))parts.pop();
      else parts.push(part);
    }
    return prefix+parts.join('/');
  };
  return normalize(a)===normalize(b);
}
