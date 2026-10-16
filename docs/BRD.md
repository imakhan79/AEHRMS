# Business Requirements Document (BRD)
## Integrated HRMS with Native Finance & Accounting — AE Global Group of Companies

> Captured from the BRD as pasted by the client, section by section. Remaining sections pending.

## 1. Document Control

| Field | Value |
|---|---|
| Client | AE Global Group of Companies |
| System | Integrated Human Resource Management System (HRMS) with Native Finance & Accounting |
| Tech stack | Next.js 14+ (frontend); Supabase — database, auth, storage, edge functions (backend) |
| Finance & accounting | Built natively on Supabase PostgreSQL; no external ERP integration |
| Headcount | 75–100 employees baseline; scalable to 500+ |
| Locations | Lahore Head Office, Gujranwala, Islamabad, regional offices, project & site locations |
| Purpose | Complete business requirements baseline through the implementation roadmap |
| Version | 4.0 — Complete Edition |
| Date | December 2024 |
| Prepared by | Solution Architecture Team |
| Approval | CEO / Managing Director |
| Review cycle | Quarterly, or upon any major scope change |

## 2. Executive Summary

AE Global Group of Companies requires a centralized, scalable HRMS that digitizes the complete employee lifecycle and provides native Finance & Accounting capabilities.

- **Frontend:** Next.js — web plus a mobile-responsive Progressive Web App (PWA).
- **Backend:** Supabase — PostgreSQL with Row Level Security, real-time subscriptions, built-in auth with RBAC support, Edge Functions (serverless compute), Storage (document management) and the Realtime API (notifications).
- **Core architectural requirement:** HR and Finance integrate seamlessly in a **single Supabase database**. Payroll, expenses, loans, statutory deductions and financial postings are all handled natively in the HRMS. **Odoo ERP is removed from scope**; no external ERP integration.
- Must support current multi-location operations and future growth in employees, business units, locations and org structures.

### Key expected outcomes

| Outcome | Target |
|---|---|
| Manual HR transactions | 80% reduction |
| Attendance & leave accuracy | ≥ 99% |
| Payroll processing time | 50% reduction |
| Financial reconciliation accuracy | 100% |
| Employee self-service adoption | ≥ 90% |
| Data | Single source of truth for HR and Finance |

### Business objectives

| # | Objective | Target / KPI | Priority |
|---|---|---|---|
| 1 | Centralize employee and HR information in a controlled digital system | Single database; 100% of employee records digitized | Critical |
| 2 | Replace manual HR processes with workflow-driven approvals and notifications | 80% reduction in paper-based workflows | Critical |
| 3 | Secure self-service for employees and managers | ≥ 90% ESS adoption within 6 months | High |
| 4 | Automate attendance, leave, payroll and statutory calculations | 50% reduction in processing time | Critical |
| 5 | Office biometric attendance plus field/mobile GPS attendance | ≥ 99% time-tracking accuracy | High |
| 6 | Native Finance & Accounting | Complete GL, AP, AR and bank reconciliation | Critical |
| 7 | Integrate HR financial transactions directly with the native GL | 100% auto-posting to GL | Critical |
| 8 | Management visibility via role-based dashboards and analytics | Real-time dashboards for all roles | High |
| 9 | Auditability and privacy | 100% audit-trail coverage; RLS enforcement | Critical |
| 10 | Scalable foundation | Supports 500+ employees without redesign | High |
| 11 | Modern serverless architecture | Cost efficiency and auto-scaling | Medium |

## 4. Scope

### 4.1 In-Scope Modules (Phase 1)

| # | Module | Coverage |
|---|---|---|
| 1 | Organization & Positions | Hierarchy, departments, designations, organogram |
| 2 | Employee Management | Master data, documents, contracts, dependents |
| 3 | Employee Self-Service (ESS) | Profile, documents, leave, attendance, payslips |
| 4 | Recruitment | Requisitions, candidates, interviews, offers, onboarding |
| 5 | Attendance | Biometric, shifts, overtime, regularization, GPS |
| 6 | Leave | Policies, balances, approvals, holidays, encashment |
| 7 | Payroll | Gross-to-net, earnings, deductions, statutory, F&F |
| 8 | Performance | KPIs, OKRs, goals, appraisals |
| 9 | Training | TNA, calendar, attendance, certifications |
| 10 | Expenses | TA/DA, receipts, advances, approvals |
| 11 | Loans & Advances | Applications, schedules, deductions, settlements |
| 12 | Benefits | Eligibility, allowances, enrollment |
| 13 | Assets | Issuance, transfer, return, clearance |
| 14 | Helpdesk | Tickets, SLA, workflow, notifications |
| 15 | Native Finance & Accounting | Chart of Accounts, General Ledger, Journal Entries, AP, AR, Bank Reconciliation, Reports, Tax, Cost Centers, Budgeting |
| 16 | Analytics & Dashboards | Role-based dashboards, operational reports |
| 17 | Administration | Roles, workflows, notifications, audit, configuration |

### 4.2 Out of Scope (Phase 2+)

- External ERP integration (Odoo, SAP, Oracle, Microsoft Dynamics)
- Advanced AI / ML predictive analytics
- External career portal for candidates
- Native iOS and Android apps (a PWA is used instead)
- Advanced visual workflow designer
- Multi-currency accounting
- Consolidation across multiple legal entities

