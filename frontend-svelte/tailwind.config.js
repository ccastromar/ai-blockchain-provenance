/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary:   '#1d4ed8',  // blue-700
        'primary-hover': '#1e40af',  // blue-800
        secondary: '#0284c7',  // sky-600
        'secondary-hover': '#0369a1',  // sky-700
        brand:     '#1e3a8a',  // blue-900 — header/nav
        'brand-dark': '#172554',  // blue-950
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: []
};
