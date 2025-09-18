import app from "./app.js";

const PORT = process.env.PORT || 5001;

app.listen(PORT, () => {
  console.log(`Server running on http://0.0.0.0:${PORT} (LAN-ready)`);
});
