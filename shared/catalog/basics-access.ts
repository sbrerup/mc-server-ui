import { bukkit, env, group, num, numOr, paperGlobal, paperWorld, section, select, spigot, text, toggle } from "./builders";

const PERMISSION_LEVELS = select(
  { value: 1, label: "1 – Ignore spawn protection", help: "Can build inside spawn protection, nothing else." },
  { value: 2, label: "2 – Cheat commands", help: "Also /gamemode, /give, /tp and command blocks." },
  { value: 3, label: "3 – Moderate players", help: "Also /kick, /ban and /op." },
  { value: 4, label: "4 – Full control", help: "Also /stop, /save-all and everything else." },
);

export const basics = group("basics", [
  section("Identity", [
    env("MOTD", "motd", {
      label: "Message of the day",
      default: "A Minecraft Server",
      control: text({ maxLength: 180, placeholder: "DripCraft" }),
      help: "The text players see under the server's name in their multiplayer list. Use § colour codes for colour, for example §aGreen. Use \\n for a second line.",
    }),
    env("ICON", undefined, {
      label: "Server icon",
      default: "",
      control: text({ allowEmpty: true, placeholder: "https://…/icon.png", pattern: "^(https://\\S+)?$", patternHint: "An https:// link to an image" }),
      help: "A link to an image that becomes the picture next to the server in the multiplayer list. It is downloaded when the server starts and resized to 64×64.",
      hint: "An existing icon stays until you also turn on “Replace existing icon”.",
    }),
    env("OVERRIDE_ICON", undefined, {
      label: "Replace existing icon",
      default: false,
      help: "Downloads the server icon again on every start, replacing the one on disk. Without this, changing the link has no effect once an icon exists.",
      advanced: true,
    }),
    env("TZ", undefined, {
      label: "Time zone",
      default: "UTC",
      control: text({ suggestions: "timezones", pattern: "^[A-Za-z_]+(/[A-Za-z0-9_+-]+)*$", patternHint: "A name such as Europe/Copenhagen", mono: true }),
      help: "The clock used for log timestamps and backup file names. It does not change the in-game day and night.",
      hint: "Also applied to the backup container, so their times agree.",
    }),
    env("BUG_REPORT_LINK", "bug-report-link", {
      label: "Bug report link",
      default: "",
      control: text({ allowEmpty: true, placeholder: "https://…" }),
      help: "A link offered to players on the disconnect screen so they can report a problem to you. Leave empty for none.",
      advanced: true,
    }),
  ]),
  section("Capacity", [
    env("MAX_PLAYERS", "max-players", {
      label: "Maximum players",
      default: 20,
      control: num(1, 200, "players"),
      help: "How many players can be online at once. Anyone beyond this is turned away with the “server full” message. Operators can still join if bypass is configured by a plugin.",
      hint: "This server is sized for 4 to 10 players. Going higher usually also needs more memory.",
    }),
  ]),
  section("Game mode & difficulty", [
    env("MODE", "gamemode", {
      label: "Default game mode",
      default: "survival",
      control: select(
        { value: "survival", label: "Survival", help: "Health, hunger and gathering." },
        { value: "creative", label: "Creative", help: "Flying and unlimited blocks." },
        { value: "adventure", label: "Adventure", help: "Blocks can only be broken with the right tools." },
        { value: "spectator", label: "Spectator", help: "Invisible flying camera." },
      ),
      help: "The mode new players start in. Players who have already joined keep their current mode unless “Force game mode” is on.",
    }),
    env("FORCE_GAMEMODE", "force-gamemode", {
      label: "Force game mode",
      default: false,
      help: "Puts every player back into the default game mode each time they join, undoing any /gamemode change from their last visit.",
    }),
    env("DIFFICULTY", "difficulty", {
      label: "Difficulty",
      default: "easy",
      control: select(
        { value: "peaceful", label: "Peaceful", help: "No hostile mobs, health regenerates." },
        { value: "easy", label: "Easy", help: "Mobs deal less damage." },
        { value: "normal", label: "Normal", help: "Standard damage." },
        { value: "hard", label: "Hard", help: "More damage. Zombies can break doors, and starvation can kill." },
      ),
      help: "How dangerous the world is: how hard mobs hit, whether hostile mobs spawn at all, and whether hunger can kill you.",
    }),
    env("HARDCORE", "hardcore", {
      label: "Hardcore",
      default: false,
      danger: "In hardcore a death is permanent: the player is locked to spectator mode. Difficulty is forced to Hard.",
      help: "Locks the difficulty to Hard and turns players into spectators when they die, so a single death ends their game in this world.",
    }),
  ]),
]);

