// StyleX compiles styles at build time. next/babel must run alongside so app and
// component code keep every Next transform. Note: a custom Babel config disables
// next/font, which is why the fonts are self-hosted in app/globals.css.
const path = require("path");

const dev = process.env.NODE_ENV !== "production";

module.exports = {
  presets: ["next/babel"],
  plugins: [
    [
      "@stylexjs/babel-plugin",
      {
        dev,
        runtimeInjection: false,
        enableInlinedConditionalMerge: true,
        treeshakeCompensation: true,
        aliases: { "@/*": [path.join(__dirname, "*")] },
        unstable_moduleResolution: { type: "commonJS" },
      },
    ],
  ],
};
