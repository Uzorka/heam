import { testDatabaseUrl } from "./env";

process.env.DATABASE_URL_ORIGINAL = process.env.DATABASE_URL;
process.env.DATABASE_URL = testDatabaseUrl();
process.env.DATA_ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString("base64");
process.env.BLIND_INDEX_KEY ||= Buffer.alloc(32, 9).toString("base64");
