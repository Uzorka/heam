import "@testing-library/jest-dom/vitest";

process.env.DATA_ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString("base64");
process.env.BLIND_INDEX_KEY ||= Buffer.alloc(32, 9).toString("base64");
process.env.DATABASE_URL ||= "postgresql://unused:unused@localhost:5432/unused";
