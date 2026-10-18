"""HR Platform MVP. Run: pip install -r requirements.txt && python app.py"""
import os, sqlite3, secrets, csv, io
from datetime import date, datetime
from functools import wraps
from flask import Flask, request, session, redirect, url_for, abort, render_template_string, flash, Response
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY') or secrets.token_hex(32)
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE='Lax', SESSION_COOKIE_SECURE=os.environ.get('HTTPS_ONLY') == '1', MAX_CONTENT_LENGTH=1024*1024)
DB = os.environ.get('HR_DB', os.path.join(os.path.dirname(__file__), 'hr.sqlite3'))

SCHEMA = '''
CREATE TABLE IF NOT EXISTS companies(id INTEGER PRIMARY KEY, name TEXT NOT NULL, country TEXT NOT NULL DEFAULT 'NG');
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id), name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','manager','employee')));
CREATE TABLE IF NOT EXISTS employees(id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id), user_id INTEGER REFERENCES users(id), full_name TEXT NOT NULL, email TEXT NOT NULL, department TEXT NOT NULL DEFAULT '', job_title TEXT NOT NULL DEFAULT '', salary REAL NOT NULL DEFAULT 0 CHECK(salary>=0), joined_on TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Active' CHECK(status IN ('Active','Inactive')), UNIQUE(company_id,email));
CREATE TABLE IF NOT EXISTS leave_requests(id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, employee_id INTEGER NOT NULL REFERENCES employees(id), start_date TEXT NOT NULL, end_date TEXT NOT NULL, leave_type TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','Approved','Rejected')), requested_by INTEGER NOT NULL REFERENCES users(id));
CREATE TABLE IF NOT EXISTS attendance(id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, employee_id INTEGER NOT NULL REFERENCES employees(id), day TEXT NOT NULL, check_in TEXT NOT NULL, check_out TEXT, UNIQUE(employee_id,day));
CREATE TABLE IF NOT EXISTS jobs(id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, title TEXT NOT NULL, department TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'Open');
CREATE TABLE IF NOT EXISTS applicants(id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, job_id INTEGER NOT NULL REFERENCES jobs(id), name TEXT NOT NULL, email TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Applied');
CREATE TABLE IF NOT EXISTS payroll(id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, employee_id INTEGER NOT NULL REFERENCES employees(id), period TEXT NOT NULL, gross REAL NOT NULL CHECK(gross>=0), deductions REAL NOT NULL DEFAULT 0 CHECK(deductions>=0), status TEXT NOT NULL DEFAULT 'Draft', UNIQUE(employee_id,period));
CREATE INDEX IF NOT EXISTS employees_company ON employees(company_id);
CREATE INDEX IF NOT EXISTS leave_company ON leave_requests(company_id);
'''
def conn():
    c=sqlite3.connect(DB); c.row_factory=sqlite3.Row; c.execute('PRAGMA foreign_keys=ON'); return c

def init_db():
    with conn() as c: c.executescript(SCHEMA)
init_db()

def csrf():
    if 'csrf' not in session: session['csrf']=secrets.token_urlsafe(32)
    return session['csrf']
app.jinja_env.globals['csrf']=csrf
@app.before_request
def secure_forms():
    if request.method=='POST' and not secrets.compare_digest(request.form.get('_csrf',''),csrf()): abort(400,'Invalid CSRF token')

def login_required(fn):
    @wraps(fn)
    def wrapper(*a,**kw):
        if not session.get('uid'): return redirect(url_for('login'))
        return fn(*a,**kw)
    return wrapper

def roles(*allowed):
    def decorator(fn):
        @wraps(fn)
        @login_required
        def wrapper(*a,**kw):
            if session.get('role') not in allowed: abort(403)
            return fn(*a,**kw)
        return wrapper
    return decorator

def q(sql,params=(),one=False):
    with conn() as c:
        rows=c.execute(sql,params).fetchall()
        return (rows[0] if rows else None) if one else rows

def mutate(sql, params=()):
    with conn() as c:
        cur=c.execute(sql,params); return cur.lastrowid

def company(): return session['cid']
def employee_for_user(): return q('SELECT * FROM employees WHERE company_id=? AND user_id=?',(company(),session['uid']),True)

