import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// inlineDynamicImports: ملف JS واحد (يسهل دمجه في صفحة HTML واحدة) رغم تحميل مكتبة Word عند الطلب
export default defineConfig({ plugins: [react()], build: { rollupOptions: { output: { inlineDynamicImports: true } } } });
