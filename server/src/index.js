import "dotenv/config";
import app from "./app.js";

const HOST = process.env.HOST || "0.0.0.0";
const DEFAULT_PORT = process.env.NODE_ENV === "production" ? 80 : 8080;
const PORT = Number(process.env.PORT) || DEFAULT_PORT;

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});
