import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const BRAND_NAME = 'SNOW GAMES';
function integer(name, fallback, min, max) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}`);
  return value;
}
const csv = name => new Set((process.env[name] || '').split(',').map(s => s.trim()).filter(Boolean));
export const config = {
  token: process.env.BOT_TOKEN,
  guildId: process.env.GUILD_ID || null,
  admins: csv('ADMIN_IDS'),
  channels: csv('GAME_CHANNEL_IDS'),
  roleId: process.env.GAME_ROLE_ID || null,
  dataDir: path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data')),
  maxPlayers: integer('MAX_PLAYERS', 50, 2, 50),
  lobbyMs: integer('LOBBY_SECONDS', 20, 5, 120) * 1000,
  turnMs: integer('TURN_SECONDS', 20, 5, 120) * 1000,
  hideMs: integer('HIDE_SECONDS', 20, 5, 120) * 1000,
  chairMs: integer('CHAIR_SECONDS', 3, 3, 60) * 1000,
  reverseMs: integer('REVERSE_SECONDS', 4, 2, 30) * 1000,
};
export const GAME_NAMES = { roulette: 'روليت', hide: 'هايد', mines: 'ألغام', chairs: 'كراسي', reverse: 'روليت عكسي' };
export const PREFIXES = { '+r': 'roulette', '+h': 'hide', '+m': 'mines', '+c': 'chairs', '-r': 'reverse' };
export const ITEMS = {
  reflect: { name: 'مرتدة', price: 2, emoji: '🛡️' },
  reveal: { name: 'كشف', price: 1, emoji: '🔎' },
  nuke: { name: 'قنبلة نووية', price: 10, emoji: '☢️' },
};
