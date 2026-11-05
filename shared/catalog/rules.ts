import { group, num, numOr, rule, section } from "./builders";

/**
 * Game rule names as they exist in Minecraft 26.3. Each was confirmed against the
 * running server with `gamerule <name>`. The older camelCase names are rejected.
 */
export const rules = group("rules", [
  section("Death & survival", [
    rule("keep_inventory", {
      label: "Keep items on death",
      default: false,
      help: "Players keep their inventory and experience when they die, rather than dropping them.",
    }),
    rule("immediate_respawn", {
      label: "Skip the death screen",
      default: false,
      help: "Players respawn straight away without seeing the “You died” screen.",
    }),
    rule("natural_health_regeneration", {
      label: "Natural health regeneration",
      default: true,
      help: "Players slowly heal when their hunger bar is full. When off, only potions and golden apples restore health.",
    }),
    rule("fall_damage", { label: "Fall damage", default: true, help: "Players take damage when they fall from a height." }),
    rule("fire_damage", { label: "Fire damage", default: true, help: "Players take damage from fire and lava." }),
    rule("drowning_damage", { label: "Drowning damage", default: true, help: "Players take damage when they run out of air underwater." }),
    rule("freeze_damage", { label: "Freezing damage", default: true, help: "Players take damage from standing in powder snow." }),
    rule("respawn_radius", {
      label: "Spawn spread",
      default: 10,
      control: num(0, 128, "blocks"),
      help: "New and respawning players appear at a random spot within this distance of the world spawn point. Use 0 to spawn on the exact point.",
    }),
    rule("players_sleeping_percentage", {
      label: "Players needed to skip the night",
      default: 100,
      control: num(0, 101, "%"),
      help: "The percentage of online players who must be in bed to skip to morning. 100 means everyone. Above 100 means the night can never be skipped.",
      hint: "On a small server, 25–50 % saves everyone from waiting for one person.",
    }),
  ]),
  section("Combat & griefing", [
    rule("pvp", {
      label: "Player vs player",
      default: true,
      help: "Players can hurt each other. In this Minecraft version PvP is a game rule rather than a server.properties setting.",
    }),
    rule("mob_griefing", {
      label: "Mob griefing",
      default: true,
      help: "Mobs can change the world: creepers destroy terrain, endermen move blocks, and villagers harvest crops. Turning it off also stops villagers from farming and breeding normally.",
    }),
    rule("universal_anger", {
      label: "Neutral mobs attack everyone",
      default: false,
      help: "When a neutral mob such as a wolf or piglin is angered, it attacks every nearby player instead of just the one who provoked it.",
    }),
    rule("forgive_dead_players", {
      label: "Forgive dead players",
      default: true,
      help: "Angered neutral mobs calm down once the player who provoked them dies.",
    }),
    rule("projectiles_can_break_blocks", {
      label: "Projectiles break blocks",
      default: true,
      help: "Projectiles can break fragile blocks they hit, such as chorus flowers and decorated pots.",
    }),
    rule("ender_pearls_vanish_on_death", {
      label: "Ender pearls vanish on death",
      default: true,
      help: "A thrown ender pearl disappears if its thrower dies before it lands.",
      advanced: true,
    }),
  ]),
  section("Mob spawning", [
    rule("spawn_mobs", { label: "Natural mob spawning", default: true, help: "Mobs spawn on their own. When off, no animals or monsters appear naturally. Spawners and spawn eggs still work." }),
    rule("spawn_monsters", { label: "Monsters spawn", default: true, help: "Hostile mobs such as zombies and skeletons spawn naturally, while animals are unaffected." }),
    rule("spawn_phantoms", { label: "Phantoms", default: true, help: "Phantoms attack players who have not slept for three in-game days." }),
    rule("spawn_patrols", { label: "Pillager patrols", default: true, help: "Groups of pillagers roam the world and can start a raid." }),
    rule("spawn_wandering_traders", { label: "Wandering traders", default: true, help: "Wandering traders and their llamas visit players from time to time." }),
    rule("spawn_wardens", { label: "Wardens", default: true, help: "Wardens can emerge in the deep dark when sculk shriekers are triggered." }),
    rule("raids", { label: "Raids", default: true, help: "A player with the Bad Omen effect who enters a village starts a raid. When off, nothing happens." }),
    rule("spawner_blocks_work", { label: "Mob spawner blocks", default: true, help: "Mob spawner blocks produce mobs. When off, dungeons and mob farms built on spawners stop." }),
    rule("max_entity_cramming", {
      label: "Mob cramming limit",
      default: 24,
      control: numOr([{ value: 0, label: "Off" }], 1, 1000, "entities"),
      help: "How many mobs can share a block before they start suffocating. Stops dense mob farms from growing without limit.",
    }),
  ]),
  section("World & time", [
    rule("advance_time", { label: "Day and night cycle", default: true, help: "Time passes, so day turns to night. When off, the sun and moon stay where they are." }),
    rule("advance_weather", { label: "Weather changes", default: true, help: "The weather changes on its own. When off, it stays as it is until someone uses /weather." }),
    rule("random_tick_speed", {
      label: "Random tick speed",
      default: 3,
      control: num(0, 1000, "per chunk section"),
      help: "How many random blocks get a growth update per chunk section each tick. It speeds up or stops crops, grass, leaf decay and more. 0 freezes all of that.",
      hint: "High values cost a lot of CPU on this server's main thread.",
    }),
    rule("spread_vines", { label: "Vines spread", default: true, help: "Vines grow and spread onto nearby blocks." }),
    rule("water_source_conversion", { label: "Water makes new sources", default: true, help: "Flowing water between two water sources becomes a new source, the classic infinite water pool." }),
    rule("lava_source_conversion", { label: "Lava makes new sources", default: false, help: "Flowing lava between two lava sources becomes a new source, giving infinite lava." }),
    rule("max_snow_accumulation_height", {
      label: "Snow build-up",
      default: 1,
      control: num(0, 8, "layers"),
      help: "How many layers of snow can pile up during snowfall.",
    }),
    rule("allow_entering_nether_using_portals", {
      label: "Nether portals work",
      default: true,
      help: "Players can travel to the Nether through portals. When off, portals stop transporting anyone.",
    }),
    rule("players_nether_portal_default_delay", {
      label: "Nether portal delay (Survival)",
      default: 80,
      control: num(0, 72000, "ticks"),
      help: "How long a Survival player must stand in a portal before travelling. 20 ticks is one second.",
      advanced: true,
    }),
    rule("players_nether_portal_creative_delay", {
      label: "Nether portal delay (Creative)",
      default: 0,
      control: num(0, 72000, "ticks"),
      help: "How long a Creative player must stand in a portal before travelling.",
      advanced: true,
    }),
    rule("spectators_generate_chunks", {
      label: "Spectators generate terrain",
      default: true,
      help: "Players in Spectator mode cause new terrain to generate as they fly. Turn off to save work when spectators wander far.",
      advanced: true,
    }),
    rule("global_sound_events", {
      label: "World-wide sounds",
      default: true,
      help: "Some major events, such as a boss spawning or dying, can be heard by every player no matter how far away they are.",
      advanced: true,
    }),
  ]),
  section("Fire & explosions", [
    rule("fire_spread_radius_around_player", {
      label: "Fire spread radius",
      default: 128,
      control: numOr([{ value: 0, label: "No spread" }, { value: -1, label: "Everywhere" }], 1, 1024, "blocks"),
      help: "Fire only spreads within this distance of a player. 0 stops fire from spreading, and -1 lets it spread anywhere that is loaded.",
    }),
    rule("tnt_explodes", { label: "TNT explodes", default: true, help: "TNT can be lit and explode. When off, TNT does nothing." }),
    rule("block_explosion_drop_decay", {
      label: "Block explosions lose drops",
      default: true,
      help: "When a block such as a bed in the Nether or a respawn anchor explodes, some destroyed blocks are lost instead of dropping as items.",
      advanced: true,
    }),
    rule("mob_explosion_drop_decay", {
      label: "Mob explosions lose drops",
      default: true,
      help: "When a mob such as a creeper explodes, some destroyed blocks are lost instead of dropping as items.",
      advanced: true,
    }),
    rule("tnt_explosion_drop_decay", {
      label: "TNT explosions lose drops",
      default: false,
      help: "When TNT explodes, some destroyed blocks are lost instead of dropping as items.",
      advanced: true,
    }),
  ]),
  section("Drops", [
    rule("block_drops", { label: "Blocks drop items", default: true, help: "Broken blocks drop items. When off, breaking a block gives nothing." }),
    rule("mob_drops", { label: "Mobs drop loot", default: true, help: "Mobs drop items and experience when killed." }),
    rule("entity_drops", { label: "Other entities drop items", default: true, help: "Minecarts, boats, item frames and similar entities drop themselves when broken." }),
  ]),
  section("Chat & messages", [
    rule("show_death_messages", { label: "Death messages", default: true, help: "Posts a chat message when a player dies, such as “Steve fell from a high place”." }),
    rule("show_advancement_messages", { label: "Advancement messages", default: true, help: "Posts a chat message when a player earns an advancement." }),
    rule("send_command_feedback", { label: "Command replies in chat", default: true, help: "Shows the result of commands in chat for the player who ran them." }),
    rule("log_admin_commands", { label: "Announce admin commands", default: true, help: "Records operator commands in the server log and tells other operators about them." }),
    rule("command_block_output", { label: "Command block messages", default: true, help: "Tells operators in chat when a command block runs a command. Often turned off because it floods chat." }),
    rule("locator_bar", { label: "Player locator bar", default: true, help: "Shows the direction of other players on a bar above the hotbar." }),
    rule("reduced_debug_info", {
      label: "Hide coordinates on F3",
      default: false,
      help: "Removes coordinates and other detail from the debug screen. Good for survival servers where finding your way is part of the game.",
    }),
  ]),
  section("Crafting & commands", [
    rule("limited_crafting", { label: "Only unlocked recipes", default: false, help: "Players can only craft recipes they have already unlocked." }),
    rule("command_blocks_work", { label: "Command blocks can run", default: true, help: "Command blocks may run. Command blocks must also be enabled under Players & access." }),
    rule("max_command_sequence_length", {
      label: "Command chain limit",
      default: 65536,
      control: num(0, 10000000, "commands"),
      help: "How many commands one chain of command blocks or functions can run in a single tick.",
      advanced: true,
    }),
    rule("max_command_forks", {
      label: "Command fork limit",
      default: 65536,
      control: num(0, 10000000, "forks"),
      help: "How many times a command using /execute can branch in a single tick.",
      advanced: true,
    }),
    rule("max_block_modifications", {
      label: "Blocks one command can change",
      default: 32768,
      control: num(1, 10000000, "blocks"),
      help: "The most blocks a single command such as /fill or /clone may change at once.",
      advanced: true,
    }),
  ]),
  section("Movement checks", [
    rule("player_movement_check", {
      label: "Check player movement",
      default: true,
      help: "Stops players who move faster than the game allows. Turn off only if players are being pulled back on a fast setup.",
      advanced: true,
    }),
    rule("elytra_movement_check", {
      label: "Check elytra movement",
      default: true,
      help: "Stops players flying faster than an elytra allows, which catches speed cheats but can rubber-band fast flyers on a laggy server.",
      advanced: true,
    }),
  ]),
]);
