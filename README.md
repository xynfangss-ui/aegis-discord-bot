# Aegis Discord Bot

A focused Discord community bot with moderation, giveaways, and private support tickets. It uses no database and has no dashboard to maintain.

## Features

- Moderation: `/ban`, `/kick`, `/timeout`, `/warn`, `/purge`, `/lock`, `/unlock`, `/slowmode`
- Giveaways: `/giveaway start`, `/giveaway end`, `/giveaway reroll`
- Tickets: `/ticket-panel`, then members open private channels with one button
- Invite tracker: `/invites` shows members how many confirmed joins came from their invites
- `/help` command with a quick command guide
- `.setupchannels` chat command for the HACKATHONS, TEAM FINDER, and STARTUPS channel layout
- `.permschannels` chat command for public/read-only channel rules and bot permissions
- Railway health endpoint on the platform-provided `PORT`
- Polished, consistent embeds with useful success/error feedback

## Local setup

1. Create a Discord application and bot in the Discord Developer Portal.
2. Enable the **Server Members Intent** and **Message Content Intent** in the Discord Developer Portal.
3. Copy `.env.example` to your environment and add `TOKEN` (`DISCORD_TOKEN` also works).
4. Run `pnpm install`, then `pnpm --filter @workspace/api-server run dev`.

Set `DISCORD_GUILD_ID` during development for instant slash-command updates. Without it, commands are registered globally and Discord can take a while to propagate them.

The ticket panel is posted by staff, and each ticket is private to the member who opened it plus `TICKET_ROLE_ID` and `MOD_ROLE_ID` when configured. Staff roles can close tickets. Invite tracking compares invite usage when a member joins; vanity URL and unavailable invite data cannot be attributed.

## Railway setup

Deploy the repository with the included `railway.json`. Add `TOKEN` as a Railway secret (`DISCORD_TOKEN` is also supported). `DISCORD_GUILD_ID`, `TICKET_ROLE_ID`, and `MOD_ROLE_ID` are optional variables. Railway supplies `PORT` automatically.

The bot keeps active giveaways, warnings, and invite counts in memory by design. A restart clears them; there is intentionally no database or external state service.

## Discord permissions

Invite the bot with the `bot` and `applications.commands` scopes. Give it `Manage Server` for invite tracking, plus `Manage Channels`, `Manage Messages`, `Moderate Members`, `Kick Members`, `Ban Members`, and `Manage Roles` as needed. Its role must be above members it moderates.