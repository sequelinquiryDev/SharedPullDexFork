export default {
  plugins: {
    tailwindcss: {
      // Provide proper path context for CSS imports
      config: './tailwind.config.ts',
    },
    autoprefixer: {},
  },
}
