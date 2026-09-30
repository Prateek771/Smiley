// Fictional demonstration data. This file never connects to a hospital or payer.
window.SAAVANTUS_DEMO = (() => {
  const workflow = [
    { name: 'Patient', page: 'intake' },
    { name: 'Insurance type', page: 'intake' },
    { name: 'Insurer', page: 'intake' },
    { name: 'TPA', page: 'intake' },
    { name: 'Policy', page: 'coverage' },
    { name: 'Eligibility', page: 'coverage' },
    { name: 'Pre-auth', page: 'coverage' },
    { name: 'Treatment', page: 'treatment' },
    { name: 'Claim', page: 'documents' },
    { name: 'Decision', page: 'payer' },
    { name: 'Settlement', page: 'settlement' }
  ];

  const documentTypes = [
    { key: 'policy', name: 'Policy / e-card', note: 'Member identity and cover terms' },
    { key: 'preauth', name: 'Pre-authorisation letter', note: 'Payer-issued reference and approved limit' },
    { key: 'bill', name: 'Final itemised bill', note: 'Charges and service lines' },
    { key: 'discharge', name: 'Discharge summary', note: 'Clinical facts for staff verification' }
  ];

  // Fictional encounter labels for the visual walkthrough; no clinical record is loaded.
  const encounterNotes = {
    'SM-1042': { unit: 'Orthopaedics', setting: 'Inpatient ward', services: 'Procedure, diagnostics and ward care' },
    'SM-1043': { unit: 'General medicine', setting: 'Inpatient ward', services: 'Consultation, diagnostics and ward care' },
    'SM-1044': { unit: 'General surgery', setting: 'Inpatient ward', services: 'Procedure, pharmacy and ward care' },
    'SM-1045': { unit: 'Cardiology', setting: 'Inpatient ward', services: 'Monitoring, diagnostics and ward care' },
    'SM-1046': { unit: 'General medicine', setting: 'Inpatient ward', services: 'Consultation and initial diagnostics' }
  };
  function encounterFor(c) {
    return encounterNotes[c.id] || { unit: 'Clinical department pending', setting: 'Inpatient ward', services: 'Services pending clinical handoff' };
  }

  const now = '29 Sep · 10:40';
  const base = {
    branch: 'Saavantus Central · Pune', owner: 'Neha Shah', insurer: 'Apex Health', tpa: 'MediAssist',
    category: 'Private', policyNo: 'APH-882104', sumInsured: 500000, roomCap: 7000,
    admitted: '27 Sep 2026', discharge: '29 Sep 2026', totalBill: 100000,
    docs: { policy: true, preauth: true, bill: true, discharge: true },
    eligibility: 'Verified by desk', preauthRef: 'PA-26-8819', preauthAmount: 90000,
    agentRun: false, factVerified: false, extractedPolicy: 'APH-882104',
    assessed: false, estimate: 85000, submitted: false, submissionRef: '',
    queryOpen: false, queryDrafted: false, queryAnswered: false, queryText: 'Please attach the discharge summary and explain the room-rent adjustment.',
    finalAuth: null, finalRef: '', rejected: false,
    billingConfirmed: false, patientShare: 8000, concession: 7000, disputed: 3000,
    patientPaid: 5000, payerPaid: 0, events: []
  };
  const make = (overrides) => ({ ...base, ...overrides, docs: { ...base.docs, ...(overrides.docs || {}) }, events: [...(overrides.events || [])] });

  function initialState() {
    return {
      version: 2,
      view: 'overview',
      selected: 'SM-1042',
      role: 'Desk',
      search: '',
      filter: 'All',
      tour: false,
      tourStep: 0,
      cases: [
        make({
          id: 'SM-1042', patient: 'Ananya Rao', initials: 'AR', age: 42, mrn: 'MRN-00481',
          phase: 'prep', priority: 'High', due: 'Today · 12:30', docs: { discharge: false },
          events: [
            { time: '29 Sep · 10:20', title: 'Final bill ready', detail: 'Billing shared a ₹1,00,000 final bill.', actor: 'Billing' },
            { time: '28 Sep · 15:10', title: 'Pre-authorisation received', detail: 'Sample payer reference PA-26-8819 recorded by the desk.', actor: 'Desk' },
            { time: '27 Sep · 11:05', title: 'Patient and policy registered', detail: 'Insurance desk linked the fictional policy.', actor: 'Desk' }
          ]
        }),
        make({
          id: 'SM-1043', patient: 'Kabir Shah', initials: 'KS', age: 57, mrn: 'MRN-00482',
          owner: 'Ritu Menon', insurer: 'Northstar Care', policyNo: 'NSC-390201', extractedPolicy: 'NSC-390201',
          phase: 'query', priority: 'Urgent', due: 'Today · 11:15', agentRun: true, factVerified: true,
          assessed: true, submitted: true, submissionRef: 'DEMO-ACK-1043', queryOpen: true,
          queryText: 'Please provide the final discharge summary and clarify the room-rent line.',
          events: [
            { time: '29 Sep · 10:12', title: 'Insurer query received', detail: 'Sample query asks for a room-rent explanation.', actor: 'Payer · simulated' },
            { time: '29 Sep · 09:30', title: 'Claim submitted', detail: 'Sample acknowledgement DEMO-ACK-1043.', actor: 'Desk' }
          ]
        }),
        make({
          id: 'SM-1044', patient: 'Mira Iyer', initials: 'MI', age: 35, mrn: 'MRN-00483',
          owner: 'Sahil Khan', insurer: 'Everwell Insurance', policyNo: 'EWI-553190', extractedPolicy: 'EWI-553190',
          phase: 'decision', priority: 'High', due: 'Today · 14:00', agentRun: true, factVerified: true,
          assessed: true, submitted: true, submissionRef: 'DEMO-ACK-1044', finalAuth: 82000,
          finalRef: 'DEMO-FINAL-1044',
          events: [
            { time: '29 Sep · 09:48', title: 'Final authorisation recorded', detail: 'Simulated payer approval: ₹82,000. Billing review needed.', actor: 'Desk' },
            { time: '28 Sep · 17:04', title: 'Claim submitted', detail: 'Sample acknowledgement DEMO-ACK-1044.', actor: 'Desk' }
          ]
        }),
        make({
          id: 'SM-1045', patient: 'Arjun Sen', initials: 'AS', age: 64, mrn: 'MRN-00484',
          owner: 'Pooja Nair', insurer: 'Apex Health', policyNo: 'APH-942801', extractedPolicy: 'APH-942801',
          phase: 'settlement', priority: 'Normal', due: '02 Oct · 17:00', agentRun: true, factVerified: true,
          assessed: true, submitted: true, submissionRef: 'DEMO-ACK-1045', finalAuth: 82000,
          finalRef: 'DEMO-FINAL-1045', billingConfirmed: true, payerPaid: 80000,
          events: [
            { time: '29 Sep · 09:15', title: 'Partial insurer payment recorded', detail: 'Sample remittance ₹80,000 against ₹82,000 approval.', actor: 'Finance' },
            { time: '28 Sep · 16:30', title: 'Patient amount signed off', detail: 'Billing confirmed ₹8,000 patient share, ₹7,000 concession and ₹3,000 dispute.', actor: 'Billing' }
          ]
        }),
        make({
          id: 'SM-1046', patient: 'Nisha Verma', initials: 'NV', age: 29, mrn: 'MRN-00485',
          owner: 'Ritu Menon', insurer: 'Northstar Care', policyNo: 'NSC-662320', extractedPolicy: 'NSC-662320',
          phase: 'eligibility', priority: 'Normal', due: 'Today · 16:00', docs: { preauth: false, bill: false, discharge: false },
          eligibility: 'Not verified', preauthRef: '', preauthAmount: 0, totalBill: 0, patientPaid: 0,
          admitted: '29 Sep 2026', discharge: 'Pending',
          events: [{ time: now, title: 'Case opened', detail: 'Policy details await eligibility verification.', actor: 'Desk' }]
        })
      ]
    };
  }

  return { workflow, documentTypes, encounterFor, initialState };
})();
