import type { CapacitorConfig } from "@capacitor/cli";

// A native shell only: the WebView loads the deployed site, so there is no
// local web build and no ios/ or android/ directory in this repo. See the
// "Mobile shell" section of the README for the commands that generate one.
const config: CapacitorConfig = {
  appId: "app.citrinia",
  appName: "Citrinia",
  // Required by the CLI's schema even though server.url means nothing is copied.
  webDir: "www",
  server: {
    url: "https://citrinia.vercel.app",
    // Sign-in hops to Supabase and GitHub. A host not listed here opens in the
    // system browser, which would finish the sign-in outside the app.
    allowNavigation: ["rcrbwlzqbuipxondpsey.supabase.co", "github.com"],
  },
};

export default config;
