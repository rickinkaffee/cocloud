"""Incremental source catalogue and bounded durable queue. Never modifies source history."""
import contextlib, datetime, hashlib, io, json, os, pathlib, re, sqlite3, time, uuid
ROOT=pathlib.Path(os.environ.get('MEMORY_DATA','/var/lib/open-workbench-memory'))
DERIVED=pathlib.Path(os.environ.get('MEMORY_DERIVED_ROOT',str(ROOT/'imports/derived')))
def digest(x): return hashlib.sha256(x.encode() if isinstance(x,str) else x).hexdigest()
def connect():
 ROOT.mkdir(parents=True,exist_ok=True)
 c=sqlite3.connect(ROOT/'catalog.sqlite',timeout=15);c.row_factory=sqlite3.Row
 c.execute('PRAGMA journal_mode=WAL');c.execute('PRAGMA busy_timeout=15000');c.execute('PRAGMA cache_size=-8192');return c
def init():
 with connect() as c:
  c.executescript('''
CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY,value TEXT);
CREATE TABLE IF NOT EXISTS sources(path TEXT PRIMARY KEY,category TEXT,device TEXT,stamp TEXT,status TEXT,lines INTEGER DEFAULT 0,visible INTEGER DEFAULT 0,filtered INTEGER DEFAULT 0,error TEXT,updated REAL);
CREATE TABLE IF NOT EXISTS session_flags(session TEXT PRIMARY KEY,is_subagent INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,kind TEXT,project TEXT,title TEXT,updated REAL);
CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,session TEXT,role TEXT,text TEXT,at TEXT,created REAL);
CREATE INDEX IF NOT EXISTS messages_session ON messages(session);
CREATE TABLE IF NOT EXISTS refs(message TEXT,path TEXT,line INTEGER,PRIMARY KEY(message,path,line));
CREATE INDEX IF NOT EXISTS refs_path ON refs(path);
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,session TEXT,bank TEXT,content TEXT,at TEXT,status TEXT DEFAULT 'pending',operation TEXT,attempts INTEGER DEFAULT 0,error TEXT,created REAL,updated REAL);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status,created);
CREATE TABLE IF NOT EXISTS job_messages(job TEXT,message TEXT,PRIMARY KEY(job,message));
CREATE INDEX IF NOT EXISTS jm_message ON job_messages(message);
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,at REAL,kind TEXT,detail TEXT);
CREATE TABLE IF NOT EXISTS banks(id TEXT PRIMARY KEY,project TEXT,ready INTEGER DEFAULT 0);
''')
  c.execute("INSERT OR IGNORE INTO state VALUES('paused','false')")
def state(k,v=None):
 with connect() as c:
  if v is not None:c.execute('INSERT OR REPLACE INTO state VALUES(?,?)',(k,json.dumps(v,ensure_ascii=False)))
  r=c.execute('SELECT value FROM state WHERE key=?',(k,)).fetchone();return json.loads(r[0]) if r else None
def event(kind,detail):
 with connect() as c:c.execute('INSERT INTO events(at,kind,detail) VALUES(?,?,?)',(time.time(),kind,detail[:1000]))
def content_text(content):
 if isinstance(content,str):return content
 if isinstance(content,list):return '\n'.join(x.get('text','') for x in content if isinstance(x,dict) and x.get('type') in ('text','input_text','output_text'))
 return ''
RUNTIME=re.compile(r'^\s*(?:# AGENTS\.md instructions|<environment_context>|<permissions instructions>|<turn_aborted>|<system-reminder>|<skill_content>|<INSTRUCTIONS>|You are Codex|The following is the Codex agent history|Current runtime context\.)',re.I)
SECRET=re.compile(r'(?i)(?:sk-[a-z0-9_-]{20,}|Bearer\s+[a-z0-9._-]{20,}|(?:api[_-]?key|password|token)\s*[=:]\s*["\']?[a-z0-9_./+-]{16,})')
def visible(e,kind):
 if kind=='codex':
  p=e.get('payload',{});typ=e.get('type')
  if typ=='response_item' and p.get('type')=='message' and p.get('role') in ('user','assistant'):
   return p['role'],content_text(p.get('content')),e.get('timestamp')
  # event_msg mirrors response_item, so it is indexed as metadata, not another message.
  return None
 typ=e.get('type');data=e.get('data',{});p=data.get('message',data)
 if typ=='user/message' and data.get('source',{}).get('kind','user')!='user':return None
 if typ in ('user/message','assistant/message') and p.get('role') in ('user','assistant'):
  return p['role'],content_text(p.get('content')),e.get('time')
 return None
