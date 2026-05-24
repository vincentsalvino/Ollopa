/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#810B38",
        bg: "#F1E2D1",
        border: "#DCC3AA",
        text: "#541A1A",
      },
    },
  },
  plugins: [],
};
