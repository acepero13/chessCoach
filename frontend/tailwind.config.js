/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        chess: {
          dark: '#1a1a2e',
          panel: '#16213e',
          accent: '#0f3460',
          gold: '#e2b96f',
          light: '#f0d9b5',
          sq: '#b58863',
        }
      }
    }
  },
  plugins: [],
}
