// Lets a project keep its own diagram scenes (<project>/scenes/index.tsx, exporting CUSTOM) outside the engine:
// `@project-scenes` points at them (VEP_SCENES, set by vep), `@vep/...` at the engine's src/ for helpers and theme,
// and packages (react, remotion) resolve from the engine's node_modules wherever the importing file lives.
const path = require('path');
const ROOT = process.cwd();   // the compose folder: vep runs remotion from here (__dirname is unreliable once Remotion compiles the config)
module.exports = (config) => ({
  ...config,
  resolve: {
    ...config.resolve,
    alias: { ...(config.resolve?.alias || {}), '@project-scenes': process.env.VEP_SCENES || path.join(ROOT, 'src/no-scenes.ts'), '@vep': path.join(ROOT, 'src') },
    modules: [...(config.resolve?.modules || ['node_modules']), path.join(ROOT, 'node_modules')],
  },
});
