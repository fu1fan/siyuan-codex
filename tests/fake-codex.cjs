#!/usr/bin/env node
const readline=require('node:readline');
const send=m=>process.stdout.write(JSON.stringify(m)+'\n');
readline.createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);if(m.id===undefined)return;
 if(m.method==='initialize') {const data=JSON.stringify({id:m.id,result:{ok:true}})+'\n';process.stdout.write(data.slice(0,5));setTimeout(()=>process.stdout.write(data.slice(5)),5);}
 else if(m.method==='test/timeout'){}
 else if(m.method==='test/exit')process.exit(3);
 else if(m.method==='test/error')send({id:m.id,error:{code:-1,message:'fixture error'}});
 else if(m.method==='test/approval'){send({id:'server-1',method:'item/commandExecution/requestApproval',params:{command:'echo safe'}});send({id:m.id,result:{ok:true}});}
 else send({id:m.id,result:m.params});
});
