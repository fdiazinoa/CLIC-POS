const documentColors = [
  'blue',
  'orange',
  'red',
  'purple',
  'green',
  'indigo',
  'cyan',
  'emerald',
  'rose',
  'teal',
  'amber',
  'slate',
  'gray',
  'sky',
  'violet',
  'lime',
  'fuchsia',
];

const promotionBorderColors = ['blue', 'purple', 'orange', 'pink', 'emerald'];

module.exports = {
  darkMode: 'class',
  content: [
    './index.html',
    './index.tsx',
    './App.tsx',
    './components/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
    './services/**/*.{ts,tsx}',
    './utils/**/*.{ts,tsx}',
    './constants/**/*.{ts,tsx}',
  ],
  safelist: [
    ...documentColors.flatMap((color) => [`bg-${color}-50`, `text-${color}-600`]),
    ...promotionBorderColors.map((color) => `border-${color}-500`),
    'from-red-50',
    'from-indigo-50',
    'to-transparent',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
