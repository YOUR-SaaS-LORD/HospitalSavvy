-- Repeatable synthetic HMS sample data. Does not modify users or existing records.
BEGIN;

INSERT INTO departments (name, description, status)
VALUES
  ('DEMO Outpatient', 'Synthetic outpatient department for demo records', 'ACTIVE'),
  ('DEMO Laboratory', 'Synthetic laboratory department for demo records', 'ACTIVE'),
  ('DEMO Pharmacy', 'Synthetic pharmacy department for demo records', 'ACTIVE'),
  ('DEMO Radiology', 'Synthetic radiology department for demo records', 'ACTIVE'),
  ('DEMO Nursing', 'Synthetic nursing department for demo records', 'ACTIVE'),
  ('DEMO Emergency', 'Synthetic emergency department for demo records', 'ACTIVE')
ON CONFLICT (name) DO NOTHING;

INSERT INTO wards (name, capacity, status)
VALUES ('DEMO General Ward', 12, 'ACTIVE')
ON CONFLICT DO NOTHING;

INSERT INTO services (name, department_id, fee, status, created_at)
SELECT 'DEMO Consultation', d.id, 25000, 'ACTIVE', NOW()
FROM departments d WHERE d.name = 'DEMO Outpatient'
  AND NOT EXISTS (SELECT 1 FROM services s WHERE s.name = 'DEMO Consultation');

INSERT INTO staff (staff_number, full_name, department_id, role, status, phone, email)
SELECT x.staff_number, x.full_name, d.id, x.role, 'ON DUTY', x.phone, x.email
FROM (VALUES
 ('DEMO-DOC-01', 'Demo Doctor', 'doctor', '+256700000101', 'demo.doctor@example.test', 'DEMO Outpatient'),
 ('DEMO-NUR-01', 'Demo Nurse', 'nurse', '+256700000102', 'demo.nurse@example.test', 'DEMO Nursing'),
 ('DEMO-LAB-01', 'Demo Laboratory Officer', 'labtech', '+256700000103', 'demo.lab@example.test', 'DEMO Laboratory'),
 ('DEMO-RAD-01', 'Demo Radiologist', 'radiologist', '+256700000104', 'demo.radiology@example.test', 'DEMO Radiology'),
 ('DEMO-SUR-01', 'Demo Surgeon', 'surgeon', '+256700000105', 'demo.surgeon@example.test', 'DEMO Emergency')
) AS x(staff_number, full_name, role, phone, email, department_name)
JOIN departments d ON d.name = x.department_name
ON CONFLICT (staff_number) DO NOTHING;

INSERT INTO patients (patient_id, full_name, date_of_birth, gender, phone, national_id,
  clinic, registration_date, status, current_phase, current_priority, notes, created_at, updated_at,
  admission_date, admitted_at, current_bed_id, assigned_doctor_id)
SELECT x.patient_code, x.full_name, x.dob::date, x.gender, x.phone, NULL,
  x.clinic, NOW(), x.status, x.phase, x.priority, x.notes, NOW(), NOW(),
  CASE WHEN x.status = 'ADMITTED' THEN NOW() - INTERVAL '1 day' END,
  CASE WHEN x.status = 'ADMITTED' THEN NOW() - INTERVAL '1 day' END,
  NULL, (SELECT id FROM staff WHERE staff_number = 'DEMO-DOC-01')
FROM (VALUES
 ('DEMO-HMS-1001', 'Alex Demo Patient', '1990-04-12', 'Male', '+256700001001', 'DEMO Outpatient', 'ACTIVE', 'Doctor Consultation', 'ROUTINE', 'Synthetic outpatient patient: use to compare current visit records with earlier visit history.'),
 ('DEMO-HMS-1002', 'Jordan Demo Inpatient', '1982-09-03', 'Female', '+256700001002', 'DEMO Nursing', 'ADMITTED', 'Inpatient Care', 'URGENT', 'Synthetic admitted patient for ward, nursing, bed, and billing screens.'),
 ('DEMO-HMS-1003', 'Casey Demo Emergency', '2001-01-24', 'Female', '+256700001003', 'DEMO Emergency', 'ACTIVE', 'Emergency', 'URGENT', 'Synthetic emergency patient for active emergency dashboard testing.')
) AS x(patient_code, full_name, dob, gender, phone, clinic, status, phase, priority, notes)
ON CONFLICT (patient_id) DO NOTHING;

