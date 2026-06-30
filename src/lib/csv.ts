// Minimal CSV writer. No dependency.
//
// Default separator is ';' (semicolon) — that's what Excel in BG / DE / most
// of Europe expects when opening a .csv. Use ',' if the receiving system
// requires it.

export interface CsvColumn<T> {
  key: keyof T | string;
  header: string;
  /** Optional formatter — defaults to String(value ?? ''). */
  format?: (row: T) => string;
}

function escape(value: unknown, separator: string): string {
  if (value == null) return '';
  let s = String(value);
  // Quote if it contains the separator, a quote, or a newline.
  if (s.includes(separator) || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[], separator: string = ';', bom: boolean = true): string {
  const header = columns.map(c => escape(c.header, separator)).join(separator);
  const lines = rows.map(row => columns.map(c => {
    const raw = c.format ? c.format(row) : (row as any)[c.key];
    return escape(raw, separator);
  }).join(separator));
  const body = [header, ...lines].join('\r\n');
  // BOM so Excel detects UTF-8 (Cyrillic in customer names won't render mojibake).
  // Some import parsers choke on the BOM (it corrupts the first header), so it's
  // optional — pass bom=false to match a parser that wants raw UTF-8.
  return bom ? '﻿' + body : body;
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
