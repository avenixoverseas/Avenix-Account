/** Pure accounting helpers. These functions do not perform database writes. */
export const isPostedFinancialStatus = status => {
  const s = String(status || '').trim().toLowerCase();
  return ['posted', 'paid', 'partially paid', 'completed'].includes(s);
};

export const inDateRange = (value, from, to) => {
  const d = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= from && d <= to;
};

export const sumAmounts = rows => rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);

export function computePettyCashBalance({ openingBalance = 0, expenses = [], transfers = [], accountId }) {
  const paidExpenses = expenses
    .filter(e => isPostedFinancialStatus(e.status) && String(e.account_type || '').toLowerCase() === 'cash' && e.account_id === accountId)
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const incoming = transfers
    .filter(t => isPostedFinancialStatus(t.status) && String(t.destination_type || '').toLowerCase() === 'cash' && t.destination_id === accountId)
    .reduce((sum, t) => sum + Number(t.amount || 0), 0);
  const outgoing = transfers
    .filter(t => isPostedFinancialStatus(t.status) && String(t.source_type || '').toLowerCase() === 'cash' && t.source_id === accountId)
    .reduce((sum, t) => sum + Number(t.amount || 0), 0);
  return {
    openingBalance: Number(openingBalance || 0),
    incoming,
    paidExpenses,
    outgoing,
    closingBalance: Number(openingBalance || 0) + incoming - paidExpenses - outgoing
  };
}

export function cashBasedPreliminary({ payments = [], expenses = [], from, to }) {
  const clientPayments = payments.filter(p => isPostedFinancialStatus(p.status) && inDateRange(p.payment_date, from, to));
  const paidExpenses = expenses.filter(e => isPostedFinancialStatus(e.status) && inDateRange(e.expense_date, from, to));
  const C = sumAmounts(clientPayments);
  const E = sumAmounts(paidExpenses);
  return { C, E, beforeUnpaidIncurredExpenses: C - E, paymentCount: clientPayments.length, paidExpenseCount: paidExpenses.length };
}

/** Current cash/bank balance for a specific account, based on posted source records. */
export function computeAccountBalance({ accountType, accountId, openingBalance = 0, payments = [], expenses = [], transfers = [] }) {
  const type = String(accountType || '').toLowerCase();
  const id = String(accountId || '');
  const valid = row => isPostedFinancialStatus(row.status);
  const received = payments.filter(p => valid(p) && String(p.account_type || '').toLowerCase() === type && String(p.account_id || '') === id)
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const spent = expenses.filter(e => valid(e) && String(e.account_type || '').toLowerCase() === type && String(e.account_id || '') === id)
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const incoming = transfers.filter(t => valid(t) && String(t.destination_type || '').toLowerCase() === type && String(t.destination_id || '') === id)
    .reduce((sum, t) => sum + Number(t.amount || 0), 0);
  const outgoing = transfers.filter(t => valid(t) && String(t.source_type || '').toLowerCase() === type && String(t.source_id || '') === id)
    .reduce((sum, t) => sum + Number(t.amount || 0), 0);
  const opening = Number(openingBalance || 0);
  return { openingBalance: opening, received, spent, incoming, outgoing, currentBalance: +(opening + received - spent + incoming - outgoing).toFixed(2) };
}