### 4.3 Scope Boundaries

| Dimension | Coverage |
|---|---|
| Users | All AE Global employees, managers, HR, Finance, Executives |
| Locations | Lahore Head Office, Gujranwala, Islamabad, regional and site offices |
| Devices | Desktop browsers; mobile browsers (PWA); biometric devices |
| Data | Employee, attendance, payroll, finance, recruitment, performance |
| Integrations | Biometric devices; email (SMTP); bank disbursement exports; Al Meezan VPS (written "AI Meezan" in source); FBR, EOBI, PESSI and PF statutory reporting |

## 5. Stakeholders and User Roles

### 5.1 Stakeholder Matrix

| Stakeholder | Role | Interest | Influence | Key concern | Engagement |
|---|---|---|---|---|---|
| CEO / Managing Director | Executive Sponsor | High | High | Strategic visibility | Monthly steering |
| HR Director | Business Owner (HR) | High | High | HR digitalization | Weekly |
| Finance Director | Business Owner (Finance) | High | High | Financial controls | Weekly |
| IT Manager | Technical Owner | High | High | System reliability | Daily during build |
| HODs / Managers | Key Users | Medium | Medium | Team management | Bi-weekly |
| Employees | End Users | Medium | Medium | Self-service | During onboarding |
| External Auditor | Compliance | Low | Low | Audit trails | As needed |
| Vendors | Implementation | Medium | Medium | Delivery | Contractual |

### 5.2 User Roles and Permissions

| Role | Access scope | Key functions | RLS policy |
|---|---|---|---|
| Executive | Read all | Dashboards, analytics, reports | Read-only on aggregated views |
| HR Admin | Full CRUD on HR | Employee management, recruitment, payroll, configuration | Full CRUD on HR tables |
| Finance | Full CRUD on Finance + read HR | GL, AP, AR, payroll posting, reconciliation | Full CRUD on Finance tables |
| HOD / Manager | Team data | Attendance, leave approvals, performance | Department-scoped |
| Employee | Own records | ESS, leave, attendance, payslips | Own records only |
| Recruiter | Recruitment data | Requisitions, candidates, interviews | Recruitment tables |
| System Admin | All data + configuration | Users, roles, integrations, audit | Admin + audit |
| Auditor | Read-only all | Audit logs, reports | Read-only |

### 5.3 Permission Matrix

Legend: **CRUD** = create/read/update/delete · **R** = read · **R-Team** = read own department/team · **R-Own** = read own records · **Approve** = approval authority · **Request** = can submit requests · **CRUD-Own** = CRUD on own records · **—** = no access

| Module | Executive | HR Admin | Finance | HOD | Employee | Recruiter | System Admin |
|---|---|---|---|---|---|---|---|
| Organization | R | CRUD | R | R | R | R | CRUD |
| Employees | R | CRUD | R | R-Team | R-Own | R | CRUD |
| Recruitment | R | CRUD | — | R | — | CRUD | CRUD |
| Attendance | R | CRUD | R | R-Team | R-Own | — | CRUD |
| Leave | R | CRUD | R | Approve | Request | — | CRUD |
| Payroll | R | CRUD | CRUD | — | R-Own (payslips) | — | CRUD |
| Finance | R | R | CRUD | — | — | — | CRUD |
| Performance | R | CRUD | — | CRUD | R-Own | — | CRUD |
| Training | R | CRUD | — | R | R | — | CRUD |
| Expenses | R | CRUD | Approve | Approve | Request | — | CRUD |
| Loans | R | CRUD | Approve | R | Request | — | CRUD |
| Assets | R | CRUD | R | R | R | — | CRUD |
| Helpdesk | R | CRUD | R | R | CRUD-Own | — | CRUD |
| Reports | R | CRUD | CRUD | R-Team | R-Own | R | CRUD |
| Admin | R | R | R | — | — | — | CRUD |

> The Auditor role (5.2) is not a column in the source matrix; per 5.2 it has read-only access to all modules.

### 5.4 Open Questions (raised during capture, pending client confirmation)

1. **Benefits** (module 12) has no row in the permission matrix.
2. 5.2 gives **Finance** read access to all HR data, but the matrix shows no Finance access to Recruitment, Performance or Training.
3. **Executive** is "read-only on aggregated views" in 5.2 but **R** on Employees, Payroll etc. in the matrix. Can Executives see individual salaries and employee records, or only totals?
4. **HOD** shows **R** (all) for Recruitment, Loans, Assets, Training and Helpdesk. Should these be limited to their own department, as with Employees and Attendance?
5. **Employee** shows **R** on Assets and Training. Is that all records, or only their own assets and trainings?

## 6. Detailed Functional Requirements

> Requirement IDs (e.g. `ORG-01`) were added during capture for traceability; they are not in the source BRD.

### 6.1 Organization and Position Management

| ID | The system shall… |
|---|---|
| ORG-01 | Support a multi-level organizational hierarchy: Company → Division → Department → Section → Team |
| ORG-02 | Define positions and designations with unique codes, titles, grades and salary bands |
| ORG-03 | Maintain reporting lines: HOD, manager and dotted-line reporting |
| ORG-04 | Generate a visual organogram with drill-down |
| ORG-05 | Support cost center assignment per department or position |
| ORG-06 | Maintain a location/branch master with addresses, geo-coordinates and timezone |
| ORG-07 | Support organizational changes with effective dates and history tracking |

