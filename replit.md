# Aegis Discord Bot

A Railway-friendly Discord community bot for moderation, giveaways, and private support tickets without a database.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the Discord bot and Railway health endpoint
- `pnpm --filter @workspace/api-server run typecheck` — typecheck the bot
- `pnpm --filter @workspace/api-server run build` — bundle the bot for production
- Required secret: `DISCORD_TOKEN`
- Optional env: `DISCORD_GUILD_ID`, `TICKET_ROLE_ID`, `MOD_ROLE_ID`; Railway supplies `PORT`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Bot: Discord.js 14
- Runtime: Node.js 24 + TypeScript
- Build: esbuild (ESM bundle)
- Health: Node HTTP server on `PORT`

## Where things live

- `artifacts/api-server/src/bot.ts` — Discord client, commands, ticket flow, and giveaway logic
- `artifacts/api-server/railway.json` — Railway build, start, and healthcheck configuration
- `artifacts/api-server/.env.example` — optional environment variable reference
- `artifacts/api-server/README.md` — setup, permissions, and deployment guide

## Architecture decisions

- No database or external state service is used by design.
- Giveaways, warnings, and invite counts are in memory, so a process restart clears them.
- Guild command registration is used when `DISCORD_GUILD_ID` exists; otherwise commands are global.

## Product

Moderators get slash commands for bans, kicks, timeouts, warnings, purges, locks, unlocks, and slowmode. Server managers can start and manage button-entry giveaways and post the ticket panel. Members can open private tickets visible to them and configured staff roles, and use `/invites` to see confirmed joins from their invite links.

## User preferences

- Keep the bot focused; do not add a database, dashboard, or unrelated services.

## Gotchas

- Discord commands require the bot's role and permissions to be configured correctly; see the bot README.
- Use `DISCORD_GUILD_ID` while developing for immediate slash-command updates.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
