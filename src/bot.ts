import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  CategoryChannel,
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  Guild,
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
const inviteCache = new Map<string, Map<string, { uses: number; inviterId?: string }>>();
const inviteCounts = new Map<string, Map<string, number>>();

const durationMs = (input: string) => {
  const match = input.trim().match(/^(\d+)\s*(s|m|h|d)$/i);
  if (!match) return null;
  const value = Number(match[1]);
  return value * ({ s: 1000, m: 60000, h: 3600000, d: 86400000 } as Record<string, number>)[match[2].toLowerCase()];
};

const embed = (title: string, description: string, color = brand) =>
  new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).setTimestamp();

const ticketStaffRoleIds = () =>
  [...new Set([process.env.TICKET_ROLE_ID, process.env.MOD_ROLE_ID].filter((id): id is string => Boolean(id)))];

const cacheGuildInvites = async (guild: Guild) => {
  try {
    const invites = await guild.invites.fetch();
    inviteCache.set(
      guild.id,
      new Map(invites.map((invite) => [invite.code, { uses: invite.uses ?? 0, inviterId: invite.inviter?.id }])),
    );
  } catch (error) {
    console.warn(`Invite tracking unavailable for ${guild.name}. The bot needs Manage Server permission.`, error);
  }
};

const commands = [
  new SlashCommandBuilder().setName("help").setDescription("See all bot commands."),
  new SlashCommandBuilder().setName("ping").setDescription("Check bot and Discord API latency."),
  new SlashCommandBuilder().setName("invites").setDescription("See how many members joined using your invite.")
    .addUserOption((o) => o.setName("member").setDescription("Staff can check another member").setRequired(false)),
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
for (const command of commands) {
  if (["help", "ping"].includes(command.name)) command.setDefaultMemberPermissions(null);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

const channelBlueprint = {
  HACKATHONS: ["📢・hackathon-alerts", "🏆・hackathon-discussion", "👥・find-a-team", "💡・hackathon-ideas", "📝・submission-help", "🎤・pitch-feedback", "🏅・results"],
  "TEAM FINDER": ["🔎・looking-for-team", "💻・developers", "🎨・designers", "🤖・ai-ml", "🔐・cybersecurity", "📊・data", "📣・marketing", "💼・business", "🎥・content"],
  STARTUPS: ["💡・startup-ideas", "🔍・validate-your-idea", "👥・find-a-cofounder", "📈・business", "💰・funding", "🎤・pitch-room", "🚀・startup-showcase"],
} as const;
const readOnlyChannels = new Set(["📢・hackathon-alerts", "🏅・results"]);

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
  await Promise.all(client.guilds.cache.map((guild) => cacheGuildInvites(guild)));
  console.info(`Logged in as ${client.user?.tag}. Commands registered.`);
});

client.on(Events.GuildCreate, async (guild) => {
  await cacheGuildInvites(guild);
});