def date(value):
 try:
  if isinstance(value,(int,float)):return datetime.datetime.fromtimestamp(value/1000,datetime.timezone.utc).isoformat()
  if value: return datetime.datetime.fromisoformat(value.replace('Z','+00:00')).isoformat()
 except (ValueError,OverflowError,OSError):pass
 return 'unset'
def workbench_snapshots():
 """Read completed workbench messages in one SQLite snapshot, including archived threads."""
 db=pathlib.Path(os.environ.get('MEMORY_WORKBENCH_DB',str(ROOT/'imports/statev2.sqlite')))
 if not db.exists():return []
 snap=ROOT/'workbench-snapshots';snap.mkdir(exist_ok=True)
 c=sqlite3.connect('file:'+str(db)+'?mode=ro',uri=True);c.row_factory=sqlite3.Row
 c.execute('BEGIN')
 providers={}
 for r in c.execute("SELECT thread_id,payload_json FROM orchestration_v2_projection_provider_threads WHERE driver='codex'"):
  d=json.loads(r['payload_json']);native=(d.get('nativeThreadRef') or {}).get('nativeId')
  if native:providers[r['thread_id']]=native
 projects={r['project_id']:r['workspace_root'] for r in c.execute('SELECT project_id,workspace_root FROM projection_projects')}
 threads=c.execute("SELECT thread_id,project_id,title FROM orchestration_v2_projection_threads WHERE default_provider='codex' OR provider_instance_id='codex'").fetchall()
 rows=[]
 for t in threads:
  events=[{'type':'session_meta','payload':{'id':providers.get(t['thread_id'],'t3:'+t['thread_id']),'cwd':projects.get(t['project_id'],'unknown'),'source_database':str(db),'workbench_thread':t['thread_id']}}]
  for r in c.execute("SELECT * FROM orchestration_v2_projection_messages WHERE thread_id=? AND streaming=0 AND role IN ('user','assistant') ORDER BY created_at,message_id",(t['thread_id'],)):
   d=json.loads(r['payload_json']);text=d.get('text','')
   if text:events.append({'type':'response_item','timestamp':r['created_at'],'payload':{'type':'message','role':r['role'],'content':[{'type':'text','text':text}]},'workbench_message_id':r['message_id']})
  if len(events)==1:continue
  p=snap/(digest(t['thread_id'])+'.jsonl');data=''.join(json.dumps(e,ensure_ascii=False)+'\n' for e in events)
  if not p.exists() or p.read_text()!=data:
   tmp=p.with_suffix('.tmp');tmp.write_text(data);tmp.replace(p)
  rows.append((p,'workbench-database','workbench','codex',t['thread_id']))
 c.close();return rows

def sources():
 rows=workbench_snapshots();known_hashes=set()
 if (DERIVED/'index.json').exists():
  d=json.loads((DERIVED/'index.json').read_text())
  for x in d['sessions']:
   known_hashes.add(x.get('sha256'))
   p=(DERIVED/x['derived']).resolve()
   if not p.is_relative_to(DERIVED):raise ValueError('Unsafe derived path')
   cat='external-codex' if x.get('sourceFormat','').startswith('codex') else 'dsh'
   rows.append((p,cat,x.get('deviceId','unknown'),'derived',x.get('sessionPath','')))
 # Newly sealed uploads are ingestible even before the old DSH decoder refreshes its index.
 for manifest in pathlib.Path(os.environ.get('MEMORY_ARCHIVE_ROOT',str(ROOT/'imports/archive'))).glob('*/*/latest.json'):
  data=json.loads(manifest.read_text())
  for item in data.get('files',[]):
   sha=item.get('sha256','')
   if sha in known_hashes:continue
   if not re.fullmatch('[a-f0-9]{64}',sha):raise ValueError('Invalid sealed object hash')
   p=manifest.parent/'objects'/sha
   rows.append((p,'dsh',data.get('deviceId','unknown'),'dsh',item.get('path',sha)))
 for base,kind,dev,pattern in [(pathlib.Path(os.environ.get('MEMORY_DSH_SESSIONS',str(ROOT/'imports/dsh-sessions'))),'dsh','server','*.zstd'),(pathlib.Path(os.environ.get('MEMORY_CODEX_SESSIONS',str(ROOT/'imports/codex-sessions'))),'workbench-codex','workbench','*.jsonl'),(pathlib.Path(os.environ.get('MEMORY_CODEX_ARCHIVED',str(ROOT/'imports/codex-archived'))),'workbench-codex','workbench','*.jsonl')]:
  if base.exists():rows.extend((p,kind,dev,'codex' if 'codex' in kind else 'dsh',str(p.relative_to(base))) for p in base.rglob(pattern))
 return sorted(rows,key=lambda r:(r[1]!='workbench-codex',str(r[0])))