-- Two visits for patient 1001 make current-visit versus full-history filtering testable.
INSERT INTO visits (visit_id, patient_id, department_id, status, created_at)
SELECT 'DEMO-VISIT-1001-OLD', p.id, d.id, 'COMPLETED', NOW() - INTERVAL '30 days'
FROM patients p JOIN departments d ON d.name = 'DEMO Outpatient'
WHERE p.patient_id = 'DEMO-HMS-1001'
  AND NOT EXISTS (SELECT 1 FROM visits v WHERE v.visit_id = 'DEMO-VISIT-1001-OLD');
INSERT INTO visits (visit_id, patient_id, department_id, status, created_at)
SELECT 'DEMO-VISIT-1001-CURRENT', p.id, d.id, 'WAITING', NOW()
FROM patients p JOIN departments d ON d.name = 'DEMO Outpatient'
WHERE p.patient_id = 'DEMO-HMS-1001'
  AND NOT EXISTS (SELECT 1 FROM visits v WHERE v.visit_id = 'DEMO-VISIT-1001-CURRENT');
INSERT INTO visits (visit_id, patient_id, department_id, status, created_at)
SELECT 'DEMO-VISIT-1002-CURRENT', p.id, d.id, 'ADMITTED', NOW()
FROM patients p JOIN departments d ON d.name = 'DEMO Nursing'
WHERE p.patient_id = 'DEMO-HMS-1002'
  AND NOT EXISTS (SELECT 1 FROM visits v WHERE v.visit_id = 'DEMO-VISIT-1002-CURRENT');
INSERT INTO visits (visit_id, patient_id, department_id, status, created_at)
SELECT 'DEMO-VISIT-1003-CURRENT', p.id, d.id, 'IN_PROGRESS', NOW()
FROM patients p JOIN departments d ON d.name = 'DEMO Emergency'
WHERE p.patient_id = 'DEMO-HMS-1003'
  AND NOT EXISTS (SELECT 1 FROM visits v WHERE v.visit_id = 'DEMO-VISIT-1003-CURRENT');

-- Create one of each sample patient-workflow record only once.
INSERT INTO triage_records (patient_id, weight, height, bmi, blood_pressure, temperature,
  pulse_rate, respiratory_rate, oxygen_saturation, blood_sugar, pain_score, chief_complaint,
  allergies, priority, assessed_by, created_at)
SELECT p.id, 72, 1.70, 24.9, '122/80', 36.8, 78, 16, 98, 5.4, 3,
  'Demo: intermittent headache for two days', 'No known allergies', 'ROUTINE', s.id, NOW()
FROM patients p LEFT JOIN staff s ON s.staff_number = 'DEMO-NUR-01'
WHERE p.patient_id = 'DEMO-HMS-1001'
  AND NOT EXISTS (SELECT 1 FROM triage_records t WHERE t.patient_id = p.id AND t.chief_complaint LIKE 'Demo:%');

INSERT INTO clinical_records (patient_id, doctor_id, hpi, past_history, examination,
  provisional_diagnosis, final_diagnosis, lab_order, radiology_order, review_date, created_at, updated_at)
SELECT p.id, s.id, 'Demo: headache, no red flags.', 'No significant past medical history.',
  'Alert, oriented; normal neurological examination.', 'Tension-type headache', 'Tension-type headache',
  'Complete blood count', 'Head CT if symptoms worsen', CURRENT_DATE + 7, NOW(), NOW()
FROM patients p LEFT JOIN staff s ON s.staff_number = 'DEMO-DOC-01'
WHERE p.patient_id = 'DEMO-HMS-1001'
  AND NOT EXISTS (SELECT 1 FROM clinical_records c WHERE c.patient_id = p.id AND c.hpi LIKE 'Demo:%');

INSERT INTO diagnoses (patient_id, diagnosis, icd10_code, diagnosis_type, created_at)
SELECT p.id, 'Demo tension-type headache', 'G44.2', 'FINAL', NOW()
FROM patients p WHERE p.patient_id = 'DEMO-HMS-1001'
  AND NOT EXISTS (SELECT 1 FROM diagnoses d WHERE d.patient_id = p.id AND d.diagnosis = 'Demo tension-type headache');

