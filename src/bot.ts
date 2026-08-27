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

const robloxGroupId = process.env.ROBLOX_GROUP_ID;
const robloxGroupUrl = process.env.ROBLOX_GROUP_URL || (robloxGroupId ? `https://www.roblox.com/communities/${robloxGroupId}` : "");
const robuxProducts = [1, 2, 3].map((number) => ({
  name: process.env[`ROBUX_ITEM_${number}_NAME`] || `TNM Access Shirt ${number}`,
  price: process.env[`ROBUX_ITEM_${number}_PRICE`] || "Not configured",
  assetId: process.env[`ROBUX_ITEM_${number}_ID`],
  url: process.env[`ROBUX_ITEM_${number}_URL`],
}));
const syncRoleMappings = new Map<string, string>();

const robloxRequest = async (path: string, init?: RequestInit) => {
  const response = await fetch(`https://${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
  });
  if (!response.ok) throw new Error(`Roblox API request failed with ${response.status}`);
  return response.json() as Promise<Record<string, any>>;
};

const findRobloxUser = async (username: string) => {
  const result = await robloxRequest("users.roblox.com/v1/usernames/users", {
    method: "POST",
    body: JSON.stringify({ usernames: [username], excludeBannedUsers: false }),
  });
  return result.data?.[0] as { id: number; name: string; displayName: string } | undefined;
};

const findRobloxGroupRole = async (userId: number) => {
  if (!robloxGroupId) return undefined;
  const result = await robloxRequest(`groups.roblox.com/v2/users/${userId}/groups/roles`);
  return result.data?.find((entry: { group?: { id: number }; role?: { name: string; rank: number } }) => String(entry.group?.id) === robloxGroupId)?.role as { name: string; rank: number } | undefined;
};

const commands = [
  new SlashCommandBuilder().setName("help").setDescription("See all bot commands."),
  new SlashCommandBuilder().setName("robux").setDescription("Show the three TNM access shirts and their Robux prices."),
  new SlashCommandBuilder().setName("check").setDescription("Check a Roblox user's shirt ownership and avatar status.")
    .addStringOption((o) => o.setName("username").setDescription("Roblox username").setRequired(true)),
  new SlashCommandBuilder().setName("payments").setDescription("Show the available payment methods."),
  new SlashCommandBuilder().setName("group").setDescription("Get the TNM Roblox community link."),
  new SlashCommandBuilder().setName("ping").setDescription("Check bot and Discord API latency."),
  new SlashCommandBuilder().setName("rank").setDescription("Check a Roblox rank and sync the matching Discord role.")
    .addStringOption((o) => o.setName("username").setDescription("Roblox username").setRequired(true))
    .addStringOption((o) => o.setName("rank").setDescription("Expected Roblox group role name").setRequired(true))
    .addUserOption((o) => o.setName("member").setDescription("Discord member to sync").setRequired(true)),
  new SlashCommandBuilder().setName("syncrank").setDescription("Manage Roblox-to-Discord rank mappings.")
    .addSubcommand((s) => s.setName("set").setDescription("Map a Roblox group role to a Discord role.")
      .addStringOption((o) => o.setName("roblox_role").setDescription("Roblox group role name").setRequired(true))
      .addRoleOption((o) => o.setName("discord_role").setDescription("Discord role to assign").setRequired(true))),
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
  if (["help", "robux", "check", "payments", "group", "ping"].includes(command.name)) command.setDefaultMemberPermissions(null);
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
      return interaction.reply({ embeds: [embed("Aegis command center", "**Moderation**\n`/ban` `/kick` `/timeout` `/warn` `/purge` `/lock` `/unlock` `/slowmode`\n\n**Community**\n`/giveaway start` `/giveaway end` `/giveaway reroll` `/ticket-panel`\n\n**Roblox**\n`/robux` `/check` `/payments` `/group` `/rank` `/syncrank set`\n\n**Server setup**\n`.setupchannels` `.permschannels`")], ephemeral: true });
    }
    if (interaction.commandName === "robux") {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(brand)
            .setTitle("TNM access shirts")
            .setDescription("Choose the access shirt that matches your role.")
            .addFields(robuxProducts.map((product) => ({ name: product.name, value: `${product.price} Robux${product.url ? `\n[View shirt](${product.url})` : ""}`, inline: true })))
            .setTimestamp(),
        ],
      });
    }
    if (interaction.commandName === "payments") {
      const methods = [
        ["Venmo", process.env.VENMO_USERNAME],
        ["Cash App", process.env.CASHAPP_USERNAME],
        ["PayPal", process.env.PAYPAL_USERNAME],
        ["Zelle", process.env.ZELLE_CONTACT],
        ["Apple Pay", process.env.APPLE_PAY_CONTACT],
      ];
      const configured = methods.filter(([, value]) => value).map(([name, value]) => `**${name}:** ${value}`);
      return interaction.reply({
        embeds: [
          embed(
            "Payment methods",
            configured.length ? configured.join("\n") : "Payment details have not been configured yet. Ask an administrator to add the payment environment variables.",
          ),
        ],
      });
    }
    if (interaction.commandName === "group") {
      return interaction.reply({
        embeds: [
          embed(
            "TNM Roblox community",
            robloxGroupUrl ? `[Join the TNM Roblox community](${robloxGroupUrl})` : "The Roblox group link has not been configured yet. Ask an administrator to set `ROBLOX_GROUP_URL`.",
          ),
        ],
      });
    }
    if (interaction.commandName === "ping") {
      const roundTrip = Date.now() - interaction.createdTimestamp;
      return interaction.reply({ embeds: [embed("Pong", `Bot latency: **${roundTrip}ms**\nDiscord API latency: **${client.ws.ping}ms**`, success)] });
    }
    if (interaction.commandName === "check") {
      const username = interaction.options.getString("username", true);
      await interaction.deferReply();
      const robloxUser = await findRobloxUser(username);
      if (!robloxUser) return interaction.editReply({ embeds: [embed("Roblox user not found", `I couldn't find a Roblox user named **${username}**.`, danger)] });
      const configuredIds = new Set(robuxProducts.flatMap((product) => product.assetId ? [Number(product.assetId)] : []));
      const [inventory, wearing] = await Promise.allSettled([
        robloxRequest(`inventory.roblox.com/v1/users/${robloxUser.id}/items/Asset?assetTypes=Shirt&sortOrder=Desc&limit=100`),
        robloxRequest(`avatar.roblox.com/v1/users/${robloxUser.id}/currently-wearing`),
      ]);
      const ownedIds = inventory.status === "fulfilled" ? new Set((inventory.value.data || []).map((item: { id: number }) => item.id)) : new Set<number>();
      const wornIds = wearing.status === "fulfilled" ? new Set((wearing.value.assetIds || []) as number[]) : new Set<number>();
      const owned = configuredIds.size ? [...configuredIds].some((id) => ownedIds.has(id)) : false;
      const worn = configuredIds.size ? [...configuredIds].some((id) => wornIds.has(id)) : false;
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(brand)
            .setTitle(`Roblox check: ${robloxUser.displayName}`)
            .setURL(`https://www.roblox.com/users/${robloxUser.id}/profile`)
            .setThumbnail(`https://www.roblox.com/headshot-thumbnail/image?userId=${robloxUser.id}&width=150&height=150&format=png`)
            .addFields(
              { name: "Username", value: `@${robloxUser.name}`, inline: true },
              { name: "Configured shirt owned", value: configuredIds.size ? (inventory.status === "fulfilled" ? (owned ? "Yes" : "No") : "Private or unavailable") : "Not configured", inline: true },
              { name: "Currently wearing", value: configuredIds.size ? (wearing.status === "fulfilled" ? (worn ? "Yes" : "No") : "Unavailable") : "Not configured", inline: true },
            )
            .setDescription(configuredIds.size ? "Checked against the configured TNM access shirt IDs." : "Add `ROBUX_ITEM_1_ID`, `ROBUX_ITEM_2_ID`, and `ROBUX_ITEM_3_ID` to enable shirt ownership checks.")
            .setTimestamp(),
        ],
      });
    }
    if (!interaction.guild) return interaction.reply({ content: "This command only works inside a server.", ephemeral: true });
    if (interaction.commandName === "syncrank") {
      const robloxRole = interaction.options.getString("roblox_role", true).trim().toLowerCase();
      const discordRole = interaction.options.getRole("discord_role", true);
      syncRoleMappings.set(robloxRole, discordRole.id);
      return interaction.reply({ embeds: [embed("Rank mapping saved", `Roblox role **${robloxRole}** now syncs to Discord role **${discordRole.name}**.`, success)] });
    }
    if (interaction.commandName === "rank") {
      const username = interaction.options.getString("username", true);
      const expectedRole = interaction.options.getString("rank", true).trim().toLowerCase();
      const discordUser = interaction.options.getUser("member", true);
      await interaction.deferReply();
      const robloxUser = await findRobloxUser(username);
      if (!robloxUser) return interaction.editReply({ embeds: [embed("Roblox user not found", `I couldn't find a Roblox user named **${username}**.`, danger)] });
      const groupRole = await findRobloxGroupRole(robloxUser.id);
      if (!groupRole) return interaction.editReply({ embeds: [embed("Roblox group rank not found", robloxGroupId ? `**${robloxUser.name}** is not in the configured Roblox group.` : "Set `ROBLOX_GROUP_ID` before using `/rank`.", danger)] });
      if (groupRole.name.trim().toLowerCase() !== expectedRole) return interaction.editReply({ embeds: [embed("Rank mismatch", `Roblox reports **${robloxUser.name}** as **${groupRole.name}**, not **${expectedRole}**.`, danger)] });
      const roleId = syncRoleMappings.get(expectedRole);
      const discordMember = await interaction.guild.members.fetch(discordUser.id).catch(() => null);
      const discordRole = roleId ? interaction.guild.roles.cache.get(roleId) : undefined;
      if (!discordMember || !discordRole) return interaction.editReply({ embeds: [embed("Rank mapping missing", "Run `/syncrank set` for this Roblox role first, and make sure the Discord member is in this server.", danger)] });
      if (!discordRole.editable) return interaction.editReply({ embeds: [embed("Role cannot be managed", `My bot role must be above **${discordRole.name}** in the server role list.`, danger)] });
      await discordMember.roles.add(discordRole, `Roblox rank sync for ${robloxUser.name}`);
      return interaction.editReply({ embeds: [embed("Rank synced", `**${robloxUser.name}** is **${groupRole.name}** in Roblox.\nAdded **${discordRole.name}** to ${discordMember}.`, success)] });
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