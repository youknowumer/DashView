/* ==========================================================================
   DashView — Odoo module profiles (window.DVOdooProfiles)
   What "good visualisation for this module" means, per Odoo app:
   the primary models to offer in the dropdown, 3–4 headline KPIs and 2–4
   charts. Anything without a profile gets a generic one built from the
   selected model's own fields, so every module still gets a useful view.
   Date tokens in domains: $now, $d30, $d365 (resolved at run time).
   ========================================================================== */
(function () {
  'use strict';

  var CONF = [['state', 'in', ['sale', 'done']]];
  var P = {
    sale: {
      title: 'Sales', models: ['sale.order', 'sale.order.line', 'res.partner', 'product.template'],
      kpis: [
        { label: 'Confirmed revenue', model: 'sale.order', domain: CONF, measure: 'amount_total', kind: 'money', sub: 'All confirmed orders' },
        { label: 'Revenue (30 days)', model: 'sale.order', domain: CONF.concat([['date_order', '>=', '$d30']]), measure: 'amount_total', kind: 'money', sub: 'Confirmed in the last 30 days' },
        { label: 'Open quotations', model: 'sale.order', domain: [['state', 'in', ['draft', 'sent']]], measure: 'amount_total', kind: 'count', sub: 'Waiting to be confirmed' },
        { label: 'Orders (30 days)', model: 'sale.order', domain: CONF.concat([['date_order', '>=', '$d30']]), kind: 'count', sub: 'Confirmed in the last 30 days' }
      ],
      charts: [
        { title: 'Revenue by month', model: 'sale.order', domain: CONF, groupby: 'date_order:month', measure: 'amount_total', type: 'bar', last: 12 },
        { title: 'Orders by stage', model: 'sale.order', groupby: 'state', type: 'doughnut' },
        { title: 'Top salespeople by revenue', model: 'sale.order', domain: CONF, groupby: 'user_id', measure: 'amount_total', type: 'hbar', limit: 8 },
        { title: 'Top customers by revenue', model: 'sale.order', domain: CONF, groupby: 'partner_id', measure: 'amount_total', type: 'hbar', limit: 8 },
        { title: 'Top products by revenue', model: 'sale.order.line', groupby: 'product_id', measure: 'price_subtotal', type: 'hbar', limit: 8 },
        { title: 'Revenue by sales team', model: 'sale.order', domain: CONF, groupby: 'team_id', measure: 'amount_total', type: 'doughnut' }
      ]
    },
    crm: {
      title: 'CRM', models: ['crm.lead', 'crm.team', 'crm.stage'],
      kpis: [
        { label: 'Open pipeline', model: 'crm.lead', domain: [['type', '=', 'opportunity'], ['probability', '<', 100]], measure: 'expected_revenue', kind: 'money', sub: 'Expected revenue, open opportunities' },
        { label: 'Won (all time)', model: 'crm.lead', domain: [['probability', '=', 100]], measure: 'expected_revenue', kind: 'money', sub: 'Closed-won revenue' },
        { label: 'New leads (30 days)', model: 'crm.lead', domain: [['create_date', '>=', '$d30']], kind: 'count', sub: 'Created in the last 30 days' }
      ],
      charts: [
        { title: 'Pipeline by stage', model: 'crm.lead', domain: [['type', '=', 'opportunity']], groupby: 'stage_id', measure: 'expected_revenue', type: 'bar' },
        { title: 'Leads by source', model: 'crm.lead', groupby: 'source_id', type: 'doughnut' },
        { title: 'Pipeline by salesperson', model: 'crm.lead', domain: [['type', '=', 'opportunity'], ['probability', '<', 100]], groupby: 'user_id', measure: 'expected_revenue', type: 'hbar', limit: 8 },
        { title: 'New leads per month', model: 'crm.lead', groupby: 'create_date:month', type: 'line', last: 12 }
      ]
    },
    account: {
      title: 'Accounting', models: ['account.move', 'account.move.line', 'account.payment', 'account.journal'],
      kpis: [
        { label: 'Invoiced (posted)', model: 'account.move', domain: [['move_type', '=', 'out_invoice'], ['state', '=', 'posted']], measure: 'amount_total', kind: 'money', sub: 'Customer invoices' },
        { label: 'Receivable outstanding', model: 'account.move', domain: [['move_type', '=', 'out_invoice'], ['state', '=', 'posted'], ['payment_state', 'in', ['not_paid', 'partial']]], measure: 'amount_residual', kind: 'money', sub: 'Unpaid customer invoices' },
        { label: 'Vendor bills (posted)', model: 'account.move', domain: [['move_type', '=', 'in_invoice'], ['state', '=', 'posted']], measure: 'amount_total', kind: 'money', sub: 'Supplier bills' }
      ],
      charts: [
        { title: 'Invoiced by month', model: 'account.move', domain: [['move_type', '=', 'out_invoice'], ['state', '=', 'posted']], groupby: 'invoice_date:month', measure: 'amount_total', type: 'bar', last: 12 },
        { title: 'Invoices by payment status', model: 'account.move', domain: [['move_type', '=', 'out_invoice'], ['state', '=', 'posted']], groupby: 'payment_state', type: 'doughnut' },
        { title: 'Entries by type', model: 'account.move', groupby: 'move_type', type: 'hbar' }
      ]
    },
    purchase: {
      title: 'Purchase', models: ['purchase.order', 'purchase.order.line', 'res.partner'],
      kpis: [
        { label: 'Confirmed spend', model: 'purchase.order', domain: [['state', 'in', ['purchase', 'done']]], measure: 'amount_total', kind: 'money', sub: 'Confirmed purchase orders' },
        { label: 'Spend (30 days)', model: 'purchase.order', domain: [['state', 'in', ['purchase', 'done']], ['date_order', '>=', '$d30']], measure: 'amount_total', kind: 'money', sub: 'Confirmed in the last 30 days' },
        { label: 'RFQs open', model: 'purchase.order', domain: [['state', 'in', ['draft', 'sent']]], kind: 'count', sub: 'Requests for quotation' },
        { label: 'Orders (30 days)', model: 'purchase.order', domain: [['state', 'in', ['purchase', 'done']], ['date_order', '>=', '$d30']], kind: 'count', sub: 'Confirmed in the last 30 days' }
      ],
      charts: [
        { title: 'Spend by month', model: 'purchase.order', domain: [['state', 'in', ['purchase', 'done']]], groupby: 'date_order:month', measure: 'amount_total', type: 'bar', last: 12 },
        { title: 'Orders by status', model: 'purchase.order', groupby: 'state', type: 'doughnut' },
        { title: 'Top vendors by spend', model: 'purchase.order', domain: [['state', 'in', ['purchase', 'done']]], groupby: 'partner_id', measure: 'amount_total', type: 'hbar', limit: 8 },
        { title: 'Top products purchased', model: 'purchase.order.line', groupby: 'product_id', measure: 'price_subtotal', type: 'hbar', limit: 8 },
        { title: 'Orders placed per month', model: 'purchase.order', groupby: 'date_order:month', type: 'line', last: 12 }
      ]
    },
    stock: {
      title: 'Inventory', models: ['stock.picking', 'stock.move', 'stock.quant', 'stock.warehouse', 'product.product'],
      kpis: [
        { label: 'Units on hand', model: 'stock.quant', measure: 'quantity', kind: 'num', sub: 'Total stock across all locations' },
        { label: 'Ready to process', model: 'stock.picking', domain: [['state', '=', 'assigned']], kind: 'count', sub: 'Transfers ready' },
        { label: 'Waiting', model: 'stock.picking', domain: [['state', 'in', ['confirmed', 'waiting']]], kind: 'count', sub: 'Waiting on stock/another operation' },
        { label: 'Late', model: 'stock.picking', domain: [['state', 'not in', ['done', 'cancel']], ['scheduled_date', '<', '$now']], kind: 'count', sub: 'Past scheduled date' }
      ],
      charts: [
        { title: 'Transfers by status', model: 'stock.picking', groupby: 'state', type: 'doughnut' },
        { title: 'Transfers by type', model: 'stock.picking', groupby: 'picking_type_id', type: 'hbar', limit: 8 },
        { title: 'Transfers per month', model: 'stock.picking', groupby: 'scheduled_date:month', type: 'line', last: 12 },
        { title: 'Stock on hand by location', model: 'stock.quant', groupby: 'location_id', measure: 'quantity', type: 'hbar', limit: 8 },
        { title: 'Stock on hand by product', model: 'stock.quant', groupby: 'product_id', measure: 'quantity', type: 'hbar', limit: 8 },
        { title: 'Quantity moved per month', model: 'stock.move', groupby: 'date:month', measure: 'product_uom_qty', type: 'line', last: 12 }
      ]
    },
    hr: {
      title: 'Employees', models: ['hr.employee', 'hr.department', 'hr.job'],
      kpis: [
        { label: 'Employees', model: 'hr.employee', kind: 'count', sub: 'Active employees' },
        { label: 'Hired (365 days)', model: 'hr.employee', domain: [['create_date', '>=', '$d365']], kind: 'count', sub: 'Added in the last year' }
      ],
      charts: [
        { title: 'Headcount by department', model: 'hr.employee', groupby: 'department_id', type: 'hbar', limit: 10 },
        { title: 'Employees by job', model: 'hr.employee', groupby: 'job_id', type: 'doughnut' },
        { title: 'Employees by company', model: 'hr.employee', groupby: 'company_id', type: 'hbar', limit: 8 }
      ]
    },
    hr_holidays: {
      title: 'Time Off', models: ['hr.leave', 'hr.leave.allocation', 'hr.leave.type'],
      kpis: [
        { label: 'To approve', model: 'hr.leave', domain: [['state', 'in', ['confirm', 'validate1']]], kind: 'count', sub: 'Waiting for a decision' },
        { label: 'Approved', model: 'hr.leave', domain: [['state', '=', 'validate']], kind: 'count', sub: 'Approved requests' }
      ],
      charts: [
        { title: 'Requests by status', model: 'hr.leave', groupby: 'state', type: 'doughnut' },
        { title: 'Requests by type', model: 'hr.leave', groupby: 'holiday_status_id', type: 'hbar', limit: 8 },
        { title: 'Requests by department', model: 'hr.leave', groupby: 'department_id', type: 'hbar', limit: 8 }
      ]
    },
    hr_expense: {
      title: 'Expenses', models: ['hr.expense', 'hr.expense.sheet'],
      kpis: [{ label: 'Total expenses', model: 'hr.expense', measure: 'total_amount', kind: 'money', sub: 'All expense lines' }],
      charts: [
        { title: 'Expenses by status', model: 'hr.expense', groupby: 'state', measure: 'total_amount', type: 'doughnut' },
        { title: 'Expenses by employee', model: 'hr.expense', groupby: 'employee_id', measure: 'total_amount', type: 'hbar', limit: 8 },
        { title: 'Expenses by month', model: 'hr.expense', groupby: 'date:month', measure: 'total_amount', type: 'bar', last: 12 }
      ]
    },
    project: {
      title: 'Project', models: ['project.task', 'project.project', 'account.analytic.line'],
      kpis: [
        { label: 'Projects', model: 'project.project', kind: 'count', sub: 'Active projects' },
        { label: 'Open tasks', model: 'project.task', kind: 'count', sub: 'Tasks in progress' }
      ],
      charts: [
        { title: 'Tasks by stage', model: 'project.task', groupby: 'stage_id', type: 'bar' },
        { title: 'Tasks by project', model: 'project.task', groupby: 'project_id', type: 'hbar', limit: 8 },
        { title: 'Tasks created per month', model: 'project.task', groupby: 'create_date:month', type: 'line', last: 12 }
      ]
    },
    mrp: {
      title: 'Manufacturing', models: ['mrp.production', 'mrp.bom', 'mrp.workorder', 'mrp.workcenter'],
      kpis: [
        { label: 'In progress', model: 'mrp.production', domain: [['state', '=', 'progress']], kind: 'count', sub: 'Manufacturing orders' },
        { label: 'Confirmed', model: 'mrp.production', domain: [['state', '=', 'confirmed']], kind: 'count', sub: 'Waiting to start' }
      ],
      charts: [
        { title: 'Orders by status', model: 'mrp.production', groupby: 'state', type: 'doughnut' },
        { title: 'Orders by product', model: 'mrp.production', groupby: 'product_id', type: 'hbar', limit: 8 },
        { title: 'Orders per month', model: 'mrp.production', groupby: 'date_start:month', type: 'line', last: 12 }
      ]
    },
    point_of_sale: {
      title: 'Point of Sale', models: ['pos.order', 'pos.session', 'pos.config', 'pos.payment'],
      kpis: [{ label: 'POS revenue', model: 'pos.order', domain: [['state', 'in', ['paid', 'done', 'invoiced']]], measure: 'amount_total', kind: 'money', sub: 'Paid orders' }],
      charts: [
        { title: 'POS revenue by month', model: 'pos.order', domain: [['state', 'in', ['paid', 'done', 'invoiced']]], groupby: 'date_order:month', measure: 'amount_total', type: 'bar', last: 12 },
        { title: 'Orders by status', model: 'pos.order', groupby: 'state', type: 'doughnut' },
        { title: 'Revenue by cashier', model: 'pos.order', groupby: 'user_id', measure: 'amount_total', type: 'hbar', limit: 8 }
      ]
    },
    contacts: {
      title: 'Contacts', models: ['res.partner', 'res.partner.category', 'res.country'],
      kpis: [
        { label: 'Contacts', model: 'res.partner', kind: 'count', sub: 'All active contacts' },
        { label: 'Customers', model: 'res.partner', domain: [['customer_rank', '>', 0]], kind: 'count', sub: 'With at least one sale' },
        { label: 'Vendors', model: 'res.partner', domain: [['supplier_rank', '>', 0]], kind: 'count', sub: 'With at least one purchase' }
      ],
      charts: [
        { title: 'Contacts by country', model: 'res.partner', groupby: 'country_id', type: 'hbar', limit: 10 },
        { title: 'New contacts per month', model: 'res.partner', groupby: 'create_date:month', type: 'line', last: 12 }
      ]
    },
    helpdesk: {
      title: 'Helpdesk', models: ['helpdesk.ticket', 'helpdesk.team'],
      kpis: [{ label: 'Tickets', model: 'helpdesk.ticket', kind: 'count', sub: 'All tickets' }],
      charts: [
        { title: 'Tickets by stage', model: 'helpdesk.ticket', groupby: 'stage_id', type: 'bar' },
        { title: 'Tickets by priority', model: 'helpdesk.ticket', groupby: 'priority', type: 'doughnut' },
        { title: 'Tickets by team', model: 'helpdesk.ticket', groupby: 'team_id', type: 'hbar', limit: 8 }
      ]
    },
    fleet: {
      title: 'Fleet', models: ['fleet.vehicle', 'fleet.vehicle.log.services', 'fleet.vehicle.log.contract'],
      kpis: [{ label: 'Vehicles', model: 'fleet.vehicle', kind: 'count', sub: 'In the fleet' }],
      charts: [
        { title: 'Vehicles by status', model: 'fleet.vehicle', groupby: 'state_id', type: 'doughnut' },
        { title: 'Vehicles by driver', model: 'fleet.vehicle', groupby: 'driver_id', type: 'hbar', limit: 8 }
      ]
    }
  };
  var ALIAS = { sale_management: 'sale', website_sale: 'sale', sale_stock: 'sale', sale_crm: 'crm', account_accountant: 'account', l10n_generic_coa: 'account', purchase_stock: 'purchase', hr_recruitment: 'hr', hr_contract: 'hr', hr_attendance: 'hr', base: 'contacts', hr_timesheet: 'project', point_of_sale_restaurant: 'point_of_sale' };


  /* Executive (top-management) specs: headline KPIs with period-over-period change,
     a wide trend, mix/concentration charts and "needs attention" alerts. */
  var UNPAID = [['move_type', '=', 'out_invoice'], ['state', '=', 'posted'], ['payment_state', 'in', ['not_paid', 'partial']]];
  var UNPAID_BILLS = [['move_type', '=', 'in_invoice'], ['state', '=', 'posted'], ['payment_state', 'in', ['not_paid', 'partial']]];
  var POSDONE = [['state', 'in', ['paid', 'done', 'invoiced']]];
  var X = {
    sale: { title: 'Sales',
      kpis: [
        { label: 'Revenue', model: 'sale.order', domain: CONF, date: 'date_order', measure: 'amount_total', kind: 'money' },
        { label: 'Confirmed orders', model: 'sale.order', domain: CONF, date: 'date_order', kind: 'count' },
        { label: 'Average order value', kind: 'ratio', of: [0, 1], money: true },
        { label: 'New quotations', model: 'sale.order', domain: [['state', 'in', ['draft', 'sent']]], date: 'create_date', kind: 'count' },
        { label: 'Products', model: 'product.template', domain: [], kind: 'count', sub: 'Open for Data checks: names and references' },
        { label: 'To invoice', model: 'sale.order', domain: [['state', 'in', ['sale', 'done']], ['invoice_status', '=', 'to invoice']], measure: 'amount_total', kind: 'money', sub: 'Confirmed, not yet billed' },
        { label: 'Open quotation value', model: 'sale.order', domain: [['state', 'in', ['draft', 'sent']]], measure: 'amount_total', kind: 'money', sub: 'Waiting to be confirmed' }],
      sc: { head: 0, subs: [1, 5, 6] }, cov: 'sale.order',
      trend: { title: 'Revenue — last 12 months', model: 'sale.order', domain: CONF, groupby: 'date_order:month', measure: 'amount_total', type: 'bar', last: 12 },
      charts: [P.sale.charts[2], P.sale.charts[3]],
      alerts: [
        { label: 'Open quotations', model: 'sale.order', domain: [['state', 'in', ['draft', 'sent']]], measure: 'amount_total', tone: 'warn', hint: 'Follow up or close them' },
        { label: 'Quotations older than 7 days', model: 'sale.order', domain: [['state', 'in', ['draft', 'sent']], ['date_order', '<', '$d7']], measure: 'amount_total', tone: 'warn', hint: 'Stale quotes rarely convert - call the customer' },
        { label: 'Confirmed, not invoiced', model: 'sale.order', domain: [['state', 'in', ['sale', 'done']], ['invoice_status', '=', 'to invoice']], measure: 'amount_total', tone: 'warn', hint: 'Revenue waiting to be billed' }] },
    crm: { title: 'CRM',
      kpis: [
        { label: 'Won revenue', model: 'crm.lead', domain: [['probability', '=', 100]], date: 'date_closed', measure: 'expected_revenue', kind: 'money' },
        { label: 'New leads', model: 'crm.lead', date: 'create_date', kind: 'count' },
        { label: 'Open pipeline', model: 'crm.lead', domain: [['type', '=', 'opportunity'], ['probability', '<', 100]], measure: 'expected_revenue', kind: 'money', sub: 'Expected revenue right now' },
        { label: 'Deals won', model: 'crm.lead', domain: [['probability', '=', 100]], date: 'date_closed', kind: 'count' },
        { label: 'Weighted pipeline', model: 'crm.lead', domain: [['type', '=', 'opportunity'], ['probability', '<', 100]], measure: 'prorated_revenue', kind: 'money', sub: 'Expected revenue x probability' }],
      sc: { head: 0, subs: [2, 1, 3] }, cov: 'crm.lead',
      trend: { title: 'Won revenue — last 12 months', model: 'crm.lead', domain: [['probability', '=', 100]], groupby: 'date_closed:month', measure: 'expected_revenue', type: 'bar', last: 12 },
      charts: [P.crm.charts[0], P.crm.charts[2]],
      alerts: [{ label: 'Opportunities past expected close', model: 'crm.lead', domain: [['type', '=', 'opportunity'], ['probability', '<', 100], ['date_deadline', '<', '$now']], measure: 'expected_revenue', tone: 'warn', hint: 'Re-date or close them out' }] },
    account: { title: 'Finance',
      kpis: [
        { label: 'Invoiced', model: 'account.move', domain: [['move_type', '=', 'out_invoice'], ['state', '=', 'posted']], date: 'invoice_date', measure: 'amount_total', kind: 'money' },
        { label: 'Vendor bills', model: 'account.move', domain: [['move_type', '=', 'in_invoice'], ['state', '=', 'posted']], date: 'invoice_date', measure: 'amount_total', kind: 'money', inverse: true },
        { label: 'Receivable outstanding', model: 'account.move', domain: UNPAID, measure: 'amount_residual', kind: 'money', inverse: true, sub: 'Unpaid customer invoices' },
        { label: 'Payable outstanding', model: 'account.move', domain: UNPAID_BILLS, measure: 'amount_residual', kind: 'money', inverse: true, sub: 'Unpaid vendor bills' },
        { label: 'Overdue payable', model: 'account.move', domain: UNPAID_BILLS.concat([['invoice_date_due', '<', '$now']]), measure: 'amount_residual', kind: 'money', inverse: true, sub: 'Past due date' },
        { label: 'Cash received', model: 'account.payment', domain: [['payment_type', '=', 'inbound'], ['state', 'in', ['posted', 'paid', 'in_process']]], date: 'date', measure: 'amount', kind: 'money', sub: 'Customer payments' },
        { label: 'Cash paid out', model: 'account.payment', domain: [['payment_type', '=', 'outbound'], ['state', 'in', ['posted', 'paid', 'in_process']]], date: 'date', measure: 'amount', kind: 'money', inverse: true, sub: 'Vendor payments' },
        { label: 'Net cash movement', kind: 'diff', of: [5, 6], money: true, sub: 'Received minus paid out' }],
      sc: { head: 0, subs: [2, 3, 7] }, cov: 'account.move',
      trend: { title: 'Invoiced — last 12 months', model: 'account.move', domain: [['move_type', '=', 'out_invoice'], ['state', '=', 'posted']], groupby: 'invoice_date:month', measure: 'amount_total', type: 'bar', last: 12 },
      charts: [P.account.charts[1], P.account.charts[2]],
      alerts: [
        { label: 'Overdue invoices', model: 'account.move', domain: UNPAID.concat([['invoice_date_due', '<', '$now']]), measure: 'amount_residual', tone: 'bad', hint: 'Start the collections run' },
        { label: 'Overdue vendor bills', model: 'account.move', domain: UNPAID_BILLS.concat([['invoice_date_due', '<', '$now']]), measure: 'amount_residual', tone: 'warn', hint: 'Pay or agree new terms with the vendor' }] },
    purchase: { title: 'Purchase',
      kpis: [
        { label: 'Spend', model: 'purchase.order', domain: [['state', 'in', ['purchase', 'done']]], date: 'date_order', measure: 'amount_total', kind: 'money', inverse: true },
        { label: 'Purchase orders', model: 'purchase.order', domain: [['state', 'in', ['purchase', 'done']]], date: 'date_order', kind: 'count' },
        { label: 'Average order value', kind: 'ratio', of: [0, 1], money: true },
        { label: 'Open RFQs', model: 'purchase.order', domain: [['state', 'in', ['draft', 'sent']]], measure: 'amount_total', kind: 'money', sub: 'Awaiting confirmation' },
        { label: 'Received, to bill', model: 'purchase.order', domain: [['state', 'in', ['purchase', 'done']], ['invoice_status', '=', 'to invoice']], measure: 'amount_total', kind: 'money', inverse: true, sub: 'Vendor bills still to record' }],
      sc: { head: 0, subs: [1, 3, 4] }, cov: 'purchase.order',
      trend: { title: 'Spend — last 12 months', model: 'purchase.order', domain: [['state', 'in', ['purchase', 'done']]], groupby: 'date_order:month', measure: 'amount_total', type: 'bar', last: 12 },
      charts: [P.purchase.charts[2], P.purchase.charts[3]],
      alerts: [
        { label: 'Open RFQs', model: 'purchase.order', domain: [['state', 'in', ['draft', 'sent']]], measure: 'amount_total', tone: 'warn', hint: 'Confirm or cancel them' },
        { label: 'Late receipts', model: 'stock.picking', domain: [['picking_type_code', '=', 'incoming'], ['state', 'in', ['assigned', 'confirmed', 'waiting']], ['scheduled_date', '<', '$now']], tone: 'bad', hint: 'Chase the vendor for delivery' }] },
    stock: { title: 'Inventory',
      kpis: [
        { label: 'Units on hand', model: 'stock.quant', measure: 'quantity', kind: 'num', sub: 'Across all locations' },
        { label: 'Transfers completed', model: 'stock.picking', domain: [['state', '=', 'done']], date: 'date_done', kind: 'count' },
        { label: 'Products', model: 'product.template', domain: [], kind: 'count', sub: 'Open for Data checks: names and references' },
        { label: 'Receipts completed', model: 'stock.picking', domain: [['picking_type_code', '=', 'incoming'], ['state', '=', 'done']], date: 'date_done', kind: 'count' },
        { label: 'Deliveries completed', model: 'stock.picking', domain: [['picking_type_code', '=', 'outgoing'], ['state', '=', 'done']], date: 'date_done', kind: 'count' },
        { label: 'Ready to process', model: 'stock.picking', domain: [['state', '=', 'assigned']], kind: 'count', sub: 'Transfers ready now' }],
      sc: { head: 1, subs: [4, 3, 5] }, cov: 'stock.picking',
      trend: { title: 'Transfers — last 12 months', model: 'stock.picking', groupby: 'scheduled_date:month', type: 'line', last: 12 },
      charts: [P.stock.charts[3], P.stock.charts[0]],
      alerts: [
        { label: 'Late transfers', model: 'stock.picking', domain: [['state', 'not in', ['done', 'cancel']], ['scheduled_date', '<', '$now']], tone: 'bad', hint: 'Past the scheduled date' },
        { label: 'Waiting on stock', model: 'stock.picking', domain: [['state', 'in', ['confirmed', 'waiting']]], tone: 'warn', hint: 'Reorder or reallocate stock' },
        { label: 'Negative stock lines', model: 'stock.quant', domain: [['quantity', '<', 0], ['location_id.usage', '=', 'internal']], tone: 'bad', hint: 'Fix with an inventory adjustment' }] },
    hr: { title: 'People',
      kpis: [
        { label: 'Headcount', model: 'hr.employee', kind: 'count', sub: 'Active employees' },
        { label: 'New hires', model: 'hr.employee', date: 'create_date', kind: 'count' },
        { label: 'Departments', model: 'hr.department', kind: 'count', sub: 'Active departments' },
        { label: 'Job positions', model: 'hr.job', kind: 'count', sub: 'Defined roles' }],
      sc: { head: 0, subs: [1, 2, 3] }, cov: 'hr.employee',
      trend: { title: 'New hires — last 12 months', model: 'hr.employee', groupby: 'create_date:month', type: 'bar', last: 12 },
      charts: [P.hr.charts[0], P.hr.charts[1]], alerts: [] },
    project: { title: 'Projects',
      kpis: [
        { label: 'Open tasks', model: 'project.task', domain: [['stage_id.fold', '=', false]], kind: 'count', sub: 'Not in a closed stage' },
        { label: 'Tasks created', model: 'project.task', date: 'create_date', kind: 'count' },
        { label: 'Active projects', model: 'project.project', kind: 'count', sub: 'Projects in progress' },
        { label: 'High priority open', model: 'project.task', domain: [['priority', '=', '1'], ['stage_id.fold', '=', false]], kind: 'count', sub: 'Starred tasks still open' }],
      sc: { head: 0, subs: [1, 2, 3] }, cov: 'project.task',
      trend: { title: 'Tasks created — last 12 months', model: 'project.task', groupby: 'create_date:month', type: 'line', last: 12 },
      charts: [P.project.charts[0], P.project.charts[1]],
      alerts: [{ label: 'Overdue open tasks', model: 'project.task', domain: [['stage_id.fold', '=', false], ['date_deadline', '<', '$now']], tone: 'warn', hint: 'Reassign or move the deadline' }] },
    mrp: { title: 'Manufacturing',
      kpis: [
        { label: 'In progress', model: 'mrp.production', domain: [['state', '=', 'progress']], kind: 'count', sub: 'Manufacturing orders' },
        { label: 'Orders started', model: 'mrp.production', date: 'date_start', kind: 'count' },
        { label: 'Orders completed', model: 'mrp.production', domain: [['state', '=', 'done']], date: 'date_finished', kind: 'count' },
        { label: 'Units produced', model: 'mrp.production', domain: [['state', '=', 'done']], date: 'date_finished', measure: 'product_qty', kind: 'num' }],
      sc: { head: 2, subs: [3, 0, 1] }, cov: 'mrp.production',
      trend: { title: 'Orders started — last 12 months', model: 'mrp.production', groupby: 'date_start:month', type: 'line', last: 12 },
      charts: [P.mrp.charts[0], P.mrp.charts[1]],
      alerts: [
        { label: 'Confirmed, not started', model: 'mrp.production', domain: [['state', '=', 'confirmed']], tone: 'warn', hint: 'Release them to the shop floor' },
        { label: 'Late manufacturing orders', model: 'mrp.production', domain: [['state', 'in', ['confirmed', 'progress', 'to_close']], ['date_deadline', '<', '$now']], tone: 'bad', hint: 'Past the planned deadline' }] },

    /* ---- apps added to the executive board (each hides itself when not installed) ---- */
    point_of_sale: { title: 'Point of Sale',
      kpis: [
        { label: 'POS revenue', model: 'pos.order', domain: POSDONE, date: 'date_order', measure: 'amount_total', kind: 'money' },
        { label: 'POS orders', model: 'pos.order', domain: POSDONE, date: 'date_order', kind: 'count' },
        { label: 'Average basket', kind: 'ratio', of: [0, 1], money: true }],
      sc: { head: 0, subs: [1, 2] }, cov: 'pos.order',
      trend: { title: 'POS revenue — last 12 months', model: 'pos.order', domain: POSDONE, groupby: 'date_order:month', measure: 'amount_total', type: 'bar', last: 12 },
      charts: [{ title: 'POS revenue by shop', model: 'pos.order', domain: POSDONE, groupby: 'config_id', measure: 'amount_total', type: 'hbar', limit: 8 }, P.point_of_sale.charts[2]],
      alerts: [{ label: 'Sessions still open', model: 'pos.session', domain: [['state', 'in', ['opened', 'closing_control']]], tone: 'warn', hint: 'Close and reconcile the cash register' }] },
    hr_holidays: { title: 'Time Off',
      kpis: [
        { label: 'Leave requests', model: 'hr.leave', date: 'create_date', kind: 'count' },
        { label: 'Approved days', model: 'hr.leave', domain: [['state', '=', 'validate']], date: 'date_from', measure: 'number_of_days', kind: 'num' },
        { label: 'Awaiting approval', model: 'hr.leave', domain: [['state', 'in', ['confirm', 'validate1']]], kind: 'count', sub: 'Waiting for a decision' }],
      sc: { head: 1, subs: [0, 2] }, cov: 'hr.leave',
      trend: { title: 'Approved days — last 12 months', model: 'hr.leave', domain: [['state', '=', 'validate']], groupby: 'date_from:month', measure: 'number_of_days', type: 'bar', last: 12 },
      charts: [P.hr_holidays.charts[1], P.hr_holidays.charts[2]],
      alerts: [{ label: 'Requests awaiting approval', model: 'hr.leave', domain: [['state', 'in', ['confirm', 'validate1']]], tone: 'warn', hint: 'Employees are waiting for an answer' }] },
    hr_expense: { title: 'Expenses',
      kpis: [
        { label: 'Expenses', model: 'hr.expense', date: 'date', measure: 'total_amount', kind: 'money', inverse: true },
        { label: 'Expense lines', model: 'hr.expense', date: 'date', kind: 'count' },
        { label: 'Average expense', kind: 'ratio', of: [0, 1], money: true, inverse: true }],
      sc: { head: 0, subs: [1, 2] }, cov: 'hr.expense',
      trend: { title: 'Expenses — last 12 months', model: 'hr.expense', groupby: 'date:month', measure: 'total_amount', type: 'bar', last: 12 },
      charts: [P.hr_expense.charts[1], P.hr_expense.charts[0]],
      alerts: [{ label: 'Expenses awaiting approval', model: 'hr.expense', domain: [['state', 'in', ['reported', 'submitted']]], measure: 'total_amount', tone: 'warn', hint: 'Approve or refuse the claims' }] },
    helpdesk: { title: 'Helpdesk',
      kpis: [
        { label: 'New tickets', model: 'helpdesk.ticket', date: 'create_date', kind: 'count', inverse: true },
        { label: 'Open tickets', model: 'helpdesk.ticket', domain: [['stage_id.fold', '=', false]], kind: 'count', inverse: true, sub: 'Not yet resolved' },
        { label: 'Tickets closed', model: 'helpdesk.ticket', domain: [['close_date', '!=', false]], date: 'close_date', kind: 'count' }],
      sc: { head: 0, subs: [1, 2] }, cov: 'helpdesk.ticket',
      trend: { title: 'Tickets created — last 12 months', model: 'helpdesk.ticket', groupby: 'create_date:month', type: 'line', last: 12 },
      charts: [P.helpdesk.charts[0], P.helpdesk.charts[2]],
      alerts: [{ label: 'High priority open tickets', model: 'helpdesk.ticket', domain: [['stage_id.fold', '=', false], ['priority', 'in', ['2', '3']]], tone: 'bad', hint: 'Customers are waiting' }] },
    fleet: { title: 'Fleet',
      kpis: [
        { label: 'Vehicles', model: 'fleet.vehicle', kind: 'count', sub: 'In the fleet' },
        { label: 'Service entries', model: 'fleet.vehicle.log.services', date: 'date', kind: 'count' },
        { label: 'Service cost', model: 'fleet.vehicle.log.services', date: 'date', measure: 'amount', kind: 'money', inverse: true }],
      sc: { head: 0, subs: [1, 2] }, cov: 'fleet.vehicle',
      trend: { title: 'Service cost — last 12 months', model: 'fleet.vehicle.log.services', groupby: 'date:month', measure: 'amount', type: 'bar', last: 12 },
      charts: [P.fleet.charts[0], P.fleet.charts[1]], alerts: [] }
  };
  Object.keys(X).forEach(function (k) { X[k].key = k; });   /* every spec knows its own key (icons, colours, drill titles) */

  /* Cross-module financial position for CFO / CEO (needs the Accounting app). */
  var INV = [['move_type', '=', 'out_invoice'], ['state', '=', 'posted']];
  var FIN = { title: 'Financial position', kpis: [
    { label: 'Invoiced (revenue)', model: 'account.move', domain: INV, date: 'invoice_date', measure: 'amount_total', kind: 'money' },
    { label: 'Vendor bills (cost)', model: 'account.move', domain: [['move_type', '=', 'in_invoice'], ['state', '=', 'posted']], date: 'invoice_date', measure: 'amount_total', kind: 'money', inverse: true },
    { label: 'Net trading position', kind: 'diff', of: [0, 1], money: true, sub: 'Invoiced minus vendor bills' },
    { label: 'Receivable outstanding', model: 'account.move', domain: UNPAID, measure: 'amount_residual', kind: 'money', inverse: true, sub: 'Unpaid customer invoices' },
    { label: 'Overdue receivable', model: 'account.move', domain: UNPAID.concat([['invoice_date_due', '<', '$now']]), measure: 'amount_residual', kind: 'money', inverse: true, sub: 'Past due date' },
    { label: 'Overdue share', kind: 'pct', of: [4, 3], inverse: true, sub: 'Overdue as % of receivable' }] };
  var XORDER = ['sale', 'crm', 'point_of_sale', 'account', 'hr_expense', 'purchase', 'stock', 'mrp', 'project', 'helpdesk', 'fleet', 'hr', 'hr_holidays'];
  function exec(mod) { return X[mod] || X[ALIAS[mod]] || null; }
  function ago(d) { return new Date(Date.now() - d * 864e5).toISOString().slice(0, 19).replace('T', ' '); }

  function get(mod) { return P[mod] || P[ALIAS[mod]] || null; }

  /* Installed apps that have an executive spec, in board order: [{ key, spec, tech }] (one entry per spec). */
  function installed(mods) {
    var names = (mods || []).map(function (m) { return m && m.technicalName; }).filter(Boolean), out = [];
    XORDER.forEach(function (key) {
      var spec = X[key], tech = null;
      names.forEach(function (n) { if (!tech && exec(n) === spec) tech = n; });
      if (spec && tech) out.push({ key: key, spec: spec, tech: tech });
    });
    return out;
  }

  function tokens(domain) {
    var now = Date.now(), f = function (d) { return new Date(now - d * 864e5).toISOString().slice(0, 19).replace('T', ' '); };
    var map = { $now: f(0), $d7: f(7), $d30: f(30), $d90: f(90), $d365: f(365) };
    return (domain || []).map(function (t) { return Array.isArray(t) ? [t[0], t[1], typeof t[2] === 'string' && map[t[2]] ? map[t[2]] : t[2]] : t; });
  }

  /* Generic profile from a model's own fields. */
  function build(model, fields) {
    var has = function (n) { return !!fields[n]; };
    var pick = function (list, skip) { for (var i = 0; i < list.length; i++) if (has(list[i]) && list[i] !== skip) return list[i]; return null; };
    var money = pick(['amount_total', 'amount_untaxed', 'price_total', 'expected_revenue', 'total_amount', 'amount', 'list_price', 'standard_price']);
    var kpis = [{ label: 'Total records', model: model, kind: 'count', sub: 'All records you can access' }];
    if (has('create_date')) kpis.push({ label: 'Created (30 days)', model: model, domain: [['create_date', '>=', '$d30']], kind: 'count', sub: 'New in the last 30 days' });
    if (money) kpis.push({ label: 'Sum of ' + (fields[money].string || money), model: model, measure: money, kind: fields[money].type === 'monetary' ? 'money' : 'num', sub: 'Across all records' });
    var status = pick(['state', 'stage_id', 'status', 'type', 'move_type', 'priority']) || Object.keys(fields).filter(function (k) { return fields[k].type === 'selection'; })[0] || null;
    var who = pick(['user_id', 'partner_id', 'team_id', 'department_id', 'categ_id', 'company_id', 'stage_id'], status);
    var charts = [];
    if (status) charts.push({ title: (fields[status].string || status) + ' split', model: model, groupby: status, type: 'doughnut' });
    if (who) charts.push({ title: 'By ' + (fields[who].string || who), model: model, groupby: who, measure: money, type: 'hbar', limit: 8 });
    if (has('create_date')) charts.push({ title: 'Created per month', model: model, groupby: 'create_date:month', type: 'line', last: 12 });
    return { title: model, generic: true, models: [model], kpis: kpis, charts: charts };
  }

  window.DVOdooProfiles = { fin: FIN, exec: exec, order: XORDER, installed: installed, ago: ago, get: get, build: build, tokens: tokens, has: function (m) { return !!get(m); } };
})();