### 6.2 Employee Management

| ID | The system shall… |
|---|---|
| EMP-01 | Maintain a complete employee master: **personal** (name, CNIC, date of birth, gender, marital status, nationality); **contact** (phone, email, address, emergency contacts); **employment** (employee code, joining date, confirmation date, designation, department, location); **bank** (bank name, branch, account number, IBAN); **statutory** (EOBI no., PESSI no., PF no., tax number); education and experience; dependents and nominees |
| EMP-02 | Support digital personnel files with document upload (CNIC, degree, experience letters, contracts, other) |
| EMP-03 | Maintain employment history (promotions, transfers, increments) with effective dates |
| EMP-04 | Support contract management for permanent, contractual and probationary employees, with renewal alerts |
| EMP-05 | Enforce unique employee codes and CNIC validation |
| EMP-06 | Support bulk import/export via Excel or CSV templates |
| EMP-07 | Provide an employee directory with search and filters |
| EMP-08 | Maintain employee lifecycle states: Draft, Active, Probation, Confirmed, Notice, Exited |

### 6.3 Employee Self-Service (ESS)

| ID | Employees shall… |
|---|---|
| ESS-01 | Log in securely via email + password, magic link, or multi-factor authentication |
| ESS-02 | View and update permitted personal information (contact details, address, emergency contacts) |
| ESS-03 | View and download payslips for current and historical periods |
| ESS-04 | View leave balances, apply for leave and track approval status |
| ESS-05 | View attendance records, mark field attendance and request regularization |
| ESS-06 | Submit expense claims with receipt uploads |
| ESS-07 | Apply for loans and advances and view schedules |
| ESS-08 | View assigned assets and acknowledge receipt |
| ESS-09 | Raise helpdesk tickets and track status |
| ESS-10 | Receive real-time notifications in-app and by email |
| ESS-11 | Use ESS as a PWA with offline capability for field attendance |

### 6.4 Recruitment and Onboarding

| ID | The system shall… |
|---|---|
| REC-01 | Support manpower requisitions with an approval workflow |
| REC-02 | Maintain a candidate database with a CV repository |
| REC-03 | Track pipeline stages: Applied → Screening → Interview → Selected → Offered → Hired / Rejected |
| REC-04 | Schedule interviews and send automated notifications |
| REC-05 | Generate offer letters from templates |
| REC-06 | Support an onboarding checklist with task assignments |
| REC-07 | Convert hired candidates to employees with data pre-fill |
| REC-08 | Track probation periods and send confirmation reminders |

### 6.5 Attendance Management

| ID | The system shall… |
|---|---|
| ATT-01 | Capture attendance from biometric devices via API or push server |
| ATT-02 | Support fixed, rotating and flexible shifts with shift rules |
| ATT-03 | Calculate overtime using configurable rules |
| ATT-04 | Support an attendance regularization workflow |
| ATT-05 | Support field/mobile attendance with GPS capture |
| ATT-06 | Enforce geo-fencing with a configurable radius per location |
| ATT-07 | Support selfie or facial verification for field attendance |
| ATT-08 | Support offline attendance capture with auto-sync |
| ATT-09 | Generate daily, monthly and exception attendance reports |
| ATT-10 | Feed attendance data into payroll calculation |

### 6.6 Leave Management

| ID | The system shall… |
|---|---|
| LV-01 | Support configurable leave types (annual, casual, sick, maternity, others) |
| LV-02 | Define leave policies with accrual rules, carry-forward and encashment |
| LV-03 | Maintain real-time leave balances per employee |
| LV-04 | Support a multi-level leave approval workflow |
| LV-05 | Maintain holiday calendars per location |
| LV-06 | Validate leave requests against policies and balances |
| LV-07 | Calculate leave encashment and feed it into payroll |
| LV-08 | Provide leave utilization reports |

### 6.7 Payroll Management

| ID | The system shall… |
|---|---|
| PAY-01 | Maintain salary structures (basic, allowances, deductions) per grade or per employee |
| PAY-02 | Calculate gross-to-net with configurable earnings and deductions |
| PAY-03 | Apply Pakistani statutory deductions: Income Tax (FBR slabs), EOBI (employer and employee), PESSI / Social Security, Provident Fund, Voluntary Pension System |
| PAY-04 | Process payroll using attendance, leave, overtime, loans and advances |
| PAY-05 | Support a payroll approval workflow: Draft → Review → Approved → Posted |
| PAY-06 | Generate PDF payslips and email them to employees |
| PAY-07 | Post payroll journal entries to the GL automatically |
| PAY-08 | Generate bank disbursement files in bank-specific formats |
| PAY-09 | Calculate Full & Final settlement on exit |
| PAY-10 | Support a parallel payroll run for validation |
| PAY-11 | Maintain payroll history and audit trail |

### 6.8 Performance Management

