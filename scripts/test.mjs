import {readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
// Enumerate in Node: Windows cmd.exe does not expand the test-file glob.
const tests=(await readdir('tests')).filter(name=>name.endsWith('.test.ts')).sort().map(name=>join('tests',name));
const child=spawn(process.execPath,['--import','tsx','--test',...process.argv.slice(2),...tests],{stdio:'inherit',shell:false});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
