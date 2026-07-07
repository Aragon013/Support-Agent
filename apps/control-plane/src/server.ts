import { buildApp } from "./app.js";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? "3000");

const app = buildApp();

app
  .listen({ host, port })
  .then(() => {
    app.log.info({ host, port }, "control-plane listening");
  })
  .catch((error) => {
    app.log.error(error, "failed to start control-plane");
    process.exit(1);
  });
