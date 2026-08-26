# Aegis Discord Bot

A focused Discord community bot with moderation, giveaways, private support tickets, and a one-command community channel setup. No database or dashboard.

## Commands

- Moderation: `/ban`, `/kick`, `/timeout`, `/warn`, `/purge`, `/lock`, `/unlock`, `/slowmode`
- Giveaways: `/giveaway start`, `/giveaway end`, `/giveaway reroll`
- Tickets: `/ticket-panel`
- Server layout: `.setupchannels`
- Help: `/help`

## Channel setup

Run `.setupchannels` in your server as a member with Manage Server. The bot creates HACKATHONS, TEAM FINDER, and STARTUPS categories with the requested channels. It is safe to run more than once and skips anything already present.

Enable **Server Members Intent** and **Message Content Intent** in the Discord Developer Portal.

## Deploy to Railway

1. Create a Discord application and bot.
2. Invite it with the `bot` and `applications.commands` scopes.
3. Give it Manage Channels, Manage Messages, Moderate Members, Kick Members, and Ban Members.
4. Deploy this repository to Railway.
5. Add your Railway secret as `TOKEN`. `DISCORD_TOKEN` is also supported.
6. Optionally add `DISCORD_GUILD_ID` and `TICKET_ROLE_ID`.

Railway provides `PORT` automatically. Active giveaways and warnings are held in memory, so a restart clears them.
