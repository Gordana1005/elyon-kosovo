import { AttachmentBuilder } from 'discord.js';

function esc(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(esc).join(',')];
  for (const r of rows) lines.push(r.map(esc).join(','));
  // BOM so Excel opens Cyrillic correctly.
  return '﻿' + lines.join('\r\n');
}

export function csvAttachment(filename: string, headers: string[], rows: unknown[][]): AttachmentBuilder {
  return new AttachmentBuilder(Buffer.from(toCsv(headers, rows), 'utf8'), { name: filename });
}
