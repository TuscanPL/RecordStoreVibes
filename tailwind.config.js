/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js,ts}'],
  theme: {
    extend: {
      colors: {
        ink: {
          900: '#0e0c0a',
          800: '#171310',
          700: '#221c17',
          600: '#332a22',
          500: '#3d342b',
        },
        flag: {
          DEFAULT: '#d99a4e',
          soft: '#c8a96e',
          dim: '#8a7454',
        },
        cream: '#f2ece0',
      },
      fontFamily: {
        display: ['"Playfair Display"', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
}
