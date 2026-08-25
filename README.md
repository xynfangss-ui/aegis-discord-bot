# Aegis Discord Bot

A focused Discord community bot with moderation, giveaways, and private support tickets. No database or dashboard.

## Commands

- Moderation: `/ban`, `/kick`, `/timeout`, `/warn`, `/purge`, `/lock`, `/unlock`, `/slowmode`
- Giveaways: `/giveaway start`, `/giveaway end`, `/giveaway reroll`
- Tickets: `/ticket-panel`
- Help: `/help`

## Deploy to Railway

1. Create a Discord application and bot.
2. Invite it with the `bot` and `applications.commands` scopes.
3. Give it Manage Channels, Manage Messages, Moderate Members, Kick Members, and Ban Members.
4. Deploy this repository to Railway.
5. Add `DISCORD_TOKEN` as a Railway secret.
6. Optionally add `DISCORD_GUILD_ID` and `TICKET_ROLE_ID`.

Railway provides `PORT` automatically. Active giveaways and warnings are held in memory, so a restart clears them.
