// Runs the built app against a pretend server: `npm run build && npm run demo`.
process.env.DEMO = "1";
process.env.COOKIE_SECURE = "false";
process.env.PORT ??= "8080";
await import("../dist/server.cjs");