INSERT INTO lab_requests (request_id, patient_id, test_name, sample_type, barcode, status, requested_at, doctor_id)
SELECT 'DEMO-LAB-1001', p.id, 'Complete blood count', 'EDTA blood', 'DEMO-BARCODE-1001', 'COMPLETED', NOW(), s.id
FROM patients p LEFT JOIN staff s ON s.staff_number = 'DEMO-DOC-01'
WHERE p.patient_id = 'DEMO-HMS-1001'
  AND NOT EXISTS (SELECT 1 FROM lab_requests r WHERE r.request_id = 'DEMO-LAB-1001');
INSERT INTO lab_results (patient_id, request_id, results, verification_status, verified_by, created_at)
SELECT p.id, r.id, 'Demo result: CBC within expected reference ranges.', 'Verified', s.id, NOW()
FROM patients p JOIN lab_requests r ON r.request_id = 'DEMO-LAB-1001'
LEFT JOIN staff s ON s.staff_number = 'DEMO-LAB-01'
WHERE p.patient_id = 'DEMO-HMS-1001'
  AND NOT EXISTS (SELECT 1 FROM lab_results lr WHERE lr.request_id = r.id);

INSERT INTO radiology_requests (request_id, patient_id, examination, status, created_at)
SELECT 'DEMO-RAD-1001', p.id, 'Head CT (demo request)', 'COMPLETED', NOW()
FROM patients p WHERE p.patient_id = 'DEMO-HMS-1001'
  AND NOT EXISTS (SELECT 1 FROM radiology_requests r WHERE r.request_id = 'DEMO-RAD-1001');
INSERT INTO radiology_results (request_id, findings, reported_by, created_at)
SELECT r.id, 'Demo report: no acute intracranial finding.', s.id, NOW()
FROM radiology_requests r LEFT JOIN staff s ON s.staff_number = 'DEMO-RAD-01'
WHERE r.request_id = 'DEMO-RAD-1001'
  AND NOT EXISTS (SELECT 1 FROM radiology_results rr WHERE rr.request_id = r.id);

INSERT INTO prescriptions (patient_id, doctor_id, drug_name, frequency, duration, status, created_at)
SELECT p.id, s.id, 'Paracetamol 500 mg (demo)', 'As needed, up to three times daily', '3 days', 'Active', NOW()
FROM patients p LEFT JOIN staff s ON s.staff_number = 'DEMO-DOC-01'
WHERE p.patient_id = 'DEMO-HMS-1001'
  AND NOT EXISTS (SELECT 1 FROM prescriptions rx WHERE rx.patient_id = p.id AND rx.drug_name = 'Paracetamol 500 mg (demo)');

INSERT INTO inventory_items (item_code, item_name, category, drug_type, valuation_method, strips_per_box,
  price_per_unit, quantity, reorder_level, loose_strips, supplier, expiry_date, status, created_at, updated_at,
  unit, unit_price)
VALUES
 ('DEMO-STOCK-001', 'Demo Paracetamol 500 mg', 'Drug Stock', 'Tablet', 'FIFO', 10, 250, 60, 10, 0, 'Demo Supplier', CURRENT_DATE + 365, 'ACTIVE', NOW(), NOW(), 'box', 250),
 ('DEMO-STOCK-002', 'Demo Examination Gloves', 'Medical Supplies', NULL, 'FIFO', NULL, 12000, 40, 8, 0, 'Demo Supplier', CURRENT_DATE + 500, 'ACTIVE', NOW(), NOW(), 'box', 12000)
ON CONFLICT (item_code) DO NOTHING;
INSERT INTO inventory_batches (inventory_item_id, batch_number, quantity_received, quantity_remaining, expiry_date, created_at)
SELECT i.id, 1, i.quantity, i.quantity, i.expiry_date, NOW()
FROM inventory_items i WHERE i.item_code IN ('DEMO-STOCK-001', 'DEMO-STOCK-002')
  AND NOT EXISTS (SELECT 1 FROM inventory_batches b WHERE b.inventory_item_id = i.id AND b.batch_number = 1);

INSERT INTO pharmacy_dispenses (patient_id, medication_name, medication_code, quantity, dosage,
  frequency, duration, prescribed_by, dispensed_by, unit_price, total_amount, status, instructions, remarks, dispense_date, created_at)