def page(title,body,**context):
    template='''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{{ title }} · PeopleFlow HR</title><link rel="stylesheet" href="/static/style.css"></head><body>
    {% if session.uid %}<aside class="sidebar"><a class="brand" href="/">◈ PeopleFlow<span> HR</span></a><div class="tenant">{{ session.company }}</div><nav>{% for path,label,ico in [('/','Overview','▦'),('/employees','Employees','♙'),('/leave','Leave requests','☼'),('/attendance','Attendance','◷'),('/jobs','Recruitment','◇'),('/payroll','Payroll','▤')] %}<a href="{{path}}" class="{{'active' if request.path==path else ''}}"><span>{{ico}}</span> {{label}}</a>{% endfor %}</nav><div class="sidebarfoot"><small>{{session.name}} · {{session.role|capitalize}}</small><form action="/logout" method="post"><input type="hidden" name="_csrf" value="{{csrf()}}"><button class="ghost" type="submit">Sign out →</button></form></div></aside>{% endif %}
    <main class="{{'main' if session.uid else 'authmain'}}"><header><div><div class="eyebrow">HUMAN RESOURCES PLATFORM</div><h1>{{title}}</h1></div><div class="today">{{today}}</div></header>{% with msgs=get_flashed_messages() %}{% if msgs %}<div class="notice">{{msgs|join(' · ')}}</div>{% endif %}{% endwith %}'''+body+'''<footer>PeopleFlow HR · MVP · All data scoped to your company</footer></main></body></html>'''
    return render_template_string(template,title=title,today=date.today().strftime('%d %b %Y'),**context)

@app.route('/register',methods=['GET','POST'])
def register():
    if session.get('uid'): return redirect('/')
    if request.method=='POST':
        name=request.form.get('company','').strip(); person=request.form.get('name','').strip(); email=request.form.get('email','').strip().lower(); password=request.form.get('password','')
        if not name or not person or '@' not in email or len(password)<12: flash('Enter all fields and a password of at least 12 characters.')
        else:
            try:
                with conn() as c:
                    cid=c.execute('INSERT INTO companies(name,country) VALUES (?,?)',(name,'NG')).lastrowid
                    c.execute('INSERT INTO users(company_id,name,email,password_hash,role) VALUES (?,?,?,?,?)',(cid,person,email,generate_password_hash(password),'admin'))
                flash('Company created. Sign in to continue.'); return redirect('/login')
            except sqlite3.IntegrityError: flash('This email is already registered.')
    return page('Create your workspace','''<div class="authcard"><p>Set up a private HR workspace for your organization.</p><form method="post"><input type="hidden" name="_csrf" value="{{csrf()}}"><label>Company name<input name="company" required placeholder="Acme Nigeria Ltd"></label><label>Your name<input name="name" required></label><label>Work email<input type="email" name="email" required></label><label>Password (12+ characters)<input type="password" name="password" minlength="12" required></label><button class="primary">Create workspace</button></form><p>Already registered? <a href="/login">Sign in</a></p></div>''')

@app.route('/login',methods=['GET','POST'])
def login():
    if session.get('uid'): return redirect('/')
    if request.method=='POST':
        u=q('SELECT u.*,c.name AS company_name FROM users u JOIN companies c ON c.id=u.company_id WHERE u.email=?',(request.form.get('email','').strip().lower(),),True)
        if u and check_password_hash(u['password_hash'],request.form.get('password','')):
            session.clear(); session.update(uid=u['id'],cid=u['company_id'],role=u['role'],name=u['name'],company=u['company_name']); csrf(); return redirect('/')
        flash('Invalid email or password.')
    return page('Welcome back','''<div class="authcard"><p>Sign in to manage your team.</p><form method="post"><input type="hidden" name="_csrf" value="{{csrf()}}"><label>Email<input type="email" name="email" required autofocus></label><label>Password<input type="password" name="password" required></label><button class="primary">Sign in</button></form><p>New organization? <a href="/register">Create workspace</a></p></div>''')

@app.post('/logout')
@login_required
def logout(): session.clear(); return redirect('/login')

