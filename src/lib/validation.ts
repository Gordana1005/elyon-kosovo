/**
 * Normalize a phone number by stripping all non-digit characters except leading +.
 */
export function normalizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
}

/**
 * Validate phone number format: must have at least 8 digits, optionally starting with +.
 */
export function isValidPhone(phone: string): boolean {
  const normalized = normalizePhone(phone);
  return /^\+?\d{8,15}$/.test(normalized);
}

/**
 * Check for duplicate phones within a list of entries.
 * Returns a Set of indices that are duplicates (keeps first occurrence).
 */
export function findDuplicatePhoneIndices(phones: string[]): Set<number> {
  const seen = new Map<string, number>();
  const dupes = new Set<number>();
  phones.forEach((phone, i) => {
    const norm = normalizePhone(phone);
    if (!norm) return;
    if (seen.has(norm)) {
      dupes.add(i);
    } else {
      seen.set(norm, i);
    }
  });
  return dupes;
}

/**
 * Validate that required fields are not empty.
 */
export function hasEmptyRequiredFields(row: { name: string; telephone: string }): boolean {
  return !row.name.trim() || !row.telephone.trim();
}
