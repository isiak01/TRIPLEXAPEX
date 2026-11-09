import { defineConfig } from "vite";

export default defineConfig({
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