@app.route('/')
@login_required
def dashboard():
    cid=company(); count=lambda t:q(f'SELECT COUNT(*) AS n FROM {t} WHERE company_id=?',(cid,),True)['n']
    pending=q("SELECT COUNT(*) AS n FROM leave_requests WHERE company_id=? AND status='Pending'",(cid,),True)['n']
    latest=q('SELECT full_name,department,job_title FROM employees WHERE company_id=? ORDER BY id DESC LIMIT 6',(cid,))
    return page('Workforce overview','''<p class="lead">Everything your people need, in one place.</p><div class="stats"><div class="stat"><span>Employees</span><strong>{{numbers.employees}}</strong><small>Team members</small></div><div class="stat"><span>Open leave requests</span><strong>{{numbers.pending}}</strong><small>Awaiting approval</small></div><div class="stat"><span>Open positions</span><strong>{{numbers.jobs}}</strong><small>Job listings</small></div><div class="stat"><span>Applicants</span><strong>{{numbers.applicants}}</strong><small>In recruitment</small></div></div><section class="panel"><div class="panelhead"><h2>Recently added employees</h2><a href="/employees">View employees →</a></div><table><thead><tr><th>Name</th><th>Department</th><th>Position</th></tr></thead><tbody>{% for e in latest %}<tr><td>{{e.full_name}}</td><td>{{e.department}}</td><td>{{e.job_title}}</td></tr>{% else %}<tr><td colspan="3">No employees yet. Add your first team member.</td></tr>{% endfor %}</tbody></table></section>''',numbers={'employees':count('employees'),'pending':pending,'jobs':q("SELECT COUNT(*) AS n FROM jobs WHERE company_id=? AND status='Open'",(cid,),True)['n'],'applicants':count('applicants')},latest=latest)

@app.route('/employees',methods=['GET','POST'])
@login_required
def employees():
    if request.method=='POST':
        if session['role']!='admin': abort(403)
        name=request.form.get('full_name','').strip(); email=request.form.get('email','').strip().lower()
        if not name or '@' not in email: flash('Provide a valid name and email.')
        else:
            try:
                salary=float(request.form.get('salary') or 0)
                if salary<0: raise ValueError()
                mutate('INSERT INTO employees(company_id,full_name,email,department,job_title,salary,joined_on) VALUES (?,?,?,?,?,?,?)',(company(),name,email,request.form.get('department',''),request.form.get('job_title',''),salary,date.today().isoformat())); flash('Employee added.')
            except (ValueError,sqlite3.IntegrityError): flash('Invalid salary or duplicate employee email.')
        return redirect('/employees')
    records=q('SELECT * FROM employees WHERE company_id=? ORDER BY id DESC',(company(),))
    if session['role']=='employee': records=[e for e in records if e['user_id']==session['uid']]
    return page('Employees','''<p class="lead">A central directory for your workforce.</p>{% if session.role=='admin' %}<details class="panel" open><summary>Add employee</summary><form method="post" class="formgrid"><input type="hidden" name="_csrf" value="{{csrf()}}"><label>Full name<input name="full_name" required></label><label>Email<input type="email" name="email" required></label><label>Department<input name="department" placeholder="Operations"></label><label>Job title<input name="job_title" placeholder="Engineer"></label><label>Monthly base salary (NGN)<input type="number" min="0" step="0.01" name="salary" value="0"></label><button class="primary">Add employee</button></form></details>{% endif %}<section class="panel"><div class="panelhead"><h2>Directory · {{records|length}} employees</h2>{% if session.role=='admin' %}<a href="/employees.csv">Export CSV ↓</a>{% endif %}</div><div class="tablewrap"><table><thead><tr><th>Employee</th><th>Department</th><th>Title</th><th>Status</th>{% if session.role=='admin' %}<th>Action</th>{% endif %}</tr></thead><tbody>{% for e in records %}<tr><td><strong>{{e.full_name}}</strong><small>{{e.email}}</small></td><td>{{e.department}}</td><td>{{e.job_title}}</td><td><span class="pill">{{e.status}}</span></td>{% if session.role=='admin' %}<td><form action="/employees/{{e.id}}/toggle" method="post"><input type="hidden" name="_csrf" value="{{csrf()}}"><button class="ghost">{{'Deactivate' if e.status=='Active' else 'Reactivate'}}</button></form></td>{% endif %}</tr>{% else %}<tr><td colspan="5">No records.</td></tr>{% endfor %}</tbody></table></div></section>''',records=records)

@app.post('/employees/<int:eid>/toggle')
@roles('admin')
def toggle_employee(eid):
    mutate("UPDATE employees SET status=CASE WHEN status='Active' THEN 'Inactive' ELSE 'Active' END WHERE id=? AND company_id=?",(eid,company())); return redirect('/employees')

@app.get('/employees.csv')
@roles('admin')
def export_employees():
    out=io.StringIO(); writer=csv.writer(out); writer.writerow(['Name','Email','Department','Title','Status','Joined'])
    for e in q('SELECT * FROM employees WHERE company_id=?',(company(),)): writer.writerow([e[x] for x in ['full_name','email','department','job_title','status','joined_on']])
    return Response(out.getvalue(),mimetype='text/csv',headers={'Content-Disposition':'attachment; filename=employees.csv'})

