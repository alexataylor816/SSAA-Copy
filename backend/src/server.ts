import { createApp } from "./app.js";
import { config } from "./config.js";
import { emailTransportName } from "./services/email.js";

// `io` used to be dropped here, which is why realtime never worked. attachRealtime
// inside createApp() now registers it with the emitter the routes call.
const { httpServer } = await createApp();

httpServer.listen(config.port, "127.0.0.1", () => {
  console.log(`SSAA backend listening on http://127.0.0.1:${config.port}`);
  const transport = emailTransportName();
  console.log(
    transport === "smtp"
      ? `Email: SMTP as ${config.smtp.user}`
      : transport === "resend"
        ? `Email: Resend from ${config.emailFrom} (sandbox keys only reach the Resend account owner)`
        : "Email: not configured; reset codes appear on screen in development",
  );
});