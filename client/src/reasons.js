// Why a driver didn't work on a pay day. These match the DEFAULT REASON list of the monthly CSR report.
// Days the workshop or administration is responsible for are excused by default; driver days are still owed.

export const DEPARTMENTS = ['DRIVER', 'AUTO WORKSHOP', 'ADMINISTRATION'];

export const REASONS = [
  { key: 'accident', label: 'Accident', report: 'ACCIDENT', dept: 'DRIVER' },
  { key: 'major_repair', label: 'Major repair works', report: 'MAJOR REPAIR WORKS', dept: 'AUTO WORKSHOP' },
  { key: 'spare_parts', label: 'Waiting for spare parts', report: 'UNAVAILABILITY OF SPARE PARTS', dept: 'AUTO WORKSHOP' },
  { key: 'servicing', label: 'Routine servicing / minor fault', report: 'ROUTINE SERVICING/MINOR FAULTS', dept: 'AUTO WORKSHOP' },
  { key: 'illness', label: 'Illness', report: 'ILLNESS', dept: 'DRIVER' },
  { key: 'personal_emergency', label: 'Personal emergency', report: 'PERSONAL EMERGENCY', dept: 'DRIVER' },
  { key: 'payment_default', label: 'Deliberate payment default', report: 'DELIBERATE DRIVER PAYMENT DEFAULT', dept: 'DRIVER' },
  { key: 'impoundment', label: 'Impounded / fines / expired permits', report: 'IMPOUNDMENT/FINES/EXPIRED PERMITS', dept: 'DRIVER' },
  { key: 'platform_suspension', label: 'Platform suspension / downtime', report: 'PLATFORM SUSPENSION AND DOWNTIME', dept: 'DRIVER' },
  { key: 'reconciliation', label: 'Reconciliation discrepancy', report: 'RECONCILIATION DISCREPANCIES', dept: 'ADMINISTRATION' },
  { key: 'unassigned_car', label: 'Car not assigned', report: 'UNASSIGNED CARS', dept: 'ADMINISTRATION' },
];

// Reasons used before the CSR list, mapped to the nearest report reason.
const LEGACY = {
  sick: ['Sick', 'illness'], workshop: ['Workshop', 'major_repair'], maintenance: ['Maintenance', 'servicing'],
  funeral: ['Funeral', 'personal_emergency'], police: ['Police / impounded', 'impoundment'], other: ['Other', null],
};

const BY_KEY = Object.fromEntries(REASONS.map(r => [r.key, r]));

export const reasonInfo = key => {
  if (BY_KEY[key]) return BY_KEY[key];
  const [label, to] = LEGACY[key] || [String(key || '').replace(/_/g, ' '), null];
  const base = BY_KEY[to];
  return { key, label, report: base ? base.report : 'OTHER', dept: base ? base.dept : 'DRIVER' };
};
export const reasonLabel = key => reasonInfo(key).label;
export const excusedByDefault = key => reasonInfo(key).dept !== 'DRIVER';