@app.route('/leave',methods=['GET','POST'])
@login_required
def leave():
    me=employee_for_user()
    if request.method=='POST':
        eid=int(request.form.get('employee_id') or 0)
        employee=q('SELECT * FROM employees WHERE id=? AND company_id=?',(eid,company()),True)
        if not employee or (session['role']=='employee' and (not me or me['id']!=eid)): abort(403)
        start,end=request.form.get('start',''),request.form.get('end','')
        try:
            if date.fromisoformat(start)>date.fromisoformat(end): raise ValueError()
        except ValueError: flash('Invalid date range.'); return redirect('/leave')
        mutate('INSERT INTO leave_requests(company_id,employee_id,start_date,end_date,leave_type,reason,requested_by) VALUES (?,?,?,?,?,?,?)',(company(),eid,start,end,request.form.get('leave_type','Annual'),request.form.get('reason',''),session['uid'])); flash('Leave request submitted.'); return redirect('/leave')
    staff=q("SELECT id,full_name FROM employees WHERE company_id=? AND status='Active' ORDER BY full_name",(company(),))
    entries=q('SELECT l.*,e.full_name FROM leave_requests l JOIN employees e ON e.id=l.employee_id WHERE l.company_id=? ORDER BY l.id DESC',(company(),))
    if session['role']=='employee': entries=[e for e in entries if me and e['employee_id']==me['id']]
    return page('Leave management','''<p class="lead">Request time off and track approvals.</p><details class="panel" open><summary>Request leave</summary>{% if staff %}<form method="post" class="formgrid"><input type="hidden" name="_csrf" value="{{csrf()}}"><label>Employee<select name="employee_id">{% for e in staff %}{% if session.role!='employee' or (me and me.id==e.id) %}<option value="{{e.id}}">{{e.full_name}}</option>{% endif %}{% endfor %}</select></label><label>Leave type<select name="leave_type"><option>Annual</option><option>Sick</option><option>Parental</option><option>Unpaid</option></select></label><label>From<input type="date" name="start" required></label><label>To<input type="date" name="end" required></label><label class="wide">Reason<textarea name="reason" rows="2"></textarea></label><button class="primary">Submit request</button></form>{% else %}<p>Add an employee before requesting leave.</p>{% endif %}</details><section class="panel"><h2>Leave requests</h2><div class="tablewrap"><table><thead><tr><th>Employee</th><th>Dates</th><th>Type</th><th>Status</th><th>Review</th></tr></thead><tbody>{% for e in entries %}<tr><td>{{e.full_name}}</td><td>{{e.start_date}} → {{e.end_date}}</td><td>{{e.leave_type}}</td><td><span class="pill">{{e.status}}</span></td><td>{% if session.role in ['admin','manager'] and e.status=='Pending' %}<form method="post" action="/leave/{{e.id}}/review"><input type="hidden" name="_csrf" value="{{csrf()}}"><button class="ghost" name="decision" value="Approved">Approve</button><button class="ghost" name="decision" value="Rejected">Reject</button></form>{% endif %}</td></tr>{% else %}<tr><td colspan="5">No leave requests.</td></tr>{% endfor %}</tbody></table></div></section>''',staff=staff,entries=entries,me=me)

@app.post('/leave/<int:lid>/review')
@roles('admin','manager')
def review_leave(lid):
    decision=request.form.get('decision')
    if decision not in ('Approved','Rejected'): abort(400)
    mutate("UPDATE leave_requests SET status=? WHERE id=? AND company_id=? AND status='Pending'",(decision,lid,company())); return redirect('/leave')