export const access = group("access", [
  section("Who can join", [
    env("ENABLE_WHITELIST", "white-list", {
      label: "Whitelist",
      default: false,
      danger: "With the whitelist off, anyone who finds the tunnel address can join this internet-facing server.",
      help: "Only players on the whitelist can join. Add and remove names on the Players page; the list itself is kept on the server, not in Git.",
      hint: "Keep this on: the server is reachable from the internet through the playit tunnel.",
    }),
    env("ENFORCE_WHITELIST", "enforce-whitelist", {
      label: "Kick when removed",
      default: false,
      help: "Kicks a player the moment they are removed from the whitelist. Without it they stay connected until they next disconnect.",
      hint: "The server image turns this on automatically whenever the whitelist is on.",
    }),
    env("ONLINE_MODE", "online-mode", {
      label: "Verify Minecraft accounts",
      default: true,
      danger: "Without account checks anyone can join using any name, including an operator's, and inherit their permissions. The repository's tests also require this to stay on.",
      help: "Checks every player with Mojang's login servers, proving they own the account they claim. Turning it off lets people join with any name and no paid account.",
    }),
    env("ENFORCE_SECURE_PROFILE", "enforce-secure-profile", {
      label: "Require signed chat",
      default: true,
      danger: "This turns off Mojang's chat signing check for joining players. The repository's tests expect it on.",
      help: "Only lets in players whose game has a Mojang-signed key, which is what makes chat messages reportable and tamper-proof. Some modded clients cannot join with this on.",
    }),
    env("HIDE_ONLINE_PLAYERS", "hide-online-players", {
      label: "Hide player names in the server list",
      default: false,
      help: "Stops the server list from showing who is online when someone hovers over the player count. Keeps usernames private from anyone who pings the server.",
    }),
    env("PREVENT_PROXY_CONNECTIONS", "prevent-proxy-connections", {
      label: "Block VPN and proxy logins",
      default: false,
      help: "Kicks players whose connection comes from a different network than the one they logged in to Mojang from. A rough check against VPNs; it can also catch players on mobile networks.",
      advanced: true,
    }),
    env("ACCEPTS_TRANSFERS", "accepts-transfers", {
      label: "Accept server transfers",
      default: false,
      help: "Lets another server send players here with the /transfer command. Only useful when several servers work together.",
      advanced: true,
    }),
    env("LOG_IPS", "log-ips", {
      label: "Log IP addresses",
      default: true,
      help: "Writes player IP addresses to the server log. Turn it off if you would rather not keep them.",
    }),
    spigot("settings.bungeecord", {
      label: "BungeeCord mode",
      default: false,
      locked: "This server uses a playit tunnel, not a BungeeCord proxy. Turning this on would let anyone forge player identities.",
      help: "Tells the server it sits behind a BungeeCord proxy that handles logins for it.",
      advanced: true,
    }),
  ]),
  section("Operators & permissions", [
    env("OP_PERMISSION_LEVEL", "op-permission-level", {
      label: "Operator permission level",
      default: 4,
      control: PERMISSION_LEVELS,
      help: "How much power someone gets when you make them an operator with /op or from the Players page. Level 4 can do everything, including stopping the server.",
    }),
    env("FUNCTION_PERMISSION_LEVEL", "function-permission-level", {
      label: "Datapack function level",
      default: 2,
      control: PERMISSION_LEVELS,
      help: "The permission level that datapack functions run with, which decides which commands they can use.",
      advanced: true,
    }),
    env("ENABLE_COMMAND_BLOCK", "enable-command-block", {
      label: "Command blocks",
      default: false,
      help: "Allows command blocks to run. Operators can then automate any command from inside the world.",
    }),
    paperWorld("command-blocks.permissions-level", {
      label: "Command block level",
      default: 2,
      control: PERMISSION_LEVELS,
      help: "The permission level that command blocks run with.",
      advanced: true,
    }),
    paperWorld("command-blocks.force-follow-perm-level", {
      label: "Command blocks need both permissions",
      default: true,
      help: "Requires command blocks to pass both the Bukkit permission check and the Vanilla level. When off, passing either one is enough.",
      advanced: true,
    }),
    env("BROADCAST_CONSOLE_TO_OPS", "broadcast-console-to-ops", {
      label: "Show console commands to ops",
      default: true,
      help: "Tells online operators in chat when a command is run from the server console.",
    }),
    env("BROADCAST_RCON_TO_OPS", "broadcast-rcon-to-ops", {
      label: "Show remote commands to ops",
      default: true,
      help: "Tells online operators in chat when a command arrives through RCON.",
      hint: "This admin panel uses RCON, so ops see actions such as whitelist changes made here.",
    }),
  ]),
  section("Idle players & connections", [
    env("PLAYER_IDLE_TIMEOUT", "player-idle-timeout", {
      label: "Kick idle players after",
      default: 0,
      control: numOr([{ value: 0, label: "Never" }], 1, 1440, "minutes"),
      help: "Kicks players who have not moved or done anything for this long. Useful for freeing slots, and it lets the server rest when everyone has walked away.",
    }),
    env("ALLOW_FLIGHT", "allow-flight", {
      label: "Allow flying with mods",
      default: false,
      help: "Stops the server from kicking players for flying in Survival. It does not give anyone flight; it only tolerates it. Turn on if a plugin grants flight, or if players are wrongly kicked while on horses or elytra.",
    }),
    env("RATE_LIMIT", "rate-limit", {
      label: "Packet rate limit",
      default: 0,
      control: numOr([{ value: 0, label: "Off" }], 1, 100000, "packets/s"),
      help: "Kicks players who send more than this many network packets per second. Off by default because Paper has its own packet limiter under Network & security.",
      advanced: true,
    }),
    bukkit("settings.connection-throttle", {
      label: "Delay between connections",
      default: 4000,
      control: numOr([{ value: -1, label: "Off" }], 0, 60000, "ms"),
      help: "How long one IP address must wait between login attempts. Slows down bots and reconnect spam.",
      hint: "Thanks to Proxy Protocol the server sees each player's real address, so this works per player here.",
      advanced: true,
    }),
    paperGlobal("misc.max-joins-per-tick", {
      label: "Maximum joins per tick",
      default: 5,
      control: num(1, 100, "players"),
      help: "How many players may finish joining in a single server tick. The rest wait their turn, which softens the spike after a restart.",
      advanced: true,
    }),
    spigot("settings.timeout-time", {
      label: "Watchdog timeout",
      default: 60,
      control: num(10, 600, "seconds"),
      help: "If the server stops ticking for this long it is treated as frozen and stopped with a crash report, so a stuck server recovers rather than hanging forever.",
      advanced: true,
    }),
  ]),
  section("Messages players see", [
    spigot("messages.whitelist", {
      label: "Not on the whitelist",
      default: "You are not whitelisted on this server!",
      help: "Shown to players who are turned away because they are not on the whitelist.",
    }),
    spigot("messages.server-full", {
      label: "Server full",
      default: "The server is full!",
      help: "Shown to players who cannot join because the maximum player count is reached.",
    }),
    bukkit("settings.shutdown-message", {
      label: "Server shutting down",
      default: "Server closed",
      help: "Shown to everyone online when the server stops, for example during a restart after you apply settings.",
    }),
    spigot("messages.restart", {
      label: "Server restarting",
      default: "Server is restarting",
      help: "Shown when the server restarts through Spigot's restart path, or when someone tries to join while it is restarting.",
      advanced: true,
    }),
    spigot("messages.outdated-client", {
      label: "Client too old",
      default: "Outdated client! Please use {0}",
      help: "Shown to a player whose game version is older than the server. {0} becomes the server's version.",
      advanced: true,
    }),
    spigot("messages.outdated-server", {
      label: "Server too old",
      default: "Outdated server! I'm still on {0}",
      help: "Shown to a player whose game version is newer than the server. {0} becomes the server's version.",
      advanced: true,
    }),
    paperGlobal("messages.no-permission", {
      label: "No permission",
      default: "<red>I'm sorry, but you do not have permission to perform this command. Please contact the server administrators if you believe that this is in error.",
      control: text({ mono: false }),
      help: "Shown when a player tries something they lack permission for. Written in MiniMessage format, for example <red>text.",
      advanced: true,
    }),
    paperGlobal("messages.kick.connection-throttle", {
      label: "Connecting too fast",
      default: "Connection throttled! Please wait before reconnecting.",
      help: "Shown to players who reconnect faster than the connection delay allows. Written in MiniMessage format.",
      advanced: true,
    }),
    paperGlobal("messages.kick.authentication-servers-down", {
      label: "Mojang login servers down",
      default: "<lang:multiplayer.disconnect.authservers_down>",
      help: "Shown when Mojang's login servers cannot be reached. Written in MiniMessage format.",
      advanced: true,
    }),
    paperGlobal("messages.kick.flying-player", {
      label: "Kicked for flying",
      default: "<lang:multiplayer.disconnect.flying>",
      help: "Shown to players kicked for flying when flight is not allowed. Written in MiniMessage format.",
      advanced: true,
    }),
    paperGlobal("messages.kick.flying-vehicle", {
      label: "Kicked for a flying vehicle",
      default: "<lang:multiplayer.disconnect.flying>",
      help: "Shown to players kicked because the boat or minecart they ride appears to fly. Written in MiniMessage format.",
      advanced: true,
    }),
    paperGlobal("messages.use-display-name-in-quit-message", {
      label: "Use nicknames in quit messages",
      default: false,
      help: "Uses the nickname a plugin gave a player, not their account name, in the “left the game” message.",
      advanced: true,
    }),
  ]),
]);
