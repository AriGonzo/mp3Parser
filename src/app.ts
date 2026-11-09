import express from "express";

// Builds the app without starting it, so tests can use it without opening a port.
export function createApp() {
  const app = express();

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  return app;
}