| ID | The system shall… |
|---|---|
| PRF-01 | Support KPI and OKR definition and assignment |
| PRF-02 | Support goal setting with weightage |
| PRF-03 | Support annual, semi-annual and quarterly appraisal cycles |
| PRF-04 | Support self-assessment, manager assessment and 360-degree feedback |
| PRF-05 | Calculate performance scores and ratings |
| PRF-06 | Maintain appraisal history and recommendations |
| PRF-07 | Link performance to increments and promotions |

### 6.9 Training and Development

| ID | The system shall… |
|---|---|
| TRN-01 | Support Training Needs Analysis (TNA) |
| TRN-02 | Maintain a training calendar and nominations |
| TRN-03 | Track training attendance and completion |
| TRN-04 | Maintain certification records with expiry alerts |
| TRN-05 | Capture training feedback and effectiveness |
| TRN-06 | Maintain training history per employee |

### 6.10 Expense Management

| ID | The system shall… |
|---|---|
| EXP-01 | Support travel requests with advance approval |
| EXP-02 | Support expense claims with receipt uploads |
| EXP-03 | Support a multi-level approval workflow |
| EXP-04 | Track advances and adjust them against claims |
| EXP-05 | Post approved expenses to the GL |
| EXP-06 | Support reimbursement via payroll or direct payment |
| EXP-07 | Provide expense analytics by category, department and project |

### 6.11 Loans and Advances

| ID | The system shall… |
|---|---|
| LN-01 | Support loan/advance applications with an approval hierarchy |
| LN-02 | Generate loan agreements and installment schedules |
| LN-03 | Deduct installments through payroll automatically |
| LN-04 | Track loan balances and recovery history |
| LN-05 | Support early settlement and closure |
| LN-06 | Post loan transactions to the GL |

### 6.12 Benefits Management

| ID | The system shall… |
|---|---|
| BEN-01 | Define benefit plans (e.g. health insurance, life insurance) |
| BEN-02 | Define eligibility rules by grade, tenure and other factors |
| BEN-03 | Support benefit enrollment and dependent management |
| BEN-04 | Track benefit costs and deductions |

### 6.13 Asset Management

| ID | The system shall… |
|---|---|
| AST-01 | Maintain an asset master (laptops, phones, vehicles, others) |
| AST-02 | Track asset issuance with acknowledgement |
| AST-03 | Support asset transfer between employees |
| AST-04 | Track asset return and condition |
| AST-05 | Integrate asset clearance with the employee exit workflow |

### 6.14 Helpdesk

| ID | The system shall… |
|---|---|
| HD-01 | Support ticket creation with categories and priorities |
| HD-02 | Define SLA rules per category |
| HD-03 | Route tickets to the appropriate assignees |
| HD-04 | Track ticket status and escalation |
| HD-05 | Provide ticket analytics and SLA compliance reports |

### 6.15 Native Finance and Accounting

| ID | Area | The system shall… |
|---|---|---|
| FIN-01 | Chart of Accounts | Maintain a hierarchical COA with account codes, types (asset, liability, equity, revenue, expense) and parent-child relationships |
| FIN-02 | General Ledger | Maintain a GL with real-time posting of all financial transactions |
| FIN-03 | Journal Entries | Support manual and automatic journal entries with double-entry validation (debits = credits) |
| FIN-04 | Accounts Payable | Manage vendor bills, payments and aging analysis |
| FIN-05 | Accounts Receivable | Manage customer invoices, receipts and aging analysis |
| FIN-06 | Bank Reconciliation | Import bank statements (CSV/Excel) and match them with transactions |
| FIN-07 | Financial Reports | Trial Balance, Profit & Loss, Balance Sheet, Cash Flow Statement, GL Detail, AP and AR Aging |
| FIN-08 | Tax Management | Calculate and track Sales Tax / GST, Withholding Tax and Income Tax |
| FIN-09 | Cost Centers | Allocate transactions to cost centers (departments, projects) |
| FIN-10 | Budgeting | Budget creation, approval and variance analysis |
| FIN-11 | Period Closing | Financial period closing with lock |
| FIN-12 | Audit Trail | Immutable audit trail for all financial transactions |

### 6.16 Analytics and Dashboards

| ID | The system shall… |
|---|---|
| ANL-01 | Provide role-based dashboards for Executive, HR, Finance, HOD and Employee |
| ANL-02 | Provide real-time metrics and KPIs |
| ANL-03 | Support drill-down from summary to detail |
| ANL-04 | Support export to Excel and PDF |
| ANL-05 | Provide scheduled report delivery by email |

### 6.17 Administration

| ID | The system shall… |
|---|---|
| ADM-01 | Support user management: create, disable, password reset |
| ADM-02 | Support role assignment with scope |
| ADM-03 | Support workflow configuration for approval chains |
| ADM-04 | Support notification rule configuration |
| ADM-05 | Support audit log viewing |
| ADM-06 | Support system configuration (company information, fiscal year) |
| ADM-07 | Support data backup and export |

### 6.18 Open Questions (raised during capture, pending client confirmation)

1. **Biometric devices (ATT-01):** make and model in use (e.g. ZKTeco), and whether they support push/ADMS or need polling.
2. **Bank disbursement files (PAY-08):** which banks, and does each have a file format spec?
3. **Fiscal year (ADM-06):** July–June (Pakistan standard) for both payroll tax and the books?
4. **Accounts Receivable (FIN-05):** who are the customers? Project clients, which would need project-wise invoicing?
5. **Policy values:** overtime rules, leave entitlements and accruals, PF and EOBI rates, and loan limits. Are these in a later section, or provided separately?

