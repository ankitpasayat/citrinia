import type { Metadata, Viewport } from "next";
import * as stylex from "@stylexjs/stylex";
import "./globals.css";
import { RegisterSw } from "@/components/register-sw";
import { colors, fonts } from "./tokens.stylex";
import { themeClassNames, THEME_STORAGE_KEY } from "./themes";

export const metadata: Metadata = {
  title: { default: "Citrinia", template: "%s · Citrinia" },
  description: "A tiny feed. Posts are peels.",
  applicationName: "Citrinia",
  appleWebApp: { capable: true, title: "Citrinia", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFF1E6" },
    { media: "(prefers-color-scheme: dark)", color: "#2A1A12" },
  ],
};

// Applies a stored explicit theme before first paint. No stored value means
// "system", which the tokens handle with prefers-color-scheme on their own.
// The theme class names are space-separated lists, so add/remove take them as arrays.
const DARK = JSON.stringify(themeClassNames.dark.split(" ").filter(Boolean));
const LIGHT = JSON.stringify(themeClassNames.light.split(" ").filter(Boolean));
const themeScript = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});var c=document.documentElement.classList;c.remove.apply(c,${DARK}.concat(${LIGHT}));if(t==="dark")c.add.apply(c,${DARK});else if(t==="light")c.add.apply(c,${LIGHT});}catch(e){}})()`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // The theme script mutates <html>'s class list before hydration; this is the documented fix.
    <html lang="en" suppressHydrationWarning {...stylex.props(styles.html)}>
      <body {...stylex.props(styles.body)}>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <RegisterSw />
        {children}
      </body>
    </html>
  );
}

const styles = stylex.create({
  html: {
    colorScheme: colors.scheme,
    backgroundColor: colors.ground,
    minHeight: "100%",
  },
  body: {
    backgroundColor: colors.ground,
    color: colors.ink,
    fontFamily: fonts.body,
    fontWeight: 600,
    fontSize: "0.9375rem",
    lineHeight: 1.5,
    minHeight: "100dvh",
  },
});
