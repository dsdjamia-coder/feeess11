import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const resolve = path.resolve;

const copyRecursive = (srcPath: string, destPath: string) => {
  if (!fs.existsSync(srcPath)) return;
  const stat = fs.statSync(srcPath);
  if (stat.isDirectory()) {
    fs.mkdirSync(destPath, { recursive: true });
    for (const entry of fs.readdirSync(srcPath)) {
      copyRecursive(path.join(srcPath, entry), path.join(destPath, entry));
    }
    return;
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(srcPath, destPath);
};

const copyStaticAssetsPlugin = (): Plugin => ({
  name: 'copy-static-assets',
  closeBundle() {
    const outDir = resolve(__dirname, 'dist');
    if (!fs.existsSync(outDir)) return;

    const staticEntries = [
      'assets/images',
      'manifest.json',
      'sw.js',
      'scripts/shared/session-guard.js',
      'scripts/shared/page-guards.js',
      'scripts/shared/hub-navigation.js'
    ];

    for (const relPath of staticEntries) {
      copyRecursive(resolve(__dirname, relPath), resolve(outDir, relPath));
    }
  }
});

const cleanUrlsPlugin = (): Plugin => {
  const handler = (req: any, res: any, next: () => void) => {
    if (req.url) {
      const [pathname, search] = req.url.split('?');
      const query = search ? `?${search}` : '';
      if (pathname === '/studentmanagement' || pathname === '/student-fee-system') {
        res.writeHead(302, { Location: `/student.html${query}` });
        res.end();
        return;
      }
      if (pathname === '/official-dashboard') {
        res.writeHead(302, { Location: `/official.html${query}` });
        res.end();
        return;
      }
      const knownPages = [
        'company',
        'admin',
        'attendance',
        'academic-plan',
        'activity',
        'evaluation',
        'collection',
        'official',
        'result',
        'student',
        'worksheet'
      ];
      const reservedNonTenants = new Set([
        'index',
        'company',
        'admin',
        'attendance',
        'academic-plan',
        'activity',
        'evaluation',
        'collection',
        'official',
        'result',
        'student',
        'worksheet',
        'assets',
        'scripts',
        'styles',
        'config',
        'public',
        'api',
        '@vite',
        '@react-refresh',
        'node_modules'
      ]);
      const trimmed = pathname.replace(/^\/+|\/+$/g, '');
      const segments = trimmed.split('/').filter(Boolean);
      if (segments.length === 1) {
        if (knownPages.includes(segments[0])) {
          req.url = `/${segments[0]}.html${query}`;
        } else if (!segments[0].includes('.') && !reservedNonTenants.has(segments[0].toLowerCase()) && !segments[0].startsWith('@')) {
          req.url = `/index.html${query}`;
        }
      } else if (segments.length === 2 && !reservedNonTenants.has(segments[0].toLowerCase()) && !segments[0].includes('.')) {
        const subPage = segments[1].replace(/\.html$/i, '');
        if (subPage === 'index' || knownPages.includes(subPage)) {
          req.url = `/${subPage}.html${query}`;
        }
      }
    }
    next();
  };

  return {
    name: 'clean-urls',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    }
  };
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), cleanUrlsPlugin(), copyStaticAssetsPlugin()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        company: resolve(__dirname, 'company.html'),
        admin: resolve(__dirname, 'admin.html'),
        collection: resolve(__dirname, 'collection.html'),
        official: resolve(__dirname, 'official.html'),
        result: resolve(__dirname, 'result.html'),
        student: resolve(__dirname, 'student.html'),
        worksheet: resolve(__dirname, 'worksheet.html'),
        attendance: resolve(__dirname, 'attendance.html'),
        academicPlan: resolve(__dirname, 'academic-plan.html'),
        activity: resolve(__dirname, 'activity.html'),
        evaluation: resolve(__dirname, 'evaluation.html'),
      }
    }
  }
});
