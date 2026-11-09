import { preview } from "vite";

const server = await preview({
  preview: {
    host: "0.0.0.0",
    port: Number(process.env.PORT) || 4173,
    strictPort: true,
    allowedHosts: ["triplex-fx.onrender.com"],
  },
});

console.log(`Preview server listening on ${server.httpServer.address().port}`);
