# Aegis Discord Bot

A focused Discord community bot with moderation, giveaways, private support tickets, and server setup commands. No database or dashboard.

## Commands

- Moderation: `/ban`, `/kick`, `/timeout`, `/warn`, `/purge`, `/lock`, `/unlock`, `/slowmode`
- Giveaways: `/giveaway start`, `/giveaway end`, `/giveaway reroll`
- Tickets: `/ticket-panel`
- Server layout: `.setupchannels`
- Channel permissions: `.permschannels`
- Help: `/help`

## Server setup

Run `.setupchannels` with Manage Server to create the HACKATHONS, TEAM FINDER, and STARTUPS categories and channels. It skips anything already present.

Run `.permschannels` with Manage Server to apply public channel permissions, make alerts and results read-only, and explicitly grant the bot the permissions it needs. Add `MOD_ROLE_ID` if you want a moderator role to receive access and message-management permissions too.

Enable **Server Members Intent** and **Message Content Intent** in the Discord Developer Portal.

## Deploy to Railway

1. Create a Discord application and bot.
2. Invite it with the `bot` and `applications.commands` scopes.
3. Give it Manage Channels, Manage Messages, Moderate Members, Kick Members, and Ban Members.
4. Deploy this repository to Railway.
5. Add your Railway secret as `TOKEN`. `DISCORD_TOKEN` is also supported.
6. Optionally add `DISCORD_GUILD_ID`, `TICKET_ROLE_ID`, and `MOD_ROLE_ID`.

Railway provides `PORT` automatically. Active giveaways and warnings are held in memory, so a restart clears them.
