import { defineConfig, type Plugin, type ViteDevServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { scanMedia, describeMissing } from './scripts/media-inventory.mjs';

const projectRoot = dirname(fileURLToPath(import.meta.url));

/**
 * Exposes `virtual:media-inventory`: which footage frames, models and posters exist in public/media/.
 * The runtime uses it to decide between real media and labelled placeholders, so the page never
 * requests a file that is not there. Adding frames during `npm run dev` reloads the page.
 */
function mediaInventory(): Plugin {
  const virtualId = 'virtual:media-inventory';
  const resolvedId = '\0' + virtualId;
  let publicDir = join(projectRoot, 'public');
  let isBuild = false;

  return {
    name: 'omas-media-inventory',
    configResolved(config) {
      publicDir = config.publicDir || publicDir;
      isBuild = config.command === 'build';
    },
    resolveId(source) {
      return source === virtualId ? resolvedId : null;
    },
    load(id) {
      if (id !== resolvedId) return null;
      const { inventory } = scanMedia(projectRoot, publicDir);
      return `export default ${JSON.stringify(inventory)};`;
    },
    buildStart() {
      if (!isBuild) return;
      const { lines, missingCount } = describeMissing(scanMedia(projectRoot, publicDir));
      if (missingCount > 0) {
        const missing = lines.filter((l) => l.startsWith('missing') || l.trim().startsWith('↳'));
        this.warn(
          `${missingCount} production media item(s) missing — labelled placeholders will be shown:\n    ` +
            missing.join('\n    ') +
            '\n  Run `npm run media:check` for the full list; specs are in ASSETS.md.',
        );
      }
    },
    configureServer(server: ViteDevServer) {
      const mediaDir = join(publicDir, 'media');
      server.watcher.add(mediaDir);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const onChange = (file: string) => {
        if (!file.startsWith(mediaDir)) return;
        clearTimeout(timer);
        // Debounced: copying a sequence adds dozens of files at once.
        timer = setTimeout(() => {
          const graph = server.environments?.client?.moduleGraph ?? server.moduleGraph;
          const mod = graph.getModuleById(resolvedId);
          if (mod) graph.invalidateModule(mod);
          server.ws.send({ type: 'full-reload' });
        }, 400);
      };
      server.watcher.on('add', onChange);
      server.watcher.on('unlink', onChange);
    },
  };
}

export default defineConfig({
  // Relative asset URLs: the built folder works under any path, e.g. omaskaffeestuuv.de/apfelkuchen/.
  base: './',
  plugins: [mediaInventory()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
  server: {
    host: true,
  },
});
