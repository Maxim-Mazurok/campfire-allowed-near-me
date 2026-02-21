import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? "8787");
const app = createApp();

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`API server listening on http://localhost:${port}`);
});
