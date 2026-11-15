import { SlashCommandBuilder, PermissionFlagsBits, REST, Routes } from 'discord.js';

const pointsCommand=(name,description)=>new SlashCommandBuilder().setName(name).setDescription(description)
  .setDMPermission(false).setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand(s=>s.setName('نقاط').setDescription(description)
    .addUserOption(o=>o.setName('الشخص').setDescription('اللاعب').setRequired(true))
    .addIntegerOption(o=>o.setName('العدد').setDescription('عدد النقاط').setRequired(true).setMinValue(1).setMaxValue(1000000)));
export const commands=[
  pointsCommand('اضافة','إضافة نقاط إلى لاعب'), pointsCommand('ازالة','إزالة نقاط من لاعب'),
  new SlashCommandBuilder().setName('نقاط').setDescription('عرض نقاط وفوزات اللاعب وأغراضه').setDMPermission(false)
    .addUserOption(o=>o.setName('الشخص').setDescription('اتركه فارغًا لعرض بياناتك')),
  new SlashCommandBuilder().setName('المتصدرين').setDescription('أكثر اللاعبين فوزًا في السيرفر').setDMPermission(false),
  new SlashCommandBuilder().setName('العاب').setDescription('شرح الألعاب والأوامر').setDMPermission(false),
  new SlashCommandBuilder().setName('ايقاف').setDescription('إيقاف القيم الحالي لصاحب القيم أو الإدارة').setDMPermission(false),
].map(c=>c.toJSON());

export async function registerCommands(token,applicationId,guildId){
  const rest=new REST({version:'10'}).setToken(token);
  const route=guildId?Routes.applicationGuildCommands(applicationId,guildId):Routes.applicationCommands(applicationId);
  // Update only commands owned by this project. Do not delete unrelated application commands.
  for(const command of commands)await rest.post(route,{body:command});
  return commands.length;
}
