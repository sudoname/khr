# PeopleFlow HR — Runnable MVP

A working, mobile-responsive, multi-company HR website with Flask and SQLite.

## Start locally

Requires Python 3.10 or newer.

```bash
cd hr-platform
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS / Linux: source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Open http://127.0.0.1:5000/register and create an organization. Each organization has an isolated company ID. No default password or demo account is installed.

## Included
- Organization registration and password-hashed admin login
- Tenant-isolated staff directory, CSV export and active/inactive management
- Leave request submissions and manager/admin approval
- Daily employee attendance check-in/out
- Job listings, applicant tracking, hiring stages
- Draft payslip register in NGN
- Simple admin/manager/employee permission checks and CSRF protection
- Responsive dashboard and SQLite database auto-creation

## Important limitations before production
This is a functional **MVP**, not a production-certified HRIS. In particular:
- Registration only creates an admin account. Employee and manager user invitations/role assignment UI still need to be built. Creating employee records does not create a login.
- Managers currently see all company records; reporting hierarchy and manager-scoped permissions are not implemented.
- Draft payroll does NOT calculate Nigerian PAYE, pensions, NHF, taxes, remittances, payslip PDFs, or pay employees.
- No email verification, MFA, password reset, rate limiting, session revocation, audit log, external email, or file attachments.
- No holiday calendar, leave balance calculations, shift support, timezone-aware attendance or leave policy engine.
- SQLite is intended for local evaluation, not multiple concurrent production workers. Migrate to PostgreSQL.
- Run behind HTTPS, configure a persistent random SECRET_KEY and set HTTPS_ONLY=1 for secure session cookies. Do not use built-in development server for production.
- Need security review, tests, data retention policy, backups, encryption strategy, compliance review and deployment automation before using actual employee data.

## Configuration
- `SECRET_KEY`: stable cryptographically random secret (required in production)
- `HR_DB`: path to the SQLite database file
- `PORT`: local server port (default 5000)
- `HTTPS_ONLY=1`: only send session cookies over HTTPS

## Database
Created automatically as `hr.sqlite3` in the app directory. The database is deliberately excluded from the source ZIP.
