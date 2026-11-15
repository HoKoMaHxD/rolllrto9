import { REST, Routes } from 'discord.js';
import { config } from '../src/config.js';
import { registerCommands } from '../src/commands.js';
if(!config.token)throw new Error('BOT_TOKEN is required');
const app=await new REST({version:'10'}).setToken(config.token).get(Routes.oauth2CurrentApplication());
console.log(`Registered ${await registerCommands(config.token,app.id,config.guildId)} commands.`);
