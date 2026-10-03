export function effortLabel(value:string){return ({'':'默认',none:'无',minimal:'最低',low:'低',medium:'中',high:'高',xhigh:'极高',max:'最大',ultra:'超高'} as Record<string,string>)[value]||value;}
