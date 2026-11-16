"""Privacy-first public projection. Raw evidence never enters the document response."""
import re
from core import connect,digest
SECTIONS={'background':'工作背景','communication':'沟通方式','workflow':'协作习惯','interests':'长期关注'}
# Conservative: omit identifying or sensitive facts entirely instead of guessing names.
PRIVATE=re.compile(r'姓名|名为|叫做|叫我|我是[\u4e00-\u9fff]{2,4}[，。]|任职|就职|单位|公司|企业|部门|服务部|迈瑞|刘陆|医院|大学|学校|客户|患者|家庭|家人|妻子|丈夫|孩子|父母|出生|年龄|岁|住址|地址|居住|身份证|护照|电话|手机[号：:]|邮箱|邮件|账号|帐号|密码|密钥|token|api.?key|收入|薪资|银行|账户|健康|疾病|诊断|政治|宗教|性取向|性别|微信|QQ|https?://|[\w.+-]+@[\w.-]+|\b\d{7,}\b|(?:\d{1,3}\.){3}\d{1,3}|[A-Z]:[\\/]|/var/|/home/|/Users/',re.I)
def safe_fact(row):
 text=row['text'].strip()
 # Background identity/biography is never automatically disclosed. Preserve only
 # broad industry context supported by an explicit first-person source.
 if row['category']=='background':
  if 'IVD' in row['quote'] and any(x in row['quote'] for x in ['我们是','进入IVD','IVD行业']):return '有体外诊断行业相关工作背景。'
  return None
 if PRIVATE.search(text) or PRIVATE.search(row['quote']):return None
 return text

def profile_document(detail='document',section='',reference=''):
 with connect() as c:
  rows=c.execute('SELECT id,category,text,quote,created FROM personal_memories WHERE hidden=0 ORDER BY category,created DESC LIMIT 1000').fetchall()
 sections={k:[] for k in SECTIONS};seen=set();refs={}
 for row in rows:
  text=safe_fact(row)
  if not text or text in seen:continue
  seen.add(text);rid=row['id'];refs[rid]={'text':text,'quote':'涉及身份的原话已隐去。' if row['category']=='background' or PRIVATE.search(row['quote']) else row['quote'],'category':row['category']}
  if len(sections[row['category']])<8:sections[row['category']].append({'text':text,'reference':rid})
 if reference:
  r=refs.get(reference)
  return {'reference':reference,'evidence':r or None,'notice':'只提供去隐私的证据片段，不返回原始会话、路径或身份信息。'}
 blocks=[{'id':k,'title':SECTIONS[k],'sentences':v} for k,v in sections.items() if v and (not section or section==k)]
 markdown='# 关于你\n\n只保留与协作有关的概括背景；个人隐私已隐去。历史信息可能过时，当前要求优先。\n'
 n=0
 for block in blocks:
  markdown+='\n## '+block['title']+'\n\n'
  parts=[]
  for sentence in block['sentences']:
   n+=1;sentence['number']=n;parts.append(sentence['text']+' ['+str(n)+']')
  markdown+=' '.join(parts)+'\n'
 summary=' '.join(v[0]['text'] for v in sections.values() if v)[:650]
 base={'title':'关于你','summary':summary,'sections':[{'id':k,'title':v,'available':bool(sections[k])} for k,v in SECTIONS.items()],'privacy':'个人身份、单位、联系方式及敏感资料不自动披露。','version':digest(markdown)[:16],'next':'任务需要时按 section 读取相关章节；只有核实结论才按 reference 读取去隐私引用。'}
 if detail!='summary':base.update({'document':blocks,'markdown':markdown})
 return base