@contextlib.contextmanager
def lines(path):
 with path.open('rb') as f:
  magic=f.read(4);f.seek(0)
  if path.suffix=='.zstd' or magic==b'\x28\xb5\x2f\xfd':
   import zstandard
   with zstandard.ZstdDecompressor().stream_reader(f,read_across_frames=True) as stream:
    yield io.TextIOWrapper(stream,encoding='utf-8')
  else:yield io.TextIOWrapper(f,encoding='utf-8')
def scan_file(row):
 p,cat,dev,kind,hint=row;st=p.stat();stamp=f'parser-v3:{st.st_ino}:{st.st_size}:{st.st_mtime_ns}'
 with connect() as c:
  old=c.execute('SELECT stamp,status FROM sources WHERE path=?',(str(p),)).fetchone()
  if old and old['stamp']==stamp and old['status']=='ready':return False
  c.execute('INSERT INTO sources(path,category,device,status,updated) VALUES(?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET status=excluded.status,updated=excluded.updated',(str(p),cat,dev,'scanning',time.time()))
 # Source data is streamed; writes commit in small batches so UI queries never wait for a full file.
 session=digest(cat+':'+dev+':'+hint);project='unknown';count=kept=filtered=0;bad=0;title='';seen={};last_key=None;last_mid=None
 try:
  with lines(p) as f,connect() as c:
   for n,line in enumerate(f,1):
    if not line.strip():continue
    count+=1
    try:e=json.loads(line)
    except json.JSONDecodeError:
     bad+=1;continue
    if e.get('type') in ('session','session_meta'):
     meta=e.get('payload',e);session=('codex:' if kind=='codex' or cat.endswith('codex') else 'dsh:')+str(meta.get('id') or session);project=meta.get('cwd') or project
    if e.get('type')=='subagent/descriptor':c.execute('INSERT OR REPLACE INTO session_flags VALUES(?,1)',(session,))
    src=e.get('source',{})
    if src.get('sessionId'):session='codex:'+src['sessionId'];project=src.get('cwd') or project
    v=visible(e,'codex' if kind=='codex' else 'dsh')
    if not v:
     if e.get('type')=='user/message':c.execute("UPDATE messages SET role='system' WHERE id IN (SELECT message FROM refs WHERE path=? AND line=?)",(str(p),n))
     filtered+=1;continue
    role,text,at=v
    if not text.strip() or RUNTIME.search(text):
     c.execute("UPDATE messages SET role='system' WHERE id IN (SELECT message FROM refs WHERE path=? AND line=?)",(str(p),n));filtered+=1;continue
    # Strip known runtime envelopes appended to genuine user text, not the user's text itself.
    text=re.sub(r'<environment_context>[\s\S]*?</environment_context>','',text).strip()
    if not text:filtered+=1;continue
    key=digest(role+'\0'+text)
    # Adjacent mirror events in converted external Codex exports share one occurrence.
    if key==last_key:mid=last_mid
    else:
     occurrence=seen.get(key,0);seen[key]=occurrence+1;mid=digest(session+'\0'+key+'\0'+str(occurrence));last_key=key;last_mid=mid
    if not title and role=='user':title=text[:100]
    c.execute('INSERT OR IGNORE INTO messages VALUES(?,?,?,?,?,?)',(mid,session,role,text,date(at),time.time()))
    c.execute('INSERT OR IGNORE INTO refs VALUES(?,?,?)',(mid,str(p),n));kept+=1
    if count%300==0:c.commit()
   c.execute('INSERT INTO sessions VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET project=CASE WHEN excluded.project=\'unknown\' THEN sessions.project ELSE excluded.project END,title=excluded.title,updated=excluded.updated',(session,cat,project,title,time.time()))
   status='error' if bad else 'ready'
   c.execute('UPDATE sources SET stamp=?,status=?,lines=?,visible=?,filtered=?,error=?,updated=? WHERE path=?',(stamp,status,count,kept,filtered,f'{bad} malformed JSON lines' if bad else None,time.time(),str(p)))
  return True
 except Exception as ex:
  with connect() as c:c.execute('UPDATE sources SET status=?,error=?,lines=?,updated=? WHERE path=?',('error',type(ex).__name__+': '+str(ex)[:180],count,time.time(),str(p)))
  event('source_error',str(p)+': '+type(ex).__name__);return False

