import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  GuildMember,
  ModalBuilder,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { createServer } from "node:http";

const token = process.env.DISCORD_TOKEN || process.env.TOKEN;
if (!token) throw new Error("TOKEN or DISCORD_TOKEN is required.");

const brand = 0x7c5cff;
const success = 0x39d98a;
const danger = 0xff5c7a;
const warnings = new Map<string, string[]>();
type Giveaway = { channelId: string; prize: string; winners: number; endsAt: number; participants: Set<string>; timer?: NodeJS.Timeout };
const giveaways = new Map<string, Giveaway>();
const endedGiveaways = new Map<string, Giveaway>();

const durationMs = (input: string) => {
  const match = input.trim().match(/^(\d+)\s*(s|m|h|d)$/i);
  if (!match) return null;
  const value = Number(match[1]);
  return value * ({ s: 1000, m: 60000, h: 3600000, d: 86400000 } as Record<string, number>)[match[2].toLowerCase()];
};

const embed = (title: string, description: string, color = brand) =>
  new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).setTimestamp();

const commands = [
  new SlashCommandBuilder().setName("help").setDescription("See all bot commands."),
  new SlashCommandBuilder().setName("ban").setDescription("Ban a member.")
    .addUserOption((o) => o.setName("user").setDescription("Member to ban").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Why they are being banned").setRequired(false)),
  new SlashCommandBuilder().setName("kick").setDescription("Kick a member.")
    .addUserOption((o) => o.setName("user").setDescription("Member to kick").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Why they are being kicked").setRequired(false)),
  new SlashCommandBuilder().setName("timeout").setDescription("Timeout a member.")
    .addUserOption((o) => o.setName("user").setDescription("Member to timeout").setRequired(true))
    .addStringOption((o) => o.setName("duration").setDescription("Examples: 10m, 2h, 1d").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Why they are being timed out").setRequired(false)),
  new SlashCommandBuilder().setName("warn").setDescription("Warn a member.")
    .addUserOption((o) => o.setName("user").setDescription("Member to warn").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason for warning").setRequired(true)),
  new SlashCommandBuilder().setName("purge").setDescription("Delete recent messages.")
    .addIntegerOption((o) => o.setName("amount").setDescription("1-100 messages").setMinValue(1).setMaxValue(100).setRequired(true)),
  new SlashCommandBuilder().setName("lock").setDescription("Lock the current channel."),
  new SlashCommandBuilder().setName("unlock").setDescription("Unlock the current channel."),
  new SlashCommandBuilder().setName("slowmode").setDescription("Set channel slowmode.")
    .addIntegerOption((o) => o.setName("seconds").setDescription("0-21600 seconds").setMinValue(0).setMaxValue(21600).setRequired(true)),
  new SlashCommandBuilder().setName("giveaway").setDescription("Manage giveaways.")
    .addSubcommand((s) => s.setName("start").setDescription("Start a giveaway.")
      .addStringOption((o) => o.setName("duration").setDescription("Examples: 10m, 2h, 1d").setRequired(true))
      .addIntegerOption((o) => o.setName("winners").setDescription("Number of winners").setMinValue(1).setMaxValue(20).setRequired(true))
      .addStringOption((o) => o.setName("prize").setDescription("What people can win").setRequired(true)))
    .addSubcommand((s) => s.setName("end").setDescription("End a giveaway now.")
      .addStringOption((o) => o.setName("message_id").setDescription("Giveaway message ID").setRequired(true)))
    .addSubcommand((s) => s.setName("reroll").setDescription("Reroll a giveaway winner.")
      .addStringOption((o) => o.setName("message_id").setDescription("Giveaway message ID").setRequired(true))),
  new SlashCommandBuilder().setName("ticket-panel").setDescription("Post the support ticket panel."),
].map((command) => command.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild));
commands[0].setDefaultMemberPermissions(null);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

const channelBlueprint = {
  HACKATHONS: ["📢・hackathon-alerts", "🏆・hackathon-discussion", "👥・find-a-team", "💡・hackathon-ideas", "📝・submission-help", "🎤・pitch-feedback", "🏅・results"],
  "TEAM FINDER": ["🔎・looking-for-team", "💻・developers", "🎨・designers", "🤖・ai-ml", "🔐・cybersecurity", "📊・data", "📣・marketing", "💼・business", "🎥・content"],
  STARTUPS: ["💡・startup-ideas", "🔍・validate-your-idea", "👥・find-a-cofounder", "📈・business", "💰・funding", "🎤・pitch-room", "🚀・startup-showcase"],
} as const;

async function finishGiveaway(messageId: string) {
  const giveaway = giveaways.get(messageId);
  if (!giveaway) return;
  giveaways.delete(messageId);
  endedGiveaways.set(messageId, giveaway);
  if (giveaway.timer) clearTimeout(giveaway.timer);
  const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
  if (!channel?.isTextBased() || !("send" in channel)) return;
  const message = await channel.messages.fetch(messageId).catch(() => null);
  const entries = [...giveaway.participants];
  const winners = entries.sort(() => Math.random() - 0.5).slice(0, Math.min(giveaway.winners, entries.length));
  const result = winners.length ? winners.map((id) => `<@${id}>`).join(", ") : "No valid entries.";
  await message?.edit({ embeds: [embed("Giveaway ended", `**${giveaway.prize}**\n\nWinner${winners.length === 1 ? "" : "s"}: ${result}`, success)], components: [] });
  await channel.send({ embeds: [embed("Congratulations", `The winner${winners.length === 1 ? "" : "s"} of **${giveaway.prize}**: ${result}`, success)] });
}

const registerCommands = async () => {
  const rest = new REST({ version: "10" }).setToken(token);
  const guildId = process.env.DISCORD_GUILD_ID;
  if (guildId) await rest.put(Routes.applicationGuildCommands(client.user!.id, guildId), { body: commands.map((c) => c.toJSON()) });
  else await rest.put(Routes.applicationCommands(client.user!.id), { body: commands.map((c) => c.toJSON()) });
};

client.once(Events.ClientReady, async () => {
  await registerCommands();
  console.info(`Logged in as ${client.user?.tag}. Commands registered.`);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || message.content.trim().toLowerCase() !== ".setupchannels" || !message.guild) return;
  if (!message.member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await message.reply("You need **Manage Server** permission to run `.setupchannels`.");
    return;
  }
  try {
    const created: string[] = [];
    for (const [categoryName, channelNames] of Object.entries(channelBlueprint)) {
      let category = message.guild.channels.cache.find((channel) => channel.type === ChannelType.GuildCategory && channel.name === categoryName);
      if (!category) {
        category = await message.guild.channels.create({ name: categoryName, type: ChannelType.GuildCategory });
        created.push(`**${categoryName}** category`);
      }
      const categoryId = category.id;
      for (const channelName of channelNames) {
        const exists = message.guild.channels.cache.find((channel) => channel.parentId === categoryId && channel.name === channelName);
        if (!exists) {
          await message.guild.channels.create({ name: channelName, type: ChannelType.GuildText, parent: categoryId });
          created.push(`#${channelName}`);
        }
      }
    }
    await message.reply({
      embeds: [
        embed(
          "Server channels are ready",
          created.length ? `Created **${created.length}** new item${created.length === 1 ? "" : "s"} across your hackathon, team finder, and startup spaces.` : "Everything is already set up. No duplicate channels were created.",
          success,
        ),
      ],
    });
  } catch (error) {
    console.error("Channel setup failed", error);
    await message.reply("I couldn’t finish setting up the channels. Make sure my role has **Manage Channels** and is above the relevant roles.");
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isButton() && interaction.customId === "ticket:create") {
      if (!interaction.guild || !interaction.member) return;
      const existing = interaction.guild.channels.cache.find((c) => c.name === `ticket-${interaction.user.username.toLowerCase()}`);
      if (existing) return interaction.reply({ content: `You already have an open ticket: ${existing}`, ephemeral: true });
      const channel = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username.toLowerCase()}`.slice(0, 90),
        type: ChannelType.GuildText,
        parent: process.env.TICKET_CATEGORY_ID || undefined,
        permissionOverwrites: [
          { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
          ...(process.env.TICKET_ROLE_ID ? [{ id: process.env.TICKET_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }] : []),
        ],
      });
      const close = new ButtonBuilder().setCustomId("ticket:close").setLabel("Close ticket").setStyle(ButtonStyle.Danger);
      await channel.send({ content: `<@${interaction.user.id}>`, embeds: [embed("Ticket opened", "Thanks for reaching out. Tell the team what you need help with.\n\nA moderator can close this ticket when you are done.")], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(close)] });
      return interaction.reply({ content: `Your ticket is ready: ${channel}`, ephemeral: true });
    }
    if (interaction.isButton() && interaction.customId === "ticket:close") {
      await interaction.reply({ embeds: [embed("Ticket closed", "This channel will be removed in 5 seconds.", danger)] });
      setTimeout(() => interaction.channel?.delete().catch(() => undefined), 5000);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith("giveaway:")) {
      const id = interaction.message.id;
      const giveaway = giveaways.get(id);
      if (!giveaway) return interaction.reply({ content: "This giveaway is no longer active.", ephemeral: true });
      giveaway.participants.add(interaction.user.id);
      return interaction.reply({ content: "You are entered. Good luck.", ephemeral: true });
    }
    if (!interaction.isChatInputCommand()) return;
    const member = interaction.member as GuildMember;
    if (interaction.commandName === "help") {
      return interaction.reply({ embeds: [embed("Aegis command center", "**Moderation**\n`/ban` `/kick` `/timeout` `/warn` `/purge` `/lock` `/unlock` `/slowmode`\n\n**Community**\n`/giveaway start` `/giveaway end` `/giveaway reroll` `/ticket-panel`")], ephemeral: true });
    }
    if (!interaction.guild) return interaction.reply({ content: "This command only works inside a server.", ephemeral: true });
    if (interaction.commandName === "ban" || interaction.commandName === "kick") {
      const user = interaction.options.getUser("user", true);
      const target = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!target) return interaction.reply({ content: "I couldn't find that member.", ephemeral: true });
      const reason = interaction.options.getString("reason") || "No reason provided";
      if (interaction.commandName === "ban") await target.ban({ reason });
      else await target.kick(reason);
      return interaction.reply({ embeds: [embed(`${interaction.commandName === "ban" ? "Member banned" : "Member kicked"}`, `**${user.tag}**\n${reason}`, success)] });
    }
    if (interaction.commandName === "timeout") {
      const user = interaction.options.getUser("user", true);
      const target = await interaction.guild.members.fetch(user.id).catch(() => null);
      const ms = durationMs(interaction.options.getString("duration", true));
      if (!target || !ms || ms > 28 * 86400000) return interaction.reply({ content: "Use a valid duration up to 28d and a current server member.", ephemeral: true });
      await target.timeout(ms, interaction.options.getString("reason") || "No reason provided");
      return interaction.reply({ embeds: [embed("Member timed out", `**${user.tag}** for **${interaction.options.getString("duration", true)}**`, success)] });
    }
    if (interaction.commandName === "warn") {
      const user = interaction.options.getUser("user", true);
      const reason = interaction.options.getString("reason", true);
      const key = `${interaction.guild.id}:${user.id}`;
      const list = warnings.get(key) || [];
      list.push(reason);
      warnings.set(key, list);
      return interaction.reply({ embeds: [embed("Warning issued", `**${user.tag}** now has **${list.length}** warning${list.length === 1 ? "" : "s"}.\n\n${reason}`, danger)] });
    }
    if (interaction.commandName === "purge") {
      const amount = interaction.options.getInteger("amount", true);
      if (!interaction.channel?.isTextBased() || !("bulkDelete" in interaction.channel)) return interaction.reply({ content: "This channel does not support message cleanup.", ephemeral: true });
      await interaction.deferReply({ ephemeral: true });
      await interaction.channel.bulkDelete(amount, true);
      return interaction.editReply({ embeds: [embed("Channel cleaned", `Deleted **${amount}** recent messages.`, success)] });
    }
    if (["lock", "unlock"].includes(interaction.commandName)) {
      const channel = interaction.channel;
      if (!channel || !("permissionOverwrites" in channel)) return interaction.reply({ content: "This channel cannot be locked.", ephemeral: true });
      await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: interaction.commandName === "unlock" });
      return interaction.reply({ embeds: [embed(interaction.commandName === "lock" ? "Channel locked" : "Channel unlocked", interaction.commandName === "lock" ? "Only moderators can speak here now." : "Members can speak here again.", success)] });
    }
    if (interaction.commandName === "slowmode") {
      const seconds = interaction.options.getInteger("seconds", true);
      if (!interaction.channel || !("setRateLimitPerUser" in interaction.channel)) return interaction.reply({ content: "This channel does not support slowmode.", ephemeral: true });
      await interaction.channel.setRateLimitPerUser(seconds);
      return interaction.reply({ embeds: [embed("Slowmode updated", seconds ? `Members can send one message every **${seconds}s**.` : "Slowmode is disabled.", success)] });
    }
    if (interaction.commandName === "ticket-panel") {
      const button = new ButtonBuilder().setCustomId("ticket:create").setLabel("Open a ticket").setStyle(ButtonStyle.Primary);
      return interaction.reply({ embeds: [embed("Need a hand?", "Press the button below to open a private support ticket. Please include as much detail as possible so the team can help quickly.")], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button)] });
    }
    if (interaction.commandName === "giveaway") {
      const sub = interaction.options.getSubcommand();
      const messageId = interaction.options.getString("message_id");
      if (sub === "start") {
        const ms = durationMs(interaction.options.getString("duration", true));
        const winners = interaction.options.getInteger("winners", true);
        const prize = interaction.options.getString("prize", true);
        if (!ms || ms < 10000 || ms > 30 * 86400000) return interaction.reply({ content: "Use a duration between 10s and 30d.", ephemeral: true });
        const button = new ButtonBuilder().setCustomId("giveaway:enter").setLabel("Enter giveaway").setStyle(ButtonStyle.Success);
        const message = await interaction.reply({ embeds: [embed("Giveaway live", `## ${prize}\n\nReact by pressing **Enter giveaway** below.\n\n**Winners:** ${winners}\n**Ends:** <t:${Math.floor((Date.now() + ms) / 1000)}:R>\n**Hosted by:** ${interaction.user}`)], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button)], fetchReply: true });
        const state: Giveaway = { channelId: interaction.channelId, prize, winners, endsAt: Date.now() + ms, participants: new Set<string>() };
        state.timer = setTimeout(() => finishGiveaway(message.id), ms);
        giveaways.set(message.id, state);
        return;
      }
      if (!messageId) return interaction.reply({ content: "Provide the giveaway message ID.", ephemeral: true });
      if (sub === "end") {
        await finishGiveaway(messageId);
        return interaction.reply({ content: "Giveaway ended.", ephemeral: true });
      }
      const giveaway = endedGiveaways.get(messageId);
      if (!giveaway || !giveaway.participants.size) return interaction.reply({ content: "I couldn't reroll that giveaway. It may not exist or had no valid entries.", ephemeral: true });
      const winner = [...giveaway.participants][Math.floor(Math.random() * giveaway.participants.size)];
      return interaction.reply({ embeds: [embed("Giveaway rerolled", `New winner for **${giveaway.prize}**: <@${winner}>`, success)] });
    }
    return;
  } catch (error) {
    console.error("Interaction failed", error);
    if (interaction.isRepliable() && !interaction.replied) await interaction.reply({ content: "Something went wrong while running that command.", ephemeral: true });
    return;
  }
});

const port = Number(process.env.PORT || 3000);
createServer((_request, response) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ ok: true, service: "aegis-discord-bot", uptime: process.uptime() }));
}).listen(port, "0.0.0.0", () => console.info(`Railway health server listening on ${port}`));

client.login(token);