@app.route('/attendance',methods=['GET','POST'])
@login_required
def attendance():
    me=employee_for_user()
    if request.method=='POST':
        eid=int(request.form.get('employee_id') or 0)
        e=q('SELECT id FROM employees WHERE id=? AND company_id=?',(eid,company()),True)
        if not e or (session['role']=='employee' and (not me or eid!=me['id'])): abort(403)
        now=datetime.now().isoformat(timespec='seconds'); day=date.today().isoformat()
        existing=q('SELECT * FROM attendance WHERE employee_id=? AND company_id=? AND day=?',(eid,company(),day),True)
        if existing:
            if not existing['check_out']: mutate('UPDATE attendance SET check_out=? WHERE id=? AND company_id=?',(now,existing['id'],company())); flash('Checked out.')
            else: flash('Attendance already completed for today.')
        else: mutate('INSERT INTO attendance(company_id,employee_id,day,check_in) VALUES (?,?,?,?)',(company(),eid,day,now)); flash('Checked in.')
        return redirect('/attendance')
    staff=q("SELECT id,full_name FROM employees WHERE company_id=? AND status='Active'",(company(),))
    entries=q('SELECT a.*,e.full_name FROM attendance a JOIN employees e ON e.id=a.employee_id WHERE a.company_id=? ORDER BY a.day DESC,a.id DESC LIMIT 100',(company(),))
    if session['role']=='employee': entries=[x for x in entries if me and x['employee_id']==me['id']]
    return page('Attendance','''<p class="lead">Track daily check-in and check-out activity.</p><section class="panel"><h2>Record attendance</h2><form method="post" class="inlineform"><input type="hidden" name="_csrf" value="{{csrf()}}"><select name="employee_id">{% for e in staff %}{% if session.role!='employee' or (me and e.id==me.id) %}<option value="{{e.id}}">{{e.full_name}}</option>{% endif %}{% endfor %}</select><button class="primary" {% if not staff %}disabled{% endif %}>Check in / out</button></form></section><section class="panel"><h2>Recent activity</h2><div class="tablewrap"><table><tr><th>Employee</th><th>Date</th><th>Check in</th><th>Check out</th></tr>{% for e in entries %}<tr><td>{{e.full_name}}</td><td>{{e.day}}</td><td>{{e.check_in[11:16]}}</td><td>{{e.check_out[11:16] if e.check_out else '—'}}</td></tr>{% else %}<tr><td colspan="4">No attendance records yet.</td></tr>{% endfor %}</table></div></section>''',staff=staff,entries=entries,me=me)

@app.route('/jobs',methods=['GET','POST'])
@login_required
def jobs():
    if request.method=='POST':
        if session['role'] not in ('admin','manager'): abort(403)
        title=request.form.get('title','').strip()
        if title: mutate('INSERT INTO jobs(company_id,title,department,description) VALUES (?,?,?,?)',(company(),title,request.form.get('department',''),request.form.get('description','')))
        return redirect('/jobs')
    jobs=q('SELECT * FROM jobs WHERE company_id=? ORDER BY id DESC',(company(),))
    candidates=q('SELECT a.*,j.title AS job_title FROM applicants a JOIN jobs j ON j.id=a.job_id WHERE a.company_id=? ORDER BY a.id DESC',(company(),))
    return page('Recruitment','''<p class="lead">Manage open positions and your hiring pipeline.</p>{% if session.role in ['admin','manager'] %}<details class="panel" open><summary>Post a job opening</summary><form method="post" class="formgrid"><input type="hidden" name="_csrf" value="{{csrf()}}"><label>Job title<input name="title" required></label><label>Department<input name="department"></label><label class="wide">Description<textarea name="description"></textarea></label><button class="primary">Create job</button></form></details>{% endif %}<section class="panel"><h2>Openings</h2><table><tr><th>Position</th><th>Department</th><th>Status</th><th>Apply</th></tr>{% for e in jobs %}<tr><td>{{e.title}}</td><td>{{e.department}}</td><td>{{e.status}}</td><td><a href="/jobs/{{e.id}}/apply">Add applicant →</a></td></tr>{% else %}<tr><td colspan="4">No openings yet.</td></tr>{% endfor %}</table></section>{% if session.role in ['admin','manager'] %}<section class="panel"><h2>Applications</h2><table><tr><th>Candidate</th><th>Position</th><th>Stage</th></tr>{% for c in candidates %}<tr><td>{{c.name}}<small>{{c.email}}</small></td><td>{{c.job_title}}</td><td><form method="post" action="/applicants/{{c.id}}/stage"><input type="hidden" name="_csrf" value="{{csrf()}}"><select name="status" onchange="this.form.submit()">{% for s in ['Applied','Screening','Interview','Offer','Hired','Rejected'] %}<option {{'selected' if s==c.status else ''}}>{{s}}</option>{% endfor %}</select></form></td></tr>{% else %}<tr><td colspan="3">No applications yet.</td></tr>{% endfor %}</table></section>{% endif %}''',jobs=jobs,candidates=candidates)