## 7. Business Workflows

### 7.1 Recruitment

Manpower requisition → HOD approval → HR verification → Position posted → Candidates added to database → Screening → Interviews → Selection → Offer → Acceptance → Onboarding → Joining → Probation → Confirmation

### 7.2 Leave

Employee request → System validation (policy and balance) → Manager / HOD approval → HR approval *(if configured)* → Final approval → Leave ledger updated → Payroll impact calculated

### 7.3 Attendance Regularization

Employee submits correction → Manager verification → HR approval *(if required)* → Attendance ledger updated → Payroll impact calculated

### 7.4 Field Attendance

Mobile login → GPS capture → Geo-fence verification → Selfie / facial verification → *(If offline)* stored locally → Auto-sync when connectivity returns → Manager verification → Attendance ledger updated

### 7.5 Payroll (Native Finance)

**Inputs:** attendance, leave, salary structure, overtime, bonuses, loans and advances, statutory rules

Payroll calculation → Review → Approval → Payslips generated → Native finance journal entries created → GL posted → Bank disbursement file generated

### 7.6 Employee Exit

Resignation submitted → Notice and approval → Clearance tasks assigned → Assets returned → Department clearance → Finance clearance → HR clearance → Full & Final settlement calculated → Exit documents generated → Employee status closed

### 7.7 Expense

Travel request → Approval → Advance payment → Expense / receipt submission → Verification → Approval → Reimbursement → Finance posting → GL updated

### 7.8 Loan

Application → Approval hierarchy → Agreement recorded → Installment schedule created → Payroll deductions → Balance tracking → Early settlement / closure *(supported)*

### 7.9 Payroll-to-GL Posting

Payroll run approved → Journal entry auto-generated → JE posted → GL updated → Financial reports reflect the changes

**Journal entry as specified in the source:**

| Account | Debit | Credit |
|---|---|---|
| Salary Expense | Gross | |
| Salary Payable | | Net pay |
| Income Tax Payable | | Tax withheld |
| EOBI Payable | | EOBI |
| PESSI Payable | | PESSI |
| PF Payable | | PF |
| Loan Recovery | | Installments recovered |

### 7.10 Review Notes (raised during capture, pending Finance Director confirmation)

1. **Employer contributions (7.9).** EOBI (employer share), PESSI (employer-funded) and PF (employer share) are company costs on top of gross salary. They need their own debit lines, otherwise the entry won't balance. Proposed entry:

   | Account | Debit | Credit |
   |---|---|---|
   | Salary Expense | Gross salary | |
   | EOBI Expense (employer) | Employer EOBI | |
   | PESSI Expense (employer) | Employer PESSI | |
   | PF Expense (employer) | Employer PF | |
   | Salary Payable | | Net pay |
   | Income Tax Payable | | Tax withheld |
   | EOBI Payable | | Employee + employer EOBI |
   | PESSI Payable | | Employer PESSI |
   | PF Payable | | Employee + employer PF |
   | VPS Payable | | VPS contributions (if any) |
   | Employee Loans & Advances (asset) | | Installments recovered |

2. **Loan recovery** should credit the *Employee Loans & Advances* asset account set up when the loan was paid out, rather than a "Loan Recovery" account.
3. **Cost centers.** Salary expense lines should be split by each employee's department or project cost center (ORG-05, FIN-09).
4. **Other GL postings not yet defined:** loan disbursement, travel advance payment and settlement (7.7), F&F settlement (7.6), leave encashment, and bank payment of net salary (clearing Salary Payable). Accounting rules for these are needed.
5. **Approvals before posting.** 7.5 and 7.9 don't say who approves. Per the permission matrix, HR Admin and Finance both have Payroll CRUD. Should it be HR approval followed by Finance approval?

## 8. Non-Functional Requirements

| ID | Category | Requirement | Target | Approach |
|---|---|---|---|---|
| NFR-01 | Performance | Page load time | < 2 s | Next.js SSR/ISR, image optimization |
| NFR-02 | Performance | API response time | < 500 ms (p95) | Supabase indexes, connection pooling |
| NFR-03 | Performance | Concurrent users | 200+ | Supabase auto-scaling |
| NFR-04 | Scalability | Employee volume | 500+ without redesign | Partitioning, read replicas |
| NFR-05 | Scalability | Data retention | 5+ years | Archival strategy |
| NFR-06 | Availability | Uptime | 99.9% | Supabase managed infrastructure |
| NFR-07 | Availability | Data durability | 99.999999999% | Supabase Storage |
| NFR-08 | Security | Authentication | MFA, SSO | Supabase Auth |
| NFR-09 | Security | Authorization | RBAC + RLS | PostgreSQL RLS |
| NFR-10 | Security | Encryption at rest | AES-256 | Supabase default |
| NFR-11 | Security | Encryption in transit | TLS 1.3 | HTTPS everywhere |
| NFR-12 | Security | Audit trail | 100% coverage | `audit_logs` table |
| NFR-13 | Privacy | PII protection | Column encryption | pgcrypto |
| NFR-14 | Backup | Frequency | Daily automated | Supabase backups |
| NFR-15 | Backup | Retention | 30 days + monthly archives (configurable) | |
| NFR-16 | Recovery | RPO | < 1 hour | Point-in-Time Recovery |
| NFR-17 | Recovery | RTO | < 4 hours | Documented runbook |
| NFR-18 | Usability | Responsive design | Mobile + desktop | Tailwind CSS |
| NFR-19 | Usability | Accessibility | WCAG 2.1 AA | shadcn/ui |
| NFR-20 | Usability | Browser support | Chrome, Firefox, Safari, Edge (latest 2 versions) | |
| NFR-21 | Usability | PWA offline | Field attendance | Service workers |
| NFR-22 | Maintainability | Code quality | TypeScript strict | ESLint, Prettier |
| NFR-23 | Maintainability | Test coverage | > 80% | Vitest, Playwright |
| NFR-24 | Portability | Data export | Complete | pg_dump, CSV exports |
| NFR-25 | Compliance | Pakistani statutory | Always current | Configurable engine |
| NFR-26 | Observability | Logging | Structured | Supabase logs |
| NFR-27 | Observability | Monitoring | Real-time alerts | Sentry, Supabase |