client.on(Events.GuildMemberAdd, async (member) => {
  try {
    const invites = await member.guild.invites.fetch();
    const previous = inviteCache.get(member.guild.id) || new Map<string, { uses: number; inviterId?: string }>();
    let usedInvite: { uses: number; inviterId?: string } | undefined;

    for (const invite of invites.values()) {
      const oldInvite = previous.get(invite.code);
      if ((invite.uses ?? 0) > (oldInvite?.uses ?? 0) && (!usedInvite || (invite.uses ?? 0) > usedInvite.uses)) {
        usedInvite = { uses: invite.uses ?? 0, inviterId: invite.inviter?.id };
      }
    }

    inviteCache.set(
      member.guild.id,
      new Map(invites.map((invite) => [invite.code, { uses: invite.uses ?? 0, inviterId: invite.inviter?.id }])),
    );

    if (!usedInvite?.inviterId) return;
    const guildCounts = inviteCounts.get(member.guild.id) || new Map<string, number>();
    guildCounts.set(usedInvite.inviterId, (guildCounts.get(usedInvite.inviterId) || 0) + 1);
    inviteCounts.set(member.guild.id, guildCounts);
    console.info(`${member.user.tag} joined ${member.guild.name} through invite owner ${usedInvite.inviterId}.`);
  } catch (error) {
    console.warn(`Could not determine the invite used by ${member.user.tag} in ${member.guild.name}.`, error);
  }
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

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || message.content.trim().toLowerCase() !== ".permschannels" || !message.guild) return;
  if (!message.member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await message.reply("You need **Manage Server** permission to run `.permschannels`.");
    return;
  }
  try {
    const botMember = message.guild.members.me;
    if (!botMember) {
      await message.reply("I couldn’t resolve my server member record. Try again in a moment.");
      return;
    }
    const moderatorRole = process.env.MOD_ROLE_ID ? message.guild.roles.cache.get(process.env.MOD_ROLE_ID) : undefined;
    let updated = 0;
    let missing = 0;
    for (const [categoryName, channelNames] of Object.entries(channelBlueprint)) {
      const category = message.guild.channels.cache.find((channel): channel is CategoryChannel => channel.type === ChannelType.GuildCategory && channel.name === categoryName);
      if (!category) {
        missing += channelNames.length;
        continue;
      }
      await category.permissionOverwrites.edit(message.guild.roles.everyone, {
        ViewChannel: true,
        ReadMessageHistory: true,
        SendMessages: true,
      });
      await category.permissionOverwrites.edit(botMember, {
        ViewChannel: true,
        ReadMessageHistory: true,
        SendMessages: true,
        ManageMessages: true,
        ManageChannels: true,
        EmbedLinks: true,
        AttachFiles: true,
      });
      if (moderatorRole) {
        await category.permissionOverwrites.edit(moderatorRole, {
          ViewChannel: true,
          ReadMessageHistory: true,
          SendMessages: true,
          ManageMessages: true,
        });
      }
      for (const channelName of channelNames) {
        const channel = message.guild.channels.cache.find((candidate) => candidate.parentId === category.id && candidate.name === channelName);
        if (!channel || !("permissionOverwrites" in channel)) {
          missing++;
          continue;
        }
        await channel.permissionOverwrites.edit(message.guild.roles.everyone, {
          ViewChannel: true,
          ReadMessageHistory: true,
          SendMessages: !readOnlyChannels.has(channelName),
        });
        await channel.permissionOverwrites.edit(botMember, {
          ViewChannel: true,
          ReadMessageHistory: true,
          SendMessages: true,
          ManageMessages: true,
          ManageChannels: true,
          EmbedLinks: true,
          AttachFiles: true,
        });
        if (moderatorRole) {
          await channel.permissionOverwrites.edit(moderatorRole, {
            ViewChannel: true,
            ReadMessageHistory: true,
            SendMessages: true,
            ManageMessages: true,
          });
        }
        updated++;
      }
    }
    await message.reply({
      embeds: [
        embed(
          "Channel permissions updated",
          `Applied the public channel rules and bot permissions to **${updated}** channel${updated === 1 ? "" : "s"}.${missing ? `\n\n**${missing}** channel${missing === 1 ? " is" : "s are"} missing — run \`.setupchannels\` first.` : ""}`,
          success,
        ),
      ],
    });
  } catch (error) {
    console.error("Channel permissions setup failed", error);
    await message.reply("I couldn’t update the channel permissions. Make sure my role has **Manage Channels**.");
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
          ...ticketStaffRoleIds().map((id) => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] })),
        ],
      });
      const close = new ButtonBuilder().setCustomId("ticket:close").setLabel("Close ticket").setStyle(ButtonStyle.Danger);
      await channel.send({ content: `<@${interaction.user.id}>`, embeds: [embed("Ticket opened", "Thanks for reaching out. Tell the team what you need help with.\n\nA moderator can close this ticket when you are done.")], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(close)] });
      return interaction.reply({ content: `Your ticket is ready: ${channel}`, ephemeral: true });
    }
    if (interaction.isButton() && interaction.customId === "ticket:close") {
      const staffMember = interaction.member as GuildMember;
      const isStaff = staffMember.permissions.has(PermissionFlagsBits.ManageGuild) || ticketStaffRoleIds().some((id) => staffMember.roles.cache.has(id));
      if (!isStaff) return interaction.reply({ content: "Only staff can close support tickets.", ephemeral: true });
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
      return interaction.reply({ embeds: [embed("Aegis command center", "**Moderation**\n`/ban` `/kick` `/timeout` `/warn` `/purge` `/lock` `/unlock` `/slowmode`\n\n**Community**\n`/giveaway start` `/giveaway end` `/giveaway reroll` `/ticket-panel` `/invites`\n\n**Server setup**\n`.setupchannels` `.permschannels`")], ephemeral: true });
    }
    if (interaction.commandName === "ping") {
      const roundTrip = Date.now() - interaction.createdTimestamp;
      return interaction.reply({ embeds: [embed("Pong", `Bot latency: **${roundTrip}ms**\nDiscord API latency: **${client.ws.ping}ms**`, success)] });
    }
    if (!interaction.guild) return interaction.reply({ content: "This command only works inside a server.", ephemeral: true });
    if (interaction.commandName === "invites") {
      const requestedMember = interaction.options.getMember("member");
      const requestedUser = interaction.options.getUser("member") || interaction.user;
      const canViewOthers = member.permissions.has(PermissionFlagsBits.ManageGuild);
      if (requestedUser.id !== interaction.user.id && !canViewOthers) {
        return interaction.reply({ content: "You can only view your own invite count.", ephemeral: true });
      }
      const count = inviteCounts.get(interaction.guild.id)?.get(requestedUser.id) || 0;
      return interaction.reply({
        embeds: [
          embed(
            "Invite tracker",
            `${requestedMember || requestedUser} has **${count}** confirmed member join${count === 1 ? "" : "s"} from their invite links.\n\nInvite counts are tracked in memory and reset if the bot restarts.`,
            success,
          ),
        ],
      });
    }
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