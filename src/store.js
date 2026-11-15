import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ITEMS } from './config.js';

export class Store {
  constructor(filename) {
    if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS profiles (
        guild TEXT NOT NULL, user TEXT NOT NULL, points INTEGER NOT NULL DEFAULT 0 CHECK(points >= 0),
        wins INTEGER NOT NULL DEFAULT 0 CHECK(wins >= 0), reflect INTEGER NOT NULL DEFAULT 0,
        reveal INTEGER NOT NULL DEFAULT 0, nuke INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(guild,user));
      CREATE TABLE IF NOT EXISTS rewards (game TEXT PRIMARY KEY, guild TEXT NOT NULL, user TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, guild TEXT, user TEXT, actor TEXT, reason TEXT, amount INTEGER, at INTEGER);`);
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  ensure(guild, user) { this.db.prepare('INSERT OR IGNORE INTO profiles(guild,user) VALUES(?,?)').run(guild, user); }
  get(guild, user) {
    this.ensure(guild, user);
    return { ...this.db.prepare('SELECT points,wins,reflect,reveal,nuke FROM profiles WHERE guild=? AND user=?').get(guild, user) };
  }
  log(guild, user, actor, reason, amount) {
    this.db.prepare('INSERT INTO audit(guild,user,actor,reason,amount,at) VALUES(?,?,?,?,?,?)').run(guild,user,actor,reason,amount,Date.now());
  }
  adjust(guild, user, amount, actor) {
    if (!Number.isSafeInteger(amount) || amount === 0 || Math.abs(amount) > 1000000) throw new Error('العدد يجب أن يكون بين 1 و1,000,000.');
    return this.transaction(() => {
      const p = this.get(guild,user);
      if (p.points + amount < 0) throw new Error('لا يملك اللاعب هذا العدد من النقاط.');
      if (p.points + amount > 1000000000) throw new Error('تجاوز الحد الأعلى للنقاط.');
      this.db.prepare('UPDATE profiles SET points=points+? WHERE guild=? AND user=?').run(amount,guild,user);
      this.log(guild,user,actor,'admin_adjust',amount);
      return this.get(guild,user);
    });
  }
  buy(guild, user, item) {
    if (!Object.hasOwn(ITEMS, item)) throw new Error('غرض غير صالح.');
    return this.transaction(() => {
      const p=this.get(guild,user), price=ITEMS[item].price;
      if (p.points < price) throw new Error(`رصيدك غير كافٍ؛ السعر ${price} نقطة ورصيدك ${p.points}.`);
      if (p[item] >= 99) throw new Error('وصلت للحد الأعلى من هذا الغرض (99).');
      this.db.prepare(`UPDATE profiles SET points=points-?, ${item}=${item}+1 WHERE guild=? AND user=?`).run(price,guild,user);
      this.log(guild,user,user,`buy_${item}`,-price);
      return this.get(guild,user);
    });
  }
  consume(guild, user, item) {
    if (!Object.hasOwn(ITEMS,item)) throw new Error('غرض غير صالح.');
    const result=this.db.prepare(`UPDATE profiles SET ${item}=${item}-1 WHERE guild=? AND user=? AND ${item}>0`).run(guild,user);
    return result.changes === 1;
  }
  reward(game, guild, user) {
    return this.transaction(() => {
      this.ensure(guild,user);
      const added=this.db.prepare('INSERT OR IGNORE INTO rewards(game,guild,user,at) VALUES(?,?,?,?)').run(game,guild,user,Date.now());
      if(added.changes){
        this.db.prepare('UPDATE profiles SET points=points+1,wins=wins+1 WHERE guild=? AND user=?').run(guild,user);
        this.log(guild,user,user,'win',1);
      }
      return this.get(guild,user);
    });
  }
  top(guild) { return this.db.prepare('SELECT user,points,wins FROM profiles WHERE guild=? ORDER BY wins DESC,points DESC LIMIT 10').all(guild); }
  close() { this.db.close(); }
}