SELECT p.id, 'Paracetamol 500 mg (demo)', 'DEMO-STOCK-001', 9, '500 mg', 'As needed', '3 days',
  'Demo Doctor', 'Demo Pharmacist', 250, 2250, 'Dispensed', 'Synthetic test record; not a real medication order.', 'DEMO DATA', NOW(), NOW()
FROM patients p WHERE p.patient_id = 'DEMO-HMS-1001'
  AND NOT EXISTS (SELECT 1 FROM pharmacy_dispenses d WHERE d.patient_id = p.id AND d.medication_code = 'DEMO-STOCK-001');

INSERT INTO nursing_records (patient_id, assessment, nursing_notes, care_plan, interventions,
  medication_notes, patient_response, vital_signs, shift, status, created_at)
SELECT p.id, 'Demo: comfortable, alert and oriented.', 'Synthetic nursing observation for testing.',
  'Encourage fluids; monitor pain.', 'Education provided; observations completed.', 'No medication administered in this sample.',
  'Stable.', 'BP 122/80; pulse 78; temperature 36.8 C; SpO2 98%.', 'Day', 'active', NOW()
FROM patients p WHERE p.patient_id = 'DEMO-HMS-1001'
  AND NOT EXISTS (SELECT 1 FROM nursing_records n WHERE n.patient_id = p.id AND n.nursing_notes LIKE 'Synthetic nursing%');
INSERT INTO doctor_round_notes (patient_id, doctor_id, note, created_at)
SELECT p.id, s.id, 'Demo round: symptoms improving; review in one week.', NOW()
FROM patients p JOIN staff s ON s.staff_number = 'DEMO-DOC-01'
WHERE p.patient_id = 'DEMO-HMS-1001'
  AND NOT EXISTS (SELECT 1 FROM doctor_round_notes n WHERE n.patient_id = p.id AND n.note LIKE 'Demo round:%');

INSERT INTO billings (patient_id, invoice_number, bill_date, description, service_type, amount, discount, tax,
  total_amount, amount_paid, balance, payment_method, payment_status, status, created_by, notes, created_at, updated_at)
SELECT p.id, 'DEMO-INV-1001', NOW(), 'Demo consultation and laboratory services', 'Outpatient',
  45000, 0, 0, 45000, 20000, 25000, 'Cash', 'Partially Paid', 'Active', 'DEMO', 'Synthetic billing record.', NOW(), NOW()
FROM patients p WHERE p.patient_id = 'DEMO-HMS-1001'
  AND NOT EXISTS (SELECT 1 FROM billings b WHERE b.invoice_number = 'DEMO-INV-1001');

INSERT INTO emergency_cases (case_id, patient_id, arrival_mode, arrival_time, priority, area, airway, breathing,
  circulation, consciousness, blood_pressure, pulse, spo2, gcs, complaint, medical_history, intervention,
  medication, doctor_id, notes, disposition, status, created_at)
SELECT 'DEMO-ER-1003', p.id, 'Walk-in', NOW(), 'YELLOW', 'DEMO Emergency', 'Patent', 'Normal', 'Stable',
  'Alert', '118/76', 86, 98, 15, 'Demo: minor ankle injury', 'No known medical history',
  'Assessment and observation', 'None recorded', s.id, 'Synthetic emergency case for dashboard testing.',
  'DISCHARGE', 'ACTIVE', NOW()
FROM patients p LEFT JOIN staff s ON s.staff_number = 'DEMO-DOC-01'
WHERE p.patient_id = 'DEMO-HMS-1003'
  AND NOT EXISTS (SELECT 1 FROM emergency_cases e WHERE e.case_id = 'DEMO-ER-1003');

INSERT INTO beds (bed_number, ward_id, status, patient_id)
SELECT 'DEMO-BED-01', w.id, 'OCCUPIED', p.id
FROM wards w JOIN patients p ON p.patient_id = 'DEMO-HMS-1002'
WHERE w.name = 'DEMO General Ward'
  AND NOT EXISTS (SELECT 1 FROM beds b WHERE b.bed_number = 'DEMO-BED-01');
UPDATE patients SET current_bed_id = (SELECT id FROM beds WHERE bed_number = 'DEMO-BED-01')
WHERE patient_id = 'DEMO-HMS-1002' AND current_bed_id IS NULL;

