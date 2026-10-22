/** Release step: add new permissions to the database (safe to run in production). */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { syncPermissionCatalog } from "../src/server/authz/catalog-sync";

const prisma = new PrismaClient();
syncPermissionCatalog(prisma)
  .then((r) => console.warn(`Permissions created: ${r.created.length}; template grants: ${r.granted.length}`))
  .finally(() => prisma.$disconnect());
