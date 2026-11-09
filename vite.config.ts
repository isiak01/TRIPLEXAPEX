import { defineConfig } from "vite";

export default defineConfig({
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
      },
    },
  },
});
