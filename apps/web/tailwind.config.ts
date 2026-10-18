import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#dbe6fe',
          500: '#3758f9',
          600: '#2a44d4',
          700: '#2236ab',
        },
      },
    },
  },
  plugins: [],
};

export default config;