### 8.1 Review Notes (raised during capture; checked against Supabase docs, Oct 2026)

1. **Supabase plan determines backups (NFR-14 to NFR-16).** Free-plan projects get **no automatic backups**. Daily backups are kept for 7 days on Pro, 14 days on Team and 30 days on Enterprise. PITR is a paid add-on (Pro and above, needs at least Small compute) with a worst-case RPO of about 2 minutes, which comfortably meets the < 1 hour target. Enabling PITR stops daily backups. To reach "30 days + monthly archives" on Pro or Team, add a scheduled `pg_dump` to off-site storage. **Action: confirm which plan project `cvqampemdkxgbrlrbznt` is on.**
2. **99.9% uptime (NFR-06)** is a design target. A contractual uptime SLA from Supabase depends on the plan tier; confirm with Supabase before relying on it.
3. **SSO (NFR-08):** Supabase supports SAML 2.0 SSO, off by default. Which identity provider is AE Global using (e.g. Microsoft 365 / Entra ID, Google Workspace)?
4. **PII column encryption (NFR-13).** Encrypting CNIC, bank account and IBAN with pgcrypto needs a key stored outside the table (Supabase Vault or a server-side secret). Encrypted columns can't be searched or checked for uniqueness directly, so CNIC uniqueness (EMP-05) will use a separate hash column. Salaries stay unencrypted so payroll and reports can calculate on them; RLS restricts who can read them.
5. **ISR caching (NFR-01).** ISR/CDN caching will be used only for pages that contain no personal data. Pages tied to a logged-in user are rendered per request, so one user is never served another user's session or data (Supabase SSR guidance).
6. **Read replicas and partitioning (NFR-04)** aren't needed at 500 employees. Only high-volume tables (attendance punches, `audit_logs`) will be designed so they can be partitioned later.
7. **Accessibility (NFR-19):** shadcn/ui gives an accessible base, but WCAG 2.1 AA still needs testing (automated axe checks in Playwright plus manual checks).

## 9. Reporting and Analytics

### 9.1 Dashboard Specifications

**Executive Dashboard**

| Widget | Metrics | Source |
|---|---|---|
| Headcount | Total, by department, by location | `employees` |
| Payroll liability | Monthly gross, net, statutory | `payroll_runs` |
| Attendance compliance | Present %, absent %, late % | `attendance` |
| Attrition | Monthly, YTD, by department | `employees` |
| Financial summary | Revenue, expenses, profit | `journal_entries` |
| Pending approvals | By type | Various |

**HR Dashboard**

| Widget | Metrics | Source |
|---|---|---|
| Employee lifecycle | Joining, exits, transfers | `employees` |
| Recruitment pipeline | Candidates by stage | `candidates` |
| Leave utilization | Used, balance, pending | `leave_requests` |
| Attendance exceptions | Late, absent, missing | `attendance` |
| Pending approvals | Leave, expense, loan | Various |

**Finance Dashboard**

| Widget | Metrics | Source |
|---|---|---|
| Payroll totals | Gross, deductions, net | `payroll_runs` |
| Statutory liabilities | Tax, EOBI, PESSI, PF | `journal_entries` |
| Reimbursements | Pending, paid | `expense_claims` |
| Loans | Active, recovery, balance | `loans` |
| GL summary | Trial balance, P&L | `general_ledger` |
| AP / AR aging | Current, 30, 60, 90+ days | `accounts_payable`, `accounts_receivable` |

**HOD Dashboard**

| Widget | Metrics | Source |
|---|---|---|
| Team attendance | Present, absent, late | `attendance` |
| Leave requests | Pending, approved | `leave_requests` |
| Field attendance | Verified, pending | `attendance` |
| Performance | Team scores | `appraisals` |
| Team requests | Expenses, loans | Various |

**Employee Dashboard**

| Widget | Metrics | Source |
|---|---|---|
| Leave balance | By type | `leave_balances` |
| Attendance summary | Current month | `attendance` |
| Payslips | Last 12 months | `payslips` |
| Request status | Pending items | Various |
| Documents | Personal documents | `employee_documents` |

