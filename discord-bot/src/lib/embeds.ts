import { EmbedBuilder } from 'discord.js';

export const BRAND = 0x5865f2;

export function baseEmbed(title: string, color: number = BRAND): EmbedBuilder {
  return new EmbedBuilder().setTitle(title).setColor(color).setTimestamp(new Date());
}

export function errorEmbed(msg: string): EmbedBuilder {
  return new EmbedBuilder().setColor(0xef4444).setDescription(`⛔ ${msg}`);
}

export function infoEmbed(msg: string, color: number = BRAND): EmbedBuilder {
  return new EmbedBuilder().setColor(color).setDescription(msg);
}

/** Discord caps field values at 1024 chars; truncate safely. */
export function clip(s: string, max = 1024): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}
