/** @type {import('tailwindcss').Config} */
// Trio design language — Ernest is the "assure" vertex (teal). Neutrals (slate) and type
// (Inter) already match the shared tokens; convergence is the accent. Rather than touch ~88
// blue-* usages, we remap Tailwind's `blue` scale to the assure teal, so every existing
// blue utility and component class becomes the vertex accent in one place. Status colors
// (red/emerald/amber) are shared and left untouched. See Prudence's docs/design/DESIGN.md.
const assure = {
  50: '#f0fdfa', 100: '#ccfbf1', 200: '#99f6e4', 300: '#5eead4', 400: '#2dd4bf',
  500: '#14b8a6', 600: '#0d9488', 700: '#0f766e', 800: '#115e59', 900: '#134e4a', 950: '#042f2e',
};

export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        blue: assure, // remap brand hue to the assure vertex accent
        primary:   '#0d9488',  // teal-600
        'primary-hover': '#0f766e',  // teal-700
        secondary: '#14b8a6',  // teal-500
        'secondary-hover': '#0f766e',  // teal-700
        brand:     '#134e4a',  // teal-900 — header/nav
        'brand-dark': '#042f2e',  // teal-950
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: []
};