@app.route('/jobs/<int:jid>/apply',methods=['GET','POST'])
@roles('admin','manager')
def apply(jid):
    job=q('SELECT * FROM jobs WHERE id=? AND company_id=?',(jid,company()),True)
    if not job: abort(404)
    if request.method=='POST':
        name=request.form.get('name','').strip(); email=request.form.get('email','').strip()
        if name and '@' in email: mutate('INSERT INTO applicants(company_id,job_id,name,email) VALUES (?,?,?,?)',(company(),jid,name,email)); return redirect('/jobs')
        flash('Enter a valid applicant name and email.')
    return page('Add applicant','''<div class="panel"><h2>{{job.title}}</h2><form method="post" class="formgrid"><input type="hidden" name="_csrf" value="{{csrf()}}"><label>Candidate name<input name="name" required></label><label>Candidate email<input name="email" type="email" required></label><button class="primary">Add to pipeline</button></form></div>''',job=job)

@app.post('/applicants/<int:aid>/stage')
@roles('admin','manager')
def stage(aid):
    state=request.form.get('status')
    if state not in ('Applied','Screening','Interview','Offer','Hired','Rejected'): abort(400)
    mutate('UPDATE applicants SET status=? WHERE id=? AND company_id=?',(state,aid,company())); return redirect('/jobs')

@app.route('/payroll',methods=['GET','POST'])
@roles('admin','manager','employee')
def payroll():
    me=employee_for_user()
    if request.method=='POST':
        if session['role']!='admin': abort(403)
        eid=int(request.form.get('employee_id') or 0)
        e=q('SELECT * FROM employees WHERE id=? AND company_id=?',(eid,company()),True)
        if not e: abort(404)
        try:
            period=request.form.get('period',''); datetime.strptime(period,'%Y-%m')
            gross=float(request.form.get('gross','0')); deductions=float(request.form.get('deductions','0'))
            if min(gross,deductions)<0 or deductions>gross: raise ValueError()
            mutate('INSERT INTO payroll(company_id,employee_id,period,gross,deductions) VALUES (?,?,?,?,?)',(company(),eid,period,gross,deductions)); flash('Draft payslip created.')
        except (ValueError,sqlite3.IntegrityError): flash('Invalid payroll details or duplicate pay period.')
        return redirect('/payroll')
    staff=q('SELECT id,full_name,salary FROM employees WHERE company_id=?',(company(),))
    rows=q('SELECT p.*,e.full_name FROM payroll p JOIN employees e ON e.id=p.employee_id WHERE p.company_id=? ORDER BY p.period DESC,p.id DESC',(company(),))
    if session['role']=='employee': rows=[r for r in rows if me and r['employee_id']==me['id']]
    return page('Payroll','''<p class="lead">Prepare salary records and track payslips in Nigerian naira (NGN).</p><div class="notice">Payroll is a draft register only. Statutory taxes, pensions, payment processing and compliance calculations are not implemented.</div>{% if session.role=='admin' %}<details class="panel" open><summary>Create draft payslip</summary><form method="post" class="formgrid"><input type="hidden" name="_csrf" value="{{csrf()}}"><label>Employee<select name="employee_id">{% for e in staff %}<option value="{{e.id}}">{{e.full_name}}</option>{% endfor %}</select></label><label>Pay period<input type="month" name="period" required></label><label>Gross pay (₦)<input type="number" step="0.01" min="0" name="gross" required></label><label>Other deductions (₦)<input type="number" step="0.01" min="0" value="0" name="deductions" required></label><button class="primary" {% if not staff %}disabled{% endif %}>Create draft</button></form></details>{% endif %}<section class="panel"><h2>Payslip register</h2><div class="tablewrap"><table><tr><th>Employee</th><th>Period</th><th>Gross</th><th>Deductions</th><th>Net</th><th>Status</th></tr>{% for p in rows %}<tr><td>{{p.full_name}}</td><td>{{p.period}}</td><td>₦{{'%.2f'|format(p.gross)}}</td><td>₦{{'%.2f'|format(p.deductions)}}</td><td>₦{{'%.2f'|format(p.gross-p.deductions)}}</td><td><span class="pill">{{p.status}}</span></td></tr>{% else %}<tr><td colspan="6">No payroll records.</td></tr>{% endfor %}</table></div></section>''',staff=staff,rows=rows,me=me)

if __name__=='__main__':
    app.run(host='127.0.0.1',port=int(os.environ.get('PORT','5000')),debug=False)