INSERT INTO surgical_records (patient_id, surgeon_id, procedure, lead_surgeon, anaesthetist,
  anaesthesia_type, status, created_at, consent, operation_notes, scheduled_at)
SELECT p.id, s.id, 'Demo wound review (no procedure performed)', 'Demo Surgeon', 'Demo Anaesthetist',
  'Local (planned)', 'SCHEDULED', NOW(), 'Pending', 'Synthetic scheduled theatre item.', NOW() + INTERVAL '1 day'
FROM patients p LEFT JOIN staff s ON s.staff_number = 'DEMO-SUR-01'
WHERE p.patient_id = 'DEMO-HMS-1003'
  AND NOT EXISTS (SELECT 1 FROM surgical_records sr WHERE sr.patient_id = p.id AND sr.procedure LIKE 'Demo wound review%');

INSERT INTO hms_counseling_records (client_reference, client_name, record_type, record_date,
  follow_up_date, referral_destination, notes, outcome, created_by, created_at, updated_at)
SELECT 'DEMO-HMS-1001', 'Alex Demo Patient', 'Intake', CURRENT_DATE, CURRENT_DATE + 14,
  'DEMO Outpatient', 'Synthetic confidential counseling sample. Do not use as a real clinical record.',
  'Follow-up scheduled.', 'DEMO', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM hms_counseling_records WHERE client_reference = 'DEMO-HMS-1001' AND record_type = 'Intake');

INSERT INTO medical_reports (patient_id, report_type, title, report_date, doctor_name, department,
  diagnosis, findings, recommendations, report_content, status, created_by, created_at, updated_at)
SELECT p.id, 'Visit Summary', 'DEMO Visit Summary - Alex Demo Patient', NOW(), 'Demo Doctor', 'DEMO Outpatient',
  'Tension-type headache', 'Stable assessment; demo laboratory and imaging results recorded.',
  'Follow-up in one week if symptoms persist.', 'Synthetic report for interface testing only.', 'Completed', 'DEMO', NOW(), NOW()
FROM patients p WHERE p.patient_id = 'DEMO-HMS-1001'
  AND NOT EXISTS (SELECT 1 FROM medical_reports mr WHERE mr.patient_id = p.id AND mr.title = 'DEMO Visit Summary - Alex Demo Patient');

INSERT INTO hospital_fund_dispensings (reference, fund_date, fund_type, recipient, department, amount,
  purpose, approved_by, status, notes, created_by, created_at)
VALUES ('DEMO-FUND-001', CURRENT_DATE, 'Operational', 'Demo Supplies Desk', 'DEMO Outpatient', 150000,
  'Synthetic facilitation fund entry for finance screens.', 'Demo Hospital Manager', 'APPROVED', 'DEMO DATA', 'DEMO', NOW())
ON CONFLICT (reference) DO NOTHING;

INSERT INTO procurement_documents (document_type, document_type_display, document_number, document_date,
  title, party_name, department, status, payload, is_scanned_document, created_by, created_at)
SELECT 'Purchase Request', 'Purchase Request', 'DEMO-PR-001', CURRENT_DATE,
  'DEMO Procurement Request - Examination Gloves', 'Demo Supplier', 'DEMO Outpatient', 'Pending',
  '{"items":[{"name":"Examination gloves","quantity":5}],"synthetic":true}'::jsonb, FALSE, NULL, NOW()
WHERE NOT EXISTS (SELECT 1 FROM procurement_documents WHERE document_number = 'DEMO-PR-001');

INSERT INTO secretariate_documents (document_type, document_type_display, document_number, document_date,
  title, author, recipient, organization, content, created_by, created_at)
SELECT 'Internal Memo', 'Internal Memo', 'DEMO-MEMO-001', CURRENT_DATE,
  'DEMO Internal Memo - Workflow Test', 'Demo Secretariat', 'Demo Hospital Manager', 'HospitalSavvy Demo',
  '{"body":"Synthetic memo to test secretariat document listing and preview.","synthetic":true}'::jsonb,
  NULL, NOW()
WHERE NOT EXISTS (SELECT 1 FROM secretariate_documents WHERE document_number = 'DEMO-MEMO-001');

COMMIT;

SELECT 'DEMO PATIENTS' AS section, patient_id, full_name FROM patients WHERE patient_id LIKE 'DEMO-HMS-%' ORDER BY patient_id;
