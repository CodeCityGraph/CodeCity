import { getUserById } from "./services/userService";
import { authenticate } from "./services/authService";
import { logInfo } from "./utils/logger";
import express from "express";

async function main(): Promise<void> {
  const app = express();
  const user = await getUserById("u-1");
  const ok = await authenticate("u-1", "secret");
  logInfo(`User: ${user.name}, auth=${ok}`);
  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });
}

main().catch(error => {
  console.error(error);
});