def enqueue():
 # Per-session project banks preserve project isolation. All sources are searchable by explicit global search.
 with connect() as c:
  sessions=c.execute('SELECT * FROM sessions ORDER BY updated DESC').fetchall()
  for s in sessions:
   pending=c.execute('SELECT * FROM messages WHERE session=? AND role IN ("user","assistant") AND NOT EXISTS(SELECT 1 FROM job_messages j WHERE j.message=messages.id) ORDER BY rowid',(s['id'],)).fetchall()
   if not pending:continue
   bank='project-'+digest(s['project'])[:16];c.execute('INSERT OR IGNORE INTO banks(id,project) VALUES(?,?)',(bank,s['project']))
   chunk=[];ids=[];size=0;at='unset'
   def flush():
    nonlocal chunk,ids,size,at
    if not chunk:return
    text='\n\n'.join(chunk);jid=digest(s['id']+'\0'+text)
    c.execute('INSERT OR IGNORE INTO jobs(id,session,bank,content,at,operation,created,updated) VALUES(?,?,?,?,?,?,?,?)',(jid,s['id'],bank,text,at,str(uuid.uuid5(uuid.NAMESPACE_URL,jid)),time.time(),time.time()))
    c.executemany('INSERT OR IGNORE INTO job_messages VALUES(?,?)',((jid,i) for i in ids));chunk=[];ids=[];size=0;at='unset'
   for m in pending:
    safe=SECRET.sub('[凭据已隐藏]',m['text'])
    # No truncation: oversized messages are split into numbered parts, all represented in durable jobs.
    for start in range(0,len(safe),10000):
     part=safe[start:start+10000];piece=f"[{m['role']} | {m['at']} | message {m['id']} | part {start//10000+1}]\n{part}"
     if size+len(piece)>16000:flush()
     chunk.append(piece);ids.append(m['id']);size+=len(piece);at=m['at'] if m['at']!='unset' else at
   flush();c.commit()
def scan():
 rows=sources();state('scan',{'status':'running','total':len(rows),'done':0,'started':time.time()})
 for i,row in enumerate(rows):
  scan_file(row)
  if i%5==0:state('scan',{'status':'running','total':len(rows),'done':i+1,'at':time.time()})
 enqueue();state('scan',{'status':'complete','total':len(rows),'done':len(rows),'at':time.time()});event('scan','历史索引已更新')
def summary():
 with connect() as c:
  return {'scan':state('scan'),'paused':state('paused'),'worker':state('worker'),'model':(state('modelSelection') or {}).get('model',os.environ.get('MEMORY_MODEL_ID','Not configured')),'engine':'Hindsight 1.2.1','sources':[dict(r) for r in c.execute('SELECT category,device,count(*) files,sum(lines) records,sum(visible) visible,sum(filtered) filtered,sum(status=\'error\') errors FROM sources GROUP BY category,device')], 'sessions':c.execute('SELECT count(*) FROM sessions').fetchone()[0], 'messages':c.execute('SELECT count(*) FROM messages WHERE role IN ("user","assistant")').fetchone()[0], 'jobs':dict(c.execute('SELECT status,count(*) FROM jobs GROUP BY status').fetchall()),'banks':[dict(r) for r in c.execute('SELECT id,project FROM banks')], 'events':[dict(r) for r in c.execute('SELECT * FROM events ORDER BY id DESC LIMIT 12')], 'usage':state('usage'),'engineStats':state('engineStats'),'modelBlock':state('modelBlock')}
if __name__=='__main__':init();scan();print(json.dumps(summary(),ensure_ascii=False))


def retained_content(job):
 with connect() as c:allowed={r[0] for r in c.execute("SELECT m.id FROM messages m JOIN job_messages jm ON jm.message=m.id WHERE jm.job=? AND m.role IN ('user','assistant')",(job['id'],))}
 blocks=re.split(r'(?=^\[(?:user|assistant) \| [^\n]+ \| message [a-f0-9]{64} \| part \d+\]\n)',job['content'],flags=re.M)
 kept=[]
 for block in blocks:
  match=re.search(r' \| message ([a-f0-9]{64}) \| part \d+\]',block.split('\n',1)[0])
  if match and match[1] in allowed:kept.append(block)
 return ''.join(kept)
