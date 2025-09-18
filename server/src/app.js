import express from "express";
import cors from "cors";
import gameRoutes from "./routes/gameRoutes.js";

const app = express();

app.use(cors());
app.use(express.json());
app.use(gameRoutes);

export default app;