### 9.2 Operational Reports

| Report | Frequency | Format | Audience |
|---|---|---|---|
| Employee Master | Monthly | Excel, PDF | HR |
| Organogram | On-demand | PDF | Management |
| Vacant / Filled Positions | Monthly | Excel | HR, Management |
| Overtime Report | Monthly | Excel | HR, Finance |
| Late / Early Attendance | Daily | Excel | HR, HOD |
| Absenteeism Report | Monthly | Excel | HR |
| Field Attendance | Weekly | Excel | HOD |
| Leave Utilization | Monthly | Excel | HR |
| Recruitment Pipeline | Weekly | PDF | HR, Management |
| Training Completion | Monthly | Excel | HR |
| Asset Register | Quarterly | Excel | Admin |

### 9.3 Compliance and Finance Reports

| Report | Frequency | Format | Audience |
|---|---|---|---|
| Income Tax Statement | Monthly | Excel | Finance |
| EOBI Contribution | Monthly | Excel | Finance |
| PESSI Contribution | Monthly | Excel | Finance |
| PF Statement | Monthly | Excel | Finance |
| VPS Statement | Monthly | Excel | Finance |
| Payroll Register | Monthly | Excel, PDF | Finance |
| F&F Settlement | On exit | PDF | Finance, HR |
| Trial Balance | Monthly | Excel, PDF | Finance |
| Profit & Loss | Monthly | PDF | Finance, Management |
| Balance Sheet | Monthly | PDF | Finance, Management |
| Cash Flow | Monthly | PDF | Finance, Management |
| AP Aging | Monthly | Excel | Finance |
| AR Aging | Monthly | Excel | Finance |
| Bank Reconciliation | Monthly | Excel | Finance |
| Budget vs Actual | Monthly | Excel | Finance, Management |

### 9.4 Audit Reports

| Report | Frequency | Format | Audience |
|---|---|---|---|
| Salary Changes | On-demand | Excel | Auditor |
| Financial Data Changes | On-demand | Excel | Auditor |
| Access Logs | On-demand | Excel | Auditor |
| Integration Logs | On-demand | Excel | IT |
| Failed Transactions | Daily | Email | IT, Finance |

### 9.5 Review Notes (raised during capture)

1. **Table names** in the Source columns are treated as the intended data model and will be used where they fit. Statutory liabilities and the financial summary will be read from posted GL lines, so they match the Trial Balance exactly.
2. **Executive access (relates to 5.4 Q3).** Every Executive widget is an aggregate (totals, percentages, trends). This supports "aggregated views only", so Executives wouldn't need access to individual salaries. Confirm.
3. **"Admin" audience for the Asset Register (9.2)** doesn't match a role in 5.2. Is it the System Admin role, or an Administration department (which may need its own role, e.g. Admin Officer with Asset CRUD)?
4. **Statutory return formats (9.3).** Do the EOBI, PESSI and FBR reports need to match an official upload or challan format (e.g. the FBR IRIS annexure layout), or are internal Excel layouts acceptable?
5. **Scheduled delivery (ANL-05, 9.2–9.4)** will run on Supabase Cron + an Edge Function that generates the file and emails it over SMTP.

## 10. Security and Compliance

### 10.1 Authentication

| Method | Use case | Implementation |
|---|---|---|
| Email + password | Standard login | Supabase Auth |
| Magic link | Passwordless login | Supabase Auth |
| MFA (TOTP) | Sensitive roles | Supabase Auth |
| SSO (SAML / OAuth) | Enterprise integration | Supabase Auth |
| Biometric (device-level) | Mobile app | WebAuthn |

### 10.2 Authorization Model

RBAC + RLS:

- **Users → roles** via the `user_roles` table; **roles → permissions**.
- **Every table has RLS policies** based on:
  - the user's **role** (from `user_roles`)
  - the user's **scope** (department, location)
  - **record ownership** (for ESS)
- **Policy types:** `SELECT` (who can read), `INSERT` (who can create), `UPDATE` (who can modify), `DELETE` (who can remove; **soft delete preferred**).

### 10.3 Data Classification

| Level | Examples | Protection |
|---|---|---|
| Public | Company information, holidays | Standard |
| Internal | Organization structure, policies | RBAC |
| Confidential | Employee contact, attendance | RBAC + RLS |
| Restricted | CNIC, salary, bank details | RBAC + RLS + encryption |
| Highly Restricted | Financial records, audit logs | RBAC + RLS + encryption + audit |

### 10.4 Compliance Requirements

| Area | Requirement | Implementation |
|---|---|---|
| FBR | Income tax calculation and reporting | Configurable tax engine |
| EOBI | Employee registration and contribution | EOBI module |
| PESSI | Social security contribution | PESSI module |
| PF | Provident fund management | PF module |
| VPS | Voluntary pension system management | VPS module |
| Data privacy | PII protection | Encryption, RLS, audit |
| Audit | Financial audit trail | Immutable audit logs |
| Retention | 5+ years | Archival strategy |

### 10.5 Review Notes (raised during capture; checked against Supabase docs, Oct 2026)

