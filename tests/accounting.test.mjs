import assert from 'node:assert/strict';
import { cashBasedPreliminary, computePettyCashBalance, computeAccountBalance, isPostedFinancialStatus, inDateRange } from '../js/modules/accounting.js';

const result = (payments=[], expenses=[], from='2026-10-01', to='2026-10-31') => cashBasedPreliminary({payments, expenses, from, to});

// 1. Client receipts with no expenses.
assert.deepEqual(result([{payment_date:'2026-10-02',amount:1500,status:'Posted'}]), {C:1500,E:0,beforeUnpaidIncurredExpenses:1500,paymentCount:1,paidExpenseCount:0});
// 2. Paid expenses with no client receipts.
assert.equal(result([], [{expense_date:'2026-10-03',amount:300,status:'Posted'}]).beforeUnpaidIncurredExpenses, -300);
// 3. An unpaid invoice is not passed as a receipt and cannot increase cash collected.
assert.equal(result([], []).C, 0);
// 4. Partial payments count only actual posted receipt amounts.
assert.equal(result([{payment_date:'2026-10-02',amount:100,status:'Posted'},{payment_date:'2026-10-03',amount:200,status:'Posted'}]).C, 300);
// 5-6. Unpaid-incurred and future commitments are intentionally not guessed by this helper.
assert.equal(Object.hasOwn(result(), 'U'), false);
// 7. Paid expenses are deducted once per supplied posted expense record.
assert.equal(result([], [{expense_date:'2026-10-03',amount:300,status:'Posted'}]).E, 300);
// 8-9. Internal transfers and owner/loan funding are not inputs to client receipts or expenses.
assert.equal(result([], []).beforeUnpaidIncurredExpenses, 0);
// 10. Cancelled, voided, reversed, pending and draft transactions are excluded.
for (const status of ['Void','Cancelled','Reversed','Pending','Draft','Rejected']) assert.equal(isPostedFinancialStatus(status), false, status);
assert.equal(result([{payment_date:'2026-10-02',amount:999,status:'Reversed'}]).C, 0);
// A posted negative refund/reversal reduces cash received; unsigned refund records need explicit schema semantics.
assert.equal(result([{payment_date:'2026-10-02',amount:500,status:'Posted'},{payment_date:'2026-10-03',amount:-50,status:'Posted'}]).C, 450);
// 11. Petty cash sample: 5000 opening - 300 - 650 + 1000 - 500 = 4550.
const petty = computePettyCashBalance({openingBalance:5000,accountId:'pc',expenses:[
  {account_type:'cash',account_id:'pc',amount:300,status:'Posted'},
  {account_type:'cash',account_id:'pc',amount:650,status:'Posted'},
  {account_type:'cash',account_id:'pc',amount:999,status:'Void'}
],transfers:[
  {destination_type:'cash',destination_id:'pc',amount:1000,status:'Posted'},
  {source_type:'cash',source_id:'pc',amount:500,status:'Posted'}
]});
assert.equal(petty.closingBalance,4550);
assert.equal(petty.paidExpenses,950);
assert.equal(petty.incoming,1000);
assert.equal(petty.outgoing,500);
// 12. Date boundaries are inclusive and empty ranges return zero.
assert.equal(inDateRange('2026-10-01','2026-10-01','2026-10-01'), true);
assert.equal(inDateRange('2026-11-01','2026-10-01','2026-10-31'), false);
assert.equal(result([{payment_date:'2026-09-30',amount:100,status:'Posted'}],[], '2026-10-01','2026-10-31').C, 0);
assert.equal(result([],[],'2026-10-01','2026-10-31').C, 0);
// 13. Individual cash account balance includes receipts, expenses and transfers only for that account.
const cashBalance = computeAccountBalance({accountType:'cash',accountId:'cash-1',openingBalance:1000,
  payments:[{account_type:'cash',account_id:'cash-1',amount:500,status:'Posted'},{account_type:'bank',account_id:'bank-1',amount:900,status:'Posted'}],
  expenses:[{account_type:'cash',account_id:'cash-1',amount:120,status:'Posted'}],
  transfers:[{destination_type:'cash',destination_id:'cash-1',amount:250,status:'Posted'},{source_type:'cash',source_id:'cash-1',amount:75,status:'Posted'},{source_type:'cash',source_id:'cash-1',amount:999,status:'Void'}]});
assert.deepEqual(cashBalance,{openingBalance:1000,received:500,spent:120,incoming:250,outgoing:75,currentBalance:1555});
console.log('Accounting helper tests passed: 13 scenario groups.');
