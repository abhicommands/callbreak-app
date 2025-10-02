import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import gameRoutes from "./routes/gameRoutes.js";

const app = express();

const rawOrigins = process.env.CLIENT_ORIGIN || "";
const allowedOrigins = rawOrigins
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length ? allowedOrigins : true,
  })
);
app.use(express.json());
app.use("/api", gameRoutes);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultDistPath = path.resolve(__dirname, "../../client/dist");
const distPath = process.env.CLIENT_DIST_PATH
  ? path.resolve(process.cwd(), process.env.CLIENT_DIST_PATH)
  : defaultDistPath;

if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.use((req, res, next) => {
    if (req.method !== "GET") return next();
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(distPath, "index.html"));
  });
} else if (process.env.NODE_ENV === "production") {
  console.warn(
    `Client build not found at ${distPath}. Run "npm run build" in ./client to generate it.`
  );
}

export default app;
