import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // next/image is not usable in this deployment. Its default loader routes
      // every image through /_vinext/image, which worker/index.ts serves with
      // the Cloudflare `env.IMAGES` binding - and that binding is not declared
      // in .openai/hosting.json or in vite.config.ts, so the handler would
      // throw. Three of the call sites are also blob: object URLs and one
      // external QR service, none of which next/image can optimise.
      //
      // The real cost this rule is pointing at is the asset, not the tag:
      // public/brand/logo.png is 270 KB and public/brand/shield.png 154 KB,
      // both rendered at about 112x42. Re-export them at display size instead.
      "@next/next/no-img-element": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
