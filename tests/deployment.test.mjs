import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('../scripts/deploy-local.mjs', import.meta.url));
const cases = ['success','nochange','badremote','badpush','dirty','branch','fetchfail','diverged','addfail','commitfail','pushfail','sourcegit','symlink'];
// The POSIX git shim never invokes git or makes network requests. Windows still
// runs the cross-platform generator tests; this shell-executable shim is skipped.
test('publication guards and fail-stop behavior (isolated mock git, no remote)', {skip: process.platform === 'win32' ? 'POSIX executable git shim' : false}, async () => {
  for (const scenario of cases) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(),'blogmaker-deploy-test-'));
    try {
      const dist=path.join(root,'dist'), target=path.join(root,'target'), bin=path.join(root,'bin'), log=path.join(root,'calls.jsonl');
      await fs.mkdir(dist); await fs.mkdir(path.join(target,'.git'),{recursive:true}); await fs.mkdir(bin);
      await fs.writeFile(path.join(dist,'index.html'),'new'); await fs.writeFile(path.join(dist,'.nojekyll'),'');
      await fs.writeFile(path.join(target,'old.html'),'must survive failed preflight');
      const shim=`#!/usr/bin/env node
import fs from 'node:fs';
const args=process.argv.slice(2),a=args.join(' '),s=process.env.SCENARIO;
fs.appendFileSync(process.env.LOG,JSON.stringify(args)+'\\n');
if(a==='rev-parse --show-toplevel')console.log(process.env.TARGET);
else if(args[0]==='remote')console.log(s==='badremote'||(s==='badpush'&&args.includes('--push'))?'https://evil.example/Sakauma/Sakauma.github.io.git':'git@github.com:Sakauma/Sakauma.github.io.git');
else if(a==='branch --show-current')console.log(s==='branch'?'feature':'main');
else if(args[0]==='status')console.log(s==='dirty'?'?? personal.txt':'');
else if(args[0]==='fetch'&&s==='fetchfail')process.exit(1);
else if(args[0]==='rev-parse')console.log(s==='diverged'&&args[1]==='FETCH_HEAD'?'different':'same');
else if(args[0]==='diff')console.log(s==='nochange'?'':'index.html');
else if(s===args[0]+'fail')process.exit(1);
`;
      await fs.writeFile(path.join(bin,'package.json'),'{"type":"module"}');
      await fs.writeFile(path.join(bin,'git'),shim,{mode:0o755});
      if(scenario==='sourcegit') await fs.mkdir(path.join(dist,'.git'));
      if(scenario==='symlink') await fs.symlink(path.join(target,'old.html'),path.join(dist,'unsafe'));
      const result=spawnSync(process.execPath,[script,target],{cwd:root,encoding:'utf8',env:{...process.env,PATH:bin+path.delimiter+process.env.PATH,SCENARIO:scenario,TARGET:target,LOG:log}});
      const calls=(await fs.readFile(log,'utf8')).trim().split('\n').map(l=>JSON.parse(l)[0]);
      assert.equal(result.status===0,['success','nochange'].includes(scenario),`${scenario}: ${result.stderr}`);
      if(['badremote','badpush','dirty','branch','fetchfail','diverged','sourcegit','symlink'].includes(scenario)) assert.equal(await fs.readFile(path.join(target,'old.html'),'utf8'),'must survive failed preflight',scenario);
      if(!['success','pushfail'].includes(scenario)) assert.ok(!calls.includes('push'),`${scenario}: must not push`);
      if(scenario==='addfail') assert.ok(!calls.includes('commit'),'failed staging must stop before commit');
      if(scenario==='success') assert.ok(calls.includes('push'));
    } finally { await fs.rm(root,{recursive:true,force:true}); }
  }
});
