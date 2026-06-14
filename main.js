import { config, parse } from "dotenv";

const env = config();
const dbUrl = null
  env.error || !env.parsed ? null : env.parsed["BASIC"];

config({
  path: ".env-example",
  encoding: "utf8",
  debug: true,
});

parse("test");

const parsed = parse("NODE_ENV=production\nDB_HOST=a.b.c");
const dbHost = parsed["DB_HOST"];

const parsedFromBuffer = parse(Buffer.from("JUSTICE=league\n"));
const justice = parsedFromBuffer["JUSTICE"];

config({
  // make sure the type accepts process.env (it didn't in the past)
  processEnv: process.env,
});
