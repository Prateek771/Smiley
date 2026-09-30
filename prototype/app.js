(() => {
  'use strict';

  const demo = window.SAAVANTUS_DEMO;
  const key = 'saavantus-claims-prototype-v2';
  const names = {
    overview: 'Overview', queue: 'Claims work queue', case: 'Case workspace', intake: 'Patient & policy',
    coverage: 'Coverage & pre-auth', treatment: 'Treatment & encounter', documents: 'Documents', discharge: 'Discharge review',
    payer: 'Payer work', settlement: 'Settlement', agent: 'Agent activity', reports: 'Reports', settings: 'Settings'
  };
  const navGroups = [
    { label: 'WORKSPACE', items: [
      ['overview', 'grid', 'Overview'], ['queue', 'list', 'Claims work queue'], ['intake', 'user', 'Patient & policy'],
      ['coverage', 'shield', 'Coverage & pre-auth'], ['treatment', 'heart', 'Treatment & encounter'], ['documents', 'file', 'Documents'],
      ['discharge', 'heart', 'Discharge review'], ['payer', 'send', 'Payer work'], ['settlement', 'wallet', 'Settlement']
    ] },
    { label: 'INSIGHTS & CONTROL', items: [
      ['agent', 'spark', 'Agent activity'], ['reports', 'chart', 'Reports'], ['settings', 'settings', 'Settings']
    ] }
  ];
  const roleOptions = ['Desk', 'Billing', 'Finance', 'Admin'];
  const tourSteps = [
    { view: 'case', title: 'One case workspace', note: 'Start with the case owner, next action, timeline and eleven-stage journey.' },
    { view: 'intake', title: 'Register patient and policy', note: 'See how the insurance desk links identity, cover type, insurer and TPA.' },
    { view: 'coverage', title: 'Check cover and pre-authorisation', note: 'Staff review policy evidence; only the payer can issue an authorisation.' },
    { view: 'treatment', title: 'Follow the hospital encounter', note: 'Clinical and billing teams provide treatment and final-bill facts for the claim.' },
    { view: 'documents', title: 'Review the evidence', note: 'The assistant proposes source-linked fields; staff check and correct them.' },
    { view: 'discharge', title: 'Compare the money states', note: 'Keep the estimate, payer decision and billing-confirmed patient amount distinct.' },
    { view: 'payer', title: 'Handle submission and queries', note: 'Track the external acknowledgement, query loop and actual payer response.' },
    { view: 'settlement', title: 'Reconcile receipts', note: 'Finance matches money received later and follows up any remaining balance.' }
  ];
  const taskNotes = {
    intake: 'Confirm patient and policy information.',
    eligibility: 'Verify cover details before requesting authorisation.',
    preauth: 'Record the payer’s pre-authorisation reference.',
    treatment: 'Add the final bill when treatment is complete.',
    prep: 'Add missing evidence, review extracted fields, and assess the bill.',
    query: 'Review and answer the insurer’s query with supporting evidence.',
    decision: 'Ask Billing to resolve the final-authorisation difference.',
    settlement: 'Match insurer remittance and patient receipts separately.',
    closed: 'All demo balances have been recorded.'
  };

  function load() {
    try {
      const parsed = JSON.parse(localStorage.getItem(key));
      if (parsed && parsed.version === 2 && Array.isArray(parsed.cases) && parsed.cases.length &&
          parsed.cases.every(c => typeof c.id === 'string' && typeof c.patient === 'string')) {
        if (!names[parsed.view]) parsed.view = 'overview';
        if (!roleOptions.includes(parsed.role)) parsed.role = 'Desk';
        return parsed;
      }
    } catch (_) { /* Reset a damaged browser copy to the fictional starting state. */ }
    return demo.initialState();
  }
  let state = load();
  let caseTab = 'summary';
  let toastTimer;
  const $ = (selector) => document.querySelector(selector);
  const mobileNav = window.matchMedia('(max-width: 720px)');
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const icon = (name, cls = '') => `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  const money = (value) => '₹' + Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  const deductions = (bill) => {
    const nonPayable = Math.min(5000, Math.max(0, bill));
    return { nonPayable, adjustment: Math.min(10000, Math.max(0, bill - nonPayable)) };
  };
  const financeOpen = (c) => c.billingConfirmed && (c.payerPaid < c.finalAuth || c.patientPaid < c.patientShare);
  const save = () => { try { localStorage.setItem(key, JSON.stringify(state)); } catch (_) { toast('Browser storage is unavailable; changes will last until this tab closes.'); } };
  const current = () => state.cases.find(c => c.id === state.selected) || state.cases[0];
  const stamp = () => new Date().toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
  function addEvent(c, title, detail, actor = state.role) {
    c.events.unshift({ time: stamp(), title, detail, actor });
    c.events = c.events.slice(0, 28);
  }
  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 4200);
  }
  function allowed(role) {
    if (state.role === 'Admin' || state.role === role) return true;
    toast(`Switch the role selector to ${role} to demonstrate this handoff.`);
    return false;
  }
  function syncMobileNav() {
    const sidebar = $('#sidebar');
    const open = mobileNav.matches && sidebar.classList.contains('open');
    sidebar.inert = mobileNav.matches && !open;
    sidebar.setAttribute('aria-hidden', String(mobileNav.matches && !open));
    const toggle = $('#mobile-menu');
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    }
  }
  function setMobileNav(open, restoreFocus = false) {
    const sidebar = $('#sidebar');
    if (!open && sidebar.contains(document.activeElement)) {
      (restoreFocus ? $('#mobile-menu') : $('#main'))?.focus({ preventScroll: true });
    }
    sidebar.classList.toggle('open', mobileNav.matches && open);
    syncMobileNav();
    if (mobileNav.matches && open) sidebar.querySelector('[data-action="close-menu"]')?.focus();
    else if (restoreFocus) $('#mobile-menu')?.focus();
  }
  function show(view) {
    state.view = names[view] ? view : 'overview';
    if (state.tour) {
      const visibleStop = state.view === 'case' && caseTab !== 'summary' ? caseTab : state.view;
      const stop = tourSteps.findIndex(item => item.view === visibleStop);
      if (stop >= 0) state.tourStep = stop;
    }
    setMobileNav(false);
    save(); render();
    $('#main').focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function phase(c) {
    if (c.rejected) return 'Rejected · insurer decision';
    if (c.billingConfirmed && c.finalAuth !== null && c.payerPaid >= c.finalAuth && c.patientPaid >= c.patientShare && c.disputed > 0) return 'Receipts matched · dispute open';
    if (c.billingConfirmed && c.finalAuth !== null && c.payerPaid >= c.finalAuth && c.patientPaid >= c.patientShare) return 'Settled';
    if (c.billingConfirmed) return 'Settlement pending';
    if (c.finalAuth !== null) return 'Billing review';
    if (c.queryOpen) return 'Insurer query';
    if (c.submitted) return 'Awaiting payer';
    if (c.assessed) return 'Ready to submit';
    if (c.totalBill > 0 && c.preauthRef) return 'Claim preparation';
    if (c.preauthRef) return 'Treatment';
    if (c.eligibility === 'Verified by desk') return 'Pre-authorisation';
    return 'Eligibility check';
  }
  function phaseTone(c) {
    if (c.rejected || c.queryOpen) return 'bad';
    if (c.billingConfirmed || c.finalAuth !== null || c.assessed) return 'good';
    if (c.submitted) return 'info';
    return 'warn';
  }
  function step(c) {
    if (c.billingConfirmed) return 10;
    if (c.finalAuth !== null || c.rejected) return 9;
    if (c.submitted || (c.totalBill > 0 && c.preauthRef)) return 8;
    if (c.preauthRef) return 7;
    if (c.eligibility === 'Verified by desk') return 6;
    return 5;
  }
  function next(c) {
    if (c.rejected) return { title: 'Review rejection with the insurer', note: 'The payer decision is external. This demo does not dispute or reverse it automatically.', view: 'payer' };
    if (c.billingConfirmed) {
      const gap = Math.max(0, (c.finalAuth || 0) - c.payerPaid);
      const patientGap = Math.max(0, c.patientShare - c.patientPaid);
      if (gap) return { title: `Match ${money(gap)} insurer balance`, note: 'Finance records actual receipts and investigates the short payment.', view: 'settlement' };
      if (patientGap) return { title: `Record ${money(patientGap)} patient balance`, note: 'Finance checks the patient receipt separately from insurer remittance.', view: 'settlement' };
      return { title: c.disputed ? 'Follow up the disputed deduction' : 'Review settlement summary', note: 'Insurer and patient receipts are matched; any payer dispute remains separate.', view: 'settlement' };
    }
    if (c.finalAuth !== null) return { title: 'Confirm the patient amount', note: 'Billing allocates the difference between patient, hospital concession, and dispute.', view: 'discharge' };
    if (c.queryOpen) return { title: 'Answer the insurer query', note: c.queryText, view: 'payer' };
    if (c.submitted) return { title: 'Track the payer response', note: 'The case is submitted. Record the actual insurer response when received.', view: 'payer' };
    if (c.assessed) return { title: 'Submit the reviewed claim pack', note: 'Desk sends the packet through an authorised channel and records the acknowledgement.', view: 'payer' };
    if (c.totalBill > 0 && c.preauthRef) return { title: 'Complete the discharge evidence', note: 'Confirm document completeness and check extracted facts before the estimate.', view: 'documents' };
    if (c.preauthRef && !c.totalBill) return { title: 'Follow treatment and record the final bill', note: 'Clinical staff confirm care details; Billing supplies final charges before the claim assessment.', view: 'treatment' };
    if (!c.preauthRef) return { title: 'Verify coverage and request pre-auth', note: 'The desk records a real payer reference before treatment begins.', view: 'coverage' };
    return { title: 'Check the patient and policy', note: 'Confirm the intake information with the hospital desk.', view: 'intake' };
  }
  function roleChip(role) { return `<span class="pill outline">${esc(role)} action</span>`; }
  function pill(text, tone) { return `<span class="pill ${tone}">${esc(text)}</span>`; }
  function titleBlock(eyebrow, title, description, actions = '') {
    return `<div class="section-head"><div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1>${description ? `<p>${description}</p>` : ''}</div>${actions ? `<div class="section-actions">${actions}</div>` : ''}</div>`;
  }
  function tourBanner() {
    if (!state.tour) return '';
    const index = Math.max(0, Math.min(tourSteps.length - 1, Number(state.tourStep) || 0));
    const stop = tourSteps[index];
    return `<section class="tour-guide space-top" aria-label="Guided walkthrough"><div><span class="eyebrow">GUIDED WALKTHROUGH · ${index + 1} OF ${tourSteps.length}</span><strong>${esc(stop.title)}</strong><p>${esc(stop.note)}</p></div><div class="tour-controls"><button class="btn" data-action="tour-prev" ${index === 0 ? 'disabled' : ''}>Previous</button><button class="btn btn-primary" data-action="tour-next">${index === tourSteps.length - 1 ? 'Finish tour' : 'Next stop'} ${icon('arrow','small')}</button><button class="btn btn-text" data-action="tour-exit">Exit</button></div></section>`;
  }
  function wrap(content) { return `<div class="main-wrap"><div class="demo-ribbon">${icon('spark','small')} <span><strong>Interactive concept · fictional data.</strong> Actions change this browser’s sample cases only; no AI model, hospital database, or insurer is connected.</span><span class="ribbon-right">Local demo / 2026</span></div>${tourBanner()}${content}</div>`; }
  function card(title, subtitle, body, right = '') {
    return `<section class="card"><div class="card-head"><div><h3>${title}</h3>${subtitle ? `<p>${subtitle}</p>` : ''}</div>${right}</div><div class="card-body">${body}</div></section>`;
  }
  function metric(label, value, note, iconName) {
    return `<div class="card kpi"><span class="kpi-label">${label}</span><strong class="amount">${value}</strong><small>${note}</small>${icon(iconName,'kpi-icon')}</div>`;
  }
  function row(label, value, cls = '') { return `<div class="metric-row ${cls}"><span>${label}</span><strong class="amount">${value}</strong></div>`; }
  function empty(title, note) { return `<div class="empty">${icon('file')}<strong>${title}</strong><p>${note}</p></div>`; }

  function sidebar() {
    const queryCount = state.cases.filter(c => c.queryOpen).length;
    $('#sidebar').innerHTML = `<button class="mobile-close" data-action="close-menu" aria-label="Close navigation">×</button><a href="#" class="brand" data-view="overview"><span class="brand-mark" aria-hidden="true">★</span><span><strong>SAAVANTUS</strong><small>CLAIMS DESK</small></span></a>` +
      navGroups.map(g => `<div class="nav-label">${g.label}</div><nav aria-label="${g.label}">${g.items.map(([view, symbol, label]) => `<button class="nav-item ${state.view === view || (state.view === 'case' && view === 'queue') ? 'active' : ''}" data-view="${view}" ${state.view === view ? 'aria-current="page"' : ''}>${icon(symbol)}<span>${label}</span>${view === 'payer' && queryCount ? `<span class="nav-count">${queryCount}</span>` : ''}</button>`).join('')}</nav>`).join('') +
      `<div class="sidebar-foot"><div class="side-hospital"><span class="side-avatar">SC</span><span><strong>Saavantus Central</strong><small>Hospital workspace · Pune</small></span></div><p class="side-foot-note">A design prototype for the hospital insurance desk.</p></div>`;
  }
  function topbar() {
    $('#topbar').innerHTML = `<div class="top-left"><button id="mobile-menu" class="mobile-toggle" data-action="menu" aria-controls="sidebar" aria-expanded="false" aria-label="Open navigation">${icon('menu')}</button><span class="crumb-parent">Hospital workspace</span><span class="breadcrumb-sep">/</span><strong>${esc(names[state.view])}</strong></div><div class="top-right"><label class="top-search">${icon('search','small')}<input id="global-search" type="search" placeholder="Search case or patient" aria-label="Search cases" value="${esc(state.search || '')}"></label><select id="role-select" class="role-select" aria-label="Preview staff role">${roleOptions.map(role => `<option ${state.role === role ? 'selected' : ''}>${role}</option>`).join('')}</select><span class="top-avatar" title="Fictional staff preview">${state.role.slice(0,2).toUpperCase()}</span></div>`;
  }
  function journey(c) {
    const at = step(c);
    return `<section class="card space-top" aria-label="Eleven-stage insurance journey"><div class="card-head"><div><h3>Insurance journey</h3><p>The original 11 stages, with a query loop when the payer requests more evidence.</p></div>${pill(`${at + 1} / 11`, 'info')}</div><div class="story">${demo.workflow.map((s, i) => `<button class="story-step ${i < at ? 'done' : i === at ? 'current' : ''}" data-view="${s.page}" title="Open ${esc(s.name)} stage"><span>${i < at ? icon('check','small') : i + 1}</span><strong>${esc(s.name)}</strong></button>`).join('')}</div></section>`;
  }
  function caseHeader(c, eyebrow, heading, note) {
    return titleBlock(eyebrow, heading, note, `<button class="btn" data-view="queue">${icon('list')} All cases</button><button class="btn btn-dark" data-view="case">${icon('file')} Open case</button>`)
      + `<div class="card case-summary"><div class="identity-row"><span class="patient-avatar">${esc(c.initials)}</span><div><span class="eyebrow">${esc(c.id)} · ${esc(c.mrn)}</span><h2>${esc(c.patient)}</h2><p>${esc(c.insurer)} · ${esc(c.branch)} · Owner ${esc(c.owner)}</p></div></div><div class="flex-start">${pill(phase(c),phaseTone(c))}${pill(c.priority, c.priority === 'Urgent' ? 'bad' : c.priority === 'High' ? 'warn' : 'info')}</div></div>`;
  }
  function timeline(c, limit = 5) {
    return `<div class="timeline">${c.events.slice(0,limit).map((e,i) => `<div class="event ${i===0?'current':''}"><span class="event-dot"></span><div class="event-body"><strong>${esc(e.title)}</strong><p>${esc(e.detail)}</p><small>${esc(e.time)} · ${esc(e.actor)}</small></div></div>`).join('')}</div>`;
  }
  function caseTable(cases, limit = 0) {
    const rows = limit ? cases.slice(0, limit) : cases;
    return rows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Patient / case</th><th>Payer</th><th>Status</th><th>Next owner</th><th>Due</th><th></th></tr></thead><tbody>${rows.map(c => `<tr><td><button class="case-link" data-action="select-case" data-id="${esc(c.id)}">${esc(c.patient)}</button><small>${esc(c.id)} · ${esc(c.mrn)}</small></td><td>${esc(c.insurer)}<small>${esc(c.tpa)}</small></td><td>${pill(phase(c),phaseTone(c))}</td><td>${esc(c.owner)}</td><td>${esc(c.due)}</td><td><button class="btn btn-text" data-action="select-case" data-id="${esc(c.id)}">Open ${icon('arrow','small')}</button></td></tr>`).join('')}</tbody></table></div>` : empty('No matching cases', 'Clear the search or choose another filter.');
  }
  function caseTabs() {
    const tabs = [['summary','Overview'],['coverage','Coverage'],['treatment','Treatment'],['documents','Documents'],['discharge','Bill & assessment'],['payer','Payer work'],['settlement','Payments'],['activity','Activity']];
    return `<div class="page-tabs" role="tablist" aria-label="Case detail views">${tabs.map(([tab,label]) => `<button id="case-tab-${tab}" class="page-tab ${caseTab===tab?'active':''}" role="tab" aria-controls="case-panel" aria-selected="${caseTab===tab}" tabindex="${caseTab===tab?'0':'-1'}" data-action="case-tab" data-tab="${tab}">${label}</button>`).join('')}</div>`;
  }

  function overview() {
    const c = current(), n = next(c);
    const queries = state.cases.filter(x=>x.queryOpen).length;
    const payerWaiting = state.cases.filter(x=>x.submitted && x.finalAuth === null && !x.queryOpen && !x.rejected).length;
    const unpaid = state.cases.filter(financeOpen).length;
    return wrap(`<section class="hero"><div><span class="eyebrow">INSURANCE DESK · TODAY</span><h1>One clear view of every claim, question, and next action.</h1><p>Walk through a fictional case to see how staff, AI assistance, the insurer and finance hand work to one another.</p><div class="hero-actions"><button class="btn btn-warm" data-action="guided">${icon('arrow')} Start guided walkthrough</button><button class="btn btn-quiet" data-view="queue">Open work queue</button></div></div><div class="hero-metric"><small>SELECTED CASE</small><strong>${esc(c.id)}</strong><span class="pill dark">${esc(phase(c))}</span><small style="display:block;margin-top:13px">Next due ${esc(c.due)}</small></div></section>
      <div class="grid grid-4 space-top">${metric('Open demo cases',state.cases.length,'Across the fictional desk','list')}${metric('Insurer queries',queries,'Need evidence or a response','alert')}${metric('Awaiting payer',payerWaiting,'Submitted, response pending','clock')}${metric('Payment gaps',unpaid,'Insurer or patient balance open','wallet')}</div>
      <div class="grid grid-main space-top"><div class="stack">${card('Your work queue','Prioritised by what needs action next',caseTable(state.cases,5),`<button class="btn btn-text" data-view="queue">View all ${icon('arrow','small')}</button>`)}${journey(c)}</div><div class="stack">${card('Next action · '+esc(c.id),'Owner '+esc(c.owner)+' · due '+esc(c.due),`<div class="next-box"><span class="eyebrow">WHAT HAPPENS NEXT</span><b>${esc(n.title)}</b><p>${esc(n.note)}</p><button class="btn btn-primary" data-view="${n.view}">Go to task ${icon('arrow','small')}</button></div>`)}${card('Agent & staff handoffs','A preview of controlled assistance',`<div class="ai-item"><strong>Document agent</strong><p>Reads sample documents and offers source-linked fields for staff review.</p>${pill('Proposes only','info')}</div><div class="ai-item"><strong>Claims rules</strong><p>Produces a provisional estimate from confirmed fields. It does not issue insurer approval.</p>${pill('Fixed calculation','good')}</div><div class="ai-item"><strong>Hospital staff</strong><p>Confirm exceptions, the patient amount, and actual payment entries.</p>${pill('Human sign-off','warn')}</div>`)}</div></div>`);
  }
  function queue() {
    const q = (state.search||'').toLowerCase();
    const list = state.cases.filter(c => (state.filter === 'All' || (state.filter === 'Queries' && c.queryOpen) || (state.filter === 'Decisions' && c.finalAuth !== null && !c.billingConfirmed) || (state.filter === 'Payments' && financeOpen(c))) && [c.id,c.patient,c.mrn,c.insurer].join(' ').toLowerCase().includes(q));
    return wrap(titleBlock('DESK WORKLIST','Claims work queue','Five fictional cases show the clean, missing-document, query, decision and partial-payment paths.',`<button class="btn btn-primary" data-view="intake">${icon('plus')} Create demo case</button>`) + `
      <div class="grid grid-4">${metric('All cases',state.cases.length,'Fictional records','list')}${metric('Need a query reply',state.cases.filter(c=>c.queryOpen).length,'Insurer waiting','alert')}${metric('Billing sign-off',state.cases.filter(c=>c.finalAuth!==null&&!c.billingConfirmed).length,'Actual decision received','heart')}${metric('Finance follow-up',state.cases.filter(financeOpen).length,'Cash still due','wallet')}</div>
      <section class="card space-top"><div class="card-head"><div><h3>Cases</h3><p>Select a patient to open the single-case workspace.</p></div><div class="flex-start"><label class="field-label" for="queue-filter">Show</label><select id="queue-filter" class="role-select"><option ${state.filter==='All'?'selected':''}>All</option><option ${state.filter==='Queries'?'selected':''}>Queries</option><option ${state.filter==='Decisions'?'selected':''}>Decisions</option><option ${state.filter==='Payments'?'selected':''}>Payments</option></select></div></div>${caseTable(list)}<div class="table-footer">Showing ${list.length} of ${state.cases.length} fictional cases · role preview: ${esc(state.role)}</div></section>`);
  }
  function intake() {
    const c = current();
    return wrap(titleBlock('START OF THE JOURNEY','Patient & policy','This is the intake desk’s first screen. It links a patient, insurer, TPA and policy before authorisation work begins.',`<button class="btn" data-view="case">Open selected case</button>`)
      + `<div class="grid grid-main"><div class="stack">${card('Register a fictional case','Local demo only · do not enter real patient information',`<form id="new-case-form"><div class="field-grid"><div class="field"><label for="patient-name">Patient name</label><input id="patient-name" name="patient" required placeholder="e.g. Tara Gupta" maxlength="70"></div><div class="field"><label for="patient-mrn">Hospital ID / MRN</label><input id="patient-mrn" name="mrn" required placeholder="e.g. MRN-00910" maxlength="24"></div><div class="field"><label for="insurer">Insurance company</label><select id="insurer" name="insurer"><option>Apex Health</option><option>Northstar Care</option><option>Everwell Insurance</option></select></div><div class="field"><label for="category">Insurance type</label><select id="category" name="category"><option>Private</option><option>Government scheme</option><option>Corporate</option></select></div><div class="field"><label for="policy">Policy number</label><input id="policy" name="policy" required placeholder="Sample policy number" maxlength="36"></div><div class="field"><label for="patient-bill">Illustrative final bill (₹)</label><input id="patient-bill" name="bill" type="number" min="0" max="10000000" value="0"></div></div><div class="form-actions"><button class="btn btn-primary" type="submit">${icon('plus')} Add to work queue</button><span class="role-note">Desk action · browser-only sample data</span></div></form>`)}${card('Selected case · '+esc(c.id),'Patient and payer details',`<div class="grid grid-2"><div>${row('Patient',esc(c.patient))}${row('Hospital ID',esc(c.mrn))}${row('Admission',esc(c.admitted))}${row('Discharge',esc(c.discharge))}</div><div>${row('Insurer',esc(c.insurer))}${row('Insurance type',esc(c.category))}${row('TPA',esc(c.tpa))}${row('Policy',esc(c.policyNo))}</div></div>`)}</div><div class="stack">${card('Why this information matters','Source: registration and policy evidence',`<div class="flow-steps"><div class="flow-step active"><b>01 · Patient</b><p>Match the hospital ID.</p></div><div class="flow-step"><b>02 · Type</b><p>Private, corporate or scheme.</p></div><div class="flow-step"><b>03 · Insurer</b><p>Who makes the decision?</p></div><div class="flow-step"><b>04 · TPA</b><p>Who handles this claim?</p></div></div><div class="callout info space-top">The application would validate that the selected patient, policy, encounter and hospital belong together. This prototype demonstrates the screen and handoff only.</div>`)}${card('Next handoff','Insurance desk → coverage check',`<p class="muted small">After intake, staff verify policy dates, member details, limits and the applicable pre-authorisation route.</p><button class="btn btn-primary space-top" data-view="coverage">Open coverage ${icon('arrow','small')}</button>`)}</div></div>`);
  }
  function coverage(c) {
    const eligible = c.eligibility === 'Verified by desk';
    return `<div class="grid grid-main"><div class="stack">${card('Policy & membership','Evidence from the sample policy / e-card',`<div class="grid grid-2"><div>${row('Insurer',esc(c.insurer))}${row('Policy number',esc(c.policyNo))}${row('Coverage type',esc(c.category))}</div><div>${row('Sum insured',money(c.sumInsured))}${row('Illustrative room cap',money(c.roomCap))}${row('TPA',esc(c.tpa))}</div></div><div class="callout info space-top">This is a fictional policy preview. Real eligibility depends on current payer confirmation and approved plan terms.</div>`)}${card('Eligibility check','Desk verifies member and benefit details',`<div class="flex-between"><div><strong>${eligible?'Coverage reviewed':'Review pending'}</strong><p class="muted small">${eligible?'The desk marked the sample evidence reviewed.':'Check the policy details before moving to pre-authorisation.'}</p></div>${pill(eligible?'Reviewed':'Needs review',eligible?'good':'warn')}</div><div class="form-actions"><button class="btn btn-primary" data-action="verify-eligibility" ${eligible?'disabled':''}>${icon('shield')} Verify sample eligibility</button>${roleChip('Desk')}</div>`)}${card('Pre-authorisation','Actual payer response is a separate record',`<div class="grid grid-2">${row('Request type','Initial cashless')}${row('Payer reference',esc(c.preauthRef||'Not recorded'))}${row('Authorised amount',c.preauthRef?money(c.preauthAmount):'—')}${row('Decision owner','Insurer / TPA')}</div><div class="form-actions"><button class="btn btn-primary" data-action="record-preauth" ${c.preauthRef?'disabled':''}>${icon('plus')} Record simulated payer pre-auth</button>${roleChip('Desk')}</div><p class="role-note space-top-sm">This button records a fictional external response. The assistant cannot grant authorisation.</p>`)}</div><div class="stack">${card('Coverage sequence','What the desk and payer each do',`<div class="timeline"><div class="event current"><span class="event-dot"></span><div class="event-body"><strong>Staff checks policy</strong><p>Identity, dates, cover and limits are verified.</p></div></div><div class="event"><span class="event-dot"></span><div class="event-body"><strong>Desk requests pre-auth</strong><p>Documents and treatment details go through an authorised channel.</p></div></div><div class="event"><span class="event-dot"></span><div class="event-body"><strong>Payer responds</strong><p>Only the insurer / TPA can approve, query or decline.</p></div></div></div>`)}${card('What the assistant can do','Agent boundary',`<div class="ai-item"><strong>Explain the policy</strong><p>Highlight relevant terms with evidence for staff review.</p></div><div class="ai-item"><strong>Prepare the request</strong><p>Collect the required data and flag missing documents.</p></div><div class="callout warn space-top">The AI does not decide that a patient is eligible. Verified eligibility is separate from an insurer’s authorisation.</div>`)}</div></div>`;
  }
  function treatment(c) {
    const encounter = demo.encounterFor(c);
    const billReady = c.totalBill > 0;
    return `<div class="grid grid-main"><div class="stack">${card('Hospital encounter','Read-only fictional clinical handoff',`<div class="grid grid-2"><div>${row('Hospital ID',esc(c.mrn))}${row('Admission',esc(c.admitted))}${row('Discharge',esc(c.discharge))}${row('Care setting',esc(encounter.setting))}</div><div>${row('Clinical unit',esc(encounter.unit))}${row('Service summary',esc(encounter.services))}${row('Pre-auth reference',esc(c.preauthRef||'Pending'))}${row('Care status',billReady?'Final bill available':'Final bill pending')}</div></div><div class="callout info space-top">These are illustrative encounter labels. Clinical staff remain responsible for treatment facts and the signed discharge summary.</div>`)}${card('Treatment → claim handoff','Billing and the desk receive different evidence',`${row('Final hospital bill',billReady?money(c.totalBill):'Pending from Billing')}${row('Itemised bill document',c.docs.bill?'Sample on file':'Not on file')}${row('Discharge summary',c.docs.discharge?'Sample on file':'Missing')}${row('Pre-authorisation',c.preauthRef?'Recorded from payer':'Awaiting payer')}<div class="form-actions"><button class="btn btn-primary" data-view="documents">Review documents ${icon('arrow','small')}</button><button class="btn" data-view="discharge">Open bill & assessment</button></div>`)} </div><div class="stack">${card('Who confirms each fact','A clear handoff before the claim can be assessed',`<div class="ai-item"><strong>Clinical team</strong><p>Confirms the treatment and discharge summary. The agent may read it, but cannot invent clinical facts.</p></div><div class="ai-item"><strong>Billing team</strong><p>Supplies the final itemised bill and corrects hospital charges.</p></div><div class="ai-item"><strong>Insurance desk</strong><p>Checks that the payer authorisation and claim documents refer to this encounter.</p></div>`)}${card('Next step','Evidence collection',`<p class="muted small">The desk checks the bill and discharge documents. The assistant then proposes fields for staff review before fixed rules calculate a provisional amount.</p><div class="callout warn space-top">Treatment completion does not equal claim approval. Only an actual insurer / TPA response supplies that decision.</div>`)}</div></div>`;
  }
  function documents(c) {
    const missing = demo.documentTypes.filter(d=>!c.docs[d.key]);
    return `<div class="grid grid-main"><div class="stack">${card('Claim document checklist',`${missing.length} missing · documents shown are fictional labels, not actual files`,`${demo.documentTypes.map(d=>`<div class="doc-row"><span class="doc-icon">${icon('file')}</span><div><strong>${esc(d.name)}</strong><p>${esc(d.note)} · ${c.docs[d.key]?'Sample on file':'Needed before assessment'}</p></div>${pill(c.docs[d.key]?'On file':'Missing',c.docs[d.key]?'good':'bad')}</div>`).join('')}<div class="form-actions"><button class="btn btn-primary" data-action="attach-document" ${c.docs.discharge?'disabled':''}>${icon('plus')} Attach sample discharge summary</button>${roleChip('Desk')}</div>`)}${card('Review extracted facts','AI suggestion → staff confirmation',`<div class="callout ${c.agentRun?'info':'warn'}">${c.agentRun?'Sample extraction ready. Compare every field to its cited document before confirming.':'Run the sample document assistant to see proposed fields and evidence.'}</div><div class="form-actions"><button class="btn" data-action="run-agent" ${c.agentRun?'disabled':''}>${icon('spark')} Run document assistant</button>${pill(c.factVerified?'Facts confirmed':c.agentRun?'Awaiting review':'Not run',c.factVerified?'good':'warn')}</div>${c.agentRun?`<form id="facts-form" class="space-top"><div class="field-grid"><div class="field"><label for="fact-policy">Policy number · source: policy / e-card</label><input id="fact-policy" name="policy" value="${esc(c.extractedPolicy)}" maxlength="36" required><span class="field-hint">Sample confidence: 94%. Correct this field if the source differs.</span></div><div class="field"><label for="fact-bill">Final bill · source: itemised bill</label><input id="fact-bill" value="${money(c.totalBill)}" readonly><span class="field-hint">Billing remains the source of truth for charges.</span></div></div><div class="form-actions"><button class="btn btn-primary" type="submit">${icon('check')} Confirm reviewed facts</button>${roleChip('Desk')}</div></form>`:''}`)}</div><div class="stack">${card('Agent result','Source-linked suggestion, never an insurer decision',`<div class="ai-head"><span class="ai-badge">${icon('spark')}</span><div><strong>Document assistant</strong><p class="muted tiny">${c.agentRun?'Sample run completed':'Ready to analyse sample labels'}</p></div></div>${c.agentRun?`<div class="ai-item"><strong>Policy number</strong><p>${esc(c.extractedPolicy)} · source: policy / e-card</p>${pill('94% sample confidence','info')}</div><div class="ai-item"><strong>Final bill</strong><p>${money(c.totalBill)} · source: itemised bill</p>${pill('Requires staff verification', 'warn')}</div>`:`<p class="muted small space-top">This panel will show extracted fields, confidence and their source document. No AI call is made in this demo.</p>`}<div class="callout ${missing.length?'warn':'good'} space-top">${missing.length?`Missing: ${missing.map(d=>d.name).join(', ')}. Assessment must wait.`:'All four sample document types are on file.'}</div>`)}${card('Handoff','Evidence → calculation',`<p class="muted small">After a human confirms the extracted fields, the application’s fixed, versioned rules calculate a provisional assessment.</p><button class="btn btn-primary space-top" data-view="discharge">Open discharge review ${icon('arrow','small')}</button>`)}</div></div>`;
  }
  function discharge(c) {
    const decided = c.finalAuth !== null;
    const delta = decided ? c.totalBill-c.finalAuth : 0;
    const applied = deductions(c.totalBill);
    return `<div class="stack"><div class="grid grid-4">${metric('Final bill',money(c.totalBill),'Hospital billing source','file')}${metric('Provisional insurer estimate',c.assessed?money(c.estimate):'—','Illustrative rule result','spark')}${metric('Actual insurer authorisation',decided?money(c.finalAuth):'—','Recorded payer response','shield')}${metric('Confirmed patient share',c.billingConfirmed?money(c.patientShare):'—','Only after Billing sign-off','wallet')}</div><div class="grid grid-main"><div class="stack">${card('Bill assessment','A reproducible estimate for staff review',`<div class="grid grid-2"><div>${row('Final bill',money(c.totalBill))}${row('Illustrative non-payable / limits',c.assessed?money(applied.nonPayable):'—')}${row('Illustrative co-pay / adjustment',c.assessed?money(applied.adjustment):'—')}</div><div>${row('Provisional insurer estimate',c.assessed?money(c.estimate):'Not calculated','emphasis')}${row('Potential difference',c.assessed?money(c.totalBill-c.estimate):'—')}${row('Rule version','Demo policy rules v1')}</div></div><div class="form-actions"><button class="btn btn-primary" data-action="run-assessment" ${c.assessed?'disabled':''}>${icon('chart')} Run sample assessment</button><span class="role-note">Fixed rules use staff-reviewed facts; this is not a payer decision.</span></div>`)}${decided?card('Resolve the decision difference',`Final authorisation ${esc(c.finalRef||'sample payer response')} · insurer controls this amount`,`<div class="callout info">The ${money(delta)} difference needs a documented split. A provisional estimate must never become an automatic patient charge.</div><form id="billing-form" class="space-top"><div class="field-grid three"><div class="field"><label for="patient-share">Patient share (₹)</label><input id="patient-share" name="patientShare" type="number" min="0" max="${delta}" value="${c.patientShare}" ${c.billingConfirmed?'readonly':''}></div><div class="field"><label for="hospital-concession">Hospital concession (₹)</label><input id="hospital-concession" name="concession" type="number" min="0" max="${delta}" value="${c.concession}" ${c.billingConfirmed?'readonly':''}></div><div class="field"><label for="disputed-amount">Payer dispute / deduction (₹)</label><input id="disputed-amount" name="disputed" type="number" min="0" max="${delta}" value="${c.disputed}" ${c.billingConfirmed?'readonly':''}></div></div><p class="role-note space-top-sm">These three values must add to ${money(delta)}. Billing reviews the actual authorisation and local rules.</p><div class="form-actions"><button class="btn btn-primary" type="submit" ${c.billingConfirmed?'disabled':''}>${icon('check')} Confirm billing split</button>${roleChip('Billing')}</div></form>${c.billingConfirmed?`<div class="callout good space-top">Billing confirmed ${money(c.patientShare)} patient share. After the ${money(c.patientPaid)} recorded deposit / receipt, the remaining patient balance is ${money(Math.max(0,c.patientShare-c.patientPaid))}.</div>`:''}`):card('After the insurer replies','The approval is external',`<p class="muted small">The insurer’s final authorisation appears here only after the desk records the actual response. Then Billing confirms what is patient-payable, conceded, or disputed.</p><button class="btn btn-quiet space-top" data-view="payer">Go to payer work ${icon('arrow','small')}</button>`)}</div><div class="stack">${card('Four amounts, four meanings','Keep these facts separate',`<div class="ai-item"><strong>1 · Provisional estimate</strong><p>${c.assessed?money(c.estimate):'Not run'} · model-assisted extraction plus fixed rules; an internal assessment.</p></div><div class="ai-item"><strong>2 · Insurer authorisation</strong><p>${decided?money(c.finalAuth):'Awaiting actual payer response'} · an externally issued decision.</p></div><div class="ai-item"><strong>3 · Billing-confirmed patient share</strong><p>${c.billingConfirmed?money(c.patientShare):'Awaiting Billing sign-off'} · separate from concession and dispute.</p></div><div class="ai-item"><strong>4 · Cash received</strong><p>${money(c.payerPaid)} insurer; ${money(c.patientPaid)} patient · recorded payment events.</p></div>`)}${c.billingConfirmed?card('Decision allocation','Bill allocation',`<div class="split-bar" aria-label="Allocation of final bill"><span style="flex:${c.finalAuth}"></span><span style="flex:${c.patientShare}"></span><span style="flex:${c.concession}"></span><span style="flex:${c.disputed}"></span></div><div class="legend"><span>Insurer</span><span>Patient</span><span>Concession</span><span>Dispute</span></div>${row('Insurer authorisation',money(c.finalAuth))}${row('Patient share',money(c.patientShare))}${row('Hospital concession',money(c.concession))}${row('Disputed deduction',money(c.disputed))}`):card('Rule evidence','Proposed product behaviour',`<p class="muted small">A production assessment would cite the effective policy, tariff or package rule and the verified document field behind each amount. This visual uses a labelled illustrative rule result.</p>`)}</div></div></div>`;
  }
  function dischargePanel(c) {
    const billForm = !c.totalBill ? card('Record a sample final bill','Billing handoff after treatment',`<form id="final-bill-form"><div class="field"><label for="new-final-bill">Final bill amount (₹)</label><input id="new-final-bill" name="amount" type="number" min="1" max="10000000" value="100000" required></div><div class="form-actions"><button class="btn btn-primary" type="submit">${icon('file')} Record fictional final bill</button>${roleChip('Billing')}</div></form>`) : '';
    return billForm + discharge(c);
  }
  function payer(c) {
    return `<div class="grid grid-main"><div class="stack">${card('Submission packet','Staff-assisted handoff before a live payer connection exists',`<div class="grid grid-2"><div>${row('Reviewed facts',c.factVerified?'Confirmed':'Pending')}${row('Document checklist',demo.documentTypes.every(d=>c.docs[d.key])?'Complete':'Incomplete')}${row('Bill assessment',c.assessed?'Ready':'Pending')}</div><div>${row('Submission',c.submitted?'Acknowledged':'Not sent')}${row('Reference',esc(c.submissionRef||'—'))}${row('Current owner',esc(c.owner))}</div></div><div class="form-actions"><button class="btn btn-primary" data-action="submit-claim" ${c.submitted?'disabled':''}>${icon('send')} Simulate desk submission</button>${roleChip('Desk')}</div><p class="role-note space-top-sm">Records a fictional acknowledgement. No actual insurer or TPA endpoint is called.</p>`)}${card('Insurer query & response',c.queryOpen?'An external query is waiting':'Show how a query loops back to evidence',`${c.queryOpen?`<div class="callout warn"><strong>Sample insurer query</strong><br>${esc(c.queryText)}</div><div class="ai-item"><strong>Assistant’s draft</strong><p>${c.queryDrafted?'The requested discharge summary is on file. The room-rent line is identified in the itemised bill. Staff must check both documents before replying.':'No draft yet. The assistant can prepare a sourced response for the desk.'}</p>${c.queryDrafted?pill('Review required','warn'):''}</div>`:`<p class="muted small">A query can reopen evidence gathering after submission. The assistant drafts a response; staff decide what to send.</p>`}<div class="form-actions">${c.queryOpen?`<button class="btn" data-action="draft-query" ${c.queryDrafted?'disabled':''}>${icon('spark')} Prepare draft</button><button class="btn btn-primary" data-action="answer-query" ${!c.queryDrafted?'disabled':''}>${icon('check')} Staff-approve sample reply</button>`:`<button class="btn" data-action="simulate-query" ${!c.submitted||c.finalAuth!==null||c.rejected?'disabled':''}>${icon('alert')} Simulate insurer query</button>`}${roleChip('Desk')}</div>`)}${card('Final payer decision','Only the insurer / TPA provides an actual approval or rejection',`${c.finalAuth!==null||c.rejected?`<div class="flex-between"><div><strong>${c.rejected?'Rejected by payer · sample':'Final authorisation recorded'}</strong><p class="muted small">Reference ${esc(c.finalRef||'DEMO-REJECTED')}</p></div>${pill(c.rejected?'Rejected':money(c.finalAuth),c.rejected?'bad':'good')}</div>`:`<form id="decision-form"><div class="field-grid"><div class="field"><label for="decision-type">Simulated payer response</label><select id="decision-type" name="type"><option value="approved">Approved</option><option value="rejected">Rejected</option></select></div><div class="field"><label for="decision-amount">Authorised amount (₹)</label><input id="decision-amount" type="number" name="amount" min="0" max="${c.totalBill}" value="${Math.min(82000,c.totalBill)}"></div><div class="field"><label for="decision-ref">Payer reference</label><input id="decision-ref" name="reference" required maxlength="36" value="DEMO-FINAL-${esc(c.id.slice(-4))}"></div></div><div class="form-actions"><button class="btn btn-primary" type="submit" ${!c.submitted||c.queryOpen?'disabled':''}>${icon('shield')} Record simulated payer decision</button>${roleChip('Desk')}</div></form>`}<div class="callout info space-top">This demo input represents an external payer message. It is not an agent-generated approval. The application would preserve the original decision document.</div>`)}</div><div class="stack">${card('Payer touchpoints','Requested → acknowledged → responded',`<div class="timeline"><div class="event current"><span class="event-dot"></span><div class="event-body"><strong>Claim submission</strong><p>${c.submitted?esc(c.submissionRef):'Not submitted yet'}</p></div></div><div class="event"><span class="event-dot"></span><div class="event-body"><strong>Query loop</strong><p>${c.queryOpen?'Open sample query':c.queryAnswered?'Sample query answered':'No active query'}</p></div></div><div class="event"><span class="event-dot"></span><div class="event-body"><strong>Final response</strong><p>${c.finalAuth!==null?money(c.finalAuth):c.rejected?'Sample rejection':'Awaiting payer'}</p></div></div></div>`)}${card('Integration boundary','What a later live connector requires',`<div class="channel"><b>Staff-assisted pilot</b><p>Desk performs the permitted portal or email step, then records the acknowledgement in this workspace.</p>${pill('First release','good')}</div><div class="channel space-top-sm"><b>Direct payer integration</b><p>Possible after channel access, payload rules, acknowledgements and retry rules are agreed.</p>${pill('Future connector','info')}</div>`)}</div></div>`;
  }
  function settlement(c) {
    const dueInsurer=Math.max(0,(c.finalAuth||0)-c.payerPaid),duePatient=Math.max(0,c.patientShare-c.patientPaid);
    return `<div class="stack"><div class="grid grid-4">${metric('Insurer approved',c.finalAuth!==null?money(c.finalAuth):'—','Decision, not cash','shield')}${metric('Insurer received',money(c.payerPaid),'Actual sample receipts','wallet')}${metric('Remittance gap',c.finalAuth!==null?money(dueInsurer):'—','Approved less received','alert')}${metric('Patient balance',c.billingConfirmed?money(duePatient):'—','After billing sign-off','user')}</div><div class="grid grid-main"><div class="stack">${card('Record sample payments','Finance reconciles actual money against approvals',`<div class="callout ${c.billingConfirmed?'good':'warn'}">${c.billingConfirmed?'Billing has confirmed the patient split. Finance can record insurer and patient receipts separately.':'Billing must confirm the patient split before settlement entries are added.'}</div><div class="grid grid-2 space-top"><form id="payer-payment-form" class="card-pad" style="border:1px solid var(--line);border-radius:10px"><h4>Insurer remittance</h4><p class="muted small space-top-sm">Remaining against approval: ${money(dueInsurer)}</p><div class="field space-top"><label for="payer-payment">Amount received (₹)</label><input id="payer-payment" name="amount" type="number" min="1" max="${dueInsurer}" value="${dueInsurer?Math.min(dueInsurer,80000):0}" required></div><div class="form-actions"><button class="btn btn-primary" type="submit" ${!c.billingConfirmed||!dueInsurer?'disabled':''}>Record sample receipt</button></div></form><form id="patient-payment-form" class="card-pad" style="border:1px solid var(--line);border-radius:10px"><h4>Patient receipt</h4><p class="muted small space-top-sm">Remaining after deposit: ${c.billingConfirmed?money(duePatient):'Awaiting sign-off'}</p><div class="field space-top"><label for="patient-payment">Amount received (₹)</label><input id="patient-payment" name="amount" type="number" min="1" max="${duePatient}" value="${duePatient||0}" required></div><div class="form-actions"><button class="btn" type="submit" ${!c.billingConfirmed||!duePatient?'disabled':''}>Record sample receipt</button></div></form></div><p class="role-note space-top-sm">Finance role required. These buttons create local sample payment entries only.</p>`)}${card('What remains open','Never turn a payer deduction into an automatic patient charge',`${row('Insurer remittance gap',c.finalAuth!==null?money(dueInsurer):'—')}${row('Patient collectible balance',c.billingConfirmed?money(duePatient):'Unconfirmed')}${row('Separate payer dispute',c.billingConfirmed?money(c.disputed):'Unreviewed')}${row('Hospital concession',c.billingConfirmed?money(c.concession):'Unreviewed')}<div class="callout info space-top">Approval, settlement and discharge clearance happen at different times. A ${money(c.disputed)} disputed deduction remains a separate issue.</div>`)}</div><div class="stack">${card('Money movement','The selected fictional case',`<div class="ai-item"><strong>Insurer’s authorised share</strong><p>${c.finalAuth!==null?money(c.finalAuth):'Awaiting insurer decision'}</p></div><div class="ai-item"><strong>Patient share after Billing sign-off</strong><p>${c.billingConfirmed?money(c.patientShare):'Not confirmed yet'}</p></div><div class="ai-item"><strong>Cash currently recorded</strong><p>Insurer ${money(c.payerPaid)} + patient ${money(c.patientPaid)}</p></div><div class="callout warn space-top">A partial remittance creates a finance follow-up even when the insurer approved the claim.</div>`)}${card('Finance handoff','One claim, explainable balances',`<p class="muted small">A production screen would show remittance files, allocation to claim lines, short payments, reversals and follow-up owners. This prototype shows the core balances with fictional numbers.</p>`)}</div></div></div>`;
  }
  function activity(c) {
    return `<div class="grid grid-main"><div class="stack">${card('Case activity','Every proposed and confirmed action has its own event',timeline(c,28))}</div><div class="stack">${card('Agent runs','Task-specific assistance',`<div class="agent-run"><div class="flex-between"><strong>Document extraction</strong>${pill(c.agentRun?'Sample completed':'Not run',c.agentRun?'good':'warn')}</div><p>Extracts policy and bill fields with sample source evidence. Staff confirm or correct.</p></div><div class="agent-run"><div class="flex-between"><strong>Claim assessment</strong>${pill(c.assessed?'Calculated':'Not run',c.assessed?'good':'warn')}</div><p>Fixed rules produce a provisional amount. The model cannot issue payer approval.</p></div><div class="agent-run"><div class="flex-between"><strong>Insurer query draft</strong>${pill(c.queryDrafted?'Draft ready':c.queryAnswered?'Staff approved':'Not needed',c.queryDrafted?'warn':'info')}</div><p>Drafts a response from supporting documents. Desk reviews before the permitted send.</p></div>`)}${card('Permissions preview','Role switch at the top of the screen',`<div>${row('Desk','Documents · coverage · payer work')}${row('Billing','Patient share sign-off')}${row('Finance','Payment recording')}${row('Admin','All demo actions')}</div><div class="callout info space-top">The role selector demonstrates handoffs in this prototype. A production application must enforce permissions server-side.</div>`)}</div></div>`;
  }
  function casePage() {
    const c = current(), n=next(c);
    const sections={summary:()=>`<div class="grid grid-main"><div class="stack">${card('What needs attention','Owner '+esc(c.owner)+' · due '+esc(c.due),`<div class="next-box"><span class="eyebrow">NEXT ACTION</span><b>${esc(n.title)}</b><p>${esc(n.note)}</p><button class="btn btn-primary" data-view="${n.view}">Open this task ${icon('arrow','small')}</button></div>`)}${card('Latest activity','Timeline of the sample case',timeline(c,5),`<button class="btn btn-text" data-action="case-tab" data-tab="activity">Full activity ${icon('arrow','small')}</button>`)}</div><div class="stack">${card('Case facts','Patient, owner, payer and next handoff',`${row('Patient',esc(c.patient))}${row('Admission',esc(c.admitted))}${row('Insurer',esc(c.insurer))}${row('TPA',esc(c.tpa))}${row('Policy',esc(c.policyNo))}${row('Owner',esc(c.owner))}${row('Next due',esc(c.due))}`)}${card('Four money states','The most important distinction',`${row('Provisional estimate',c.assessed?money(c.estimate):'Pending')}${row('Payer authorisation',c.finalAuth!==null?money(c.finalAuth):'Pending')}${row('Confirmed patient share',c.billingConfirmed?money(c.patientShare):'Pending')}${row('Insurer cash received',money(c.payerPaid))}`)}</div></div>`,documents:()=>documents(c),coverage:()=>coverage(c),treatment:()=>treatment(c),discharge:()=>dischargePanel(c),payer:()=>payer(c),settlement:()=>settlement(c),activity:()=>activity(c)};
    return wrap(caseHeader(c,'CASE WORKSPACE',`${esc(c.patient)}’s claim`,'The entire insurance journey, handoffs, evidence and money for one case.')+journey(c)
      + `<section class="card space-top"><div class="card-body" style="padding-top:0">${caseTabs()}<div id="case-panel" class="space-top" role="tabpanel" aria-labelledby="case-tab-${caseTab}" tabindex="0">${sections[caseTab]()}</div></div></section>`);
  }
  function focused(view) {
    const c=current(), cfg={coverage:['POLICY & AUTHORISATION','Coverage & pre-auth','Verify cover and record an external payer pre-authorisation response.'],treatment:['HOSPITAL ENCOUNTER','Treatment & encounter','Follow the clinical and billing handoff before final claim preparation.'],documents:['EVIDENCE WORKSPACE','Documents & AI review','Check the packet, inspect proposed fields, and confirm what is supported by a source.'],discharge:['BILLING & DISCHARGE','Discharge review','Separate the internal estimate, actual payer authorisation, patient amount and receipts.'],payer:['PAYER COMMUNICATION','Submission, query & decision','Record acknowledgements and actual payer responses; staff review every outgoing answer.'],settlement:['PAYMENT RECONCILIATION','Settlement & receipts','Match insurer and patient money to the approved amounts without hiding disputes.'],agent:['AGENT OBSERVABILITY','Agent activity & audit','See which tasks used AI, fixed rules or human confirmation.']}[view];
    const body={coverage,treatment,documents,discharge:dischargePanel,payer,settlement,agent:activity}[view];
    return wrap(caseHeader(c,cfg[0],cfg[1],cfg[2])+journey(c)+`<div class="space-top">${body(c)}</div>`);
  }
  function reports() {
    const total=state.cases.length, counts=[['Eligibility',state.cases.filter(c=>!c.preauthRef).length],['Claim preparation',state.cases.filter(c=>c.totalBill>0&&!c.submitted).length],['Insurer query',state.cases.filter(c=>c.queryOpen).length],['Billing decision',state.cases.filter(c=>c.finalAuth!==null&&!c.billingConfirmed).length],['Settlement',state.cases.filter(c=>c.billingConfirmed).length]];
    return wrap(titleBlock('ILLUSTRATIVE REPORTS','Desk & finance snapshot','These charts count fictional browser cases. They are not measured hospital throughput or a prediction of 1–2-hour claim resolution.')+`<div class="grid grid-4">${metric('Tracked cases',total,'Demo worklist','list')}${metric('Queries',state.cases.filter(c=>c.queryOpen).length,'External follow-up','alert')}${metric('Insurer authorised',state.cases.filter(c=>c.finalAuth!==null).length,'Decision recorded','shield')}${metric('Open payment balances',state.cases.filter(financeOpen).length,'Finance follow-up','wallet')}</div><div class="grid grid-2 space-top">${card('Cases matching each status','A case can match more than one status',counts.map(([label,count])=>`<div class="report-bar"><span>${label}</span><div class="progress-track"><span style="width:${total?Math.round(count/total*100):0}%"></span></div><strong>${count}</strong></div>`).join(''))}${card('Time and outcome measures','What a live product would track',`<div class="flow-steps"><div class="flow-step"><b>Document prep</b><p>Bill ready → packet ready.</p></div><div class="flow-step"><b>Payer wait</b><p>Submission → response.</p></div><div class="flow-step"><b>Discharge clearance</b><p>Bill ready → cleared.</p></div><div class="flow-step"><b>Cash settlement</b><p>Approval → money received.</p></div></div><div class="callout warn space-top">The 1–2 hour goal is an ambition to validate with a pilot and a precise start/end event. This demo contains no real turnaround measurements.</div>`)}</div>`);
  }
  function settings() {
    return wrap(titleBlock('ADMINISTRATION PREVIEW','Workspace settings','The controls below show what the production application must manage. Configuration is deliberately read-only in this prototype.')+`<div class="grid grid-3">${card('Hospitals & access','Organisational boundaries',`${row('Hospital','Saavantus Central')}${row('Branch','Pune')}${row('Demo roles','Desk / Billing / Finance / Admin')}<div class="callout info space-top">Production access must be checked on the server for every case and document.</div>`)}${card('Rules & calculations','Versioned finance logic',`${row('Current demo rule','Illustrative v1')}${row('Calculation owner','Billing & approved policy rules')}${row('Estimated vs final','Always distinct')}<div class="callout info space-top">A live rule change must preserve the version used for every previous assessment.</div>`)}${card('External channels','Staff-assisted first release',`${row('Payer submission','Sample handoff')}${row('Insurer responses','Manual sample entry')}${row('Direct connectors','Later, when access exists')}<div class="callout warn space-top">No payer endpoint or live AI model is configured in this file-based demo.</div>`)}</div><div class="card space-top card-pad"><div class="flex-between"><div><h3>Reset prototype</h3><p class="muted small">Return all fictional cases to their original states in this browser.</p></div><button class="btn btn-danger" data-action="reset">${icon('refresh')} Reset demo</button></div></div>`);
  }
  function main() {
    const pages={overview,queue,case:casePage,intake,coverage:()=>focused('coverage'),treatment:()=>focused('treatment'),documents:()=>focused('documents'),discharge:()=>focused('discharge'),payer:()=>focused('payer'),settlement:()=>focused('settlement'),agent:()=>focused('agent'),reports,settings};
    $('#main').innerHTML=(pages[state.view]||overview)();
  }
  function render() { sidebar();topbar();main();syncMobileNav(); }

  function selectCaseTab(tab, focusTab) {
    caseTab = tab;
    state.view = 'case';
    if (state.tour) {
      const stop = tourSteps.findIndex(item => item.view === (tab === 'summary' ? 'case' : tab));
      if (stop >= 0) state.tourStep = stop;
    }
    save();
    main();
    const target = focusTab ? document.getElementById(`case-tab-${tab}`) : $('#case-panel');
    target?.focus({ preventScroll: true });
  }

  function afterAction(c, message, view) { save();render();if(view)show(view);toast(message); }
  function act(action, element) {
    const c=current();
    switch(action) {
      case 'menu': setMobileNav(!$('#sidebar').classList.contains('open'), true);return;
      case 'close-menu': setMobileNav(false, true);return;
      case 'guided': state.tour=true;state.tourStep=0;caseTab='summary';show('case');toast('Use the walkthrough strip to visit each stage.');return;
      case 'tour-prev': {
        const index = Math.max(0, Number(state.tourStep) || 0);
        if (index > 0) {
          const target = tourSteps[index - 1].view;
          if (target === 'case') caseTab = 'summary';
          show(target);
        }
        return;
      }
      case 'tour-next': {
        const index = Math.max(0, Number(state.tourStep) || 0);
        if (index >= tourSteps.length - 1) {
          state.tour=false;save();render();toast('Guided walkthrough complete. Explore any case or menu.');
        } else {
          show(tourSteps[index + 1].view);
        }
        return;
      }
      case 'tour-exit': state.tour=false;save();render();toast('Guided walkthrough closed.');return;
      case 'select-case': state.selected=element.dataset.id;caseTab='summary';show('case');return;
      case 'case-tab': selectCaseTab(element.dataset.tab, element.getAttribute('role') === 'tab');return;
      case 'verify-eligibility':
        if(!allowed('Desk'))return;c.eligibility='Verified by desk';c.phase='preauth';addEvent(c,'Eligibility reviewed','Desk marked the sample policy evidence reviewed. This is not insurer approval.');afterAction(c,'Sample eligibility review recorded.');return;
      case 'record-preauth':
        if(!allowed('Desk'))return;if(c.eligibility!=='Verified by desk'){toast('Verify eligibility first.');return;}
        c.preauthRef='DEMO-PA-'+c.id.slice(-4);c.preauthAmount=90000;c.docs.preauth=true;c.phase='treatment';addEvent(c,'Pre-authorisation recorded','Simulated external payer authorisation '+c.preauthRef+' for '+money(c.preauthAmount)+'.');afterAction(c,'A simulated payer pre-authorisation was recorded.');return;
      case 'attach-document':
        if(!allowed('Desk'))return;c.docs.discharge=true;addEvent(c,'Sample discharge summary attached','Fictional document checklist updated. No actual file was uploaded.');afterAction(c,'Fictional discharge summary added to the checklist.');return;
      case 'run-agent':
        if(!allowed('Desk'))return;c.agentRun=true;addEvent(c,'Document assistant ran','Sample fields proposed with source labels and confidence. Staff review is required.','Agent · simulated');afterAction(c,'Sample extraction is ready for staff review.');return;
      case 'run-assessment':
        if(!allowed('Desk'))return;
        if(!demo.documentTypes.every(d=>c.docs[d.key])){toast('Add all required sample documents before the assessment.');show('documents');return;}
        if(!c.factVerified){toast('Run the document assistant and confirm its proposed fields first.');show('documents');return;}
        if(!c.totalBill||!c.preauthRef){toast('A final bill and a recorded pre-authorisation are needed.');return;}
        const applied=deductions(c.totalBill);c.assessed=true;c.estimate=c.totalBill-applied.nonPayable-applied.adjustment;c.phase='prep';addEvent(c,'Provisional bill assessment calculated','Demo rule v1 estimated '+money(c.estimate)+' insurer share from '+money(c.totalBill)+' bill.','Claims rules');afterAction(c,'Provisional estimate calculated. Payer decision is still pending.');return;
      case 'submit-claim':
        if(!allowed('Desk'))return;if(!c.assessed||!c.factVerified||!demo.documentTypes.every(d=>c.docs[d.key])){toast('Confirm the documents and assessment before submission.');return;}
        c.submitted=true;c.submissionRef='DEMO-ACK-'+c.id.slice(-4);c.phase='submitted';addEvent(c,'Sample claim submitted','Fictional acknowledgement '+c.submissionRef+'. No payer endpoint was contacted.');afterAction(c,'Sample claim submission acknowledged locally.');return;
      case 'simulate-query':
        if(!allowed('Desk'))return;if(!c.submitted||c.finalAuth!==null||c.rejected){toast('The claim must be submitted and still awaiting a decision.');return;}
        c.queryOpen=true;c.queryDrafted=false;c.phase='query';addEvent(c,'Insurer query received','Simulated insurer request: '+c.queryText,'Payer · simulated');afterAction(c,'Simulated insurer query received.');return;
      case 'draft-query':
        if(!allowed('Desk'))return;if(!c.queryOpen)return;
        c.queryDrafted=true;addEvent(c,'Query response drafted','Agent proposed a response from the sample discharge summary and bill. Staff review required.','Agent · simulated');afterAction(c,'Draft prepared. Desk approval is required.');return;
      case 'answer-query':
        if(!allowed('Desk'))return;if(!c.queryOpen||!c.queryDrafted)return;
        if(!c.docs.discharge){toast('The requested discharge summary is still missing.');show('documents');return;}
        c.queryOpen=false;c.queryDrafted=false;c.queryAnswered=true;c.phase='submitted';addEvent(c,'Query response staff-approved','Sample response and supporting document recorded. No external message was sent.');afterAction(c,'Sample query response recorded after desk review.');return;
      case 'reset':
        $('#dialog-title').textContent='Reset all fictional cases?';$('#dialog-copy').textContent='This replaces the demo changes saved in this browser. The source files and your other project work are untouched.';$('#confirm-dialog').showModal();return;
      default:return;
    }
  }
  function submit(form) {
    const data=new FormData(form),c=current();
    switch(form.id) {
      case 'new-case-form': {
        if(!allowed('Desk'))return;
        const patient=String(data.get('patient')||'').trim(),mrn=String(data.get('mrn')||'').trim(),policy=String(data.get('policy')||'').trim();
        const bill=Number(data.get('bill')||0);
        if(!patient||!mrn||!policy||!Number.isFinite(bill)||bill<0||bill>10000000){toast('Complete the sample patient, hospital ID, policy and valid bill.');return;}
        const id='SM-'+String(Math.max(...state.cases.map(x=>Number(x.id.slice(3))||0))+1);
        const fresh={...demo.initialState().cases[4],id,patient,mrn,initials:patient.split(/\s+/).slice(0,2).map(x=>x[0].toUpperCase()).join(''),insurer:String(data.get('insurer')),category:String(data.get('category')),policyNo:policy,extractedPolicy:policy,totalBill:bill,owner:'Neha Shah',phase:'eligibility',submitted:false,preauthRef:'',preauthAmount:0,eligibility:'Not verified',docs:{policy:true,preauth:false,bill:bill>0,discharge:false},assessed:false,agentRun:false,factVerified:false,finalAuth:null,finalRef:'',billingConfirmed:false,patientShare:0,concession:0,disputed:0,payerPaid:0,patientPaid:0,events:[]};
        addEvent(fresh,'Fictional case created','Desk registered the sample patient and policy.');state.cases.unshift(fresh);state.selected=id;caseTab='summary';afterAction(fresh,'Fictional case added to the work queue.','case');return;
      }
      case 'final-bill-form': {
        if(!allowed('Billing'))return;
        if(c.totalBill>0||c.submitted){toast('The final bill is already recorded or the case has been submitted.');return;}
        const amount=Number(data.get('amount'));
        if(!Number.isFinite(amount)||amount<=0||amount>10000000){toast('Enter a fictional final bill above zero and below ₹1 crore.');return;}
        c.totalBill=amount;c.docs.bill=true;c.discharge='29 Sep 2026';c.agentRun=false;c.factVerified=false;c.assessed=false;c.phase='prep';
        addEvent(c,'Final bill recorded','Billing added a fictional '+money(amount)+' final bill for review.');
        afterAction(c,'Fictional final bill recorded. Review its evidence before assessment.');return;
      }
      case 'facts-form':
        if(!allowed('Desk'))return;if(!c.agentRun){toast('Run the sample document assistant first.');return;}
        if(c.submitted){toast('A submitted claim needs a documented amendment before changing confirmed facts.');return;}
        c.extractedPolicy=String(data.get('policy')||'').trim();if(!c.extractedPolicy){toast('Enter the reviewed policy number.');return;}
        if(c.extractedPolicy!==c.policyNo){c.policyNo=c.extractedPolicy;c.assessed=false;addEvent(c,'Extracted field corrected','Desk corrected the sample policy number against the e-card; the previous assessment must be recalculated.');}
        c.factVerified=true;addEvent(c,'Extracted facts confirmed','Desk checked sample fields against source documents.');afterAction(c,'Source fields confirmed by the desk.');return;
      case 'decision-form': {
        if(!allowed('Desk'))return;if(!c.submitted||c.queryOpen||c.finalAuth!==null||c.rejected){toast('Submit the claim, answer the query, and record only one final payer decision.');return;}
        const type=String(data.get('type')),amount=Number(data.get('amount')),ref=String(data.get('reference')||'').trim();
        if(!ref||!Number.isFinite(amount)||amount<0||amount>c.totalBill){toast('Enter a valid fictional payer reference and amount.');return;}
        c.finalRef=ref;c.rejected=type==='rejected';c.finalAuth=c.rejected?null:amount;c.phase=c.rejected?'rejected':'decision';addEvent(c,c.rejected?'Sample payer rejection recorded':'Final authorisation recorded',c.rejected?'Simulated external payer rejection.':'Simulated external payer authorisation '+money(amount)+'; Billing review needed.','Payer · simulated');afterAction(c,'Simulated external payer decision recorded.');return;
      }
      case 'billing-form': {
        if(!allowed('Billing'))return;if(c.finalAuth===null||c.billingConfirmed){toast('A new, unsigned insurer decision is required.');return;}
        const patientShare=Number(data.get('patientShare')),concession=Number(data.get('concession')),disputed=Number(data.get('disputed'));
        if([patientShare,concession,disputed].some(x=>!Number.isFinite(x)||x<0)||patientShare+concession+disputed!==c.totalBill-c.finalAuth){toast(`Split must total ${money(c.totalBill-c.finalAuth)}. Review patient share, concession and dispute.`);return;}
        c.patientShare=patientShare;c.concession=concession;c.disputed=disputed;c.billingConfirmed=true;c.phase='settlement';addEvent(c,'Patient amount signed off','Billing confirmed '+money(patientShare)+' patient share, '+money(concession)+' concession and '+money(disputed)+' payer dispute.');afterAction(c,'Billing split confirmed. Finance can now reconcile receipts.');return;
      }
      case 'payer-payment-form':
      case 'patient-payment-form': {
        if(!allowed('Finance'))return;if(!c.billingConfirmed){toast('Billing sign-off is required first.');return;}
        const amount=Number(data.get('amount')),payer=form.id==='payer-payment-form';
        const outstanding=payer?Math.max(0,c.finalAuth-c.payerPaid):Math.max(0,c.patientShare-c.patientPaid);
        if(!Number.isFinite(amount)||amount<=0||amount>outstanding){toast(`Enter an amount above zero and no more than ${money(outstanding)}.`);return;}
        if(payer)c.payerPaid+=amount;else c.patientPaid+=amount;
        addEvent(c,payer?'Insurer receipt recorded':'Patient receipt recorded',`Finance entered a fictional ${money(amount)} ${payer?'insurer remittance':'patient receipt'}.`);
        if(c.payerPaid>=c.finalAuth&&c.patientPaid>=c.patientShare)c.phase=c.disputed?'dispute':'closed';
        afterAction(c,'Fictional payment entry recorded.');return;
      }
      default:return;
    }
  }

  document.addEventListener('click', event => {
    const action=event.target.closest('[data-action]');
    if(action){event.preventDefault();try{act(action.dataset.action,action);}catch(error){console.error(error);toast(`Prototype action could not run: ${error.message}`);}return;}
    const view=event.target.closest('[data-view]');
    if(view){event.preventDefault();show(view.dataset.view);}
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && mobileNav.matches && $('#sidebar').classList.contains('open')) {
      setMobileNav(false, true);
      return;
    }
    const tab = event.target.closest?.('.page-tab[role="tab"]');
    if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = [...document.querySelectorAll('.page-tab[role="tab"]')];
    const index = tabs.indexOf(tab);
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault();
    selectCaseTab(tabs[nextIndex].dataset.tab, true);
  });
  mobileNav.addEventListener('change', () => setMobileNav(false));
  document.addEventListener('submit', event => {
    if(event.target.id){event.preventDefault();submit(event.target);}
  });
  document.addEventListener('change', event => {
    if(event.target.id==='role-select'){state.role=event.target.value;save();render();toast(`Previewing ${state.role} handoff.`);}
    if(event.target.id==='queue-filter'){state.filter=event.target.value;save();main();}
  });
  document.addEventListener('input', event => {
    if(event.target.id==='global-search'){
      const value=event.target.value;state.search=value;state.view='queue';save();sidebar();main();
    }
  });
  $('#confirm-dialog').addEventListener('close', event => {
    if(event.target.returnValue==='confirm'){state=demo.initialState();caseTab='summary';save();render();toast('Fictional cases restored to their starting states.');}
  });
  render();
})();
