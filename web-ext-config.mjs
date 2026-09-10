export default {
  sourceDir: "src",
  artifactsDir: "web-ext-artifacts",
  ignoreFiles: ["**/*.test.js", "dev.json"],
  run: {
    // Keep the browser console open while developing.
    browserConsole: false,
    startUrl: ["about:debugging#/runtime/this-firefox"],
  },
};
