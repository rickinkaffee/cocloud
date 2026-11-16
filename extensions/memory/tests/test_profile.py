import core,profile_memory as pm

def test_profile_evidence_requires_verbatim_user_quote(tmp_path,monkeypatch):
 monkeypatch.setattr(core,'ROOT',tmp_path);core.init();pm.init_profile()
 text='我希望以后先给结论再详细解释原因。'
 items=[{'category':'communication','text':'先给结论再解释','quote':'以后先给结论再详细解释原因'}, {'category':'background','text':'用户是医生','quote':'我是医生'}, {'category':'invalid','text':'先给结论','quote':text}]
 assert pm.validate_items(items,text)==items[:1]

def test_review_payload_not_personal_evidence(tmp_path,monkeypatch):
 monkeypatch.setattr(core,'ROOT',tmp_path);core.init();pm.init_profile()
 with core.connect() as c:
  for mid,role,text in [('u','user','我平常主要在电脑上工作，手机用来安排任务。'),('r','user','The following is the Codex agent history added since your last approval assessment. 我是医生'),('a','assistant','用户是医生')]:
   c.execute('INSERT INTO messages(id,role,text) VALUES(?,?,?)',(mid,role,text));c.execute('INSERT INTO job_messages VALUES(?,?)',('j',mid))
 text=pm.evidence_text({'id':'j','content':'我平常主要在电脑上工作，手机用来安排任务。 The following is the Codex agent history added since your last approval assessment. 我是医生'})
 assert '电脑' in text;assert '医生' not in text
 with core.connect() as c:c.execute("INSERT INTO personal_memories(id,category,text,quote,job,project,created,hidden) VALUES('p','workflow','test','quote','j','/p',1,1)")
 assert pm.personal_summary()['items']==[]

def test_document_privacy_and_progressive_disclosure(tmp_path,monkeypatch):
 import profile_document as doc,json
 monkeypatch.setattr(core,'ROOT',tmp_path);core.init();pm.init_profile()
 with core.connect() as c:
  for key,cat,text,quote in [('id','background','自述名为张三，任职某公司','张三在某公司'),('industry','background','在IVD企业工作','我们是IVD企业'),('safe','workflow','希望默认使用 PowerShell 7。','我希望以后都是ps7'),('phone','communication','请打电话 13812345678','联系电话13812345678'),('hidden','workflow','隐藏内容','隐藏内容')]:
   c.execute('INSERT INTO personal_memories(id,category,text,quote,job,project,created,hidden) VALUES(?,?,?,?,?,?,?,?)',(key,cat,text,quote,'private-job','/private/path',1,int(key=='hidden')))
 full=doc.profile_document();raw=json.dumps(full,ensure_ascii=False)
 for secret in ['张三','某公司','13812345678','/private/path','private-job','我希望以后都是ps7','隐藏内容']:assert secret not in raw
 assert 'PowerShell' in full['markdown'] and '体外诊断' in full['markdown']
 summary=doc.profile_document('summary');assert 'document' not in summary and 'markdown' not in summary
 assert [x['id'] for x in doc.profile_document(section='workflow')['document']]==['workflow']
 assert doc.profile_document(reference='id')['evidence'] is None
 assert doc.profile_document(reference='phone')['evidence'] is None
 assert doc.profile_document(reference='safe')['evidence']['quote']=='我希望以后都是ps7'
 assert 'IVD企业' not in str(doc.profile_document(reference='industry'))
 with core.connect() as c:c.execute("UPDATE personal_memories SET hidden=1 WHERE id='safe'")
 assert 'PowerShell' not in doc.profile_document('summary')['summary']