1. **Device biometric login (WebAuthn).** Supabase Auth supports passkeys (WebAuthn: fingerprint, Face ID, Windows Hello), but the feature is still **marked experimental** and needs supabase-js 2.105 or later (the project has 2.118). It will be offered as an optional sign-in method, with email + password or magic link as the fallback.
2. **MFA enforcement for sensitive roles.** Supabase MFA supports TOTP and phone codes. A verified second factor puts `aal2` in the user's token. Database access rules for HR Admin, Finance, System Admin and Auditor will require `aal2`, so a stolen password or magic link alone can't open payroll or finance data. Which roles count as "sensitive"? Proposed: HR Admin, Finance, System Admin, Auditor and Executive.
3. **Salary encryption (conflicts with 8.1 note 4).** 10.3 classes salary as Restricted, requiring encryption. If salary is encrypted inside the database, payroll, reports and dashboards can't total it with normal queries, so every calculation would have to decrypt it in a protected server function. **Recommendation:** column-level encryption for CNIC, bank account and IBAN only. Protect salary with RLS, column-level privileges (only payroll roles can select salary columns) and full audit logging of every read or change. **Needs client decision.**
4. **"Encryption" for Highly Restricted financial records.** Encrypting ledger amounts would break the Trial Balance, P&L and other reports. Proposed reading: AES-256 encryption at rest (Supabase default) plus TLS in transit for financial records, with immutable audit logging. Not column-level encryption.
5. **Soft delete vs. finance.** Soft delete applies to HR master data. Posted journal entries are never deleted or edited; corrections are reversing entries. Closed periods are locked (FIN-11, FIN-12).
6. **Role scope.** `user_roles` will carry an optional scope (department and/or location), so HOD access is "department X" and a regional HR officer could be "location Gujranwala". This also answers 5.4 Q4 if HOD rows should be department-scoped.

# Part II — Technical Design

## 11. Technology Stack

### 11.1 Frontend Stack

> *Content pending: only the heading has been received so far.*

### 11.2 Backend Stack (Supabase)

| Component | Technology | Purpose |
|---|---|---|
| Database | PostgreSQL 15+ | Primary data store |
| Authentication | Supabase Auth | JWT, MFA, SSO |
| Authorization | Row Level Security | Fine-grained access |
| API | PostgREST | Auto-generated REST endpoints |
| Realtime | Supabase Realtime | WebSocket subscriptions |
| Storage | Supabase Storage | File / document management |
| Edge Functions | Deno | Serverless business logic |
| Scheduled jobs | pg_cron | Background processing |
| Vault | Supabase Vault | Secret management |
| Extensions | pgcrypto, uuid-ossp, pg_trgm | Encryption, UUIDs, search |

### 11.3 Development and DevOps

| Area | Tool | Purpose |
|---|---|---|
| Version control | Git + GitHub | Source control |
| CI/CD | GitHub Actions | Automated pipelines |
| Frontend hosting | Vercel | Next.js deployment |
| Backend hosting | Supabase Cloud | Managed backend |
| Monitoring | Sentry | Error tracking |
| Analytics | Vercel Analytics | Performance |
| Unit testing | Vitest | |
| E2E testing | Playwright | |
| API testing | Supertest | |
| Linting | ESLint | Code quality |
| Formatting | Prettier | Code formatting |
| Type checking | TypeScript | Static analysis |
| Documentation | Storybook | Component documentation |

### 11.4 Review Notes (raised during capture)

1. **uuid-ossp isn't needed.** PostgreSQL 13+ has `gen_random_uuid()` built in, so one fewer extension.
2. **Supertest** tests a Node HTTP server, but most of this API is PostgREST and Edge Functions. Proposed replacement: **pgTAP** (Supabase-supported) to test every RLS policy directly in the database, which is the most important security test for this system. Also **Vitest + supabase-js** with real test users per role to test the API, and Supertest only for any custom Next.js route handlers.
3. **Next.js version.** The BRD says Next.js 14+. The project is on **Next.js 16**, which uses `proxy.ts` instead of `middleware.ts`.
4. **Hosting region.** The Supabase project is in **ap-northeast-2 (Seoul)**. For users in Pakistan, a nearer region (e.g. ap-south-1 Mumbai, or me-central-1 if offered) would cut latency on every request and help NFR-01/02. A region can't be changed on an existing project. Moving now, while the database is empty, costs nothing; later it means a migration. Set the Vercel function region to match.

## Appendix A. Abbreviations

| Term | Meaning |
|---|---|
| HRMS | Human Resource Management System |
| ESS | Employee Self-Service |
| RBAC | Role-Based Access Control |
| RLS | Row Level Security (Supabase / PostgreSQL) |
| PWA | Progressive Web App |
| F&F | Full and Final settlement |
| EOBI | Employees' Old-Age Benefits Institution |
| PESSI | Punjab Employees Social Security Institution |
| PF | Provident Fund |
| VPS | Voluntary Pension System |
| FBR | Federal Board of Revenue |
| TA/DA | Travel Allowance and Daily Allowance |
| GL | General Ledger |
| AP | Accounts Payable |
| AR | Accounts Receivable |
| COA | Chart of Accounts |
| KPI | Key Performance Indicator |
| OKR | Objectives and Key Results |
| TNA | Training Needs Analysis |
| SLA | Service Level Agreement |
| UAT | User Acceptance Testing |
| PITR | Point-in-Time Recovery |
