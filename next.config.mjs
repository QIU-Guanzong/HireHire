import { fileURLToPath } from 'node:url';
import { PHASE_PRODUCTION_BUILD } from 'next/constants.js';
import { captureBuildSource } from './scripts/build-source.mjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // A full .next release accompanies the custom transport-aware server.
  poweredByHeader: false,
  experimental: { cpus: 2 },
};
export default function configuration(phase) {
  const source = phase === PHASE_PRODUCTION_BUILD ? captureBuildSource(fileURLToPath(new URL('.', import.meta.url))) : null;
  return {
    ...nextConfig,
    generateBuildId: async () => source?.buildId ?? null,
    env: {
      HIREHIRE_BUILT_SOURCE_COMMIT: source?.commit ?? '',
      HIREHIRE_BUILT_SOURCE_TREE: source?.tree ?? '',
    },
  };
}
