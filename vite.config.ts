import { vitePlugin as remixVitePlugin } from '@remix-run/dev';
import path from 'node:path';
import UnoCSS from 'unocss/vite';
import { defineConfig, type Plugin, type ViteDevServer } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { optimizeCssModules } from 'vite-plugin-optimize-css-modules';
import tsconfigPaths from 'vite-tsconfig-paths';

const posixPathShim = path.resolve(__dirname, 'app/utils/posixPath.ts');

function ssrSafeNodePolyfills(): Plugin {
  const basePlugin = nodePolyfills({
    include: ['buffer'],
  }) as Plugin & { config?: (config: unknown, env: unknown) => Record<string, unknown> };

  let bufferAlias: string | undefined;

  return {
    ...basePlugin,
    name: 'ssr-safe-node-polyfills',
    enforce: 'pre',
    config(userConfig, env) {
      const resolved = (basePlugin.config?.(userConfig, env) ?? {}) as {
        resolve?: { alias?: Record<string, string> };
      };
      if (resolved.resolve?.alias) {
        bufferAlias = resolved.resolve.alias['buffer'] || resolved.resolve.alias['node:buffer'];
        delete resolved.resolve.alias;
      }
      return resolved as never;
    },
    resolveId(source, importer, options) {
      if (options?.ssr) {
        return null;
      }
      if (source === 'path' || source === 'node:path' || source === 'path-browserify') {
        return posixPathShim;
      }
      if ((source === 'buffer' || source === 'node:buffer') && bufferAlias) {
        return this.resolve(bufferAlias, importer, { ...options, skipSelf: true });
      }
      return null;
    },
  };
}

export default defineConfig((config) => {
  return {
    build: {
      target: 'esnext',
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    plugins: [
      ssrSafeNodePolyfills(),
      remixVitePlugin({
        future: {
          v3_fetcherPersist: true,
          v3_relativeSplatPath: true,
          v3_throwAbortReason: true,
        },
      }),
      UnoCSS(),
      tsconfigPaths(),
      chrome129IssuePlugin(),
      config.mode === 'production' && optimizeCssModules({ apply: 'build' }),
    ],
  };
});

function chrome129IssuePlugin() {
  return {
    name: 'chrome129IssuePlugin',
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        const raw = req.headers['user-agent']?.match(/Chrom(e|ium)\/([0-9]+)\./);

        if (raw) {
          const version = parseInt(raw[2], 10);

          if (version === 129) {
            res.setHeader('content-type', 'text/html');
            res.end(
              '<body><h1>Please use Chrome Canary for testing.</h1><p>Chrome 129 has an issue with JavaScript modules & Vite local development, see <a href="https://github.com/stackblitz/bolt.new/issues/86#issuecomment-2395519258">for more information.</a></p><p><b>Note:</b> This only impacts <u>local development</u>. `npm run build` and `npm run start` will work fine in this browser.</p></body>',
            );

            return;
          }
        }

        next();
      });
    },
  };
}
