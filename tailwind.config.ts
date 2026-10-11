import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: { extend: { colors: { ink: "#111827", panel: "#171f2e", muted: "#8490a5", mint: "#69e2b1" }, boxShadow: { soft: "0 8px 30px rgba(0,0,0,.16)" } } },
  plugins: []
};
export default config;
