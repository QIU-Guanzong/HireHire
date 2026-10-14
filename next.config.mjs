/** @type {import('next').NextConfig} */
const nextConfig = {
  // A full .next release accompanies the custom transport-aware server.
  poweredByHeader: false,
  experimental: { cpus: 2 },
};
export default nextConfig;
