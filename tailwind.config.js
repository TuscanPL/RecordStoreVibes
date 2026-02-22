/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{vue,js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        vinyl: {
          black: '#1a1a1a',
          brown: '#3d2b1f',
          amber: '#c8a96e',
          cream: '#f5f0e1',
          orange: '#c47d3b',
          warm: '#2a1f14',
        },
      },
      fontFamily: {
        display: ['"Playfair Display"', 'Georgia', 'serif'],
        body: ['"Inter"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
