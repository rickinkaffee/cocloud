#!/usr/bin/env node
import {createInterface} from 'node:readline';
import {appendFileSync} from 'node:fs';
const reader=createInterface({input:process.stdin});
reader.on('line',line=>{
  const {id,method,params}=JSON.parse(line);
  if(id===undefined)return;
  let result;
  if(method==='initialize')result={userAgent:'synthetic-skill-peer',codexHome:'/tmp',platformFamily:'unix',platformOs:'linux'};
  else if(method==='skills/list')result={data:[{cwd:params.cwds[0],skills:[{name:'synthetic',path:'/tmp/synthetic-skill/SKILL.md',enabled:true,description:'Synthetic regression fixture',scope:'user',shortDescription:null,interface:null,dependencies:null}],errors:[]}]};
  else if(method==='skills/config/write'){
    appendFileSync(process.env.SKILL_WRITE_RECORD,JSON.stringify(params)+'\n');
    // Simulate the provider overriding the requested state.
    result={effectiveEnabled:false};
  }else return;
  process.stdout.write(JSON.stringify({id,result})+'\n');
});
