import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      "/api": "http://127.0.0.1:10000",
    },
  },
  preview: {
    allowedHosts: ["triplex-fx.onrender.com"],
  },
  build: {
    rollupOptions: {
      input: {
        index: "index.html",
        login: "login.html",
        signup: "signup.html",
        loading: "loading.html",
        contact: "contact.html",
        admin: "admin.html",
        profit: "profit.html",
        assistant: "assistant.html",
        receipts: "receipts.html",
        members: "members.html",
      },
    },
  },
});
