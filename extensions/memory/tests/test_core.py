import json,sys,pathlib,time
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
import core
import pytest
@pytest.fixture(autouse=True)
def root(tmp_path,monkeypatch):monkeypatch.setattr(core,'ROOT',tmp_path/'data');core.init()
def write(p,events):p.write_text('\n'.join(json.dumps(e,ensure_ascii=False) for e in events)+'\n');return p
def msg(t,role='user'):return {'type':role+'/message','time':1794000000000,'data':{'message':{'role':role,'content':[{'type':'text','text':t}]}}}
def test_duplicates_across_mirror_archives_and_incremental(tmp_path):
 events=[{'type':'session','id':'same','cwd':'/project'},msg('长期用中文回复'),msg('好的','assistant'),msg('临时需求')]
 a=write(tmp_path/'a.jsonl',events);b=write(tmp_path/'b.jsonl',events)
 for p in [a,b]:core.scan_file((p,'dsh','server','derived',p.name))
 core.enqueue()
 with core.connect() as c:
  assert c.execute('SELECT count(*) FROM messages').fetchone()[0]==3
  assert c.execute('SELECT count(*) FROM refs').fetchone()[0]==6
  before=c.execute('SELECT count(*) FROM jobs').fetchone()[0]
 assert core.scan_file((a,'dsh','server','derived',a.name)) is False
 write(a,events+[msg('发布前要跑回归')]);core.scan_file((a,'dsh','server','derived',a.name));core.enqueue()
 with core.connect() as c:assert c.execute('SELECT count(*) FROM jobs').fetchone()[0]==before+1

def test_long_message_no_loss_and_secret_redaction(tmp_path):
 text='长内容测试'*6000+'END';p=write(tmp_path/'a.jsonl',[{'type':'session','id':'long','cwd':'/p'},msg(text),msg('token=abcdefghijklmnopqrstuvwx')]);core.scan_file((p,'dsh','x','derived','a'));core.enqueue()
 with core.connect() as c:
  jobs=c.execute('SELECT content FROM jobs').fetchall();assert len(jobs)>=3
  combined=''.join(x[0] for x in jobs);assert 'END' in combined;assert 'abcdefghijklmnopqrstuvwx' not in combined
  assert sum(x[0].count('长内容测试') for x in jobs)==6000
  assert c.execute('SELECT count(DISTINCT message) FROM job_messages').fetchone()[0]==2

def test_codex_filter_and_project_isolation(tmp_path):
 events=[{'type':'session_meta','payload':{'id':'abc','cwd':'/work'}},{'type':'response_item','timestamp':'2026-11-01T01:00:00Z','payload':{'type':'message','role':'user','content':[{'type':'input_text','text':'真实用户请求'}]}},{'type':'event_msg','payload':{'type':'user_message','message':'真实用户请求'}},{'type':'response_item','payload':{'type':'message','role':'developer','content':[{'type':'text','text':'规则注入'}]}}]
 p=write(tmp_path/'c.jsonl',events);core.scan_file((p,'workbench-codex','workbench','codex','c'));core.enqueue()
 with core.connect() as c:
  assert c.execute('SELECT count(*) FROM messages').fetchone()[0]==1
  assert c.execute('SELECT project FROM banks').fetchone()[0]=='/work'

def test_corrupt_file_reported_not_complete(tmp_path):
 p=tmp_path/'bad.jsonl';p.write_text('{bad}\n');core.scan_file((p,'dsh','x','derived','bad'))
 with core.connect() as c:assert c.execute('SELECT status FROM sources').fetchone()[0]=='error'

def test_adjacent_codex_mirrors(tmp_path):
 e=msg('hello');e['source']={'sessionId':'abc','cwd':'D:/project'};p=write(tmp_path/'a.jsonl',[e,e]);core.scan_file((p,'external-codex','pc','derived','a'))
 with core.connect() as c:assert c.execute('SELECT count(*) FROM messages').fetchone()[0]==1

def test_hash_named_sealed_zstd(tmp_path):
 import zstandard
 payload=(json.dumps({'type':'session','id':'sealed','cwd':'/p'})+'\n'+json.dumps(msg('新上传的历史'))+'\n').encode()
 p=tmp_path/('a'*64);p.write_bytes(zstandard.ZstdCompressor().compress(payload))
 core.scan_file((p,'dsh','pc','dsh','session.zstd'))
 with core.connect() as c:
  assert c.execute('SELECT count(*) FROM messages').fetchone()[0]==1
  assert c.execute('SELECT status FROM sources').fetchone()[0]=='ready'


def test_actual_dsh_user_payload_and_mirrored_message(tmp_path):
 real={'type':'user/message','time':1794000000000,'data':{'role':'user','content':[{'type':'text','text':'我平常用手机安排任务，电脑上验收结果。'}],'source':{'kind':'user'}}}
 p=write(tmp_path/'real.jsonl',[{'type':'session','id':'actual','cwd':'/real'},real,msg('明白','assistant')])
 core.scan_file((p,'dsh','server','dsh','actual'));core.enqueue()
 with core.connect() as c:
  rows=list(c.execute("SELECT role,text FROM messages WHERE session='dsh:actual' ORDER BY rowid"))
  assert rows[0]['role']=='user' and '手机' in rows[0]['text'];assert len(rows)==2
  assert c.execute("SELECT count(*) FROM jobs WHERE content LIKE '%手机%'").fetchone()[0]==1
 assert core.scan_file((p,'dsh','server','dsh','actual')) is False

def test_subagent_source_flag(tmp_path):
 p=write(tmp_path/'child.jsonl',[{'type':'session','id':'child','cwd':'/p'},{'type':'subagent/descriptor','data':{}},msg('我是一名医生，这是角色扮演。')])
 core.scan_file((p,'dsh','server','dsh','child'))
 with core.connect() as c:assert c.execute("SELECT is_subagent FROM session_flags WHERE session='dsh:child'").fetchone()[0]==1


def test_runtime_dsh_user_events_are_not_user_messages():
 for kind in ['agent-message','subagent-settled','runtime-context','skill-catalog']:
  assert core.visible({'type':'user/message','data':{'role':'user','source':{'kind':kind},'content':[{'type':'text','text':'我是一位医生'}]}},'dsh') is None

def test_corrected_queue_excludes_runtime_records(tmp_path):
 p=write(tmp_path/'q.jsonl',[{'type':'session','id':'q','cwd':'/p'},msg('真实用户背景'),msg('系统通知')])
 core.scan_file((p,'dsh','server','dsh','q'));core.enqueue()
 with core.connect() as c:
  c.execute("UPDATE messages SET role='system' WHERE text='系统通知'")
  job=dict(c.execute('SELECT * FROM jobs LIMIT 1').fetchone())
 assert '真实用户背景' in core.retained_content(job)
 assert '系统通知' not in core.retained_content(job)
