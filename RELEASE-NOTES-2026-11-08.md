# Avenix ERP — Payroll & Responsive UI Update

## Updated
- Automatic AVXT employee-code generation at database level, beginning at AVXT-021.
- Bank ledger auto-linking for legacy and newly-created bank accounts, plus payroll RPC fallback.
- Employee form reordered into clear sections.
- Salary structure form reordered and made responsive.
- Payslips now display the Avenix logo and four-sided double border.
- Phone/tablet/laptop/desktop layout refinements, including horizontal scrolling for wide data tables.

## Important deployment note
The ZIP contains frontend source and the consolidated Supabase SQL file. Database changes do not take effect until the SQL file is applied to the correct Supabase project. Back up and test in staging first. No production payroll payment was executed by preparing this package.
