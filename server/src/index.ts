import express from "express";
import http from "http";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./env.js";

export const app = express();
export const httpServer = http.createServer(app);
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" })); // sendgrid inbound is form-encoded
app.use(cookieParser());
app.use(cors({ origin: env.APP_ORIGIN, credentials: true }));
app.get("/healthz", (_req, res) => res.json({ ok: true, ts: Date.now() }));

if (process.env.VITEST === undefined) {
  httpServer.listen(env.PORT, () => console.log(`listening :${env.PORT}`));
}
